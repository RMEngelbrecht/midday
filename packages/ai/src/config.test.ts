import { describe, expect, it } from "bun:test";
import {
  assertEmbeddingDimensions,
  EmbeddingDimensionError,
  isAIConfigured,
  resolveAIConfig,
} from "./config";

describe("resolveAIConfig", () => {
  it("is disabled with no env", () => {
    expect(resolveAIConfig({})).toBeNull();
    expect(isAIConfigured({ AI_API_KEY: "k" })).toBe(false);
    expect(
      resolveAIConfig({ AI_PROVIDER: "bogus", AI_API_KEY: "k" }),
    ).toBeNull();
  });

  it("uses per-provider defaults", () => {
    const c = resolveAIConfig({ AI_PROVIDER: "openai", AI_API_KEY: "k" })!;
    expect(c.language.models.chat).toBe("gpt-4.1-mini");
    expect(c.embedding?.model).toBe("text-embedding-3-small");
    expect(c.embedding?.dimensions).toBe(768);
  });

  it("infers the provider from legacy keys", () => {
    expect(resolveAIConfig({ OPENAI_API_KEY: "k" })?.language.provider).toBe(
      "openai",
    );
    const g = resolveAIConfig({ GOOGLE_GENERATIVE_AI_API_KEY: "g" })!;
    expect(g.language.provider).toBe("google");
    expect(g.language.apiKey).toBe("g");
    expect(g.embedding?.model).toBe("gemini-embedding-001");
    // explicit provider + legacy key for that provider
    expect(
      resolveAIConfig({
        AI_PROVIDER: "google",
        GOOGLE_GENERATIVE_AI_API_KEY: "g",
      }),
    ).not.toBeNull();
  });

  it("requires base url and chat model for openai-compatible, key optional", () => {
    expect(resolveAIConfig({ AI_PROVIDER: "openai-compatible" })).toBeNull();
    expect(
      resolveAIConfig({
        AI_PROVIDER: "openai-compatible",
        AI_BASE_URL: "http://x/v1",
      }),
    ).toBeNull();
    const c = resolveAIConfig({
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "http://x/v1",
      AI_MODEL_CHAT: "qwen",
    })!;
    expect(c.language.models).toEqual({
      chat: "qwen",
      fast: "qwen",
      vision: "qwen",
      extraction: "qwen",
    });
    expect(c.embedding).toBeNull();
  });

  it("builds the extraction chain from extraction then vision, deduped", () => {
    const base = { AI_PROVIDER: "openai", AI_API_KEY: "k" } as const;
    expect(resolveAIConfig(base)!.language.extractionModels).toEqual([
      "gpt-4.1-mini",
    ]);
    expect(
      resolveAIConfig({ ...base, AI_MODEL_EXTRACTION: "big" })!.language
        .extractionModels,
    ).toEqual(["big", "gpt-4.1-mini"]);
    expect(
      resolveAIConfig({
        ...base,
        AI_MODEL_VISION: "v",
        AI_MODEL_EXTRACTION: "v",
      })!.language.extractionModels,
    ).toEqual(["v"]);
  });

  it("allows embeddings from a different provider", () => {
    const c = resolveAIConfig({
      AI_PROVIDER: "openai",
      AI_API_KEY: "sk",
      AI_EMBEDDING_BASE_URL: "http://ollama:11434/v1",
      AI_EMBEDDING_MODEL: "nomic-embed-text",
    })!;
    expect(c.embedding).toMatchObject({
      provider: "openai-compatible",
      baseURL: "http://ollama:11434/v1",
      model: "nomic-embed-text",
      apiKey: undefined,
    });
  });

  it("has no embeddings for anthropic unless overridden", () => {
    expect(
      resolveAIConfig({ AI_PROVIDER: "anthropic", AI_API_KEY: "k" })!.embedding,
    ).toBeNull();
  });
});

describe("assertEmbeddingDimensions", () => {
  it("accepts 768 and rejects others with a clear error", () => {
    expect(() =>
      assertEmbeddingDimensions("m", [new Array(768).fill(0)]),
    ).not.toThrow();
    expect(() =>
      assertEmbeddingDimensions("m", [new Array(1024).fill(0)]),
    ).toThrow(EmbeddingDimensionError);
    expect(() =>
      assertEmbeddingDimensions("m", [new Array(1024).fill(0)]),
    ).toThrow(/1024 dimensions.*expects 768/);
  });
});
