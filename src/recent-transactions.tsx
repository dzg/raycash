import { Action, ActionPanel, Color, Icon, List, LocalStorage, environment } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getAccountSet, getPrefs, SimpleFinTransaction, formatAmount, formatDate } from "./simplefin";

function transactionDate(txn: SimpleFinTransaction, dateFormat: string): string {
  const epoch = txn.transacted_at ?? txn.posted;
  return formatDate(epoch, dateFormat);
}

export default function Command() {
  const prefs = getPrefs();
  const { data, isLoading } = usePromise(async () => {
    const accountSet = await getAccountSet(environment.launchType === "background");
    const settings = await LocalStorage.allItems<Record<string, string>>();
    return { ...accountSet, settings };
  });

  const accounts = data?.accounts ?? [];
  const settings = data?.settings ?? {};
  const dateFormat = prefs.prefDateFormat || "MM/DD";

  const visibleAccounts = accounts.filter((a) => settings[`hide_${a.id}`] !== "true");

  let allTxns: (SimpleFinTransaction & { accountName: string; currency: string })[] = [];
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
  allTxns.sort((a, b) => (b.transacted_at ?? b.posted) - (a.transacted_at ?? a.posted));

  // Default limit if they have tons of history
  const displayTxns = allTxns.slice(0, 300);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter transactions...">
      {displayTxns.map((txn) => {
        const amount = Number.parseFloat(txn.amount);
        const dateStr = transactionDate(txn, dateFormat);
        const title = (txn.payee || txn.description || "Transaction").trim();
        const formattedAmount = formatAmount(txn.amount, txn.currency);

        return (
          <List.Item
            key={`${txn.accountName}-${txn.id}`}
            title={dateStr}
            subtitle={title}
            keywords={[formattedAmount, txn.amount, txn.accountName]}
            icon={{
              source: amount < 0 ? Icon.ArrowUpCircle : Icon.ArrowDownCircle,
              tintColor: amount < 0 ? Color.Red : Color.Green,
            }}
            accessories={[
              { text: txn.accountName, icon: Icon.Wallet },
              { text: formattedAmount },
            ]}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard
                  title="Copy Transaction Details"
                  content={`${dateStr} | ${txn.accountName} | ${title} | ${formattedAmount}`}
                />
                <Action.CopyToClipboard title="Copy Amount" content={formattedAmount} />
                <Action.CopyToClipboard title="Copy Description" content={title} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
