import { apps as allApps, getEnabledApps } from "@midday/app-store";
import { connectorApps } from "@midday/connectors";
import { getFeatures } from "@midday/features";
import { AppsTabs } from "./apps-tabs";
import { SearchField } from "./search-field";

export function AppsHeader() {
  const { integrations } = getFeatures();
  const officialApps = getEnabledApps(allApps, integrations);
  const connectors = integrations.composio
    ? connectorApps.filter((c) => c.active)
    : [];
  const totalApps = officialApps.length + connectors.length;

  return (
    <div className="flex space-x-4">
      <AppsTabs />
      <SearchField placeholder={`Search ${totalApps} apps`} shallow />
    </div>
  );
}
