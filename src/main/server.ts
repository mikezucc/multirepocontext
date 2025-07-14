import express from 'express'
import { Server } from 'http'
import { hybridSearch } from './vectordb/search'
import { embeddingGenerator } from './embeddings/embeddings'
import { vectorDB } from './vectordb/database'
import { countTokens } from '../shared/tokenUtils'
import { promptExpansionService } from './services/promptExpansion'
import { promptHistoryStore } from './database/promptHistoryStore'
import { v4 as uuidv4 } from 'uuid'

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
        const { prompt, repositoryId, repositoryName = 'Unknown', options = {} } = req.body

        if (!prompt || !repositoryId) {
          return res.status(400).json({
            error: 'Missing required fields: prompt and repositoryId'
          })
        }

        console.log('[SearchServer] Processing request for repository:', repositoryId)

        // Create prompt history entry
        const promptHistoryId = uuidv4()
        promptHistoryStore.addPromptHistory(
          promptHistoryId,
          prompt,
          repositoryId,
          repositoryName,
          options
        )

        // Expand the prompt with related keywords
        const expandedPrompt = await promptExpansionService.expandPromptForSearch(prompt)
        console.log('[SearchServer] Expanded prompt:', expandedPrompt)

        // Generate embedding for the expanded prompt
        const queryEmbedding = await embeddingGenerator.generateEmbedding(expandedPrompt)

        // Perform hybrid search with expanded prompt
        const searchResults = await hybridSearch.hybridSearch(
          expandedPrompt,
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
          expandedQuery: expandedPrompt,
          results: resultsWithContext.map(r => ({
            filePath: r.filePath,
            title: r.title,
            score: r.score,
            content: r.expandedContext || r.content,
            metadata: r.metadata
          }))
        }

        // Save search results to prompt history
        const historyResults = resultsWithContext.map(r => ({
          document_id: r.documentId,
          document_path: r.filePath,
          chunk_index: r.chunkId || 0,
          score: r.score,
          content: r.expandedContext || r.content,
          metadata: r.metadata
        }))
        
        promptHistoryStore.addPromptResults(promptHistoryId, historyResults)

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

    // Get prompt history for a repository
    this.app.get('/prompt-history/:repositoryId', async (req, res) => {
      try {
        const { repositoryId } = req.params
        const { limit = 50 } = req.query
        
        const history = promptHistoryStore.getPromptHistory(
          repositoryId, 
          parseInt(limit as string)
        )
        
        res.json({
          success: true,
          history
        })
      } catch (error) {
        console.error('[SearchServer] Error fetching prompt history:', error)
        res.status(500).json({ 
          success: false,
          error: 'Failed to fetch prompt history' 
        })
      }
    })

    // Get all prompt history
    this.app.get('/prompt-history', async (req, res) => {
      try {
        const { limit = 100 } = req.query
        
        const history = promptHistoryStore.getAllPromptHistory(
          parseInt(limit as string)
        )
        
        res.json({
          success: true,
          history
        })
      } catch (error) {
        console.error('[SearchServer] Error fetching all prompt history:', error)
        res.status(500).json({ 
          success: false,
          error: 'Failed to fetch prompt history' 
        })
      }
    })

    // Get results for a specific prompt
    this.app.get('/prompt-results/:promptId', async (req, res) => {
      try {
        const { promptId } = req.params
        
        const results = promptHistoryStore.getPromptResults(promptId)
        
        res.json({
          success: true,
          results
        })
      } catch (error) {
        console.error('[SearchServer] Error fetching prompt results:', error)
        res.status(500).json({ 
          success: false,
          error: 'Failed to fetch prompt results' 
        })
      }
    })

    // Search prompt history
    this.app.get('/prompt-history/search', async (req, res) => {
      try {
        const { q, repositoryId } = req.query
        
        if (!q) {
          return res.status(400).json({
            success: false,
            error: 'Search query (q) is required'
          })
        }
        
        const history = promptHistoryStore.searchPromptHistory(
          q as string,
          repositoryId as string | undefined
        )
        
        res.json({
          success: true,
          history
        })
      } catch (error) {
        console.error('[SearchServer] Error searching prompt history:', error)
        res.status(500).json({ 
          success: false,
          error: 'Failed to search prompt history' 
        })
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