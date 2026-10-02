import { registerMiddayBotRuntime } from "@api/bot/runtime";
import type { Context } from "@api/rest/types";
import { OpenAPIHono } from "@hono/zod-openapi";
import { bot, isBotAdapterEnabled } from "@midday/bot";

const app = new OpenAPIHono<Context>();

registerMiddayBotRuntime();

// Adapter is only built when its credentials are configured.
app.use("*", async (c, next) => {
  if (!isBotAdapterEnabled("telegram")) return c.notFound();
  await next();
});

app.post("/", async (c) => {
  await bot.initialize();
  return bot.webhooks.telegram(c.req.raw);
});

export const telegramWebhookRouter = app;
