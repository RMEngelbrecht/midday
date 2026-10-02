import { LogEvents } from "@midday/events/events";
import { setupAnalytics } from "@midday/events/server";
import { sanitizeRedirectPath } from "@midday/utils/sanitize-redirect";
import { addSeconds, addYears } from "date-fns";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ENV } from "@/env";
import { callAuthApi } from "@/utils/auth.server";
import { Cookies } from "@/utils/constants";

/**
 * Where sign-ins land (social callbacks redirect here with the session
 * cookie already set by the API).
 *
 * Desktop handoff:
 * 1. The system browser finishes signing in and arrives with
 *    `client=desktop`. We mint a one-time token for its session and show
 *    /verify, which opens `midday://api/auth/callback?code=<token>`.
 * 2. The desktop webview loads this route with `code`; we redeem the token
 *    with the API and pass its session cookie on to the webview.
 */
export async function GET(req: NextRequest) {
  const origin = ENV.APP_URL;
  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");
  const client = requestUrl.searchParams.get("client");
  const returnTo = requestUrl.searchParams.get("return_to");
  const provider = requestUrl.searchParams.get("provider");

  if (client === "desktop") {
    const res = await callAuthApi("/one-time-token/generate");
    const data = res.ok ? ((await res.json()) as { token?: string }) : null;

    if (!data?.token) {
      return NextResponse.redirect(`${origin}/login`);
    }

    return NextResponse.redirect(
      `${origin}/verify?code=${encodeURIComponent(data.token)}`,
    );
  }

  let target = origin;

  if (returnTo?.startsWith("teams/invite/")) {
    // Accept/decline the invite on the teams page.
    target = `${origin}/teams`;
  } else if (returnTo) {
    // The proxy strips the leading "/" (e.g. "settings/accounts"),
    // but sanitizeRedirectPath requires a root-relative path.
    const normalized = returnTo.startsWith("/") ? returnTo : `/${returnTo}`;
    target = `${origin}${sanitizeRedirectPath(normalized)}`;
  }

  const response = NextResponse.redirect(target);
  let sessionCookies: string[] = [];

  if (code) {
    const res = await callAuthApi("/one-time-token/verify", {
      method: "POST",
      body: { token: code },
    });

    if (!res.ok) {
      return NextResponse.redirect(`${origin}/login`);
    }

    sessionCookies = res.headers.getSetCookie();
  }

  if (provider) {
    response.cookies.set(Cookies.PreferredSignInProvider, provider, {
      expires: addYears(new Date(), 1),
    });

    const analytics = await setupAnalytics();
    analytics.track({
      event: LogEvents.SignIn.name,
      channel: LogEvents.SignIn.channel,
      provider,
    });
  }

  // Force primary database reads for the first requests after sign-in, so
  // a just-created user is visible even with read replicas.
  response.cookies.set(Cookies.ForcePrimary, "true", {
    expires: addSeconds(new Date(), 30),
    httpOnly: false, // Needs to be readable by client-side tRPC
    sameSite: "lax",
  });

  // Appended last: `response.cookies.set` rewrites the set-cookie header.
  for (const cookie of sessionCookies) {
    response.headers.append("set-cookie", cookie);
  }

  return response;
}
