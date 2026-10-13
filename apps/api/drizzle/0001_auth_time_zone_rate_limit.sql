CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
-- Revisto à mão antes da primeira aplicação: o default temporário preenche
-- utilizadores já existentes com "UTC"; o estado final (sem default) é o do snapshot.
ALTER TABLE "user" ADD COLUMN "time_zone" text NOT NULL DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "time_zone" DROP DEFAULT;
