"use client";

import { useEffect, useRef } from "react";
import { usePublicConfig } from "@/components/public-config-provider";
import {
  type ChangeType,
  getRealtime,
  matchesFilter,
  type RealtimeRows,
  type RealtimeTable,
} from "@/lib/realtime";

export type RealtimePayload<TN extends RealtimeTable> = {
  eventType: ChangeType;
  table: TN;
  /** The trigger's columns for this table; `{}` on DELETE. */
  new: Partial<RealtimeRows[TN]>;
  /** Same columns before the change; `{}` on INSERT. */
  old: Partial<RealtimeRows[TN]>;
};

interface UseRealtimeProps<TN extends RealtimeTable> {
  /** Kept for call-site readability; all subscriptions share one stream. */
  channelName: string;
  /** Specific events to listen for. Defaults to ["INSERT", "UPDATE"]. */
  events?: ChangeType[];
  table: TN;
  /** `column=eq.value`; nothing is subscribed until it is set. */
  filter?: string;
  onEvent: (payload: RealtimePayload<TN>) => void;
}

/**
 * Subscribes to row changes pushed by the API (`API_URL/realtime`). Payloads
 * carry ids and a few status columns only (see RealtimeRows); refetch the
 * relevant query for anything else. The server already limits events to
 * the user's teams; `filter` narrows them further.
 */
export function useRealtime<TN extends RealtimeTable>({
  events = ["INSERT", "UPDATE"],
  table,
  filter,
  onEvent,
}: UseRealtimeProps<TN>) {
  const { apiUrl } = usePublicConfig();
  const onEventRef = useRef(onEvent);
  const eventsRef = useRef(events);

  useEffect(() => {
    onEventRef.current = onEvent;
    eventsRef.current = events;
  });

  useEffect(() => {
    if (!filter) {
      return;
    }

    return getRealtime(apiUrl).subscribe((event) => {
      if (
        event.table !== table ||
        !eventsRef.current.includes(event.type) ||
        !matchesFilter(event, filter)
      ) {
        return;
      }

      onEventRef.current({
        eventType: event.type,
        table,
        new: event.new as Partial<RealtimeRows[TN]>,
        old: event.old as Partial<RealtimeRows[TN]>,
      });
    });
  }, [apiUrl, table, filter]);
}
