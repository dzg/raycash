import {
  Action,
  ActionPanel,
  Form,
  LocalStorage,
  Toast,
  showToast,
  popToRoot,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";

export default function Command() {
  const { data: settings, isLoading } = usePromise(async () => {
    return await LocalStorage.allItems<Record<string, string>>();
  });

  if (isLoading) {
    return <Form isLoading={true} />;
  }

  return (
    <Form
      navigationTitle="Global Settings"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Settings"
            onSubmit={async (values) => {
              const keys = [
                "prefHistoryDays",
                "prefAccountTxn",
                "prefGlobalTxnCount",
                "prefGlobalTxnDays",
                "prefTitleMode",
                "prefDateFormat",
                "minIntervalMinutes",
              ];

              for (const key of keys) {
                const val = values[key];
                if (val && val !== "") {
                  await LocalStorage.setItem(key, val);
                } else {
                  await LocalStorage.removeItem(key);
                }
              }

              await showToast({
                style: Toast.Style.Success,
                title: "Global Settings Saved",
              });
              popToRoot();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="prefHistoryDays"
        title="Transaction History (Days)"
        info="How many days of transactions to request (SimpleFIN caps a single request at 90 days)."
        defaultValue={settings?.["prefHistoryDays"] || "30"}
      />

      <Form.TextField
        id="prefAccountTxn"
        title="Transactions Per Account"
        info="How many recent transactions to list inside each account submenu."
        defaultValue={settings?.["prefAccountTxn"] || "8"}
      />

      <Form.TextField
        id="prefGlobalTxnCount"
        title="Global Transactions Count"
        info="How many recent transactions to show in the combined list at the bottom. Leave blank or 0 for none."
        defaultValue={settings?.["prefGlobalTxnCount"] || "15"}
      />

      <Form.TextField
        id="prefGlobalTxnDays"
        title="Global Transactions Days"
        info="Alternatively, show all transactions from the last X days in the combined list. Leave blank for none."
        defaultValue={settings?.["prefGlobalTxnDays"] || "7"}
      />

      <Form.Dropdown
        id="prefTitleMode"
        title="Menu Bar Title"
        info="What to display next to the icon in the menu bar."
        defaultValue={settings?.["prefTitleMode"] || "total"}
      >
        <Form.Dropdown.Item title="Net total" value="total" />
        <Form.Dropdown.Item title="Icon only" value="none" />
      </Form.Dropdown>

      <Form.TextField
        id="prefDateFormat"
        title="Date Format"
        info="e.g. MM/DD, DD/MM, MM-DD, YYYY-MM-DD"
        defaultValue={settings?.["prefDateFormat"] || "MM/DD"}
      />

      <Form.TextField
        id="minIntervalMinutes"
        title="Minimum Fetch Interval (Minutes)"
        info="Hard floor between network requests. (SimpleFIN suggests ~90 mins)."
        defaultValue={settings?.["minIntervalMinutes"] || "90"}
      />
    </Form>
  );
}
