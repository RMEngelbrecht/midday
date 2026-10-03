/**
 * Browser side of API_URL/realtime (Server-Sent Events fed by Postgres
 * NOTIFY, see apps/api/src/realtime). One EventSource per tab, shared by
 * every `useRealtime` subscription and closed when the last one leaves.
 *
 * Auth: the better-auth session cookie (`withCredentials`), the same cookie
 * `getAccessToken()` relies on. EventSource retries dropped connections
 * itself (server `retry:` hint); when it gives up (e.g. a 401/5xx response
 * while the API restarts) we reopen it with backoff.
 */

export type ChangeType = "INSERT" | "UPDATE" | "DELETE";

/** Columns each table's trigger includes (migration 0005). */
export type RealtimeRows = {
  inbox: { id: string; team_id: string; status: string | null };
  documents: {
    id: string;
    team_id: string;
    processing_status: string | null;
  };
  customers: { id: string; team_id: string; enrichment_status: string | null };
  activities: {
    id: string;
    team_id: string;
    user_id: string | null;
    priority: number | null;
    status: string;
  };
  insights: { id: string; team_id: string; status: string };
  /** Statement-level: one event per team and statement, no row id. */
  transactions: { team_id: string };
};

export type RealtimeTable = keyof RealtimeRows;

/** Wire format of a `change` event. */
export type ChangeEvent = {
  table: string;
  type: ChangeType;
  team_id: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

type EventSourceLike = Pick<
  EventSource,
  "addEventListener" | "close" | "readyState"
>;

const CLOSED = 2;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Supabase-style `column=eq.value` filters, the only form the dashboard
 * uses. Matched against the new row (old row for DELETE).
 */
export function matchesFilter(event: ChangeEvent, filter: string) {
  const match = /^([a-z_]+)=eq\.(.*)$/.exec(filter);
  if (!match) return false;
  const [, column, value] = match;
  const row = event.type === "DELETE" ? event.old : event.new;
  const actual = row[column!];
  return actual !== null && actual !== undefined && String(actual) === value;
}

export class RealtimeSubscriptions {
  #listeners = new Set<(event: ChangeEvent) => void>();
  #source: EventSourceLike | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #backoff = MIN_BACKOFF_MS;

  constructor(private readonly open: () => EventSourceLike) {}

  get size() {
    return this.#listeners.size;
  }

  get connected() {
    return this.#source !== null;
  }

  subscribe(listener: (event: ChangeEvent) => void) {
    this.#listeners.add(listener);
    if (!this.#source && !this.#retryTimer) this.#connect();

    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#disconnect();
    };
  }

  #connect() {
    const source = this.open();
    this.#source = source;

    source.addEventListener("ready", () => {
      this.#backoff = MIN_BACKOFF_MS;
    });

    source.addEventListener("change", (message) => {
      let event: ChangeEvent;
      try {
        event = JSON.parse((message as MessageEvent<string>).data);
      } catch {
        return;
      }
      for (const listener of [...this.#listeners]) {
        try {
          listener(event);
        } catch (error) {
          console.error("[Realtime] listener failed", error);
        }
      }
    });

    source.addEventListener("error", () => {
      // CONNECTING: the browser is already retrying.
      if (source.readyState !== CLOSED || this.#source !== source) return;
      source.close();
      this.#source = null;
      if (this.#listeners.size === 0) return;
      const delay = this.#backoff;
      this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = null;
        if (this.#listeners.size > 0) this.#connect();
      }, delay);
    });
  }

  #disconnect() {
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#source?.close();
    this.#source = null;
    this.#backoff = MIN_BACKOFF_MS;
  }
}

let shared: RealtimeSubscriptions | null = null;

export function getRealtime(apiUrl: string) {
  shared ??= new RealtimeSubscriptions(
    () => new EventSource(`${apiUrl}/realtime`, { withCredentials: true }),
  );
  return shared;
}
