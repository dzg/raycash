import {
  Clipboard,
  Color,
  Icon,
  LaunchType,
  LocalStorage,
  MenuBarExtra,
  environment,
  open,
  openExtensionPreferences,
  showHUD,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import {
  AccountSet,
  SimpleFinAccount,
  SimpleFinTransaction,
  formatAmount,
  getAccountSet,
  getPrefs,
  relativeTime,
  requestsToday,
  signedBalance,
  formatDate,
} from "./simplefin";

function transactionTitle(txn: SimpleFinTransaction): string {
  const label = (txn.payee || txn.description || "Transaction").trim();
  return label.length > 44 ? `${label.slice(0, 43)}…` : label;
}

function transactionDate(txn: SimpleFinTransaction, dateFormat: string): string {
  const epoch = txn.transacted_at ?? txn.posted;
  return formatDate(epoch, dateFormat);
}

function accountIcon(amount: number) {
  if (amount < 0) return { source: Icon.Minus, tintColor: Color.Red };
  return { source: Icon.Plus, tintColor: Color.Green };
}

function AccountSubmenu({
  account,
  settings,
  customName,
  txnLimit,
  txnDays,
  dateFormat,
}: {
  account: SimpleFinAccount;
  settings: Record<string, string>;
  customName?: string;
  txnLimit: number;
  txnDays?: number;
  dateFormat: string;
}) {
  const balance = signedBalance(account, settings);
  const label = formatAmount(balance, account.currency);
  const displayName = customName || account.name;
  const org = account.org?.name || account.org?.domain || "";
  const available = account["available-balance"];

  let txns = (account.transactions ?? []).slice();
  txns.sort(
    (a, b) => (b.transacted_at ?? b.posted) - (a.transacted_at ?? a.posted),
  );

  if (txnDays && txnDays > 0) {
    const cutoff = Date.now() / 1000 - txnDays * 86400;
    txns = txns.filter((t) => (t.transacted_at ?? t.posted) >= cutoff);
  } else {
    txns = txns.slice(0, txnLimit);
  }

  return (
    <MenuBarExtra.Submenu
      title={`${displayName} — ${label}`}
      icon={accountIcon(balance)}
    >
      <MenuBarExtra.Section title={org || undefined}>
        <MenuBarExtra.Item
          title={`Balance = ${label}`}
          subtitle={
            account["balance-date"]
              ? `as of ${formatDate(account["balance-date"], dateFormat)}`
              : undefined
          }
          icon={Icon.Coins}
          onAction={async () => {
            await Clipboard.copy(label);
            await showHUD(`Copied ${label}`);
          }}
        />
        {available && available !== account.balance ? (
          <MenuBarExtra.Item
            title={`Available ${formatAmount(available, account.currency)}`}
            icon={Icon.Wallet}
            onAction={() => undefined}
          />
        ) : null}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section
        title={txns.length ? "Recent Transactions" : undefined}
      >
        {txns.length === 0 ? (
          <MenuBarExtra.Item
            title="No transactions in range"
            icon={Icon.Tray}
            onAction={() => undefined}
          />
        ) : (
          txns.map((txn) => {
            const amount = Number.parseFloat(txn.amount);
            return (
              <MenuBarExtra.Item
                key={txn.id}
                title={transactionTitle(txn)}
                subtitle={`${formatAmount(txn.amount, account.currency)}${txn.pending ? " (pending)" : ""}  ·  ${transactionDate(txn, dateFormat)}`}
                icon={{
                  source:
                    amount < 0 ? Icon.ArrowUpCircle : Icon.ArrowDownCircle,
                  tintColor: amount < 0 ? Color.Red : Color.Green,
                }}
                tooltip={txn.memo || txn.description || undefined}
                onAction={async () => {
                  await Clipboard.copy(
                    `${transactionTitle(txn)} ${formatAmount(txn.amount, account.currency)}`,
                  );
                  await showHUD("Copied transaction");
                }}
              />
            );
          })
        )}
      </MenuBarExtra.Section>

      {account.org?.domain ? (
        <MenuBarExtra.Section>
          <MenuBarExtra.Item
            title={`Open ${account.org.domain}`}
            icon={Icon.Globe}
            onAction={() => open(`https://${account.org.domain}`)}
          />
        </MenuBarExtra.Section>
      ) : null}
    </MenuBarExtra.Submenu>
  );
}

export default function Command() {
  const prefs = getPrefs();
  const { data, isLoading, error, revalidate } = usePromise(async () => {
    const accountSet = await getAccountSet(
      environment.launchType === LaunchType.Background,
    );
    const settings = await LocalStorage.allItems<Record<string, string>>();
    return { ...accountSet, settings };
  });

  const accounts = data?.accounts ?? [];
  const settings = data?.settings ?? {};

  const txnLimit = Number(prefs.prefAccountTxn || "8");
  const globalTxnCount = prefs.prefGlobalTxnCount
    ? Number(prefs.prefGlobalTxnCount)
    : undefined;
  const globalTxnDays = prefs.prefGlobalTxnDays
    ? Number(prefs.prefGlobalTxnDays)
    : undefined;
  const titleMode = prefs.prefTitleMode || "total";
  const dateFormat = prefs.prefDateFormat || "MM/DD";

  const visibleAccounts = accounts.filter(
    (a) => settings[`hide_${a.id}`] !== "true",
  );

  // Group by institution so a dozen accounts stay navigable.
  const byOrg = new Map<string, SimpleFinAccount[]>();
  for (const account of visibleAccounts) {
    const key = account.org?.name || account.org?.domain || "Other";
    byOrg.set(key, [...(byOrg.get(key) ?? []), account]);
  }

  const net = visibleAccounts.reduce((sum, a) => {
    if (settings[`exclude_${a.id}`] === "true") return sum;
    return sum + signedBalance(a, settings);
  }, 0);

  const netLabel = formatAmount(net, visibleAccounts[0]?.currency ?? "USD");

  const title = error
    ? "—"
    : titleMode === "none"
      ? undefined
      : visibleAccounts.length
        ? netLabel
        : undefined;

  return (
    <MenuBarExtra
      icon={
        error ? { source: Icon.Warning, tintColor: Color.Red } : Icon.Wallet
      }
      title={title}
      isLoading={isLoading}
      tooltip="Raycash"
    >
      {error ? (
        <MenuBarExtra.Section title="Error">
          <MenuBarExtra.Item
            title={error.message}
            icon={Icon.ExclamationMark}
            onAction={() => openExtensionPreferences()}
          />
        </MenuBarExtra.Section>
      ) : null}

      {data?.errors?.length ? (
        (() => {
          const filteredErrors = data.errors.filter(e => !e.includes("45 days"));
          if (filteredErrors.length === 0) return null;
          return (
            <MenuBarExtra.Section title="Institution Warnings">
              {filteredErrors.map((message, i) => (
                <MenuBarExtra.Item
                  key={i}
                  title={message}
                  icon={{ source: Icon.Warning, tintColor: Color.Orange }}
                  onAction={() => open("https://beta-bridge.simplefin.org/")}
                />
              ))}
            </MenuBarExtra.Section>
          );
        })()
      ) : null}

      {[...byOrg.entries()].map(([org, orgAccounts]) => (
        <MenuBarExtra.Section key={org} title={org}>
          {orgAccounts.map((account) => (
            <AccountSubmenu
              key={account.id}
              account={account}
              settings={settings}
              customName={settings[account.id]}
              txnLimit={txnLimit}
              dateFormat={dateFormat}
            />
          ))}
        </MenuBarExtra.Section>
      ))}

      {visibleAccounts.length && titleMode === "none" ? (
        <MenuBarExtra.Section>
          <MenuBarExtra.Item
            title={`Net Total ${netLabel}`}
            icon={Icon.Calculator}
            onAction={async () => {
              await Clipboard.copy(netLabel);
              await showHUD(`Copied ${netLabel}`);
            }}
          />
        </MenuBarExtra.Section>
      ) : null}

      {(() => {
        let allTxns: (SimpleFinTransaction & {
          accountName: string;
          currency: string;
        })[] = [];
        if (globalTxnCount || globalTxnDays) {
          for (const acc of visibleAccounts) {
            const displayName = settings[acc.id] || acc.name;
            for (const t of acc.transactions ?? []) {
              allTxns.push({
                ...t,
                accountName: displayName,
                currency: acc.currency,
              });
            }
          }
          allTxns.sort(
            (a, b) =>
              (b.transacted_at ?? b.posted) - (a.transacted_at ?? a.posted),
          );
          if (globalTxnDays && globalTxnDays > 0) {
            const cutoff = Date.now() / 1000 - globalTxnDays * 86400;
            allTxns = allTxns.filter(
              (t) => (t.transacted_at ?? t.posted) >= cutoff,
            );
          }
          if (globalTxnCount && globalTxnCount > 0) {
            allTxns = allTxns.slice(0, globalTxnCount);
          }
        }

        if (allTxns.length === 0) return null;

        return (
          <MenuBarExtra.Section title="Global Recent Transactions">
            {allTxns.map((txn) => {
              const amount = Number.parseFloat(txn.amount);
              const dateStr = transactionDate(txn, dateFormat);
              const title = `${dateStr}  ·  ${txn.accountName}  ·  ${transactionTitle(txn)}`;
              
              return (
                <MenuBarExtra.Item
                  key={`${txn.accountName}-${txn.id}`}
                  title={title}
                  subtitle={`${formatAmount(txn.amount, txn.currency)}${txn.pending ? " (pending)" : ""}`}
                  icon={{
                    source:
                      amount < 0 ? Icon.ArrowUpCircle : Icon.ArrowDownCircle,
                    tintColor: amount < 0 ? Color.Red : Color.Green,
                  }}
                  tooltip={txn.memo || txn.description || undefined}
                  onAction={async () => {
                    await Clipboard.copy(
                      `${transactionTitle(txn)} ${formatAmount(txn.amount, txn.currency)}`,
                    );
                    await showHUD("Copied transaction");
                  }}
                />
              );
            })}
          </MenuBarExtra.Section>
        );
      })()}
    </MenuBarExtra>
  );
}
