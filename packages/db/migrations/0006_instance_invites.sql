-- Instance invites: invites to sign up on this instance and create your own
-- team. user_invites rows are team invites only, so team_id becomes NOT NULL;
-- any team-less rows (which could only grant sign-up) move to instance_invites.

CREATE TABLE "instance_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"invited_by" uuid
);
--> statement-breakpoint
ALTER TABLE "instance_invites" ADD CONSTRAINT "instance_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instance_invites_email_key" ON "instance_invites" USING btree (lower("email"));--> statement-breakpoint
INSERT INTO "instance_invites" ("email", "invited_by", "created_at")
SELECT "email", "invited_by", "created_at" FROM "user_invites"
WHERE "team_id" IS NULL AND "email" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "user_invites" WHERE "team_id" IS NULL;--> statement-breakpoint
ALTER TABLE "user_invites" ALTER COLUMN "team_id" SET NOT NULL;
