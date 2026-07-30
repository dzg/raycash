import { Cache, getPreferenceValues } from "@raycast/api";

/**
 * SimpleFIN Bridge client.
 *
 * Protocol reference: https://www.simplefin.org/protocol.html
 * Developer guide:    https://beta-bridge.simplefin.org/info/developers
 *
 * Two constraints drive the design of this file:
 *   1. The /accounts endpoint has a quota of roughly 24 requests per day.
 *      Exceeding it produces warnings and then DISABLES the access token.
 *   2. Upstream data refreshes about once per day per institution, so
 *      aggressive polling buys you nothing anyway.
 *
 * Everything therefore goes through a cache with a hard request floor and a
 * daily request counter.
 */

export interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description?: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
  transacted_at?: number;
}

export interface SimpleFinOrg {
  id?: string;
  name?: string;
  domain?: string;
  "sfin-url"?: string;
  url?: string;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  org: SimpleFinOrg;
  transactions?: SimpleFinTransaction[];
}

export interface AccountSet {
  errors: string[];
  accounts: SimpleFinAccount[];
  /** Epoch millis of the network fetch this data came from. */
  fetchedAt: number;
  /** True when this came from cache rather than a fresh request. */
  fromCache: boolean;
}

export interface Preferences {
  accessUrl: string;
  prefHistoryDays: string;
  prefAccountTxn: string;
  prefGlobalTxnCount: string;
  prefGlobalTxnDays: string;
  prefTitleMode: string;
  prefDateFormat: string;
  minIntervalMinutes: string;
}

const cache = new Cache({ namespace: "simplefin" });

const KEY_PAYLOAD = "payload";
const KEY_FETCHED_AT = "fetchedAt";
const KEY_COUNTER = "counter";
const KEY_ACCESS_URL = "accessUrl";

/** Absolute ceiling on network requests per calendar day, below SimpleFIN's ~24. */
const MAX_REQUESTS_PER_DAY = 18;
/** Even a forced refresh will not fire more often than this. */
const FORCE_FLOOR_MINUTES = 20;

export function getPrefs(): Preferences {
  return getPreferenceValues<Preferences>();
}

interface Counter {
  day: string;
  count: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCounter(): Counter {
  const raw = cache.get(KEY_COUNTER);
  if (!raw) return { day: today(), count: 0 };
  try {
    const parsed = JSON.parse(raw) as Counter;
    return parsed.day === today() ? parsed : { day: today(), count: 0 };
  } catch {
    return { day: today(), count: 0 };
  }
}

function bumpCounter(): void {
  const c = readCounter();
  cache.set(KEY_COUNTER, JSON.stringify({ day: c.day, count: c.count + 1 }));
}

export function requestsToday(): number {
  return readCounter().count;
}

/**
 * Splits the Access URL into an endpoint and an Authorization header.
 *
 * The Access URL arrives as https://user:pass@host/simplefin. Node's fetch
 * does not reliably forward userinfo embedded in a URL, so the credentials are
 * extracted and sent as an explicit Basic auth header instead.
 */
function buildRequest(
  accessUrl: string,
  days: number,
): { url: string; headers: Record<string, string> } {
  const parsed = new URL(accessUrl.trim());
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  parsed.username = "";
  parsed.password = "";

  const base = parsed.toString().replace(/\/+$/, "");
  const endpoint = new URL(`${base}/accounts`);

  const now = Math.floor(Date.now() / 1000);
  // SimpleFIN caps a single request at a 90 day span.
  const span = Math.min(Math.max(days, 1), 90);
  endpoint.searchParams.set("start-date", String(now - span * 86400));
  endpoint.searchParams.set("end-date", String(now));
  endpoint.searchParams.set("pending", "1");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (username || password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  return { url: endpoint.toString(), headers };
}

function readCache():
  | { accounts: SimpleFinAccount[]; errors: string[]; fetchedAt: number }
  | undefined {
  const raw = cache.get(KEY_PAYLOAD);
  const ts = cache.get(KEY_FETCHED_AT);
  if (!raw || !ts) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      accounts: SimpleFinAccount[];
      errors: string[];
    };
    return {
      accounts: parsed.accounts ?? [],
      errors: parsed.errors ?? [],
      fetchedAt: Number(ts),
    };
  } catch {
    return undefined;
  }
}

