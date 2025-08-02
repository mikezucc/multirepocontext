import express from 'express'
import { Server } from 'http'
import { hybridSearch } from './vectordb/search'
import { embeddingGenerator } from './embeddings/embeddings'
import { vectorDB } from './vectordb/database'
import { countTokens } from '../shared/tokenUtils'
import { promptExpansionService } from './services/promptExpansion'
import { promptHistoryStore } from './database/promptHistoryStore'
import { v4 as uuidv4 } from 'uuid'
import { repositoryAccessStore } from './database/repositoryAccessStore'
import { repositoryStore } from './database/repositoryStore'
import log from 'electron-log/main'

export class SearchServer {
  private app: express.Application
  private server: Server | null = null
  private port: number = 3989 // Fixed port to avoid conflicts and match CSP

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
      res.json({ status: 'ok', service: 'multirepocontext-search' })
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

        log.info('[SearchServer] Processing request for repository:', repositoryId)

        // Create prompt history entry
        const promptHistoryId = uuidv4()
        promptHistoryStore.addPromptHistory(
          promptHistoryId,
          prompt,
          repositoryId,
          repositoryName,
          options
        )

        log.info('[SearchServer] [BEFORE] Expanded prompt:', prompt)

        // Expand the prompt with related keywords
        const expandedPrompt = await promptExpansionService.expandPromptForSearch(prompt)
        log.info('[SearchServer] Expanded prompt:', expandedPrompt)

        // Generate embedding for the expanded prompt
        const queryEmbedding = await embeddingGenerator.generateEmbedding(expandedPrompt)

        // Get accessible repositories for this repository
        const accessibleRepositories = repositoryAccessStore.getAccessibleRepositories(repositoryId)
        log.info('[SearchServer] Accessible repositories for', repositoryId, ':', accessibleRepositories)

        // Perform hybrid search with expanded prompt across accessible repositories
        const searchResults = await hybridSearch.hybridSearch(
          expandedPrompt,
          queryEmbedding,
          accessibleRepositories,
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

        // Get repository names for the results
        const repositoryNames = new Map<string, string>()
        for (const result of resultsWithContext) {
          if (result.repositoryId && !repositoryNames.has(result.repositoryId)) {
            // Get repository info from repository store
            const repos = repositoryStore.getAllRepositories()
            const repo = repos.find(r => r.id === result.repositoryId)
            if (repo) {
              repositoryNames.set(result.repositoryId, repo.name)
            }
          }
        }

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
            metadata: r.metadata,
            repositoryId: r.repositoryId,
            repositoryName: r.repositoryId ? repositoryNames.get(r.repositoryId) || 'Unknown' : repositoryName
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
        
        promptHistoryStore.addPromptResults(promptHistoryId, repositoryId, historyResults)

        // Track MCP server token usage
        const inputTokens = countTokens(prompt)
        const outputTokens = countTokens(JSON.stringify(response))
        
        await vectorDB.trackTokenUsage('mcp_server', 'input', inputTokens)
        await vectorDB.trackTokenUsage('mcp_server', 'output', outputTokens)

        res.json(response)
      } catch (error) {
        log.error('[SearchServer] Error processing request:', error)
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
        log.error('[SearchServer] Error checking repository status:', error)
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
        log.error('[SearchServer] Error fetching prompt history:', error)
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
        
        log.info('[SearchServer] Getting all prompt history with limit:', limit)
        const history = promptHistoryStore.getAllPromptHistory(
          parseInt(limit as string)
        )
        log.info('[SearchServer] Returning', history.length, 'history entries')
        
        res.json({
          success: true,
          history
        })
      } catch (error) {
        log.error('[SearchServer] Error fetching all prompt history:', error)
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
        log.error('[SearchServer] Error fetching prompt results:', error)
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
        log.error('[SearchServer] Error searching prompt history:', error)
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
        // Start on fixed port 3989
        this.server = this.app.listen(this.port, '127.0.0.1', () => {
          log.info(`[SearchServer] Server started on port ${this.port}`)
          resolve(this.port)
        })
        
        this.server.on('error', (error: any) => {
          if (error.code === 'EADDRINUSE') {
            log.error(`[SearchServer] Port ${this.port} is already in use. Please close any other application using this port.`)
            reject(new Error(`Port ${this.port} is already in use`))
          } else {
            reject(error)
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
          log.info('[SearchServer] Server stopped')
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