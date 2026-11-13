CREATE TABLE IF NOT EXISTS "agent_commentary_votes" (
	"commentary_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_commentary_votes_commentary_id_user_id_pk" PRIMARY KEY("commentary_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_commentary_votes" ADD CONSTRAINT "agent_commentary_votes_commentary_id_agent_commentary_id_fk" FOREIGN KEY ("commentary_id") REFERENCES "public"."agent_commentary"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_commentary_votes" ADD CONSTRAINT "agent_commentary_votes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_commentary_votes_company_user_idx" ON "agent_commentary_votes" USING btree ("company_id","user_id");
