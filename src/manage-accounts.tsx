import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  LocalStorage,
  Toast,
  showToast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { SimpleFinAccount, formatAmount, getAccountSet } from "./simplefin";

function AccountSettingsForm({
  account,
  settings,
  onSaved,
}: {
  account: SimpleFinAccount;
  settings: Record<string, string>;
  onSaved: (id: string, newSettings: Record<string, string>) => void;
}) {
  const { pop } = useNavigation();
  const currentName = settings[account.id];
  const isHidden = settings[`hide_${account.id}`] === "true";
  const isExcluded = settings[`exclude_${account.id}`] === "true";
  const isInverted = settings[`invert_${account.id}`] === "true";

  return (
    <Form
      navigationTitle={`Settings for ${account.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Settings"
            onSubmit={async (values) => {
              const newName = values.name.trim();
              const newSettings: Record<string, string> = { ...settings };

              if (newName) {
                await LocalStorage.setItem(account.id, newName);
                newSettings[account.id] = newName;
              } else {
                await LocalStorage.removeItem(account.id);
                delete newSettings[account.id];
              }

              if (values.hidden) {
                await LocalStorage.setItem(`hide_${account.id}`, "true");
                newSettings[`hide_${account.id}`] = "true";
              } else {
                await LocalStorage.removeItem(`hide_${account.id}`);
                delete newSettings[`hide_${account.id}`];
              }

              if (values.excluded) {
                await LocalStorage.setItem(`exclude_${account.id}`, "true");
                newSettings[`exclude_${account.id}`] = "true";
              } else {
                await LocalStorage.removeItem(`exclude_${account.id}`);
                delete newSettings[`exclude_${account.id}`];
              }

              if (values.inverted) {
                await LocalStorage.setItem(`invert_${account.id}`, "true");
                newSettings[`invert_${account.id}`] = "true";
              } else {
                await LocalStorage.removeItem(`invert_${account.id}`);
                delete newSettings[`invert_${account.id}`];
              }

              onSaved(account.id, newSettings);
              await showToast({
                style: Toast.Style.Success,
                title: "Settings Saved",
              });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text={`Original name: ${account.name}`} />
      <Form.TextField
        id="name"
        title="Display Name"
        defaultValue={currentName || account.name}
      />
      <Form.Checkbox
        id="hidden"
        label="Hide account entirely"
        defaultValue={isHidden}
      />
      <Form.Checkbox
        id="excluded"
        label="Exclude from Net Total"
        defaultValue={isExcluded}
      />
      <Form.Checkbox
        id="inverted"
        label="Invert Balance Sign"
        defaultValue={isInverted}
      />
    </Form>
  );
}

export default function Command() {
  const [settings, setSettings] = useState<Record<string, string>>({});

  const { data, isLoading, error } = usePromise(async () => {
    const accountSet = await getAccountSet(false);
    const local = await LocalStorage.allItems<Record<string, string>>();
    setSettings(local);
    return accountSet;
  });

  const accounts = data?.accounts ?? [];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search accounts...">
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Error"
          description={error.message}
        />
      ) : accounts.length === 0 && !isLoading ? (
        <List.EmptyView icon={Icon.Wallet} title="No Accounts Found" />
      ) : null}

      {accounts.map((account) => {
        const customName = settings[account.id];
        const isHidden = settings[`hide_${account.id}`] === "true";
        const isExcluded = settings[`exclude_${account.id}`] === "true";

        const displayName = customName || account.name;
        const orgName = account.org?.name || account.org?.domain || "Unknown";
        const subtitle = formatAmount(account.balance, account.currency);

        const accessories = [];
        if (isHidden)
          accessories.push({ text: "Hidden", icon: Icon.EyeDisabled });
        else if (isExcluded)
          accessories.push({ text: "Excluded", icon: Icon.MinusCircle });
        accessories.push({ text: orgName });

        return (
          <List.Item
            key={account.id}
            icon={Icon.Wallet}
            title={displayName}
            subtitle={subtitle}
            accessories={accessories}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Edit Account Settings"
                  icon={Icon.Pencil}
                  target={
                    <AccountSettingsForm
                      account={account}
                      settings={settings}
                      onSaved={(id, newSettings) => {
                        setSettings(newSettings);
                      }}
                    />
                  }
                />
                <Action
                  title={isHidden ? "Unhide Account" : "Hide Account"}
                  icon={isHidden ? Icon.Eye : Icon.EyeDisabled}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
                  onAction={async () => {
                    const nextVal = !isHidden;
                    if (nextVal) {
                      await LocalStorage.setItem(`hide_${account.id}`, "true");
                    } else {
                      await LocalStorage.removeItem(`hide_${account.id}`);
                    }
                    setSettings((prev) => {
                      const next = { ...prev };
                      if (nextVal) next[`hide_${account.id}`] = "true";
                      else delete next[`hide_${account.id}`];
                      return next;
                    });
                    await showToast({
                      style: Toast.Style.Success,
                      title: nextVal ? "Account Hidden" : "Account Unhidden",
                    });
                  }}
                />
                <Action
                  title={
                    isExcluded
                      ? "Include in Net Total"
                      : "Exclude from Net Total"
                  }
                  icon={isExcluded ? Icon.PlusCircle : Icon.MinusCircle}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
                  onAction={async () => {
                    const nextVal = !isExcluded;
                    if (nextVal) {
                      await LocalStorage.setItem(
                        `exclude_${account.id}`,
                        "true",
                      );
                    } else {
                      await LocalStorage.removeItem(`exclude_${account.id}`);
                    }
                    setSettings((prev) => {
                      const next = { ...prev };
                      if (nextVal) next[`exclude_${account.id}`] = "true";
                      else delete next[`exclude_${account.id}`];
                      return next;
                    });
                    await showToast({
                      style: Toast.Style.Success,
                      title: nextVal ? "Account Excluded" : "Account Included",
                    });
                  }}
                />
                {customName || isHidden || isExcluded || settings[`invert_${account.id}`] === "true" ? (
                  <Action
                    title="Reset All Settings"
                    icon={Icon.ArrowCounterClockwise}
                    style={Action.Style.Destructive}
                    onAction={async () => {
                      await LocalStorage.removeItem(account.id);
                      await LocalStorage.removeItem(`hide_${account.id}`);
                      await LocalStorage.removeItem(`exclude_${account.id}`);
                      await LocalStorage.removeItem(`invert_${account.id}`);
                      setSettings((prev) => {
                        const next = { ...prev };
                        delete next[account.id];
                        delete next[`hide_${account.id}`];
                        delete next[`exclude_${account.id}`];
                        delete next[`invert_${account.id}`];
                        return next;
                      });
                      await showToast({
                        style: Toast.Style.Success,
                        title: "Settings Reset",
                      });
                    }}
                  />
                ) : null}
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
