/**
 * better-auth contract (S0c ⇄ S1).
 *
 * These tables live in the Postgres `auth` schema and are owned by
 * better-auth. Pass `authSchema` to better-auth's drizzle adapter:
 *
 *   drizzleAdapter(db, { provider: "pg", schema: authSchema })
 *
 * - Property names are camelCase (what better-auth expects); columns are
 *   snake_case.
 * - Every id is a uuid with a `gen_random_uuid()` default. Configure
 *   better-auth to emit uuids (`advanced.database.generateId: "uuid"`) or to
 *   leave id generation to the database.
 * - `public.users.id` references `auth.user.id` ON DELETE CASCADE, so
 *   deleting a better-auth user removes the Midday profile row too.
 * - Plugins in use: twoFactor (`two_factor`, `user.two_factor_enabled`)
 *   and jwt (`jwks`).
 */
import { boolean, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const authPgSchema = pgSchema("auth");

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const authUser = authPgSchema.table("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSession = authPgSchema.table("session", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authAccount = authPgSchema.table("account", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authVerification = authPgSchema.table("verification", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authTwoFactor = authPgSchema.table("two_factor", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
});

export const authJwks = authPgSchema.table("jwks", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: createdAt(),
  // Optional in better-auth's jwt plugin (key rotation); nullable here.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

/** Keyed by better-auth model name, ready for `drizzleAdapter({ schema })`. */
export const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  twoFactor: authTwoFactor,
  jwks: authJwks,
};
