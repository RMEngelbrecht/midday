import { SecondaryMenu } from "@/components/secondary-menu";
import { getQueryClient, trpc } from "@/trpc/server";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The server decides; non-admins never see the Instance tab.
  const isInstanceAdmin = await getQueryClient()
    .fetchQuery(trpc.instance.isAdmin.queryOptions())
    .catch(() => false);

  return (
    <div className="max-w-[800px]">
      <SecondaryMenu
        items={[
          { path: "/settings", label: "General" },
          { path: "/settings/accounts", label: "Bank Connections" },
          { path: "/settings/members", label: "Members" },
          { path: "/settings/notifications", label: "Notifications" },
          { path: "/settings/developer", label: "Developer" },
          ...(isInstanceAdmin
            ? [{ path: "/settings/instance", label: "Instance" }]
            : []),
        ]}
      />

      <main className="mt-8">{children}</main>
    </div>
  );
}
