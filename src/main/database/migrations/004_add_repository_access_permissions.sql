-- Migration to add repository access permissions for cross-repository queries
CREATE TABLE IF NOT EXISTS repository_access_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_repository_id TEXT NOT NULL,
  target_repository_id TEXT NOT NULL,
  permission_type TEXT NOT NULL DEFAULT 'read', -- 'read' for now, extensible for future
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  granted_by TEXT, -- Could be used to track who granted the permission
  expires_at DATETIME, -- Optional expiration date
  FOREIGN KEY (source_repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  FOREIGN KEY (target_repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE(source_repository_id, target_repository_id, permission_type)
);

-- Index for faster permission lookups
CREATE INDEX IF NOT EXISTS idx_repo_access_source ON repository_access_permissions(source_repository_id);
CREATE INDEX IF NOT EXISTS idx_repo_access_target ON repository_access_permissions(target_repository_id);
CREATE INDEX IF NOT EXISTS idx_repo_access_expires ON repository_access_permissions(expires_at) WHERE expires_at IS NOT NULL;