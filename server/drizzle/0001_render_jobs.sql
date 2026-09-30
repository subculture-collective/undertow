CREATE TABLE "render_job" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"api_key_id" text,
	"status" text DEFAULT 'awaiting_upload' NOT NULL,
	"spec" jsonb NOT NULL,
	"duration_seconds" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"token_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"output_bytes" integer,
	"worker_id" text,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "render_media" (
	"job_id" text NOT NULL,
	"media_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text DEFAULT 'application/octet-stream' NOT NULL,
	"size" integer NOT NULL,
	"uploaded" boolean DEFAULT false NOT NULL,
	CONSTRAINT "render_media_job_id_media_id_pk" PRIMARY KEY("job_id","media_id")
);
--> statement-breakpoint
ALTER TABLE "render_job" ADD CONSTRAINT "render_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_media" ADD CONSTRAINT "render_media_job_id_render_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."render_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "render_job_user_idx" ON "render_job" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "render_job_status_idx" ON "render_job" USING btree ("status","created_at");