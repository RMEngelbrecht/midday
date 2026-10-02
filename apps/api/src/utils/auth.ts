import { auth } from "@api/auth";
import { ENV } from "@api/env";
import {
  createLocalJWKSet,
  errors,
  type JSONWebKeySet,
  type JWTPayload,
  jwtVerify,
} from "jose";

export type Session = {
  user: {
    id: string;
    email?: string;
    full_name?: string;
  };
  teamId?: string;
};

type AuthJWTPayload = JWTPayload & {
  email?: string;
  name?: string;
};

// The signing keys live in auth.jwks (better-auth jwt plugin). Load them
// in-process and reload once when a token names an unknown key (rotation).
let keySet: ReturnType<typeof createLocalJWKSet> | null = null;

async function loadKeySet() {
  const jwks = (await auth.api.getJwks()) as JSONWebKeySet;
  keySet = createLocalJWKSet(jwks);
  return keySet;
}

async function verify(token: string, reload: boolean): Promise<JWTPayload> {
  const keys = keySet && !reload ? keySet : await loadKeySet();
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: ENV.API_URL,
      audience: ENV.API_URL,
    });
    return payload;
  } catch (error) {
    if (!reload && error instanceof errors.JWKSNoMatchingKey) {
      return verify(token, true);
    }
    throw error;
  }
}

/**
 * Verifies a better-auth JWT (issued by API_URL/auth/token or the
 * `set-auth-jwt` header of get-session) and returns the user it names.
 * Team membership is resolved from the database by the callers.
 */
export async function verifyAccessToken(
  accessToken?: string,
): Promise<Session | null> {
  // Midday API keys / OAuth tokens are opaque, never JWTs.
  if (!accessToken || accessToken.split(".").length !== 3) return null;

  try {
    const payload = (await verify(accessToken, false)) as AuthJWTPayload;
    if (!payload.sub) return null;

    return {
      user: {
        id: payload.sub,
        email: payload.email,
        full_name: payload.name || undefined,
      },
    };
  } catch {
    return null;
  }
}
