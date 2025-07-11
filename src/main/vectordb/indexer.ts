import { vectorDB } from './database'
import { embeddingGenerator } from '../embeddings/embeddings'
import { documentChunker } from '../embeddings/chunker'

export class DocumentIndexer {
  async indexFile(repositoryId: string, filePath: string, content: string): Promise<void> {
    try {
      console.log('[Indexer] Indexing file:', filePath)
      
      const fileName = filePath.split('/').pop() || filePath
      
      // Insert or update document
      const documentId = await vectorDB.upsertDocument(
        repositoryId,
        filePath,
        fileName,
        content
      )
      
      // Delete existing chunks for this document
      await vectorDB.deleteChunksForDocument(documentId)
      
      // Chunk the document
      const chunks = await documentChunker.chunkDocument(content, filePath)
      
      // Optimize chunks
      const optimizedChunks = documentChunker.optimizeChunks(chunks)
      
      // Generate embeddings for chunks
      const chunkTexts = optimizedChunks.map(c => c.content)
      const embeddings = await embeddingGenerator.generateBatchEmbeddings(chunkTexts)
      
      // Store chunks with embeddings
      for (let i = 0; i < optimizedChunks.length; i++) {
        await vectorDB.insertChunk(
          documentId,
          i,
          optimizedChunks[i].content,
          embeddings[i],
          optimizedChunks[i].metadata
        )
      }
      
      console.log(`[Indexer] Indexed ${optimizedChunks.length} chunks for:`, filePath)
    } catch (error) {
      console.error('[Indexer] Error indexing file:', filePath, error)
      throw error
    }
  }

  async getIndexStats(repositoryId: string): Promise<{
    documentCount: number
    chunkCount: number
    lastIndexed: Date | null
  }> {
    const db = vectorDB.getDatabase()
    
    const docStats = db.prepare(`
      SELECT COUNT(*) as count, MAX(updated_at) as lastUpdated
      FROM documents
      WHERE repository_id = ?
    `).get(repositoryId) as { count: number; lastUpdated: string }

    const chunkStats = db.prepare(`
      SELECT COUNT(*) as count
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.repository_id = ?
    `).get(repositoryId) as { count: number }

    return {
      documentCount: docStats.count,
      chunkCount: chunkStats.count,
      lastIndexed: docStats.lastUpdated ? new Date(docStats.lastUpdated) : null
    }
  }

  async removeFile(repositoryId: string, filePath: string): Promise<void> {
    try {
      await vectorDB.deleteDocument(repositoryId, filePath)
      console.log('[Indexer] Removed from index:', filePath)
    } catch (error) {
      console.error('[Indexer] Error removing file:', filePath, error)
    }
  }

  async removeRepository(repositoryId: string): Promise<void> {
    try {
      await vectorDB.deleteRepository(repositoryId)
      console.log('[Indexer] Removed repository from index:', repositoryId)
    } catch (error) {
      console.error('[Indexer] Error removing repository:', repositoryId, error)
    }
  }
}

export const documentIndexer = new DocumentIndexer()