import { vectorDB } from './database'

export interface SearchResult {
  documentId: number
  chunkId: number
  content: string
  score: number
  metadata: any
  filePath: string
  title: string
}

export interface HybridSearchOptions {
  weightFts?: number      // Weight for FTS5 results (default: 1.0)
  weightVector?: number   // Weight for vector results (default: 1.0)
  topK?: number          // Number of results to return (default: 10)
  minScore?: number      // Minimum score threshold (default: 0)
}

export class HybridSearch {
  // Perform vector similarity search
  async vectorSearch(
    queryEmbedding: Float32Array,
    repositoryId: string,
    limit: number = 20
  ): Promise<Array<{ id: number; score: number }>> {
    const db = vectorDB.getDatabase()
    
    // Get all chunks for the repository with embeddings
    const chunks = db.prepare(`
      SELECT c.id, c.embedding
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.repository_id = ?
      AND c.embedding IS NOT NULL
    `).all(repositoryId) as Array<{ id: number; embedding: Buffer }>

    // Calculate cosine similarity for each chunk
    const results = chunks.map(chunk => {
      const chunkEmbedding = vectorDB.bufferToFloat32Array(chunk.embedding)
      const score = this.cosineSimilarity(queryEmbedding, chunkEmbedding)
      return { id: chunk.id, score }
    })

    // Sort by score and return top results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  // Perform FTS5 full-text search
  async ftsSearch(
    query: string,
    repositoryId: string,
    limit: number = 20
  ): Promise<Array<{ id: number; score: number }>> {
    const db = vectorDB.getDatabase()
    
    // Use FTS5 to search for matching chunks
    const results = db.prepare(`
      SELECT 
        c.id,
        -rank as score
      FROM chunks_fts f
      JOIN chunks c ON f.rowid = c.id
      JOIN documents d ON c.document_id = d.id
      WHERE d.repository_id = ?
      AND chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(repositoryId, query, limit) as Array<{ id: number; score: number }>

    // Normalize FTS scores to 0-1 range
    if (results.length > 0) {
      const maxScore = Math.max(...results.map(r => r.score))
      results.forEach(r => r.score = r.score / maxScore)
    }

    return results
  }

  // Perform hybrid search combining vector and FTS results
  async hybridSearch(
    query: string,
    queryEmbedding: Float32Array,
    repositoryId: string,
    options: HybridSearchOptions = {}
  ): Promise<SearchResult[]> {
    const {
      weightFts = 1.0,
      weightVector = 1.0,
      topK = 10,
      minScore = 0
    } = options

    // Perform both searches in parallel
    const [vectorResults, ftsResults] = await Promise.all([
      this.vectorSearch(queryEmbedding, repositoryId, topK * 2),
      this.ftsSearch(query, repositoryId, topK * 2)
    ])

    // Combine results using reciprocal rank fusion
    const combinedScores = new Map<number, number>()
    
    // Add vector search results
    vectorResults.forEach((result, index) => {
      const reciprocalRank = 1 / (index + 1)
      combinedScores.set(
        result.id,
        weightVector * reciprocalRank
      )
    })

    // Add FTS results
    ftsResults.forEach((result, index) => {
      const reciprocalRank = 1 / (index + 1)
      const existingScore = combinedScores.get(result.id) || 0
      combinedScores.set(
        result.id,
        existingScore + weightFts * reciprocalRank
      )
    })

    // Get chunk details for combined results
    const db = vectorDB.getDatabase()
    const chunkIds = Array.from(combinedScores.keys())
    
    if (chunkIds.length === 0) {
      return []
    }

    const placeholders = chunkIds.map(() => '?').join(',')
    const chunks = db.prepare(`
      SELECT 
        c.id as chunkId,
        c.document_id as documentId,
        c.content,
        c.metadata,
        d.file_path as filePath,
        d.title
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE c.id IN (${placeholders})
    `).all(...chunkIds) as Array<{
      chunkId: number
      documentId: number
      content: string
      metadata: string
      filePath: string
      title: string
    }>

    // Create final results with combined scores
    const results: SearchResult[] = chunks.map(chunk => ({
      documentId: chunk.documentId,
      chunkId: chunk.chunkId,
      content: chunk.content,
      score: combinedScores.get(chunk.chunkId) || 0,
      metadata: JSON.parse(chunk.metadata || '{}'),
      filePath: chunk.filePath,
      title: chunk.title
    }))

    // Sort by score and filter
    return results
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  // Calculate cosine similarity between two vectors
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length')
    }

    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    normA = Math.sqrt(normA)
    normB = Math.sqrt(normB)

    if (normA === 0 || normB === 0) {
      return 0
    }

    return dotProduct / (normA * normB)
  }

  // Get full document context by combining chunks
  async getDocumentContext(
    documentId: number,
    centerChunkId: number,
    contextChunks: number = 2
  ): Promise<string> {
    const db = vectorDB.getDatabase()
    
    // Get the center chunk's index
    const centerChunk = db.prepare(`
      SELECT chunk_index FROM chunks WHERE id = ?
    `).get(centerChunkId) as { chunk_index: number }

    if (!centerChunk) {
      return ''
    }

    // Get surrounding chunks
    const chunks = db.prepare(`
      SELECT content, chunk_index, metadata
      FROM chunks
      WHERE document_id = ?
      AND chunk_index >= ?
      AND chunk_index <= ?
      ORDER BY chunk_index
    `).all(
      documentId,
      Math.max(0, centerChunk.chunk_index - contextChunks),
      centerChunk.chunk_index + contextChunks
    ) as Array<{ content: string; chunk_index: number; metadata: string }>

    // Combine chunks into context
    return chunks.map(c => c.content).join('\n\n')
  }
}

export const hybridSearch = new HybridSearch()