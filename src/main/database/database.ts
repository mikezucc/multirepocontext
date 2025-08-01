import Database from 'better-sqlite3'
import * as path from 'path'
import { app } from 'electron'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'multirepocontext.db')
    db = new Database(dbPath)
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON')
    
    // Initialize base tables
    initializeTables()
  }
  return db
}

function initializeTables() {
  if (!db) return
  
  // Create repositories table first (required by other tables)
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_opened DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  
  // Create index for repositories
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_repositories_path ON repositories(path)
  `)
  
  // Create repository access permissions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS repository_access_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_repository_id TEXT NOT NULL,
      target_repository_id TEXT NOT NULL,
      permission_type TEXT NOT NULL DEFAULT 'read',
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      granted_by TEXT,
      expires_at DATETIME,
      FOREIGN KEY (source_repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      FOREIGN KEY (target_repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
      UNIQUE(source_repository_id, target_repository_id, permission_type)
    )
  `)
  
  // Create indexes for repository access
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_repo_access_source ON repository_access_permissions(source_repository_id);
    CREATE INDEX IF NOT EXISTS idx_repo_access_target ON repository_access_permissions(target_repository_id);
    CREATE INDEX IF NOT EXISTS idx_repo_access_expires ON repository_access_permissions(expires_at) WHERE expires_at IS NOT NULL;
  `)
}

export function closeDatabase() {
  if (db) {
    db.close()
    db = null
  }
}