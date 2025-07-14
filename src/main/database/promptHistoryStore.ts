import Database from 'better-sqlite3'
import * as path from 'path'
import { app } from 'electron'

interface PromptHistoryEntry {
  id: string
  prompt: string
  repository_id: string
  repository_name: string
  options: string // JSON stringified search options
  timestamp: string
  total_results: number
}

interface PromptResult {
  id: string
  prompt_history_id: string
  repository_id: string
  document_id: string
  document_path: string
  chunk_index: number
  score: number
  content: string
  metadata: string // JSON stringified metadata
}

class PromptHistoryStore {
  private db: Database.Database

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'mdgent.db')
    this.db = new Database(dbPath)
    
    // Run migration before initializing
    this.runMigration()
    this.initialize()
    
    // Clean up any duplicate entries from previous runs
    this.cleanupDuplicates()
  }

  private runMigration() {
    try {
      // Check if tables already exist
      const tableExists = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='prompt_history'
      `).get()
      
      if (!tableExists) {
        console.log('[PromptHistoryStore] Running migration to create prompt history tables')
        
        // Execute migration inline since SQL files might not be available in production
        const migration = `
          -- Create prompt history table
          CREATE TABLE IF NOT EXISTS prompt_history (
            id TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            repository_id TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            options TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            total_results INTEGER DEFAULT 0,
            FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
          );

          -- Create prompt results table
          CREATE TABLE IF NOT EXISTS prompt_results (
            id TEXT PRIMARY KEY,
            prompt_history_id TEXT NOT NULL,
            repository_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            document_path TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            score REAL NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            FOREIGN KEY (prompt_history_id) REFERENCES prompt_history(id) ON DELETE CASCADE,
            FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
          );

          -- Create indexes for better performance
          CREATE INDEX IF NOT EXISTS idx_prompt_history_repository_id ON prompt_history(repository_id);
          CREATE INDEX IF NOT EXISTS idx_prompt_history_timestamp ON prompt_history(timestamp);
          CREATE INDEX IF NOT EXISTS idx_prompt_results_prompt_history_id ON prompt_results(prompt_history_id);
          CREATE INDEX IF NOT EXISTS idx_prompt_results_score ON prompt_results(score);
        `
        this.db.exec(migration)
        console.log('[PromptHistoryStore] Migration completed successfully')
      }
    } catch (error) {
      console.error('[PromptHistoryStore] Migration error:', error)
      // Continue with initialization even if migration fails
    }
  }

  private initialize() {
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON')
    
    // Create prompt history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_history (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        repository_id TEXT NOT NULL,
        repository_name TEXT NOT NULL,
        options TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_results INTEGER DEFAULT 0,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      )
    `)

    // Create prompt results table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_results (
        id TEXT PRIMARY KEY,
        prompt_history_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        document_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        score REAL NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (prompt_history_id) REFERENCES prompt_history(id) ON DELETE CASCADE
      )
    `)

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_prompt_history_repository_id ON prompt_history(repository_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_history_timestamp ON prompt_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_prompt_results_prompt_history_id ON prompt_results(prompt_history_id);
      CREATE INDEX IF NOT EXISTS idx_prompt_results_score ON prompt_results(score);
    `)
  }

  // Add a new prompt history entry
  addPromptHistory(
    id: string,
    prompt: string,
    repositoryId: string,
    repositoryName: string,
    options: any
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO prompt_history (id, prompt, repository_id, repository_name, options)
      VALUES (?, ?, ?, ?, ?)
    `)
    
    try {
      stmt.run(id, prompt, repositoryId, repositoryName, JSON.stringify(options))
    } catch (error) {
      console.error('Error adding prompt history:', error)
      throw error
    }
  }

  // Add results for a prompt
  addPromptResults(promptHistoryId: string, repositoryId: string, results: any[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO prompt_results (
        id, prompt_history_id, repository_id, document_id, document_path,
        chunk_index, score, content, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const updateCountStmt = this.db.prepare(`
      UPDATE prompt_history 
      SET total_results = ? 
      WHERE id = ?
    `)
    
    try {
      this.db.transaction(() => {
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          const resultId = `${promptHistoryId}-${i}-${Date.now()}`
          stmt.run(
            resultId,
            promptHistoryId,
            repositoryId,
            result.document_id,
            result.document_path,
            result.chunk_index || 0,
            result.score,
            result.content,
            JSON.stringify(result.metadata || {})
          )
        }
        const dbInsertResult = updateCountStmt.run(results.length, promptHistoryId);
        console.log(`[PromptHistoryStore] Updated prompt history ${promptHistoryId} with ${dbInsertResult} total results.`);
      })()
    } catch (error) {
      console.error('Error adding prompt results:', error)
      throw error
    }
  }

  // Get prompt history for a repository
  getPromptHistory(repositoryId: string, limit: number = 50): PromptHistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM prompt_history
      WHERE repository_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    
    try {
      return stmt.all(repositoryId, limit) as PromptHistoryEntry[]
    } catch (error) {
      console.error('Error getting prompt history:', error)
      return []
    }
  }

  // Get all prompt history across all repositories
  getAllPromptHistory(limit: number = 100): PromptHistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM prompt_history
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    
    try {
      return stmt.all(limit) as PromptHistoryEntry[]
    } catch (error) {
      console.error('Error getting all prompt history:', error)
      return []
    }
  }

  // Get results for a specific prompt
  getPromptResults(promptHistoryId: string): PromptResult[] {
    const stmt = this.db.prepare(`
      SELECT * FROM prompt_results
      WHERE prompt_history_id = ?
      ORDER BY score DESC
    `)
    
    try {
      return stmt.all(promptHistoryId) as PromptResult[]
    } catch (error) {
      console.error('Error getting prompt results:', error)
      return []
    }
  }

  // Delete old prompt history entries (older than days specified)
  cleanupOldHistory(daysToKeep: number = 30): void {
    const stmt = this.db.prepare(`
      DELETE FROM prompt_history
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `)
    
    try {
      const result = stmt.run(daysToKeep)
      console.log(`Cleaned up ${result.changes} old prompt history entries`)
    } catch (error) {
      console.error('Error cleaning up old history:', error)
    }
  }

  // Search prompt history
  searchPromptHistory(searchTerm: string, repositoryId?: string): PromptHistoryEntry[] {
    let query = `
      SELECT * FROM prompt_history
      WHERE prompt LIKE ?
    `
    const params: any[] = [`%${searchTerm}%`]
    
    if (repositoryId) {
      query += ` AND repository_id = ?`
      params.push(repositoryId)
    }
    
    query += ` ORDER BY timestamp DESC LIMIT 50`
    
    const stmt = this.db.prepare(query)
    
    try {
      return stmt.all(...params) as PromptHistoryEntry[]
    } catch (error) {
      console.error('Error searching prompt history:', error)
      return []
    }
  }

  // Delete duplicate or problematic entries
  cleanupDuplicates(): void {
    try {
      // Check if repository_id column exists
      const columnExists = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM pragma_table_info('prompt_results') 
        WHERE name='repository_id'
      `).get() as { count: number }
      
      if (columnExists.count === 0) {
        // If column doesn't exist, drop and recreate the table with new schema
        console.log('[PromptHistoryStore] Migrating prompt_results table to include repository_id')
        this.db.exec(`
          DROP TABLE IF EXISTS prompt_results;
          CREATE TABLE prompt_results (
            id TEXT PRIMARY KEY,
            prompt_history_id TEXT NOT NULL,
            repository_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            document_path TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            score REAL NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            FOREIGN KEY (prompt_history_id) REFERENCES prompt_history(id) ON DELETE CASCADE,
            FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
          );
          CREATE INDEX idx_prompt_results_prompt_history_id ON prompt_results(prompt_history_id);
          CREATE INDEX idx_prompt_results_score ON prompt_results(score);
        `)
      }
      
      console.log('[PromptHistoryStore] Cleanup completed')
    } catch (error) {
      console.error('[PromptHistoryStore] Error during cleanup:', error)
    }
  }

  // Close the database connection
  close(): void {
    // DB is shared with repositoryStore, so we don't close it here
  }
}

export const promptHistoryStore = new PromptHistoryStore()