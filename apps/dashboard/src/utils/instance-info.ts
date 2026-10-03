/**
 * Public, unauthenticated description of this deployment. The desktop app and
 * the CLI fetch it from `GET <APP_URL>/api/instance` to discover the API URL
 * and the deep-link scheme from the one URL a user knows (the dashboard).
 */
export type InstanceInfo = {
  appUrl: string;
  apiUrl: string;
  desktopScheme: string;
  version: string;
};

export function buildInstanceInfo(config: {
  appUrl: string;
  apiUrl: string;
  desktopScheme: string;
  release?: string | null;
}): InstanceInfo {
  return {
    appUrl: config.appUrl.replace(/\/+$/, ""),
    apiUrl: config.apiUrl.replace(/\/+$/, ""),
    desktopScheme: config.desktopScheme,
    version: config.release || "dev",
  };
}
