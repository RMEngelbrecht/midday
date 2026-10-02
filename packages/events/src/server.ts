import { OpenPanel, type TrackProperties } from "@openpanel/nextjs";
import { ENV } from "./env";

export const setupAnalytics = async () => {
  const clientId = ENV.OPENPANEL_CLIENT_ID;
  const clientSecret = ENV.OPENPANEL_SECRET_KEY;
  const client =
    clientId && clientSecret ? new OpenPanel({ clientId, clientSecret }) : null;

  return {
    track: (options: { event: string } & TrackProperties) => {
      if (!client || ENV.APP_ENV !== "production") {
        console.log("Track", options);
        return;
      }

      const { event, ...rest } = options;

      client.track(event, rest).catch(() => {});
    },
  };
};
