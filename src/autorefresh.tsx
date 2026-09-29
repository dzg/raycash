import {
  LaunchProps,
  LaunchType,
  environment,
  showHUD,
  updateCommandMetadata,
} from "@raycast/api";
import {
  formatRefreshTime,
  getAccountSet,
  recordLaunch,
  repaintMenuBar,
} from "./simplefin";

/**
 * The background worker. Raycast launches it on the manifest interval; each
 * run fetches only once the cache is older than the minimum interval, then
 * repaints the menu bar so it shows what was fetched.
 *
 * Kept apart from the menu bar command on purpose. Raycast times a command's
 * next scheduled run from its last run of any kind, and opening the menu is a
 * run, so a menu bar command that carried its own interval never came due for
 * anyone who looked at it. Nothing the user does runs this command, so its
 * schedule holds. The same split is used by the store's Nightscout and Lock
 * Time extensions.
 */
export default async function Command(props: LaunchProps) {
  const manual = props.launchType === LaunchType.UserInitiated;

  if (environment.isDevelopment) {
    recordLaunch({
      at: Date.now(),
      prop: props.launchType,
      env: environment.launchType,
      source: "autorefresh",
    });
  }

  let outcome: string;
  try {
    const started = Date.now();
    const accountSet = await getAccountSet(false, { launch: true });
    if (!accountSet.fromCache) {
      outcome = "refreshed";
      await repaintMenuBar("autorefresh");
    } else if (accountSet.failure && accountSet.failure.at >= started) {
      outcome = `failed: ${accountSet.failure.message}`;
    } else {
      const minsAgo = Math.round((Date.now() - accountSet.fetchedAt) / 60000);
      outcome = `balances ${minsAgo}m old, no request needed`;
    }
  } catch (err) {
    outcome = `failed: ${(err as Error).message}`;
  }

  await updateCommandMetadata({
    subtitle: `Last check ${formatRefreshTime(Date.now())}: ${outcome}`,
  });

  // The HUD is for a person who ran this from Raycast. Background launches
  // have no one to show it to, and Raycast may refuse it there.
  if (manual) {
    try {
      await showHUD(
        outcome === "refreshed"
          ? "Balances refreshed"
          : `Auto-refresh: ${outcome}`,
      );
    } catch {
      // Not available in this launch; the subtitle has it.
    }
  }
}
