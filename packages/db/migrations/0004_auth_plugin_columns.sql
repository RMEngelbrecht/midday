ALTER TABLE "auth"."jwks" ADD COLUMN "alg" text;--> statement-breakpoint
ALTER TABLE "auth"."jwks" ADD COLUMN "crv" text;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD COLUMN "verified" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD COLUMN "failed_verification_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD COLUMN "locked_until" timestamp with time zone;