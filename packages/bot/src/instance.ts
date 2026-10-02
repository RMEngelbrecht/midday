import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { resolveRedisUrl } from "@midday/cache/shared-redis";
import { getFeatures, type IntegrationFeatures } from "@midday/features";
import { Chat } from "chat";
import { createSendblueAdapter } from "chat-adapter-sendblue";

const adapterFactories = {
  whatsapp: createWhatsAppAdapter,
  telegram: createTelegramAdapter,
  slack: createSlackAdapter,
  sendblue: createSendblueAdapter,
} as const;

export type BotAdapterName = keyof typeof adapterFactories;

type AllAdapters = {
  [K in BotAdapterName]: ReturnType<(typeof adapterFactories)[K]>;
};

/** Whether the adapter's credentials are configured. */
export function isBotAdapterEnabled(
  name: BotAdapterName,
  integrations: Pick<IntegrationFeatures, BotAdapterName> = getFeatures()
    .integrations,
) {
  return integrations[name];
}

/** Builds only the adapters that are configured; others are never constructed. */
export function createBotAdapters(
  integrations: Pick<IntegrationFeatures, BotAdapterName>,
): Partial<AllAdapters> {
  const adapters: Record<string, unknown> = {};

  for (const name of Object.keys(adapterFactories) as BotAdapterName[]) {
    if (isBotAdapterEnabled(name, integrations)) {
      adapters[name] = adapterFactories[name]();
    }
  }

  return adapters as Partial<AllAdapters>;
}

export function createMiddayBot() {
  // Typed as if every adapter exists so call sites stay unchanged; routes for
  // disabled adapters return 404 before touching `bot.webhooks.<name>`.
  return new Chat({
    userName: "midday",
    adapters: createBotAdapters(getFeatures().integrations) as AllAdapters,
    state: createRedisState({ url: resolveRedisUrl() }),
    concurrency: {
      strategy: "debounce",
      debounceMs: 1500,
    },
  });
}

export const bot = createMiddayBot();