function shouldFetch(force: boolean, minIntervalMinutes: number): boolean {
  const cached = readCache();
  if (!cached) return true;

  if (requestsToday() >= MAX_REQUESTS_PER_DAY) return false;

  const ageMinutes = (Date.now() - cached.fetchedAt) / 60000;
  return force
    ? ageMinutes >= FORCE_FLOOR_MINUTES
    : ageMinutes >= minIntervalMinutes;
}

/**
 * Returns the current account set, hitting the network only when the cache is
 * stale enough and the daily quota allows it.
 */
export async function getAccountSet(force = false): Promise<AccountSet> {
  const prefs = getPrefs();
  const minInterval = Number(prefs.minIntervalMinutes || "90");
  const days = Number(prefs.prefHistoryDays || "30");

  if (cache.get(KEY_ACCESS_URL) !== prefs.accessUrl) {
    cache.remove(KEY_PAYLOAD);
    cache.remove(KEY_FETCHED_AT);
    cache.remove(KEY_COUNTER);
    cache.set(KEY_ACCESS_URL, prefs.accessUrl);
    force = true;
  }

  if (!shouldFetch(force, minInterval)) {
    const cached = readCache();
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  if (!prefs.accessUrl || !prefs.accessUrl.includes("://")) {
    throw new Error(
      "No SimpleFIN Access URL configured. Add it in extension preferences.",
    );
  }

  const { url, headers } = buildRequest(prefs.accessUrl, days);

  let response: Response;
  try {
    bumpCounter();
    response = await fetch(url, { headers });
  } catch (err) {
    const cached = readCache();
    if (cached) return { ...cached, fromCache: true };
    throw new Error(`Could not reach SimpleFIN: ${(err as Error).message}`);
  }

  if (response.status === 403) {
    throw new Error(
      "SimpleFIN rejected the credentials (403). The Access URL may have been revoked.",
    );
  }
  if (!response.ok) {
    const cached = readCache();
    if (cached) return { ...cached, fromCache: true };
    const detail = await response.text().catch(() => "");
    throw new Error(
      `SimpleFIN returned ${response.status}.${detail ? ` ${detail.slice(0, 300)}` : ""}`,
    );
  }

  const body = (await response.json()) as {
    accounts?: SimpleFinAccount[];
    errors?: string[];
  };
  const accounts = body.accounts ?? [];
  const errors = body.errors ?? [];
  const fetchedAt = Date.now();

  cache.set(KEY_PAYLOAD, JSON.stringify({ accounts, errors }));
  cache.set(KEY_FETCHED_AT, String(fetchedAt));

  return { accounts, errors, fetchedAt, fromCache: false };
}

/** Formats a SimpleFIN decimal string. Falls back to plain digits for non-ISO currencies. */
export function formatAmount(
  value: string | number,
  currency?: string,
): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (Number.isNaN(n)) return "—";
  const iso =
    currency && /^[A-Za-z]{3}$/.test(currency)
      ? currency.toUpperCase()
      : undefined;
  return new Intl.NumberFormat("en-US", {
    ...(iso ? { style: "currency" as const, currency: iso } : {}),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Institutions disagree about the sign of credit balances. The invert balance
 * setting lets you flip specific accounts so the net total comes out right.
 */
export function signedBalance(
  account: SimpleFinAccount,
  settings?: Record<string, string>,
): number {
  const raw = Number.parseFloat(account.balance);
  if (Number.isNaN(raw)) return 0;
  const shouldInvert = settings?.[`invert_${account.id}`] === "true";
  return shouldInvert ? -raw : raw;
}

export function relativeTime(epochMillis: number): string {
  const minutes = Math.round((Date.now() - epochMillis) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatDate(epochSeconds: number, format: string = "MM/DD"): string {
  if (!epochSeconds) return "";
  const date = new Date(epochSeconds * 1000);
  
  const map: Record<string, string> = {
    'YYYY': String(date.getFullYear()),
    'YY': String(date.getFullYear()).slice(-2),
    'MM': String(date.getMonth() + 1).padStart(2, '0'),
    'M': String(date.getMonth() + 1),
    'DD': String(date.getDate()).padStart(2, '0'),
    'D': String(date.getDate()),
  };
  
  return format.replace(/YYYY|YY|MM|M|DD|D/g, (match) => map[match]);
}
