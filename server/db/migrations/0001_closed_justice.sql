ALTER TABLE "answer_packs" ADD COLUMN "context" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "comments_video_id_idx" ON "comments" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "sent_replies_creator_id_idx" ON "sent_replies" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "sessions_creator_id_idx" ON "sessions" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_creator_id_status_idx" ON "sync_jobs" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "videos_creator_id_idx" ON "videos" USING btree ("creator_id");