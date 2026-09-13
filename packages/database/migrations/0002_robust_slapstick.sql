ALTER TABLE "agent_threads" ADD COLUMN "running_summary" text;--> statement-breakpoint
ALTER TABLE "agent_threads" ADD COLUMN "summarized_through_seq" bigint;