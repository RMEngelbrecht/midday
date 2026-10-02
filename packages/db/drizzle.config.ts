import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  casing: "snake_case",
  schemaFilter: ["public", "auth"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.DATABASE_PRIMARY_URL ?? "",
  },
} satisfies Config;
