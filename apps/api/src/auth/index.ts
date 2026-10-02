import { ENV } from "@api/env";
import { authSchema, authUser } from "@midday/db/auth-schema";
import { db } from "@midday/db/client";
import { userInvites } from "@midday/db/schema";
import { triggerJob } from "@midday/job-client";
import { logger } from "@midday/logger";
import { send } from "@midday/mailer";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import {
  bearer,
  emailOTP,
  jwt,
  oneTimeToken,
  twoFactor,
} from "better-auth/plugins";
import { count, sql } from "drizzle-orm";
import { mfaGate } from "./mfa-gate";
import {
  canSignUp,
  deriveCookieDomain,
  type SignupPolicy,
  socialProvidersFromEnv,
} from "./policy";

export const AUTH_BASE_PATH = "/auth";

const cookieDomain = deriveCookieDomain(
  ENV.APP_URL,
  ENV.API_URL,
  ENV.AUTH_COOKIE_DOMAIN,
);

const socialProviders = socialProvidersFromEnv(ENV);

const trustedOrigins = [
  ENV.APP_URL,
  `${ENV.DESKTOP_SCHEME}://`,
  ...(ENV.ALLOWED_API_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
  // Sign in with Apple posts its callback from this origin.
  ...(socialProviders.apple ? ["https://appleid.apple.com"] : []),
];

async function assertSignupAllowed(email: string) {
  const policy = ENV.ALLOW_SIGNUP as SignupPolicy;
  if (policy === "open") return;

  const [[users], [invites]] = await Promise.all([
    db.select({ value: count() }).from(authUser),
    db
      .select({ value: count() })
      .from(userInvites)
      .where(sql`lower(${userInvites.email}) = lower(${email})`),
  ]);

  const allowed = canSignUp(policy, {
    userCount: users?.value ?? 0,
    hasPendingInvite: (invites?.value ?? 0) > 0,
  });

  if (!allowed) {
    throw new APIError("FORBIDDEN", {
      code: "SIGNUP_DISABLED",
      message: "Sign-up is by invitation only. Ask a team admin to invite you.",
    });
  }
}

/** Sign-in codes go through the mailer (the console driver logs them). */
async function sendSignInCode(email: string, otp: string) {
  await send({
    to: email,
    subject: `${otp} is your Midday sign-in code`,
    text: `Your Midday sign-in code is ${otp}. It expires in 5 minutes.`,
  });
}

export const auth = betterAuth({
  appName: "Midday",
  baseURL: ENV.API_URL,
  basePath: AUTH_BASE_PATH,
  secret: ENV.AUTH_SECRET,
  trustedOrigins,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders,
  session: {
    // Lets get-session (called by the dashboard on navigation) skip the DB.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    cookiePrefix: "midday",
    database: { generateId: "uuid" },
    crossSubDomainCookies: cookieDomain
      ? { enabled: true, domain: cookieDomain }
      : undefined,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          await assertSignupAllowed(user.email);
        },
        after: async (user) => {
          // public.users is inserted by the on_auth_user_created trigger.
          try {
            // The onboard-team processor applies its own delay.
            await triggerJob("onboard-team", { userId: user.id }, "teams");
          } catch (error) {
            logger.error("Failed to enqueue onboard-team", {
              userId: user.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      },
    },
  },
  plugins: [
    emailOTP({
      sendVerificationOTP: async ({ email, otp }) => {
        await sendSignInCode(email, otp);
      },
    }),
    // Accounts without a password (email code / social) can manage 2FA
    // without one; password accounts must confirm theirs.
    twoFactor({ issuer: "Midday", allowPasswordless: true }),
    mfaGate({ mfaUrl: `${ENV.APP_URL}/mfa/verify` }),
    // The dashboard calls the API with short-lived JWTs (Bearer), verified
    // locally against these keys; see utils/auth.ts.
    jwt({
      jwt: {
        issuer: ENV.API_URL,
        audience: ENV.API_URL,
        expirationTime: "15m",
        definePayload: ({ user }) => ({ email: user.email, name: user.name }),
      },
    }),
    bearer(),
    // Desktop sign-in handoff: browser session -> one-time code -> midday://
    oneTimeToken({ expiresIn: 3 }),
  ],
});

export type Auth = typeof auth;
