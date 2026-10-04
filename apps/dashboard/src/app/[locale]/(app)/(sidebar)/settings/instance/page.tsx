import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InstanceInvites } from "@/components/instance-invites";
import { getQueryClient, HydrateClient, trpc } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Instance | Midday",
};

// Non-admins are redirected by the proxy already; this is the backstop.
export default async function Instance() {
  const queryClient = getQueryClient();

  const isAdmin = await queryClient
    .fetchQuery(trpc.instance.isAdmin.queryOptions())
    .catch(() => false);

  if (!isAdmin) {
    redirect("/settings");
  }

  await queryClient.fetchQuery(trpc.instance.invites.list.queryOptions());

  return (
    <HydrateClient>
      <InstanceInvites />
    </HydrateClient>
  );
}
