CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"target_distance_m" integer NOT NULL,
	"target_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"replaced_at" timestamp with time zone,
	CONSTRAINT "goals_title_length_chk" CHECK (char_length("goals"."title") between 1 and 80),
	CONSTRAINT "goals_title_not_blank_chk" CHECK ("goals"."title" ~ '[^[:space:]]'),
	CONSTRAINT "goals_target_distance_chk" CHECK ("goals"."target_distance_m" between 1 and 1000000),
	CONSTRAINT "goals_target_date_range_chk" CHECK ("goals"."target_date" between date '0001-01-01' and date '9999-12-31'),
	CONSTRAINT "goals_status_chk" CHECK ("goals"."status" in ('active', 'completed', 'replaced')),
	CONSTRAINT "goals_completed_at_chk" CHECK (("goals"."status" = 'completed') = ("goals"."completed_at" is not null)),
	CONSTRAINT "goals_replaced_at_chk" CHECK (("goals"."status" = 'replaced') = ("goals"."replaced_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"performed_on" date NOT NULL,
	"distance_m" integer NOT NULL,
	"duration_s" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_distance_chk" CHECK ("workouts"."distance_m" between 1 and 1000000),
	CONSTRAINT "workouts_duration_chk" CHECK ("workouts"."duration_s" between 1 and 172800),
	CONSTRAINT "workouts_performed_on_range_chk" CHECK ("workouts"."performed_on" between date '1970-01-01' and date '9999-12-31'),
	CONSTRAINT "workouts_notes_chk" CHECK ("workouts"."notes" is null or (char_length("workouts"."notes") between 1 and 1000 and "workouts"."notes" ~ '[^[:space:]]'))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "goals_one_active_per_user_idx" ON "goals" USING btree ("user_id") WHERE "goals"."status" = 'active';--> statement-breakpoint
CREATE INDEX "goals_user_created_idx" ON "goals" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "workouts_user_history_idx" ON "workouts" USING btree ("user_id","performed_on" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);