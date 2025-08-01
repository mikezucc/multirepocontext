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
    this.dbPath = path.join(userDataPath, 'multirepocontext-vector.db')
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

    // Token usage tracking tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL, -- 'mcp_server' or 'anthropic_api'
        usage_type TEXT NOT NULL, -- 'input' or 'output'
        tokens INTEGER NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Daily aggregated token usage for efficient querying
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        source TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        UNIQUE(date, source)
      )
    `)

    // Create index for efficient token usage queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp)
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_daily_date ON token_usage_daily(date)
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

  // Get statistics for a repository
  async getStatistics(repositoryId: string): Promise<{
    totalDocuments: number
    totalChunks: number
    totalSize: number
    avgChunksPerDocument: number
    avgChunkSize: number
    vectorDimensions: number
    indexedFiles: string[]
    lastUpdated: string | null
  }> {
    if (!this.db) throw new Error('Database not initialized')

    // Get document count
    const docStats = this.db.prepare(`
      SELECT 
        COUNT(*) as totalDocuments,
        SUM(LENGTH(content)) as totalContentSize,
        MAX(updated_at) as lastUpdated
      FROM documents 
      WHERE repository_id = ?
    `).get(repositoryId) as any

    // Get chunk statistics
    const chunkStats = this.db.prepare(`
      SELECT 
        COUNT(*) as totalChunks,
        AVG(LENGTH(c.content)) as avgChunkSize,
        MAX(LENGTH(c.embedding)) as embeddingSize
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.repository_id = ?
    `).get(repositoryId) as any

    // Get list of indexed files
    const files = this.db.prepare(`
      SELECT file_path 
      FROM documents 
      WHERE repository_id = ? 
      ORDER BY file_path
    `).all(repositoryId) as { file_path: string }[]

    // Calculate vector dimensions from embedding size
    const vectorDimensions = chunkStats.embeddingSize ? chunkStats.embeddingSize / 4 : 0

    return {
      totalDocuments: docStats.totalDocuments || 0,
      totalChunks: chunkStats.totalChunks || 0,
      totalSize: docStats.totalContentSize || 0,
      avgChunksPerDocument: docStats.totalDocuments > 0 
        ? (chunkStats.totalChunks || 0) / docStats.totalDocuments 
        : 0,
      avgChunkSize: chunkStats.avgChunkSize || 0,
      vectorDimensions,
      indexedFiles: files.map(f => f.file_path),
      lastUpdated: docStats.lastUpdated
    }
  }

  // Debug search - returns raw results for a query
  async debugSearch(repositoryId: string, query: string, limit: number = 10): Promise<{
    query: string
    queryEmbedding?: number[]
    results: Array<{
      documentId: number
      filePath: string
      chunkIndex: number
      content: string
      score: number
      method: 'vector' | 'fts' | 'hybrid'
      metadata: any
    }>
    timing: {
      embeddingTime: number
      searchTime: number
      totalTime: number
    }
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const startTime = Date.now()
    const timing = {
      embeddingTime: 0,
      searchTime: 0,
      totalTime: 0
    }

    // This will be filled by the search implementation
    // For now, return a placeholder
    return {
      query,
      results: [],
      timing
    }
  }

  // Token usage tracking methods
  async trackTokenUsage(source: 'mcp_server' | 'anthropic_api', usageType: 'input' | 'output', tokens: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    
    // Insert into detailed usage table
    const stmt = this.db.prepare(`
      INSERT INTO token_usage (source, usage_type, tokens)
      VALUES (?, ?, ?)
    `)
    stmt.run(source, usageType, tokens)
    
    // Update daily aggregated table
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD format
    const updateStmt = this.db.prepare(`
      INSERT INTO token_usage_daily (date, source, ${usageType}_tokens)
      VALUES (?, ?, ?)
      ON CONFLICT(date, source) 
      DO UPDATE SET ${usageType}_tokens = ${usageType}_tokens + ?
    `)
    updateStmt.run(today, source, tokens, tokens)
  }

  async getTokenUsageStats(): Promise<{
    today: { mcp: { input: number; output: number }; anthropic: { input: number; output: number } };
    total: { mcp: { input: number; output: number }; anthropic: { input: number; output: number } };
  }> {
    if (!this.db) throw new Error('Database not initialized')
    
    const today = new Date().toISOString().split('T')[0]
    
    // Get today's usage
    const todayStmt = this.db.prepare(`
      SELECT source, input_tokens, output_tokens
      FROM token_usage_daily
      WHERE date = ?
    `)
    const todayRows = todayStmt.all(today) as Array<{ source: string; input_tokens: number; output_tokens: number }>
    
    // Get total usage
    const totalStmt = this.db.prepare(`
      SELECT source, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
      FROM token_usage_daily
      GROUP BY source
    `)
    const totalRows = totalStmt.all() as Array<{ source: string; input_tokens: number; output_tokens: number }>
    
    // Initialize result structure
    const result = {
      today: {
        mcp: { input: 0, output: 0 },
        anthropic: { input: 0, output: 0 }
      },
      total: {
        mcp: { input: 0, output: 0 },
        anthropic: { input: 0, output: 0 }
      }
    }
    
    // Process today's data
    todayRows.forEach(row => {
      if (row.source === 'mcp_server') {
        result.today.mcp.input = row.input_tokens
        result.today.mcp.output = row.output_tokens
      } else if (row.source === 'anthropic_api') {
        result.today.anthropic.input = row.input_tokens
        result.today.anthropic.output = row.output_tokens
      }
    })
    
    // Process total data
    totalRows.forEach(row => {
      if (row.source === 'mcp_server') {
        result.total.mcp.input = row.input_tokens
        result.total.mcp.output = row.output_tokens
      } else if (row.source === 'anthropic_api') {
        result.total.anthropic.input = row.input_tokens
        result.total.anthropic.output = row.output_tokens
      }
    })
    
    return result
  }
}

export const vectorDB = new VectorDatabase()