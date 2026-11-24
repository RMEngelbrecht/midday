CREATE TYPE "public"."transaction_category_kind" AS ENUM('expense', 'income', 'refund', 'cost_of_goods', 'transfer');--> statement-breakpoint
ALTER TABLE "transaction_categories" ADD COLUMN "kind" "transaction_category_kind" DEFAULT 'expense' NOT NULL;--> statement-breakpoint
-- Kinds replace the hard-coded slug lists that decided income, refunds, cost
-- of goods and transfers. Built-in categories get the kind those lists gave
-- them, so reports stay the same.
UPDATE "transaction_categories" SET "kind" = 'income'
WHERE "slug" IN ('revenue', 'income', 'product-sales', 'service-revenue', 'consulting-revenue', 'subscription-revenue', 'interest-income', 'other-income');--> statement-breakpoint
UPDATE "transaction_categories" SET "kind" = 'refund'
WHERE "slug" IN ('customer-refunds', 'chargebacks-disputes');--> statement-breakpoint
UPDATE "transaction_categories" AS c SET "kind" = 'cost_of_goods'
WHERE c."slug" = 'cost-of-goods-sold'
  OR c."parent_id" IN (
    SELECT p."id" FROM "transaction_categories" AS p WHERE p."slug" = 'cost-of-goods-sold'
  );--> statement-breakpoint
UPDATE "transaction_categories" SET "kind" = 'transfer'
WHERE "slug" IN ('transfer', 'internal-transfer');--> statement-breakpoint
-- Custom subcategories take their parent's kind (a custom category under
-- Revenue now counts as income).
UPDATE "transaction_categories" AS c SET "kind" = p."kind"
FROM "transaction_categories" AS p
WHERE c."parent_id" = p."id" AND c."system" IS NOT TRUE;
