/**
 * Pure AI configuration resolution: env record -> provider/models. No env or
 * SDK imports, so it can be unit tested and shared with @midday/features.
 */

export const AI_PROVIDERS = [
  "openai",
  "openai-compatible",
  "google",
  "anthropic",
  "mistral",
] as const;
export type AIProviderName = (typeof AI_PROVIDERS)[number];

/** Embeddings are stored in vector(768) columns. */
export const EMBEDDING_DIMENSIONS = 768;

export const AI_ENV_KEYS = [
  "AI_PROVIDER",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL_CHAT",
  "AI_MODEL_FAST",
  "AI_MODEL_VISION",
  "AI_MODEL_EXTRACTION",
  "AI_EMBEDDING_PROVIDER",
  "AI_EMBEDDING_BASE_URL",
  "AI_EMBEDDING_API_KEY",
  "AI_EMBEDDING_MODEL",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "MISTRAL_API_KEY",
] as const;
export type AIEnvKey = (typeof AI_ENV_KEYS)[number];
export type AIEnv = Partial<Record<AIEnvKey, string | undefined>>;

export type ModelRole = "chat" | "fast" | "vision" | "extraction";

type RoleDefaults = { chat: string; fast: string; vision: string };

/** Default model names per provider. Overridden by AI_MODEL_*. */
export const DEFAULT_MODELS: Record<
  Exclude<AIProviderName, "openai-compatible">,
  RoleDefaults
> = {
  openai: {
    chat: "gpt-4.1-mini",
    fast: "gpt-4o-mini",
    vision: "gpt-4.1-mini",
  },
  google: {
    chat: "gemini-3.8-flash",
    fast: "gemini-3.5-flash-lite",
    vision: "gemini-3.8-flash",
  },
  anthropic: {
    chat: "claude-sonnet-4-5",
    fast: "claude-haiku-4-5",
    vision: "claude-sonnet-4-5",
  },
  mistral: {
    chat: "mistral-large-latest",
    fast: "mistral-small-latest",
    vision: "mistral-small-latest",
  },
};

/** Providers with a native 768-dim capable embedding model by default. */
export const DEFAULT_EMBEDDING_MODELS: Partial<Record<AIProviderName, string>> =
  {
    openai: "text-embedding-3-small",
    google: "gemini-embedding-001",
  };

const LEGACY_KEYS: Array<[AIProviderName, AIEnvKey]> = [
  ["openai", "OPENAI_API_KEY"],
  ["google", "GOOGLE_GENERATIVE_AI_API_KEY"],
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["mistral", "MISTRAL_API_KEY"],
];

export type ProviderSettings = {
  provider: AIProviderName;
  baseURL?: string;
  apiKey?: string;
};

export type LanguageConfig = ProviderSettings & {
  models: Record<ModelRole, string>;
  /** Extraction attempts in order: dedicated extraction model, then vision. */
  extractionModels: string[];
};

export type EmbeddingConfig = ProviderSettings & {
  model: string;
  dimensions: typeof EMBEDDING_DIMENSIONS;
};

export type AIConfig = {
  language: LanguageConfig;
  /** null when no embedding model is available (e.g. anthropic without an override). */
  embedding: EmbeddingConfig | null;
};

function val(env: AIEnv, key: AIEnvKey): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}

function isProvider(v: string | undefined): v is AIProviderName {
  return !!v && (AI_PROVIDERS as readonly string[]).includes(v);
}

/** Provider to use for chat models: explicit AI_PROVIDER, else the first legacy key found. */
export function inferProvider(env: AIEnv): AIProviderName | null {
  const explicit = val(env, "AI_PROVIDER");
  if (explicit) return isProvider(explicit) ? explicit : null;
  for (const [provider, key] of LEGACY_KEYS) {
    if (val(env, key)) return provider;
  }
  return null;
}

function legacyKeyFor(env: AIEnv, provider: AIProviderName) {
  const entry = LEGACY_KEYS.find(([p]) => p === provider);
  return entry ? val(env, entry[1]) : undefined;
}

