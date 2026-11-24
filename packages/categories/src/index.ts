// Types

// Main category definitions
export { CATEGORIES } from "./categories";
// Color system
export {
  CATEGORY_COLOR_MAP,
  CATEGORY_COLORS,
  getAllColors,
  getCategoryColor,
  getColorFromSlug,
  getRandomColor,
} from "./color-system";
// Embeddings
export {
  CategoryEmbeddings,
  categoryEmbeddingsEnabled,
  generateCategoryEmbedding,
  generateCategoryEmbeddings,
} from "./embeddings";

// Tax rate configurations
export {
  getSupportedCountries,
  getTaxRateForCategory,
  getTaxTypeForCountry,
  isCountrySupported,
  TAX_RATE_CONFIGS,
} from "./tax-rates";
export type {
  BaseCategory,
  CategoryHierarchy,
  ChildCategory,
  ParentCategory,
  TaxRateConfig,
} from "./types";
// Zod schemas for validation
export {
  baseCategorySchema,
  categoryHierarchySchema,
  childCategorySchema,
  parentCategorySchema,
  taxRateConfigSchema,
} from "./types";
// Utility functions
export {
  getCategoryBySlug,
  getCategoryWithTaxRate,
  getFlatCategories,
  getParentCategory,
} from "./utils";

// Constants for easy reference
export const TAX_TYPES = [
  "vat",
  "gst",
  "sales_tax",
  "income_tax",
  "none",
] as const;

// Category kinds, protected categories and the built-in kind defaults
export {
  CATEGORY_KINDS,
  type CategoryKind,
  CONTRA_REVENUE_CATEGORIES,
  getDefaultCategoryKind,
  isProtectedCategory,
  PROTECTED_CATEGORY_SLUGS,
  REVENUE_CATEGORIES,
} from "./kinds";
