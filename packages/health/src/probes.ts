/**
 * Lightweight probe functions for external services.
 *
 * Each probe should be the cheapest possible verification:
 * - No side effects
 * - Minimal data transfer
 * - Fast timeout
 */

import { Provider } from "@midday/banking";
import { checkHealth as checkCacheHealth } from "@midday/cache/health";
import { checkHealth as checkDbHealth } from "@midday/db/utils/health";
import { type Features, getFeatures } from "@midday/features";
import { ENV } from "./env";
import type { Dependency } from "./registry";

// ---------------------------------------------------------------------------
// Tier 1 — Core infrastructure (app breaks without these)
// ---------------------------------------------------------------------------

/** Database: SELECT 1 via the existing @midday/db health utility */
export function databaseProbe(): Dependency {
  return {
    name: "database",
    tier: 1,
    cacheTtlMs: 30_000,
    timeoutMs: 3_000,
    probe: async () => {
      await checkDbHealth();
      return true;
    },
  };
}

/** Redis cache: PING via the existing @midday/cache health utility */
export function redisCacheProbe(): Dependency {
  return {
    name: "redis_cache",
    tier: 1,
    cacheTtlMs: 30_000,
    timeoutMs: 3_000,
    probe: async () => {
      await checkCacheHealth();
      return true;
    },
  };
}

