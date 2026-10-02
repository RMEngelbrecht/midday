import { sanitizeRedirectPath } from "@midday/utils/sanitize-redirect";
import { Cookies } from "@/utils/constants";

/**
 * Client-side landing after a successful first factor (password or email
 * code). With 2FA enabled there is no session yet: the API set a pending
 * two-factor cookie and the TOTP step at /mfa/verify finishes the sign-in.
 */
export function afterSignIn(opts: {
  method: "password" | "otp";
  twoFactorRedirect?: boolean;
  returnTo?: string | null;
}) {
  const oneYear = 60 * 60 * 24 * 365;
  // biome-ignore lint/suspicious/noDocumentCookie: plain cookie, read server-side
  document.cookie = `${Cookies.PreferredSignInProvider}=${opts.method}; path=/; max-age=${oneYear}; samesite=lax`;
  // Force primary database reads right after sign-in (replication lag).
  // biome-ignore lint/suspicious/noDocumentCookie: plain cookie, read by tRPC
  document.cookie = `${Cookies.ForcePrimary}=true; path=/; max-age=30; samesite=lax`;

  // The proxy passes return_to without its leading "/".
  const returnTo = opts.returnTo ?? "";

  if (opts.twoFactorRedirect) {
    const params = returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : "";
    window.location.assign(`/mfa/verify${params}`);
    return;
  }

  const target = returnTo.startsWith("teams/invite/")
    ? "/teams"
    : sanitizeRedirectPath(`/${returnTo}`);

  // Full navigation so server components see the new session cookie.
  window.location.assign(target);
}
