CREATE TABLE ingestion_jobs (
 id TEXT PRIMARY KEY, video_id TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('youtube','obs')),
 status TEXT NOT NULL DEFAULT 'queued', phase TEXT NOT NULL DEFAULT 'Na fila',
 start_seconds REAL NOT NULL DEFAULT 0, cursor_seconds REAL NOT NULL DEFAULT 0,
 duration_seconds REAL, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 lease_token TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ingestion_jobs_queue ON ingestion_jobs(status,created_at);
CREATE UNIQUE INDEX ingestion_jobs_active_video ON ingestion_jobs(video_id) WHERE status IN ('queued','running');
CREATE TABLE ingestion_workers (id TEXT PRIMARY KEY,last_seen INTEGER NOT NULL);