/** Supabase: GET auth health (requires apikey header) */
export function supabaseProbe(): Dependency {
  return {
    name: "supabase",
    tier: 1,
    cacheTtlMs: 30_000,
    timeoutMs: 3_000,
    probe: async () => {
      const url = ENV.SUPABASE_URL;
      if (!url) throw new Error("SUPABASE_URL not set");
      const apikey = ENV.SUPABASE_SECRET_KEY || ENV.SUPABASE_PUBLISHABLE_KEY;
      const headers: Record<string, string> = {};
      if (apikey) {
        headers.apikey = apikey;
      }
      const res = await fetch(`${url}/auth/v1/health`, {
        headers,
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    },
  };
}

/** Redis queue: PING using Bun's RedisClient */
export function redisQueueProbe(): Dependency {
  const { RedisClient } = require("bun");

  return {
    name: "redis_queue",
    tier: 1,
    cacheTtlMs: 30_000,
    timeoutMs: 3_000,
    probe: async () => {
      const url = ENV.REDIS_QUEUE_URL;
      if (!url) throw new Error("REDIS_QUEUE_URL not set");

      const client = new RedisClient(url, { connectionTimeout: 3000 });
      await client.connect();
      await client.send("PING", []);
      client.close();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Tier 2 — Important services
// ---------------------------------------------------------------------------

/** Plaid health check via @midday/banking */
export function plaidProbe(): Dependency {
  return {
    name: "plaid",
    tier: 2,
    cacheTtlMs: 60_000,
    timeoutMs: 5_000,
    probe: async () => {
      try {
        const provider = new Provider({ provider: "plaid" });
        return await provider
          .getHealthCheck()
          .then((h) => h.plaid?.healthy ?? false);
      } catch {
        return false;
      }
    },
  };
}

/** GoCardless health check via @midday/banking */
export function gocardlessProbe(): Dependency {
  return {
    name: "gocardless",
    tier: 2,
    cacheTtlMs: 60_000,
    timeoutMs: 5_000,
    probe: async () => {
      try {
        const provider = new Provider({ provider: "gocardless" });
        return await provider
          .getHealthCheck()
          .then((h) => h.gocardless?.healthy ?? false);
      } catch {
        return false;
      }
    },
  };
}

/** EnableBanking health check via @midday/banking */
export function enableBankingProbe(): Dependency {
  return {
    name: "enablebanking",
    tier: 2,
    cacheTtlMs: 60_000,
    timeoutMs: 5_000,
    probe: async () => {
      try {
        const provider = new Provider({ provider: "enablebanking" });
        return await provider
          .getHealthCheck()
          .then((h) => h.enablebanking?.healthy ?? false);
      } catch {
        return false;
      }
    },
  };
}

/** Teller health check via @midday/banking */
export function tellerProbe(): Dependency {
  return {
    name: "teller",
    tier: 2,
    cacheTtlMs: 60_000,
    timeoutMs: 5_000,
    probe: async () => {
      try {
        const provider = new Provider({ provider: "teller" });
        return await provider
          .getHealthCheck()
          .then((h) => h.teller?.healthy ?? false);
      } catch {
        return false;
      }
    },
  };
}

/** Stripe: GET /v1/balance (cheapest authenticated endpoint) */
export function stripeProbe(): Dependency {
  return {
    name: "stripe",
    tier: 2,
    cacheTtlMs: 60_000,
    timeoutMs: 5_000,
    probe: async () => {
      const key = ENV.STRIPE_SECRET_KEY;
      if (!key) return false;
      const res = await fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    },
  };
}

/** OpenAI: GET /v1/models (lightweight list) */
export function openaiProbe(): Dependency {
  return {
    name: "openai",
    tier: 2,
    cacheTtlMs: 60_000,
    timeoutMs: 5_000,
    probe: async () => {
      const key = ENV.OPENAI_API_KEY;
      if (!key) return false;
      const res = await fetch("https://api.openai.com/v1/models?limit=1", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    },
  };
}

// ---------------------------------------------------------------------------
// Tier 3 — Integrations (check token endpoint reachability)
// ---------------------------------------------------------------------------

function oauthTokenProbe(name: string, tokenUrl: string): Dependency {
  return {
    name,
    tier: 3,
    cacheTtlMs: 300_000, // 5 minutes
    timeoutMs: 5_000,
    probe: async () => {
      // Use POST — some OAuth token endpoints reject HEAD/GET with 501.
      // An empty POST will get 400 (invalid_request) which proves reachability.
      const res = await fetch(tokenUrl, {
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      }).catch(() => null);
      // Any non-network response means the endpoint is reachable
      return res !== null && res.status < 500;
    },
  };
}

export function slackProbe(): Dependency {
  return oauthTokenProbe("slack", "https://slack.com/api/api.test");
}

export function xeroProbe(): Dependency {
  return oauthTokenProbe("xero", "https://identity.xero.com/connect/token");
}

export function quickbooksProbe(): Dependency {
  return oauthTokenProbe(
    "quickbooks",
    "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  );
}

export function fortnoxProbe(): Dependency {
  return oauthTokenProbe("fortnox", "https://apps.fortnox.se/oauth-v1/token");
}

// ---------------------------------------------------------------------------
// Tier 4 — Optional services
// ---------------------------------------------------------------------------

/** Google AI: lightweight models list */
export function googleAiProbe(): Dependency {
  return {
    name: "google_ai",
    tier: 4,
    cacheTtlMs: 300_000,
    timeoutMs: 5_000,
    probe: async () => {
      const key = ENV.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!key) return false;
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1`,
        { signal: AbortSignal.timeout(5_000) },
      );
      return res.ok;
    },
  };
}

/** Exa: API reachability */
export function exaProbe(): Dependency {
  return {
    name: "exa",
    tier: 4,
    cacheTtlMs: 300_000,
    timeoutMs: 5_000,
    probe: async () => {
      const key = ENV.EXA_API_KEY;
      if (!key) return false;
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "health", numResults: 0 }),
        signal: AbortSignal.timeout(5_000),
      });
      // 400 is fine — means the API is reachable and authenticated
      return res.status < 500;
    },
  };
}

/** Mistral AI: models list */
export function mistralProbe(): Dependency {
  return {
    name: "mistral",
    tier: 4,
    cacheTtlMs: 300_000,
    timeoutMs: 5_000,
    probe: async () => {
      const key = ENV.MISTRAL_API_KEY;
      if (!key) return false;
      const res = await fetch("https://api.mistral.ai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-built registry sets for each service
// ---------------------------------------------------------------------------

type ProbeFeatures = Pick<Features, "ai" | "mail" | "banking" | "integrations">;

/** Probes for the optional services that are configured; nothing else is probed. */
export function optionalProbes(
  features: ProbeFeatures,
  env: { OPENAI_API_KEY?: string; MISTRAL_API_KEY?: string } = ENV,
): Dependency[] {
  const { banking, integrations } = features;
  const candidates: [boolean, () => Dependency][] = [
    [banking.plaid, plaidProbe],
    [banking.gocardless, gocardlessProbe],
    [banking.enablebanking, enableBankingProbe],
    [banking.teller, tellerProbe],
    [integrations.stripe, stripeProbe],
    [Boolean(env.OPENAI_API_KEY), openaiProbe],
    [integrations.slack, slackProbe],
    [integrations.xero, xeroProbe],
    [integrations.quickbooks, quickbooksProbe],
    [integrations.fortnox, fortnoxProbe],
    [Boolean(env.MISTRAL_API_KEY), mistralProbe],
  ];

  return candidates.filter(([enabled]) => enabled).map(([, probe]) => probe());
}

/** Dependencies used by the API service */
export function apiDependencies(features = getFeatures()): Dependency[] {
  return [
    // Tier 1 — Core
    databaseProbe(),
    redisCacheProbe(),
    redisQueueProbe(),
    ...(ENV.SUPABASE_URL ? [supabaseProbe()] : []),
    ...optionalProbes(features),
    ...(ENV.GOOGLE_GENERATIVE_AI_API_KEY ? [googleAiProbe()] : []),
  ];
}

/** Dependencies used by the Worker service */
export function workerDependencies(features = getFeatures()): Dependency[] {
  return [
    // Tier 1 — Core
    databaseProbe(),
    redisQueueProbe(),
    ...(ENV.SUPABASE_URL ? [supabaseProbe()] : []),
    ...optionalProbes(features).filter(
      (d) =>
        !["stripe", "slack", "xero", "quickbooks", "fortnox"].includes(d.name),
    ),
    ...(ENV.GOOGLE_GENERATIVE_AI_API_KEY ? [googleAiProbe()] : []),
    ...(ENV.EXA_API_KEY ? [exaProbe()] : []),
  ];
}
