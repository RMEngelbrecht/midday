/**
 * In-process fan-out of Postgres change notifications (channel
 * `midday_changes`, see packages/db/migrations/0005_*) to SSE subscribers.
 * Pure: no IO, so team scoping is unit-testable.
 */

export const CHANGE_TYPES = ["INSERT", "UPDATE", "DELETE"] as const;

export type ChangeEvent = {
  table: string;
  type: (typeof CHANGE_TYPES)[number];
  team_id: string;
  /** id, team_id and a few small columns; `{}` on DELETE. */
  new: Record<string, unknown>;
  /** Same columns before the change; `{}` on INSERT. */
  old: Record<string, unknown>;
};

export type Subscriber = {
  userId: string;
  /** Teams the user belongs to (users_on_team), refreshed by the route. */
  teamIds: ReadonlySet<string>;
  send: (event: ChangeEvent) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a NOTIFY payload; null for anything not shaped like a change. */
export function parseChangeEvent(payload: string): ChangeEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    typeof value.table !== "string" ||
    typeof value.team_id !== "string" ||
    !CHANGE_TYPES.includes(value.type as ChangeEvent["type"])
  ) {
    return null;
  }

  return {
    table: value.table,
    type: value.type as ChangeEvent["type"],
    team_id: value.team_id,
    new: isRecord(value.new) ? value.new : {},
    old: isRecord(value.old) ? value.old : {},
  };
}

/**
 * A subscriber sees changes of its own teams only. Rows that belong to one
 * user (activities.user_id) go to that user only.
 */
export function shouldDeliver(event: ChangeEvent, subscriber: Subscriber) {
  if (!subscriber.teamIds.has(event.team_id)) return false;

  const owner = event.new.user_id ?? event.old.user_id;
  return typeof owner !== "string" || owner === subscriber.userId;
}

export class RealtimeHub {
  #subscribers = new Set<Subscriber>();

  get size() {
    return this.#subscribers.size;
  }

  subscribe(subscriber: Subscriber) {
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  publish(event: ChangeEvent) {
    for (const subscriber of this.#subscribers) {
      if (shouldDeliver(event, subscriber)) subscriber.send(event);
    }
  }
}
