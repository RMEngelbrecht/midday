import { deriveFeatures, FEATURE_ENV_KEYS, type Features } from "./derive";
import { ENV } from "./env";

export * from "./derive";

/** Features enabled by the current process env. Server-side only. */
export function getFeatures(): Features {
  return deriveFeatures(
    Object.fromEntries(FEATURE_ENV_KEYS.map((key) => [key, ENV[key]])),
  );
}
