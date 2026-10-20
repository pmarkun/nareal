CREATE TABLE transcript_blocks (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, start_seconds REAL, end_seconds REAL, speaker TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX transcript_blocks_video_time ON transcript_blocks(video_id,start_seconds,created_at);
