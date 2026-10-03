import { createLoggerWithContext } from "@midday/logger";
import { Client } from "pg";
import { getDatabaseSsl, getPrimaryDatabaseUrl } from "./connection";

const logger = createLoggerWithContext("db:listen");

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

type ListenOptions = {
  /** Called after every (re)connect once LISTEN is active. */
  onConnect?: () => void;
};

/**
 * LISTEN on a Postgres channel over one dedicated connection (outside the
 * pool: a pooled connection can't hold a LISTEN). Reconnects with
 * exponential backoff; NOTIFYs sent while disconnected are lost, so
 * `onConnect` lets callers tell their consumers to resync.
 *
 * Always uses the primary: replicas don't deliver NOTIFY.
 */
export function listen(
  channel: string,
  onMessage: (payload: string) => void,
  options: ListenOptions = {},
): () => Promise<void> {
  let client: Client | null = null;
  let stopped = false;
  let backoff = MIN_BACKOFF_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    const delay = backoff;
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  const connect = async () => {
    const next = new Client({
      connectionString: getPrimaryDatabaseUrl(),
      ssl: getDatabaseSsl(),
      application_name: `listen:${channel}`,
      keepAlive: true,
    });
    client = next;

    let failed = false;
    const fail = (error?: Error) => {
      if (failed) return;
      failed = true;
      if (!stopped) {
        logger.warn("LISTEN connection lost, reconnecting", {
          channel,
          error: error?.message,
        });
      }
      next.removeAllListeners();
      next.on("error", () => {});
      void next.end().catch(() => {});
      if (client === next) client = null;
      scheduleReconnect();
    };

    next.on("error", fail);
    next.on("end", () => fail());
    next.on("notification", (message) => {
      if (message.channel === channel && message.payload) {
        onMessage(message.payload);
      }
    });

    try {
      await next.connect();
      await next.query(`LISTEN "${channel.replaceAll('"', '""')}"`);
    } catch (error) {
      fail(error as Error);
      return;
    }

    if (stopped) {
      await next.end().catch(() => {});
      return;
    }

    backoff = MIN_BACKOFF_MS;
    logger.info("LISTEN active", { channel });
    options.onConnect?.();
  };

  void connect();

  return async () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    const current = client;
    client = null;
    if (current) {
      current.removeAllListeners();
      current.on("error", () => {});
      await current.end().catch(() => {});
    }
  };
}
