import { auth } from "@api/auth";
import { verifyAccessToken } from "@api/utils/auth";
import { db } from "@midday/db/client";
import { listen } from "@midday/db/listen";
import { getTeamIdsByUserId } from "@midday/db/queries";
import { logger } from "@midday/logger";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { parseChangeEvent, RealtimeHub, type Subscriber } from "./hub";

export const REALTIME_CHANNEL = "midday_changes";
const HEARTBEAT_MS = 25_000;
const RETRY_MS = 3_000;

const hub = new RealtimeHub();
let listening = false;

/** One LISTEN connection per API process, opened on the first subscriber. */
function ensureListener() {
  if (listening) return;
  listening = true;
  listen(REALTIME_CHANNEL, (payload) => {
    const event = parseChangeEvent(payload);
    if (event) hub.publish(event);
  });
}

/**
 * The dashboard opens `new EventSource(API_URL/realtime, { withCredentials:
 * true })`, so the better-auth session cookie authenticates it (the same
 * cookie the dashboard needs to mint its API JWTs). Other clients may send
 * `Authorization: Bearer <jwt | session token>` instead.
 */
async function authenticate(c: Context): Promise<string | null> {
  const authorization = c.req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    const session = await verifyAccessToken(authorization.slice(7));
    if (session) return session.user.id;
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user.id ?? null;
}

async function loadTeamIds(userId: string) {
  return new Set(await getTeamIdsByUserId(db, userId));
}

/**
 * GET /realtime: Server-Sent Events with `change` events for the caller's
 * teams. Membership is re-read on every heartbeat, so leaving a team stops
 * the stream within one interval.
 */
export async function realtimeHandler(c: Context) {
  const userId = await authenticate(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const subscriber: Subscriber = {
    userId,
    teamIds: await loadTeamIds(userId),
    send: () => {},
  };

  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    ensureListener();

    subscriber.send = (event) => {
      stream
        .writeSSE({ event: "change", data: JSON.stringify(event) })
        .catch(() => {});
    };
    const unsubscribe = hub.subscribe(subscriber);
    stream.onAbort(unsubscribe);

    await stream.writeSSE({ event: "ready", data: "", retry: RETRY_MS });

    while (!stream.aborted && !stream.closed) {
      await stream.sleep(HEARTBEAT_MS);
      if (stream.aborted) break;
      try {
        subscriber.teamIds = await loadTeamIds(userId);
      } catch (error) {
        logger.warn("realtime: failed to refresh team membership", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await stream.writeSSE({ event: "ping", data: "" });
    }

    unsubscribe();
  });
}
