import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export function isDesktopApp() {
  return isTauri();
}

/**
 * Returns the deep link base URL (scheme + "://").
 * The scheme is a deployment setting (DESKTOP_SCHEME), read on the server and
 * passed to client code through the dashboard's runtime PublicConfig.
 *
 * @example
 * getDesktopSchemeUrl("midday") // "midday://"
 */
export function getDesktopSchemeUrl(scheme: string): string {
  return `${scheme}://`;
}

export type DeepLinkHandler = (path: string) => void;

export async function listenForDeepLinks(handler: DeepLinkHandler) {
  if (!isDesktopApp()) {
    console.log("Deep links are only available in desktop app");
    return () => {}; // No-op cleanup for non-desktop environments
  }

  try {
    const unlisten = await listen<string>("deep-link-navigate", (event) => {
      console.log("Deep link navigation received:", event.payload);
      handler(event.payload);
    });

    console.log("Deep link listener registered");
    return unlisten;
  } catch (error) {
    console.error("Failed to listen for deep links:", error);
    return () => {};
  }
}

/**
 * Generate a deep link URL.
 * @param path The path to navigate to (without leading slash)
 * @param scheme The desktop deep link scheme (DESKTOP_SCHEME)
 *
 * @example
 * createDeepLink("transactions/123", "midday-dev"); // "midday-dev://transactions/123"
 */
export function createDeepLink(path: string, scheme: string): string {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${getDesktopSchemeUrl(scheme)}${cleanPath}`;
}
