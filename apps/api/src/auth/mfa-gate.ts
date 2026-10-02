import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";

// Same cookie/verification shape as better-auth's twoFactor plugin, so its
// `/two-factor/verify-totp` and `/two-factor/verify-backup-code` endpoints
// finish these sign-ins too.
const TWO_FACTOR_COOKIE_NAME = "two_factor";
const TWO_FACTOR_COOKIE_MAX_AGE = 600;

const EMAIL_OTP_SIGN_IN = "/sign-in/email-otp";
const SOCIAL_CALLBACK = "/callback/:id";

/**
 * The twoFactor plugin only challenges password sign-ins. This extends the
 * same challenge to email-OTP and social sign-ins, so "has a session" always
 * means "passed 2FA" (the dashboard and API rely on that).
 *
 * - email OTP: responds `{ twoFactorRedirect: true }` like a password sign-in
 * - social: redirects the browser to `${mfaUrl}` instead of the app
 */
export function mfaGate(options: { mfaUrl: string }): BetterAuthPlugin {
  return {
    id: "midday-mfa-gate",
    hooks: {
      after: [
        {
          matcher: (ctx) =>
            ctx.path === EMAIL_OTP_SIGN_IN || ctx.path === SOCIAL_CALLBACK,
          handler: createAuthMiddleware(async (ctx) => {
            const data = ctx.context.newSession;
            if (
              !data?.user ||
              !(data.user as { twoFactorEnabled?: boolean }).twoFactorEnabled
            ) {
              return;
            }

            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(data.session.token);
            ctx.context.setNewSession(null);

            const cookie = ctx.context.createAuthCookie(
              TWO_FACTOR_COOKIE_NAME,
              { maxAge: TWO_FACTOR_COOKIE_MAX_AGE },
            );
            const identifier = `2fa-${generateRandomString(20)}`;
            const expiresAt = new Date(
              Date.now() + TWO_FACTOR_COOKIE_MAX_AGE * 1000,
            );

            await ctx.context.internalAdapter.createVerificationValue({
              value: data.user.id,
              identifier,
              expiresAt,
            });
            await ctx.context.internalAdapter.createVerificationValue({
              value: "0",
              identifier: `2fa-attempts-${identifier}`,
              expiresAt,
            });
            await ctx.setSignedCookie(
              cookie.name,
              identifier,
              ctx.context.secret,
              cookie.attributes,
            );

            if (ctx.path === SOCIAL_CALLBACK) {
              throw ctx.redirect(options.mfaUrl);
            }

            return ctx.json({
              twoFactorRedirect: true,
              twoFactorMethods: ["totp"],
            });
          }),
        },
      ],
    },
  };
}
