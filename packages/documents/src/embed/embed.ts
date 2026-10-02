import { embed, embedMany, isEmbeddingEnabled } from "@midday/ai";

export class Embed {
  /** False when no embedding model is configured. */
  public static isEnabled(): boolean {
    return isEmbeddingEnabled();
  }

  public async embedMany(content: string[]): Promise<{
    embeddings: number[][];
    model: string;
  }> {
    return embedMany(content);
  }

  public async embed(content: string): Promise<{
    embedding: number[];
    model: string;
  }> {
    return embed(content);
  }
}
