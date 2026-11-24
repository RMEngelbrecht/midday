import { z } from "zod";

// Structured output schema for LLM response (for use with output: "array")
export const enrichmentSchema = z.object({
  merchant: z
    .string()
    .nullable()
    .describe("The formal legal business entity name"),
  // A slug from the team's categories listed in the prompt. Checked against
  // that list afterwards, since every team has its own categories.
  category: z
    .string()
    .nullable()
    .describe(
      "The slug of the transaction's category from the allowed list - only return if confidence is high",
    ),
  categoryConfidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Confidence score for the category assignment (0-1, where 1 is highest confidence)",
    ),
  merchantConfidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Confidence score for the merchant name extraction (0-1, where 1 is highest confidence)",
    ),
});

// Types
export type TransactionData = {
  description: string;
  amount: string;
  currency: string;
};

export type EnrichmentResult = z.infer<typeof enrichmentSchema>;

export type UpdateData = {
  merchantName?: string;
  categorySlug?: string;
};

// Confidence thresholds for accepting LLM results
export const CONFIDENCE_THRESHOLDS = {
  CATEGORY_MIN: 0.7, // Only accept category if confidence >= 70%
  MERCHANT_MIN: 0.6, // Only accept merchant if confidence >= 60%
  HIGH_CONFIDENCE: 0.9, // Consider this high confidence
} as const;

// Helper function to determine if we should use the LLM result
export function shouldUseCategoryResult(result: EnrichmentResult): boolean {
  return (
    result.category !== null &&
    result.categoryConfidence >= CONFIDENCE_THRESHOLDS.CATEGORY_MIN
  );
}

export function shouldUseMerchantResult(result: EnrichmentResult): boolean {
  return (
    result.merchant !== null &&
    result.merchantConfidence >= CONFIDENCE_THRESHOLDS.MERCHANT_MIN
  );
}

export function isHighConfidenceResult(result: EnrichmentResult): boolean {
  return (
    result.categoryConfidence >= CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE &&
    result.merchantConfidence >= CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE
  );
}
