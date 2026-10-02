import {
  OpenPanelComponent,
  type TrackProperties,
  useOpenPanel,
} from "@openpanel/nextjs";

// Build mode (inlined by the bundler), not deployment configuration.
const isProd = process.env.NODE_ENV === "production";

/**
 * Renders the OpenPanel script when analytics is configured. The client id is
 * passed from the server (runtime config), never inlined at build time.
 */
const Provider = ({ clientId }: { clientId?: string }) =>
  clientId ? (
    <OpenPanelComponent
      clientId={clientId}
      trackAttributes={true}
      trackScreenViews={isProd}
      trackOutgoingLinks={isProd}
    />
  ) : null;

const track = (options: { event: string } & TrackProperties) => {
  const { track: openTrack } = useOpenPanel();

  if (!isProd) {
    console.log("Track", options);
    return;
  }

  const { event, ...rest } = options;

  openTrack(event, rest);
};

export { Provider, track };
