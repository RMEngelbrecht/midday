/**
 * Session lookup against the API's better-auth `get-session`, shared by the
 * proxy (middleware) and server components.
 */

export type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
    twoFactorEnabled?: boolean | null;
    createdAt: string;
  };
  session: { id: string; expiresAt: string };
  /** Short-lived JWT for calling the API as `Authorization: Bearer`. */
  accessToken: string | null;
};

// better-auth cookie names (cookiePrefix "midday"); `__Secure-` on https.
const SESSION_COOKIE = "midday.session_token";
const TWO_FACTOR_COOKIE = "midday.two_factor";

function hasCookie(cookieHeader: string, name: string) {
  return cookieHeader.split(";").some((part) => {
    const key = part.trim().split("=", 1)[0];
    return key === name || key === `__Secure-${name}`;
  });
}

export function hasSessionCookie(cookieHeader: string) {
  return hasCookie(cookieHeader, SESSION_COOKIE);
}

/** Set after a first factor when a TOTP challenge is pending. */
export function hasPendingTwoFactor(cookieHeader: string) {
  return hasCookie(cookieHeader, TWO_FACTOR_COOKIE);
}

export async function fetchAuthSession(
  apiUrl: string,
  cookieHeader: string,
): Promise<{ session: AuthSession | null; setCookies: string[] }> {
  if (!hasSessionCookie(cookieHeader)) {
    return { session: null, setCookies: [] };
  }

  try {
    const res = await fetch(`${apiUrl}/auth/get-session`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });

    if (!res.ok) return { session: null, setCookies: [] };

    const data = (await res.json()) as Omit<AuthSession, "accessToken"> | null;

    return {
      session: data?.user
        ? { ...data, accessToken: res.headers.get("set-auth-jwt") }
        : null,
      setCookies: res.headers.getSetCookie(),
    };
  } catch {
    return { session: null, setCookies: [] };
  }
}

/** Whether the signed-in user is an instance admin (decided by the API). */
export async function fetchIsInstanceAdmin(
  apiUrl: string,
  accessToken: string | null,
): Promise<boolean> {
  if (!accessToken) return false;

  try {
    const res = await fetch(`${apiUrl}/trpc/instance.isAdmin`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      result?: { data?: { json?: unknown } };
    };
    return body.result?.data?.json === true;
  } catch {
    return false;
  }
}
