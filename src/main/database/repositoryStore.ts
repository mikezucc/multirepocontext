import Database from 'better-sqlite3'
import { getDatabase } from './database'

interface StoredRepository {
  id: string
  name: string
  path: string
  added_at: string
  last_opened: string
}

class RepositoryStore {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  // Add a new repository
  addRepository(id: string, name: string, repoPath: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO repositories (id, name, path, last_opened)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `)
    
    try {
      stmt.run(id, name, repoPath)
    } catch (error) {
      console.error('Error adding repository to store:', error)
      throw error
    }
  }

  // Remove a repository
  removeRepository(id: string): void {
    const stmt = this.db.prepare('DELETE FROM repositories WHERE id = ?')
    
    try {
      stmt.run(id)
    } catch (error) {
      console.error('Error removing repository from store:', error)
      throw error
    }
  }

  // Get all stored repositories
  getAllRepositories(): StoredRepository[] {
    const stmt = this.db.prepare(`
      SELECT * FROM repositories 
      ORDER BY last_opened DESC
    `)
    
    try {
      return stmt.all() as StoredRepository[]
    } catch (error) {
      console.error('Error getting repositories from store:', error)
      return []
    }
  }

  // Update last opened timestamp
  updateLastOpened(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE repositories 
      SET last_opened = CURRENT_TIMESTAMP 
      WHERE id = ?
    `)
    
    try {
      stmt.run(id)
    } catch (error) {
      console.error('Error updating last opened:', error)
    }
  }

  // Check if a repository path exists
  hasRepository(repoPath: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM repositories WHERE path = ?')
    
    try {
      const result = stmt.get(repoPath)
      return !!result
    } catch (error) {
      console.error('Error checking repository existence:', error)
      return false
    }
  }

  // Close the database connection
  close(): void {
    this.db.close()
  }
}

export const repositoryStore = new RepositoryStore()