-- Reprocessing archives generated blocks instead of deleting editorial history.
ALTER TABLE transcript_blocks ADD COLUMN archived_at INTEGER;
ALTER TABLE ingestion_jobs ADD COLUMN replace_job_id TEXT;
CREATE INDEX transcript_blocks_visible ON transcript_blocks(video_id,archived_at,start_seconds);
