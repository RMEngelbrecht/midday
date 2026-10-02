"use client";

import { Card, CardDescription, CardHeader, CardTitle } from "@midday/ui/card";
import { CopyInput } from "@/components/copy-input";
import { useInboxEmail } from "@/hooks/use-inbox-email";
import { useUserQuery } from "@/hooks/use-user";

export function InboxEmailSettings() {
  const { data: user } = useUserQuery();
  const inboxEmail = useInboxEmail(user?.team?.inboxId);

  if (!inboxEmail) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Address</CardTitle>
        <CardDescription>
          Use this unique email address for online purchases and receipts.
          Emails sent to this address will automatically appear in your inbox
          and can be matched against transactions.
        </CardDescription>
      </CardHeader>

      <div className="px-6 pb-6 max-w-[400px]">
        <CopyInput value={inboxEmail} />
      </div>
    </Card>
  );
}
