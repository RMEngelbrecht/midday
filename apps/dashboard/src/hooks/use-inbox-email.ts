"use client";

import { formatInboxAddress } from "@midday/inbox/address";
import { usePublicConfig } from "@/components/public-config-provider";

/** The team's email forwarding address, or null when inbound email is off. */
export function useInboxEmail(inboxId?: string | null): string | null {
  const { inboxEmail } = usePublicConfig();
  if (!inboxEmail || !inboxId) return null;
  return formatInboxAddress(inboxId, inboxEmail);
}
