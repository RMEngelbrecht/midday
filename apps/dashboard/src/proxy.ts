import { type NextRequest, NextResponse } from "next/server";
import { createI18nMiddleware } from "next-international/middleware";
import { ENV } from "@/env";
import {
  type AuthSession,
  fetchAuthSession,
  hasPendingTwoFactor,
} from "@/utils/auth-session";

const I18nMiddleware = createI18nMiddleware({
  locales: ["en"],
  defaultLocale: "en",
  urlMappingStrategy: "rewrite",
});

// Brief in-process cache of session lookups, keyed by the cookie header, so
// client-side navigations don't each round-trip to the API.
const SESSION_CACHE_TTL_MS = 15_000;
const SESSION_CACHE_MAX = 1000;
const sessionCache = new Map<
  string,
  { session: AuthSession; expiresAt: number }
>();

async function getSession(cookieHeader: string) {
  const cached = sessionCache.get(cookieHeader);
  if (cached && cached.expiresAt > Date.now()) {
    return { session: cached.session, setCookies: [] as string[] };
  }

  const result = await fetchAuthSession(ENV.API_INTERNAL_URL, cookieHeader);

  if (result.session) {
    if (sessionCache.size >= SESSION_CACHE_MAX) {
      const oldest = sessionCache.keys().next().value;
      if (oldest !== undefined) sessionCache.delete(oldest);
    }
    sessionCache.set(cookieHeader, {
      session: result.session,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    });
  }

  return result;
}

const PUBLIC_PATHS = ["/login", "/mfa/verify"];
const PUBLIC_SEGMENTS = [
  "/i/",
  "/p/",
  "/s/",
  "/r/",
  "/verify",
  "/oauth-callback",
  "/desktop/search",
];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_SEGMENTS.some((segment) => pathname.includes(segment))
  );
}

export async function proxy(request: NextRequest) {
  // Read at request time: APP_URL is runtime config.
  const ORIGIN = ENV.APP_URL;
  const cookieHeader = request.headers.get("cookie") ?? "";

  const response = I18nMiddleware(request);
  const { session, setCookies } = await getSession(cookieHeader);
  const isAuthenticated = !!session;

  // Refreshed session cookies (cookie cache / sliding expiry) from the API.
  for (const cookie of setCookies) {
    response.headers.append("set-cookie", cookie);
  }

  const nextUrl = request.nextUrl;

  const pathnameLocale = nextUrl.pathname.split("/", 2)?.[1];

  const pathnameWithoutLocale = pathnameLocale
    ? nextUrl.pathname.slice(pathnameLocale.length + 1)
    : nextUrl.pathname;

  const newUrl = new URL(pathnameWithoutLocale || "/", ORIGIN);

  const encodedSearchParams = `${newUrl?.pathname?.substring(1)}${
    newUrl.search
  }`;

  if (!isAuthenticated && !isPublicPath(newUrl.pathname)) {
    // A first factor succeeded but the TOTP challenge is still pending:
    // there is no session until /mfa/verify completes.
    const target = hasPendingTwoFactor(cookieHeader) ? "/mfa/verify" : "/login";
    const redirectUrl = new URL(target, ORIGIN);

    if (encodedSearchParams) {
      redirectUrl.searchParams.append("return_to", encodedSearchParams);
    }

    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthenticated) {
    if (newUrl.pathname === "/login" || newUrl.pathname === "/mfa/verify") {
      return NextResponse.redirect(new URL("/", ORIGIN));
    }

    if (newUrl.pathname !== "/onboarding" && newUrl.pathname !== "/teams") {
      const inviteCodeMatch = newUrl.pathname.startsWith("/teams/invite/");

      if (inviteCodeMatch) {
        return NextResponse.redirect(`${ORIGIN}${request.nextUrl.pathname}`);
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|email/|api).*)"],
};
