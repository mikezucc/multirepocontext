import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs/promises'
import { app } from 'electron'

export class VectorDatabase {
  private db: Database.Database | null = null
  private dbPath: string

  constructor() {
    // Store database in app's user data directory
    const userDataPath = app.getPath('userData')
    this.dbPath = path.join(userDataPath, 'mdgent-vector.db')
  }

  async initialize(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath)
      await fs.mkdir(dir, { recursive: true })

      // Open database
      this.db = new Database(this.dbPath)
      
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON')
      
      // Create tables
      await this.createTables()
      
      console.log('[VectorDB] Database initialized at:', this.dbPath)
    } catch (error) {
      console.error('[VectorDB] Failed to initialize database:', error)
      throw error
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    // Documents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(repository_id, file_path)
      )
    `)

    // Document chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT, -- JSON metadata (headers, position, etc)
        embedding BLOB, -- Vector embedding
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        UNIQUE(document_id, chunk_index)
      )
    `)

    // Create virtual table for FTS5 full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        content=chunks,
        content_rowid=id
      )
    `)

    // Create triggers to keep FTS index in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END
    `)

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        DELETE FROM chunks_fts WHERE rowid = old.id;
      END
    `)

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        UPDATE chunks_fts SET content = new.content WHERE rowid = new.id;
      END
    `)

    // Create index for vector similarity search
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id)
    `)

    // Create index for repository queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_repository_id ON documents(repository_id)
    `)
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  getDatabase(): Database.Database {
    if (!this.db) throw new Error('Database not initialized')
    return this.db
  }

  // Document management methods
  async upsertDocument(
    repositoryId: string, 
    filePath: string, 
    title: string, 
    content: string
  ): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT INTO documents (repository_id, file_path, title, content)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(repository_id, file_path) 
      DO UPDATE SET 
        title = excluded.title,
        content = excluded.content,
        updated_at = CURRENT_TIMESTAMP
    `)

    const info = stmt.run(repositoryId, filePath, title, content)
    
    // Get the document ID
    const doc = this.db.prepare(
      'SELECT id FROM documents WHERE repository_id = ? AND file_path = ?'
    ).get(repositoryId, filePath) as { id: number }
    
    return doc.id
  }

  async deleteDocument(repositoryId: string, filePath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(
      'DELETE FROM documents WHERE repository_id = ? AND file_path = ?'
    )
    stmt.run(repositoryId, filePath)
  }

  async deleteRepository(repositoryId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('DELETE FROM documents WHERE repository_id = ?')
    stmt.run(repositoryId)
  }

  // Chunk management methods
  async insertChunk(
    documentId: number,
    chunkIndex: number,
    content: string,
    embedding: Float32Array,
    metadata: any
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (document_id, chunk_index, content, embedding, metadata)
      VALUES (?, ?, ?, ?, ?)
    `)

    // Convert Float32Array to Buffer for storage
    const embeddingBuffer = Buffer.from(embedding.buffer)
    const metadataJson = JSON.stringify(metadata)

    stmt.run(documentId, chunkIndex, content, embeddingBuffer, metadataJson)
  }

  async deleteChunksForDocument(documentId: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const stmt = this.db.prepare('DELETE FROM chunks WHERE document_id = ?')
    stmt.run(documentId)
  }

  // Helper to convert buffer back to Float32Array
  bufferToFloat32Array(buffer: Buffer): Float32Array {
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4)
  }
}

export const vectorDB = new VectorDatabase()