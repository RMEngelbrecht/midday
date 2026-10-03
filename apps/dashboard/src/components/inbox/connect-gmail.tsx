"use client";

import { Icons } from "@midday/ui/icons";
import { SubmitButton } from "@midday/ui/submit-button";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePublicConfig } from "@/components/public-config-provider";
import { useTRPC } from "@/trpc/client";

type Props = {
  redirectPath?: string;
};

export function ConnectGmail({ redirectPath }: Props) {
  const { features } = usePublicConfig();
  const trpc = useTRPC();
  const router = useRouter();

  const connectMutation = useMutation(
    trpc.inboxAccounts.connect.mutationOptions({
      onSuccess: (authUrl) => {
        if (authUrl) {
          router.push(authUrl);
        }
      },
    }),
  );

  // Needs operator-registered OAuth credentials (see docs/self-hosting.md).
  if (!features.integrations.gmail) return null;

  return (
    <SubmitButton
      className="px-4 font-medium h-[40px] w-full"
      variant="outline"
      data-track="Inbox Email Connected"
      data-provider="gmail"
      onClick={() =>
        connectMutation.mutate({ provider: "gmail", redirectPath })
      }
      isSubmitting={connectMutation.isPending}
    >
      <div className="flex items-center space-x-2">
        <Icons.Gmail />
        <span>Connect Gmail</span>
      </div>
    </SubmitButton>
  );
}
