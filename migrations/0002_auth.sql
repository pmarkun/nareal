CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL, credential_version TEXT NOT NULL);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX login_attempt_key_time ON login_attempts(key,created_at);
CREATE INDEX chat_messages_room_id ON chat_messages(room,id);
CREATE INDEX chat_messages_actor_time ON chat_messages(actor,created_at);
