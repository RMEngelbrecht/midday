import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import {
  type ChangeEvent,
  matchesFilter,
  RealtimeSubscriptions,
} from "./realtime";

class FakeEventSource {
  readyState = 0;
  closed = false;
  #handlers = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, handler: (event: unknown) => void) {
    this.#handlers.set(type, [...(this.#handlers.get(type) ?? []), handler]);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  emit(type: string, data = "") {
    for (const handler of this.#handlers.get(type) ?? []) handler({ data });
  }

  change(event: ChangeEvent) {
    this.emit("change", JSON.stringify(event));
  }
}

const TEAM = "team-a";

function change(partial: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    table: "inbox",
    type: "INSERT",
    team_id: TEAM,
    new: { id: "1", team_id: TEAM, status: "new" },
    old: {},
    ...partial,
  };
}

function setup() {
  const sources: FakeEventSource[] = [];
  const manager = new RealtimeSubscriptions(() => {
    const source = new FakeEventSource();
    sources.push(source);
    return source as unknown as EventSource;
  });
  return { manager, sources };
}

describe("RealtimeSubscriptions", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("opens one shared source and closes it with the last subscriber", () => {
    const { manager, sources } = setup();
    const a: ChangeEvent[] = [];
    const b: ChangeEvent[] = [];

    const offA = manager.subscribe((e) => a.push(e));
    const offB = manager.subscribe((e) => b.push(e));
    expect(sources).toHaveLength(1);

    sources[0]!.change(change());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    offA();
    expect(sources[0]!.closed).toBe(false);
    sources[0]!.change(change());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);

    offB();
    expect(sources[0]!.closed).toBe(true);
    expect(manager.connected).toBe(false);

    manager.subscribe(() => {});
    expect(sources).toHaveLength(2);
  });

  it("ignores malformed messages and isolates throwing listeners", () => {
    const { manager, sources } = setup();
    const received: ChangeEvent[] = [];
    const error = console.error;
    console.error = () => {};
    manager.subscribe(() => {
      throw new Error("boom");
    });
    manager.subscribe((e) => received.push(e));

    sources[0]!.emit("change", "not json");
    sources[0]!.change(change());
    console.error = error;
    expect(received).toHaveLength(1);
  });

  it("leaves transient errors to the browser's own retry", () => {
    const { manager, sources } = setup();
    manager.subscribe(() => {});
    sources[0]!.readyState = 0; // CONNECTING
    sources[0]!.emit("error");
    jest.advanceTimersByTime(60_000);
    expect(sources).toHaveLength(1);
  });

  it("reopens with backoff after the browser gives up", () => {
    const { manager, sources } = setup();
    manager.subscribe(() => {});

    sources[0]!.readyState = 2; // CLOSED, e.g. 502 while the API restarts
    sources[0]!.emit("error");
    expect(manager.connected).toBe(false);
    jest.advanceTimersByTime(999);
    expect(sources).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);

    sources[1]!.readyState = 2;
    sources[1]!.emit("error");
    jest.advanceTimersByTime(1_999);
    expect(sources).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(sources).toHaveLength(3);

    // A successful handshake resets the backoff.
    sources[2]!.emit("ready");
    sources[2]!.readyState = 2;
    sources[2]!.emit("error");
    jest.advanceTimersByTime(1_000);
    expect(sources).toHaveLength(4);
  });

  it("does not reconnect once everyone has unsubscribed", () => {
    const { manager, sources } = setup();
    const off = manager.subscribe(() => {});
    sources[0]!.readyState = 2;
    sources[0]!.emit("error");
    off();
    jest.advanceTimersByTime(60_000);
    expect(sources).toHaveLength(1);
  });
});

describe("matchesFilter", () => {
  it("matches column=eq.value against the new row", () => {
    expect(matchesFilter(change(), `team_id=eq.${TEAM}`)).toBe(true);
    expect(matchesFilter(change(), "team_id=eq.other")).toBe(false);
    expect(matchesFilter(change(), "team_id=eq.undefined")).toBe(false);
    expect(matchesFilter(change(), "id=eq.1")).toBe(true);
    expect(matchesFilter(change(), "garbage")).toBe(false);
  });

  it("matches DELETE against the old row", () => {
    const deleted = change({
      type: "DELETE",
      new: {},
      old: { id: "1", team_id: TEAM },
    });
    expect(matchesFilter(deleted, `team_id=eq.${TEAM}`)).toBe(true);
  });

  it("compares numbers as strings and never matches missing columns", () => {
    const activity = change({
      table: "activities",
      new: { id: "a", team_id: TEAM, user_id: null, priority: 2 },
    });
    expect(matchesFilter(activity, "priority=eq.2")).toBe(true);
    expect(matchesFilter(activity, "user_id=eq.null")).toBe(false);
  });
});
