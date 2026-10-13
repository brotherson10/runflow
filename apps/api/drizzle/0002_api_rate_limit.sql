CREATE TABLE "api_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "api_rate_limit_count_chk" CHECK ("api_rate_limit"."count" >= 1)
);
