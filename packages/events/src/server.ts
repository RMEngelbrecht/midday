import { OpenPanel, type TrackProperties } from "@openpanel/nextjs";
import { ENV } from "./env";

type TrackOptions = { event: string } & TrackProperties;

type AnalyticsEnv = {
  OPENPANEL_CLIENT_ID?: string;
  OPENPANEL_SECRET_KEY?: string;
  APP_ENV: string;
};

type Tracker = { track: (options: TrackOptions) => void };

/**
 * Builds the server tracker. Without both OPENPANEL_* keys it is a no-op: no
 * client is created, nothing is logged and no network request is made.
 */
export function createTracker(
  env: AnalyticsEnv,
  createClient: (credentials: {
    clientId: string;
    clientSecret: string;
  }) => Pick<OpenPanel, "track"> = (credentials) => new OpenPanel(credentials),
): Tracker {
  const clientId = env.OPENPANEL_CLIENT_ID;
  const clientSecret = env.OPENPANEL_SECRET_KEY;

  if (!clientId || !clientSecret) {
    return { track: () => {} };
  }

  const client = createClient({ clientId, clientSecret });

  return {
    track: (options) => {
      if (env.APP_ENV !== "production") {
        console.log("Track", options);
        return;
      }

      const { event, ...rest } = options;

      client.track(event, rest).catch(() => {});
    },
  };
}

export const setupAnalytics = async () => createTracker(ENV);