function resolveEmbedding(
  env: AIEnv,
  language: ProviderSettings,
): EmbeddingConfig | null {
  const overrideProvider = val(env, "AI_EMBEDDING_PROVIDER");
  const overrideBase = val(env, "AI_EMBEDDING_BASE_URL");
  const overrideKey = val(env, "AI_EMBEDDING_API_KEY");
  const overrideModel = val(env, "AI_EMBEDDING_MODEL");

  const overridden = Boolean(overrideProvider || overrideBase || overrideKey);

  let provider: AIProviderName;
  if (overrideProvider) {
    if (!isProvider(overrideProvider)) return null;
    provider = overrideProvider;
  } else if (overrideBase) {
    provider = "openai-compatible";
  } else {
    provider = language.provider;
  }

  const sameProvider = provider === language.provider;
  const model = overrideModel ?? DEFAULT_EMBEDDING_MODELS[provider];
  if (!model) return null;

  const baseURL = overrideBase ?? (sameProvider ? language.baseURL : undefined);
  const apiKey =
    overrideKey ??
    (sameProvider && !overridden ? language.apiKey : undefined) ??
    (sameProvider ? language.apiKey : legacyKeyFor(env, provider));

  if (provider === "openai-compatible" && !baseURL) return null;
  if (provider !== "openai-compatible" && !apiKey) return null;

  return { provider, baseURL, apiKey, model, dimensions: EMBEDDING_DIMENSIONS };
}

/**
 * Resolve AI settings from env. Returns null when AI is not (validly)
 * configured, which disables every AI feature.
 */
export function resolveAIConfig(env: AIEnv): AIConfig | null {
  const provider = inferProvider(env);
  if (!provider) return null;

  const baseURL = val(env, "AI_BASE_URL");
  const apiKey = val(env, "AI_API_KEY") ?? legacyKeyFor(env, provider);

  let models: Record<"chat" | "fast" | "vision", string>;
  if (provider === "openai-compatible") {
    const chat = val(env, "AI_MODEL_CHAT");
    if (!baseURL || !chat) return null;
    models = {
      chat,
      fast: val(env, "AI_MODEL_FAST") ?? chat,
      vision: val(env, "AI_MODEL_VISION") ?? chat,
    };
  } else {
    if (!apiKey) return null;
    const d = DEFAULT_MODELS[provider];
    models = {
      chat: val(env, "AI_MODEL_CHAT") ?? d.chat,
      fast: val(env, "AI_MODEL_FAST") ?? d.fast,
      vision: val(env, "AI_MODEL_VISION") ?? d.vision,
    };
  }

  const extraction = val(env, "AI_MODEL_EXTRACTION");
  const extractionModels = [
    ...new Set([extraction, models.vision].filter((m): m is string => !!m)),
  ];

  const language: LanguageConfig = {
    provider,
    baseURL,
    apiKey,
    models: { ...models, extraction: extraction ?? models.vision },
    extractionModels,
  };

  return { language, embedding: resolveEmbedding(env, language) };
}

export function isAIConfigured(env: AIEnv): boolean {
  return resolveAIConfig(env) !== null;
}

/** Providers whose APIs accept PDF files as model input (openai-compatible servers generally do not). */
export function supportsPdfInput(provider: AIProviderName): boolean {
  return provider !== "openai-compatible";
}

export class EmbeddingDimensionError extends Error {
  constructor(
    public readonly model: string,
    public readonly actual: number,
    public readonly expected: number = EMBEDDING_DIMENSIONS,
  ) {
    super(
      `Embedding model "${model}" returned ${actual} dimensions but the database expects ${expected}. ` +
        `Use a ${expected}-dimension model (e.g. nomic-embed-text, text-embedding-3-small, gemini-embedding-001) via AI_EMBEDDING_MODEL.`,
    );
    this.name = "EmbeddingDimensionError";
  }
}

/** Throws EmbeddingDimensionError unless every vector has exactly `expected` dims. */
export function assertEmbeddingDimensions(
  model: string,
  vectors: number[][],
  expected: number = EMBEDDING_DIMENSIONS,
): void {
  for (const v of vectors) {
    if (v.length !== expected) {
      throw new EmbeddingDimensionError(model, v.length, expected);
    }
  }
}
