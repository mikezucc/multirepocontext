-- Migration to add repositories table for persisting user-selected repositories
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_opened DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster path lookups
CREATE INDEX IF NOT EXISTS idx_repositories_path ON repositories(path);