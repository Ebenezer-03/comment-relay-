CREATE TABLE "answer_packs" (
	"video_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"draft" text DEFAULT '' NOT NULL,
	CONSTRAINT "answer_packs_video_id_pack_id_pk" PRIMARY KEY("video_id","pack_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"creator_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"label" text NOT NULL,
	"priority" text NOT NULL,
	"tone" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"keywords" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	CONSTRAINT "categories_creator_id_pack_id_pk" PRIMARY KEY("creator_id","pack_id")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"parent_id" text NOT NULL,
	"author_name" text,
	"author_initials" text,
	"text" text NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp,
	"pack_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" text PRIMARY KEY NOT NULL,
	"google_sub" text NOT NULL,
	"email" text,
	"channel_title" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"creator_id" text NOT NULL,
	"day" text NOT NULL,
	"units_used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quota_usage_creator_id_day_pk" PRIMARY KEY("creator_id","day")
);
--> statement-breakpoint
CREATE TABLE "sent_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"parent_ids" jsonb NOT NULL,
	"text" text NOT NULL,
	"ok" boolean NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"tokens" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp DEFAULT now() + interval '30 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"cursor" jsonb,
	"videos_total" integer DEFAULT 0 NOT NULL,
	"videos_processed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"title" text NOT NULL,
	"thumbnail_url" text,
	"published_at" timestamp,
	"last_synced_at" timestamp,
	"priority_score" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"top_pack_id" text
);
--> statement-breakpoint
ALTER TABLE "answer_packs" ADD CONSTRAINT "answer_packs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_replies" ADD CONSTRAINT "sent_replies_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_replies" ADD CONSTRAINT "sent_replies_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;