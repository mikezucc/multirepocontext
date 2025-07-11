import express from 'express'
import { Server } from 'http'
import { hybridSearch } from './vectordb/search'
import { embeddingGenerator } from './embeddings/embeddings'
import { vectorDB } from './vectordb/database'
import { countTokens } from '../shared/tokenUtils'

export class SearchServer {
  private app: express.Application
  private server: Server | null = null
  private port: number = 0 // Will be assigned dynamically

  constructor() {
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json({ limit: '10mb' }))
    
    // CORS for local requests
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') {
        res.sendStatus(200)
      } else {
        next()
      }
    })
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'mdgent-search' })
    })

    // Main search endpoint
    this.app.post('/search', async (req, res) => {
      try {
        const { prompt, repositoryId, options = {} } = req.body

        if (!prompt || !repositoryId) {
          return res.status(400).json({
            error: 'Missing required fields: prompt and repositoryId'
          })
        }

        console.log('[SearchServer] Processing request for repository:', repositoryId)

        // Generate embedding for the prompt
        const queryEmbedding = await embeddingGenerator.generateEmbedding(prompt)

        // Perform hybrid search
        const searchResults = await hybridSearch.hybridSearch(
          prompt,
          queryEmbedding,
          repositoryId,
          {
            weightFts: options.weightFts || 1.0,
            weightVector: options.weightVector || 1.0,
            topK: options.topK || 5,
            minScore: options.minScore || 0.1
          }
        )

        if (searchResults.length === 0) {
          return res.json({
            success: true,
            results: [],
            message: 'No relevant documents found'
          })
        }

        // Get expanded context for each result
        const contextPromises = searchResults.map(async (result) => {
          const context = await hybridSearch.getDocumentContext(
            result.documentId,
            result.chunkId,
            options.contextChunks || 2
          )
          return {
            ...result,
            expandedContext: context
          }
        })

        const resultsWithContext = await Promise.all(contextPromises)

        // Format response
        const response = {
          success: true,
          query: prompt,
          results: resultsWithContext.map(r => ({
            filePath: r.filePath,
            title: r.title,
            score: r.score,
            content: r.expandedContext || r.content,
            metadata: r.metadata
          }))
        }

        // Track MCP server token usage
        const inputTokens = countTokens(prompt)
        const outputTokens = countTokens(JSON.stringify(response))
        
        await vectorDB.trackTokenUsage('mcp_server', 'input', inputTokens)
        await vectorDB.trackTokenUsage('mcp_server', 'output', outputTokens)

        res.json(response)
      } catch (error) {
        console.error('[SearchServer] Error processing request:', error)
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Internal server error'
        })
      }
    })

    // Endpoint to check if a repository has been indexed
    this.app.get('/repository/:id/status', async (req, res) => {
      try {
        const { id } = req.params
        const db = vectorDB.getDatabase()
        
        const result = db.prepare(`
          SELECT COUNT(*) as documentCount, MAX(updated_at) as lastUpdated
          FROM documents
          WHERE repository_id = ?
        `).get(id) as { documentCount: number; lastUpdated: string }

        res.json({
          indexed: result.documentCount > 0,
          documentCount: result.documentCount,
          lastUpdated: result.lastUpdated
        })
      } catch (error) {
        console.error('[SearchServer] Error checking repository status:', error)
        res.status(500).json({ error: 'Failed to check repository status' })
      }
    })
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        // Start on a random available port
        this.server = this.app.listen(0, '127.0.0.1', () => {
          const address = this.server!.address()
          if (typeof address === 'object' && address !== null) {
            this.port = address.port
            console.log(`[SearchServer] Server started on port ${this.port}`)
            resolve(this.port)
          } else {
            reject(new Error('Failed to get server address'))
          }
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[SearchServer] Server stopped')
          this.server = null
          this.port = 0
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  getPort(): number {
    return this.port
  }
}

export const searchServer = new SearchServer()