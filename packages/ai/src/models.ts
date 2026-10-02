import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import {
  embedMany as aiEmbedMany,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
import {
  type AIConfig,
  type AIProviderName,
  assertEmbeddingDimensions,
  type EmbeddingConfig,
  type ModelRole,
  type ProviderSettings,
  resolveAIConfig,
  supportsPdfInput,
} from "./config";
import { ENV } from "./env";

export class AIDisabledError extends Error {
  constructor() {
    super(
      "AI is not configured. Set AI_PROVIDER (and AI_API_KEY / AI_BASE_URL / AI_MODEL_CHAT) to enable it.",
    );
    this.name = "AIDisabledError";
  }
}

function currentConfig(): AIConfig | null {
  return resolveAIConfig(ENV);
}

export function getAIConfig(): AIConfig | null {
  return currentConfig();
}

/** True when chat/fast/vision models are configured. */
export function isAIEnabled(): boolean {
  return currentConfig() !== null;
}

/** True when an embedding model is configured (a 768-dim model). */
export function isEmbeddingEnabled(): boolean {
  return currentConfig()?.embedding != null;
}

export type ModelHandle = {
  model: LanguageModel;
  provider: AIProviderName;
  modelId: string;
  /** Whether PDF files can be sent to this model directly. */
  pdfInput: boolean;
};

function languageModel(s: ProviderSettings, id: string): LanguageModel {
  switch (s.provider) {
    case "openai":
      return createOpenAI({ apiKey: s.apiKey, baseURL: s.baseURL })(id);
    case "openai-compatible":
      // Chat Completions is the widely implemented API; Responses is OpenAI-only.
      return createOpenAI({
        apiKey: s.apiKey ?? "not-needed",
        baseURL: s.baseURL,
      }).chat(id);
    case "google":
      return createGoogleGenerativeAI({
        apiKey: s.apiKey,
        baseURL: s.baseURL,
      })(id);
    case "anthropic":
      return createAnthropic({ apiKey: s.apiKey, baseURL: s.baseURL })(id);
    case "mistral":
      return createMistral({ apiKey: s.apiKey, baseURL: s.baseURL })(id);
  }
}

function handle(config: AIConfig, modelId: string): ModelHandle {
  const { provider } = config.language;
  return {
    model: languageModel(config.language, modelId),
    provider,
    modelId,
    pdfInput: supportsPdfInput(provider),
  };
}

function requireConfig(): AIConfig {
  const config = currentConfig();
  if (!config) throw new AIDisabledError();
  return config;
}

export function getModelHandle(role: ModelRole): ModelHandle {
  const config = requireConfig();
  return handle(config, config.language.models[role]);
}

/** Language model for a role. Throws AIDisabledError when AI is not configured. */
export function getModel(role: ModelRole): LanguageModel {
  return getModelHandle(role).model;
}

/** Extraction attempts in order: dedicated extraction model (if set), then the vision model. */
export function getExtractionModels(): ModelHandle[] {
  const config = requireConfig();
  return config.language.extractionModels.map((id) => handle(config, id));
}

export type WebSearchOptions = { country?: string; timezone?: string };

/** Provider-native web search tool, or null when the provider has none. */
export function getWebSearchTool(
  options: WebSearchOptions = {},
): { name: "web_search"; tool: any } | null {
  const config = currentConfig();
  if (!config) return null;
  const s = config.language;
  if (s.provider === "openai") {
    const openai = createOpenAI({ apiKey: s.apiKey, baseURL: s.baseURL });
    return {
      name: "web_search",
      tool: openai.tools.webSearch({
        searchContextSize: "medium",
        userLocation: {
          type: "approximate",
          country: options.country,
          timezone: options.timezone,
        },
      }),
    };
  }
  if (s.provider === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: s.apiKey,
      baseURL: s.baseURL,
    });
    return { name: "web_search", tool: google.tools.googleSearch({}) };
  }
  return null;
}

function embeddingModelFor(e: EmbeddingConfig): EmbeddingModel {
  switch (e.provider) {
    case "openai":
      return createOpenAI({
        apiKey: e.apiKey,
        baseURL: e.baseURL,
      }).embeddingModel(e.model);
    case "openai-compatible":
      return createOpenAI({
        apiKey: e.apiKey ?? "not-needed",
        baseURL: e.baseURL,
      }).embeddingModel(e.model);
    case "google":
      return createGoogleGenerativeAI({
        apiKey: e.apiKey,
        baseURL: e.baseURL,
      }).embeddingModel(e.model);
    case "mistral":
      return createMistral({
        apiKey: e.apiKey,
        baseURL: e.baseURL,
      }).textEmbeddingModel(e.model);
    case "anthropic":
      throw new Error("Anthropic does not provide an embedding model.");
  }
}

function embeddingProviderOptions(
  e: EmbeddingConfig,
): Record<string, Record<string, string | number>> | undefined {
  if (e.provider === "google") {
    return {
      google: {
        outputDimensionality: e.dimensions,
        taskType: "SEMANTIC_SIMILARITY",
      },
    };
  }
  // text-embedding-3-* can be shortened server side; older models reject it.
  if (e.provider === "openai" && e.model.startsWith("text-embedding-3")) {
    return { openai: { dimensions: e.dimensions } };
  }
  return undefined;
}

function requireEmbedding(): EmbeddingConfig {
  const e = currentConfig()?.embedding;
  if (!e) {
    throw new Error(
      "No embedding model configured. Set AI_EMBEDDING_MODEL (and AI_EMBEDDING_BASE_URL for openai-compatible servers).",
    );
  }
  return e;
}

/** The configured embedding model (768 dims). Prefer embed/embedMany below. */
export function getEmbeddingModel(): EmbeddingModel {
  return embeddingModelFor(requireEmbedding());
}

/** Name stored in the `model` column of embedding tables. */
export function getEmbeddingModelName(): string {
  return requireEmbedding().model;
}

export async function embed(
  value: string,
): Promise<{ embedding: number[]; model: string }> {
  const { embeddings, model } = await embedMany([value]);
  return { embedding: embeddings[0]!, model };
}

export async function embedMany(
  values: string[],
): Promise<{ embeddings: number[][]; model: string }> {
  const e = requireEmbedding();
  if (values.length === 0) return { embeddings: [], model: e.model };
  const { embeddings } = await aiEmbedMany({
    model: embeddingModelFor(e),
    values,
    providerOptions: embeddingProviderOptions(e),
  });
  assertEmbeddingDimensions(e.model, embeddings, e.dimensions);
  return { embeddings, model: e.model };
}
