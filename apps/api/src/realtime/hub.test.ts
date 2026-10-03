import { describe, expect, it } from "bun:test";
import {
  type ChangeEvent,
  parseChangeEvent,
  RealtimeHub,
  type Subscriber,
  shouldDeliver,
} from "./hub";

const TEAM_A = "aaaaaaaa-0000-0000-0000-000000000000";
const TEAM_B = "bbbbbbbb-0000-0000-0000-000000000000";

function subscriber(userId: string, teams: string[]) {
  const received: ChangeEvent[] = [];
  const sub: Subscriber = {
    userId,
    teamIds: new Set(teams),
    send: (event) => received.push(event),
  };
  return { sub, received };
}

function event(partial: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    table: "inbox",
    type: "INSERT",
    team_id: TEAM_A,
    new: { id: "row-1", team_id: TEAM_A },
    old: {},
    ...partial,
  };
}

describe("parseChangeEvent", () => {
  it("parses a trigger payload", () => {
    const payload = JSON.stringify({
      table: "inbox",
      type: "UPDATE",
      team_id: TEAM_A,
      new: { id: "1", status: "done" },
      old: { id: "1", status: "new" },
    });
    expect(parseChangeEvent(payload)).toEqual({
      table: "inbox",
      type: "UPDATE",
      team_id: TEAM_A,
      new: { id: "1", status: "done" },
      old: { id: "1", status: "new" },
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseChangeEvent("not json")).toBeNull();
    expect(parseChangeEvent("[]")).toBeNull();
    expect(parseChangeEvent(JSON.stringify({ table: "inbox" }))).toBeNull();
    expect(
      parseChangeEvent(
        JSON.stringify({ table: "inbox", type: "TRUNCATE", team_id: TEAM_A }),
      ),
    ).toBeNull();
  });

  it("defaults missing row objects to {}", () => {
    const parsed = parseChangeEvent(
      JSON.stringify({
        table: "transactions",
        type: "INSERT",
        team_id: TEAM_A,
      }),
    );
    expect(parsed?.new).toEqual({});
    expect(parsed?.old).toEqual({});
  });
});

describe("shouldDeliver", () => {
  it("delivers only to members of the row's team", () => {
    expect(shouldDeliver(event(), subscriber("u1", [TEAM_A]).sub)).toBe(true);
    expect(shouldDeliver(event(), subscriber("u2", [TEAM_B]).sub)).toBe(false);
    expect(shouldDeliver(event(), subscriber("u3", [TEAM_B, TEAM_A]).sub)).toBe(
      true,
    );
    expect(shouldDeliver(event(), subscriber("u4", []).sub)).toBe(false);
  });

  it("delivers user-owned rows to their owner only", () => {
    const activity = event({
      table: "activities",
      new: { id: "a1", team_id: TEAM_A, user_id: "u1", priority: 1 },
    });
    expect(shouldDeliver(activity, subscriber("u1", [TEAM_A]).sub)).toBe(true);
    expect(shouldDeliver(activity, subscriber("u2", [TEAM_A]).sub)).toBe(false);

    const deleted = event({
      table: "activities",
      type: "DELETE",
      new: {},
      old: { id: "a1", team_id: TEAM_A, user_id: "u1" },
    });
    expect(shouldDeliver(deleted, subscriber("u2", [TEAM_A]).sub)).toBe(false);

    const teamWide = event({
      table: "activities",
      new: { id: "a2", team_id: TEAM_A, user_id: null },
    });
    expect(shouldDeliver(teamWide, subscriber("u2", [TEAM_A]).sub)).toBe(true);
  });
});

describe("RealtimeHub", () => {
  it("fans out to matching subscribers and stops after unsubscribe", () => {
    const hub = new RealtimeHub();
    const a = subscriber("u1", [TEAM_A]);
    const b = subscriber("u2", [TEAM_B]);
    const unsubscribeA = hub.subscribe(a.sub);
    hub.subscribe(b.sub);

    hub.publish(event());
    hub.publish(event({ team_id: TEAM_B }));
    expect(a.received.map((e) => e.team_id)).toEqual([TEAM_A]);
    expect(b.received.map((e) => e.team_id)).toEqual([TEAM_B]);

    unsubscribeA();
    expect(hub.size).toBe(1);
    hub.publish(event());
    expect(a.received).toHaveLength(1);
  });

  it("follows membership changes on the subscriber", () => {
    const hub = new RealtimeHub();
    const a = subscriber("u1", [TEAM_A]);
    hub.subscribe(a.sub);
    a.sub.teamIds = new Set();
    hub.publish(event());
    expect(a.received).toHaveLength(0);
  });
});
