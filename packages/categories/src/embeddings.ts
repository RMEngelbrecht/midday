import { embed, embedMany, isEmbeddingEnabled } from "@midday/ai";

/** False when no embedding model is configured; callers should skip embedding work. */
export function categoryEmbeddingsEnabled(): boolean {
  return isEmbeddingEnabled();
}

/**
 * Generate a single embedding for a category name
 */
export async function generateCategoryEmbedding(categoryName: string) {
  return embed(categoryName);
}

/**
 * Generate embeddings for multiple category names
 */
export async function generateCategoryEmbeddings(categoryNames: string[]) {
  return embedMany(categoryNames);
}

/**
 * Category Embedding Service
 * Provides a consistent interface for generating category embeddings
 */
export class CategoryEmbeddings {
  /**
   * Generate embedding for a single category
   */
  public async embed(categoryName: string) {
    return generateCategoryEmbedding(categoryName);
  }

  /**
   * Generate embeddings for multiple categories
   */
  public async embedMany(categoryNames: string[]) {
    return generateCategoryEmbeddings(categoryNames);
  }
}
