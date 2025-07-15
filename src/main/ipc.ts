import { ipcMain, dialog } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { createHash } from 'crypto'
import { Repository } from '../shared/types'
import { documentIndexer } from './vectordb/indexer'
import { repositoryStore } from './database/repositoryStore'

export class IpcHandler {
  private daemon: ChildProcess | null = null
  private repositories: Map<string, Repository> = new Map()
  private mainWindow: Electron.BrowserWindow | null = null
  private serverPort: number = 0
  private mcpServers: Map<string, ChildProcess> = new Map() // repositoryId -> MCP server process

  constructor() {
    this.setupHandlers()
    this.startDaemon()
    this.loadStoredRepositories()
  }

  setMainWindow(window: Electron.BrowserWindow) {
    this.mainWindow = window
  }

  setServerPort(port: number) {
    this.serverPort = port
    console.log(`[IPC] Server port set to ${port}`)
  }

  private generateRepositoryId(repoPath: string): string {
    // Normalize the path to ensure consistency
    // Remove trailing slashes and resolve to absolute path
    const normalizedPath = path.resolve(repoPath).replace(/[/\\]+$/, '')
    
    // Create a SHA-256 hash of the normalized path
    const hash = createHash('sha256')
    hash.update(normalizedPath)
    // Return first 32 characters of the hex digest
    return hash.digest('hex').substring(0, 32)
  }

  private setupHandlers() {
    ipcMain.on('add-repository', async (event, data) => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Repository Directory'
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const repoPath = result.filePaths[0]
        const repoName = path.basename(repoPath)
        const repoId = this.generateRepositoryId(repoPath)
        
        // Check if this repository already exists
        if (this.repositories.has(repoId)) {
          console.log(`Repository already exists with ID: ${repoId}`)
          return
        }
        
        const repository: Repository = {
          id: repoId,
          path: repoPath,
          name: repoName,
          status: 'idle',
          lastUpdated: new Date()
        }

        this.repositories.set(repository.id, repository)
        
        // Save to persistent store
        try {
          repositoryStore.addRepository(repository.id, repository.name, repository.path)
        } catch (error) {
          console.error('Failed to save repository to store:', error)
        }
        
        // Send updated repository list
        this.sendToRenderer('repository-status', Array.from(this.repositories.values()))
        
        // Send to daemon
        this.sendToDaemon('add-repository', repository)
        
        // Start MCP server for this repository
        this.startMCPServer(repository.id, repository.path, repository.name)
      }
    })

    ipcMain.on('remove-repository', (event, data) => {
      const { id } = data
      this.repositories.delete(id)
      
      // Remove from persistent store
      try {
        repositoryStore.removeRepository(id)
      } catch (error) {
        console.error('Failed to remove repository from store:', error)
      }
      
      this.sendToDaemon('remove-repository', { id })
      this.sendToRenderer('repository-removed', { id })
      
      // Stop MCP server for this repository
      this.stopMCPServer(id)
    })

    ipcMain.on('get-repositories', (event) => {
      const repos = Array.from(this.repositories.values())
      event.reply('repository-status', repos)
    })

    ipcMain.on('refresh-repository', (event, data) => {
      const { id } = data
      this.sendToDaemon('analyze-repository', { id })
    })

    ipcMain.on('get-api-key', async (event) => {
      const apiKey = await this.getApiKey()
      event.reply('api-key', apiKey)
    })

    ipcMain.on('set-api-key', async (event, data) => {
      await this.setApiKey(data.apiKey)
      this.sendToDaemon('configure', { apiKey: data.apiKey })
    })

    ipcMain.on('get-provider-settings', async (event) => {
      const settings = await this.getProviderSettings()
      event.reply('provider-settings', settings)
    })

    ipcMain.on('set-provider-settings', async (event, data) => {
      await this.setProviderSettings(data)
      this.sendToDaemon('configure-provider', data)
      
      // Update prompt expansion service with new provider
      const { promptExpansionService } = require('./services/promptExpansion')
      await promptExpansionService.updateProviderSettings(data)
    })

    ipcMain.on('get-server-port', (event) => {
      event.reply('server-port', this.serverPort)
    })

    ipcMain.on('get-mcp-server-status', (event) => {
      const status: Record<string, boolean> = {}
      for (const [repoId, repo] of this.repositories) {
        status[repoId] = this.mcpServers.has(repoId)
      }
      event.reply('mcp-server-status', status)
    })

    ipcMain.on('get-directory-tree', (event, data) => {
      console.log('IPC: get-directory-tree request received for:', data)
      const { id } = data
      this.sendToDaemon('get-directory-tree', { id })
    })

    ipcMain.on('scan-repository', (event, data) => {
      const { id } = data
      this.sendToDaemon('analyze-repository', { id })
    })

    ipcMain.on('process-directory', async (event, data) => {
      console.log('IPC: process-directory request received for:', data)
      const { repositoryId, directoryPath } = data
      
      // Get repository info from our map
      const repository = this.repositories.get(repositoryId)
      if (!repository) {
        console.error('IPC: Repository not found:', repositoryId)
        return
      }
      
      // Send to daemon to process specific directory
      this.sendToDaemon('analyze-directory', { 
        repositoryId, 
        directoryPath,
        repository 
      })
    })

    ipcMain.on('read-file', async (event, data) => {
      console.log('IPC: read-file request received for:', data)
      const { path } = data
      try {
        const content = fs.readFileSync(path, 'utf-8')
        console.log('IPC: Successfully read file, content length:', content.length)
        event.reply('file-content', { path, content, error: null })
      } catch (error) {
        console.error('IPC: Error reading file:', error)
        event.reply('file-content', { 
          path, 
          content: null, 
          error: error instanceof Error ? error.message : 'Failed to read file' 
        })
      }
    })

    ipcMain.on('save-file', async (event, data) => {
      console.log('IPC: save-file request received for:', data.path)
      const { path, content } = data
      try {
        fs.writeFileSync(path, content, 'utf-8')
        console.log('IPC: Successfully saved file')
        event.reply('file-saved', { path, success: true })
      } catch (error) {
        console.error('IPC: Error saving file:', error)
        event.reply('file-saved', { 
          path, 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to save file' 
        })
      }
    })

    ipcMain.on('setup-mcp-server', (event, data) => {
      console.log('IPC: setup-mcp-server request received for:', data)
      const { id } = data
      const repository = this.repositories.get(id)
      
      if (!repository) {
        console.error('IPC: Repository not found:', id)
        return
      }
      
      // Send to daemon to setup MCP server
      this.sendToDaemon('setup-mcp', { 
        repositoryId: id, 
        repository,
        serverPort: this.serverPort
      })
    })

    ipcMain.on('regenerate-embeddings', async (event, data) => {
      console.log('IPC: regenerate-embeddings request received for:', data)
      const { id } = data
      const repository = this.repositories.get(id)
      
      if (!repository) {
        console.error('IPC: Repository not found:', id)
        return
      }
      
      // Send to daemon to regenerate embeddings
      this.sendToDaemon('regenerate-embeddings', { 
        repositoryId: id, 
        repository
      })
    })
    
    ipcMain.on('get-token-usage', async (event) => {
      try {
        const { vectorDB } = await import('./vectordb/database')
        const stats = await vectorDB.getTokenUsageStats()
        event.reply('token-usage-update', stats)
      } catch (error) {
        console.error('[IPC] Error getting token usage:', error)
      }
    })

    ipcMain.on('get-vector-stats', async (event, data) => {
      const { id } = data
      try {
        console.log('IPC: get-vector-stats request received for:', id)
        const stats = await this.getVectorStats(id)
        console.log('IPC: get-vector-stats request responding', stats);
        event.reply('vector-stats', { repositoryId: id, stats })
      } catch (error) {
        console.error('IPC: Error getting vector stats:', error)
        event.reply('vector-stats', { 
          repositoryId: id, 
          stats: null,
          error: error instanceof Error ? error.message : 'Failed to get stats' 
        })
      }
    })

    ipcMain.on('debug-search', async (event, data) => {
      const { repositoryId, query, limit = 10 } = data
      try {
        console.log('IPC: debug-search request received for:', data);
        const results = await this.debugSearch(repositoryId, query, limit)
        event.reply('debug-search-results', { repositoryId, results })
      } catch (error) {
        console.error('IPC: Error in debug search:', error)
        event.reply('debug-search-results', { 
          repositoryId, 
          error: error instanceof Error ? error.message : 'Search failed' 
        })
      }
    })

    ipcMain.on('reset-vector-database', async (event, data) => {
      const { repositoryId } = data
      try {
        console.log('IPC: reset-vector-database request received for:', repositoryId)
        
        // Delete all vector data for this repository
        await documentIndexer.removeRepository(repositoryId)
        
        // Send success message
        event.reply('vector-database-reset', { 
          repositoryId, 
          success: true 
        })
        
        // Refresh vector stats
        const stats = await this.getVectorStats(repositoryId)
        event.reply('vector-stats', { repositoryId, stats })
      } catch (error) {
        console.error('IPC: Error resetting vector database:', error)
        event.reply('vector-database-reset', { 
          repositoryId, 
          success: false,
          error: error instanceof Error ? error.message : 'Failed to reset database' 
        })
      }
    })

    ipcMain.on('get-prompt-config', async (event, data) => {
      try {
        // Send current prompt configuration to the daemon
        if (this.daemon) {
          this.daemon.send({ type: 'get-prompt-config', data: {} })
        }
      } catch (error) {
        console.error('IPC: Error getting prompt config:', error)
        event.reply('prompt-config', { error: error instanceof Error ? error.message : 'Failed to get prompt config' })
      }
    })

    ipcMain.on('save-prompt-config', async (event, data) => {
      try {
        // Send new prompt configuration to the daemon
        if (this.daemon) {
          this.daemon.send({ type: 'save-prompt-config', data: { prompt: data.prompt } })
        }
        event.reply('prompt-config-saved', { success: true })
      } catch (error) {
        console.error('IPC: Error saving prompt config:', error)
        event.reply('prompt-config-saved', { 
          success: false, 
          error: error instanceof Error ? error.message : 'Failed to save prompt config' 
        })
      }
    })

    ipcMain.on('update-repository-opened', (event, data) => {
      const { id } = data
      try {
        repositoryStore.updateLastOpened(id)
      } catch (error) {
        console.error('IPC: Error updating repository last opened:', error)
      }
    })
  }

  private startDaemon() {
    const daemonPath = path.join(__dirname, 'daemon.js')
    
    this.daemon = spawn('node', [daemonPath], {
      stdio: ['inherit', 'pipe', 'pipe', 'ipc']
    })

    this.daemon.on('message', (message: any) => {
      this.handleDaemonMessage(message)
    })

    // Capture daemon stdout
    if (this.daemon.stdout) {
      this.daemon.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean)
        lines.forEach((line: string) => {
          console.log('Daemon:', line)
          if (line.includes('[DAEMON]')) {
            this.sendToRenderer('daemon-status', {
              connected: true,
              message: line.replace('[DAEMON]', '').trim(),
              type: line.includes('ERROR') ? 'error' : line.includes('WARNING') ? 'warning' : 'info'
            })
          }
        })
      })
    }

    // Capture daemon stderr
    if (this.daemon.stderr) {
      this.daemon.stderr.on('data', (data) => {
        console.error('Daemon Error:', data.toString())
        this.sendToRenderer('daemon-status', {
          connected: true,
          message: data.toString(),
          type: 'error'
        })
      })
    }

    this.daemon.on('error', (error) => {
      console.error('Daemon error:', error)
      this.sendToRenderer('daemon-status', {
        connected: false,
        message: `Daemon error: ${error.message}`,
        type: 'error'
      })
    })

    this.daemon.on('exit', (code) => {
      console.log(`Daemon exited with code ${code}`)
      this.sendToRenderer('daemon-status', {
        connected: false,
        message: `Daemon exited with code ${code}`,
        type: 'error'
      })
      // Restart daemon if it crashes
      setTimeout(() => this.startDaemon(), 5000)
    })

    // Send initial daemon status
    this.sendToRenderer('daemon-status', {
      connected: true,
      message: 'Daemon started',
      type: 'info'
    })

    // Configure daemon with API key if available
    this.getApiKey().then(apiKey => {
      if (apiKey) {
        this.sendToDaemon('configure', { apiKey })
      }
    })
  }

  private handleDaemonMessage(message: any) {
    switch (message.type) {
      case 'repository-status':
        const repo = this.repositories.get(message.data.id)
        if (repo) {
          repo.status = message.data.status
          if (message.data.error) repo.error = message.data.error
          this.sendToRenderer('repository-status', Array.from(this.repositories.values()))
        }
        break
      
      case 'analysis-progress':
        this.sendToRenderer('analysis-update', message.data)
        break
      
      case 'documentation-updated':
        this.sendToRenderer('documentation-ready', message.data)
        const affectedRepo = this.repositories.get(message.data.repositoryId)
        if (affectedRepo) {
          affectedRepo.lastUpdated = new Date()
          affectedRepo.documentCount = (affectedRepo.documentCount || 0) + 1
        }
        break
      
      case 'directory-tree':
        this.sendToRenderer('directory-tree', message.data)
        // Also fetch vector stats when loading directory
        this.getVectorStats(message.data.repositoryId)
          .then(stats => {
            const repo = this.repositories.get(message.data.repositoryId)
            if (repo) {
              repo.vectorStats = stats
              this.sendToRenderer('repository-status', Array.from(this.repositories.values()))
            }
          })
          .catch(error => {
            console.error('[IPC] Error fetching vector stats on directory load:', error)
          })
        break
      
      
      case 'index-file':
        // Index file in vector database
        this.indexFile(message.data)
        break
      
      case 'remove-indexed-file':
        // Remove file from index
        documentIndexer.removeFile(message.data.repositoryId, message.data.filePath)
        break
      
      case 'remove-indexed-repository':
        // Remove repository from index
        documentIndexer.removeRepository(message.data.repositoryId)
        break
      
      case 'mcp-status':
        this.sendToRenderer('mcp-status', message.data)
        // If MCP setup was successful, try to start the MCP server
        if (message.data.success && message.data.repositoryId) {
          const repo = this.repositories.get(message.data.repositoryId)
          if (repo) {
            // Give it a moment for files to be written
            setTimeout(() => {
              this.startMCPServer(repo.id, repo.path, repo.name)
            }, 1000)
          }
        }
        break
      
      case 'embeddings-status':
        this.sendToRenderer('embeddings-status', message.data)
        break
        
      case 'track-token-usage':
        this.handleTokenUsage(message.data)
        break
      
      case 'prompt-config':
        this.sendToRenderer('prompt-config', message.data)
        break
      
      case 'prompt-config-saved':
        this.sendToRenderer('prompt-config-saved', message.data)
        break
    }
  }

  private async indexFile(data: { repositoryId: string; filePath: string; content: string }) {
    try {
      await documentIndexer.indexFile(data.repositoryId, data.filePath, data.content)
    } catch (error) {
      console.error('[IPC] Error indexing file:', error)
    }
  }

  private sendToDaemon(type: string, data: any) {
    if (this.daemon && !this.daemon.killed) {
      this.daemon.send({ type, data })
    }
  }

  private sendToRenderer(channel: string, data: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    }
  }

  private async getApiKey(): Promise<string | null> {
    try {
      const configPath = path.join(process.env.HOME || '', '.mdgent', 'config.json')
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return config.apiKey || null
    } catch (e) {
      return null
    }
  }

  private async getProviderSettings(): Promise<any> {
    try {
      const configPath = path.join(process.env.HOME || '', '.mdgent', 'config.json')
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return {
        provider: config.provider || 'anthropic',
        apiKeys: {
          anthropic: config.apiKey || config.apiKeys?.anthropic,
          openai: config.apiKeys?.openai,
          grok: config.apiKeys?.grok
        }
      }
    } catch (e) {
      return {
        provider: 'anthropic',
        apiKeys: {}
      }
    }
  }

  private async setApiKey(apiKey: string) {
    const configDir = path.join(process.env.HOME || '', '.mdgent')
    const configPath = path.join(configDir, 'config.json')
    
    try {
      fs.mkdirSync(configDir, { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify({ apiKey }, null, 2))
    } catch (e) {
      console.error('Failed to save API key:', e)
    }
  }

  private async setProviderSettings(settings: any) {
    const configDir = path.join(process.env.HOME || '', '.mdgent')
    const configPath = path.join(configDir, 'config.json')
    
    try {
      fs.mkdirSync(configDir, { recursive: true })
      let existingConfig = {}
      try {
        existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      } catch (e) {
        // Config doesn't exist yet
      }
      
      // Merge settings with existing config
      const newConfig = {
        ...existingConfig,
        provider: settings.provider,
        apiKeys: {
          ...(existingConfig.apiKeys || {}),
          ...settings.apiKeys
        }
      }
      
      // Keep legacy apiKey field for backward compatibility
      if (settings.apiKeys.anthropic) {
        newConfig.apiKey = settings.apiKeys.anthropic
      }
      
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2))
    } catch (e) {
      console.error('Failed to save provider settings:', e)
    }
  }

  private async loadStoredRepositories() {
    console.log('[IPC] loadStoredRepositories called')
    try {
      // Wait a bit for the daemon to be ready and server port to be set
      setTimeout(() => {
        console.log(`[IPC] Checking server port: ${this.serverPort}`)
        // Don't start MCP servers if server port is not set yet
        if (this.serverPort === 0) {
          console.log('[IPC] Server port not set yet, delaying MCP server startup')
          setTimeout(() => this.loadStoredRepositories(), 2000)
          return
        }
        const storedRepos = repositoryStore.getAllRepositories()
        
        for (const stored of storedRepos) {
          // Verify the repository still exists on disk
          if (fs.existsSync(stored.path)) {
            const repository: Repository = {
              id: stored.id,
              path: stored.path,
              name: stored.name,
              status: 'idle',
              lastUpdated: new Date(stored.last_opened)
            }
            
            this.repositories.set(repository.id, repository)
            
            // Send to daemon
            this.sendToDaemon('add-repository', repository)
            
            // Start MCP server for this repository
            console.log(`[IPC] Starting MCP server for repository: ${repository.name}`)
            this.startMCPServer(repository.id, repository.path, repository.name)
          } else {
            // Remove from store if path no longer exists
            console.log(`Repository path no longer exists, removing: ${stored.path}`)
            repositoryStore.removeRepository(stored.id)
          }
        }
        
        // Send updated repository list to renderer once window is ready
        if (this.mainWindow) {
          this.sendToRenderer('repository-status', Array.from(this.repositories.values()))
        }
      }, 1000)
    } catch (error) {
      console.error('Failed to load stored repositories:', error)
    }
  }

  private async getVectorStats(repositoryId: string) {
    const { vectorDB } = await import('./vectordb/database')
    return await vectorDB.getStatistics(repositoryId)
  }

  private async debugSearch(repositoryId: string, query: string, limit: number) {
    const { hybridSearch } = await import('./vectordb/search')
    const { embeddingGenerator } = await import('./embeddings/embeddings')
    
    const startTime = Date.now()
    
    // Generate embedding for the query
    const embeddingStartTime = Date.now()
    const queryEmbedding = await embeddingGenerator.generateEmbedding(query)
    const embeddingTime = Date.now() - embeddingStartTime
    
    // Perform search
    const searchStartTime = Date.now()
    const searchResults = await hybridSearch.hybridSearch(
      query,
      queryEmbedding,
      repositoryId,
      { topK: limit }
    )
    const searchTime = Date.now() - searchStartTime
    
    // Format results for debugging
    const results = searchResults.map(result => ({
      documentId: result.documentId,
      filePath: result.filePath,
      chunkIndex: result.chunkId,
      content: result.content,
      score: result.score,
      method: 'hybrid' as const,
      metadata: result.metadata
    }))
    
    return {
      query,
      queryEmbedding: Array.from(queryEmbedding).slice(0, 10), // First 10 values for preview
      results,
      timing: {
        embeddingTime,
        searchTime,
        totalTime: Date.now() - startTime
      }
    }
  }

  private async handleTokenUsage(data: { source: 'mcp_server' | 'anthropic_api'; input: number; output: number }) {
    try {
      const { source, input, output } = data

      const { vectorDB } = await import('./vectordb/database')
      
      // Track input tokens
      if (input > 0) {
        await vectorDB.trackTokenUsage(source, 'input', input)
      }
      
      // Track output tokens
      if (output > 0) {
        await vectorDB.trackTokenUsage(source, 'output', output)
      }
      
      // Get updated stats and send to renderer
      const stats = await vectorDB.getTokenUsageStats()
      this.sendToRenderer('token-usage-update', stats)
    } catch (error) {
      console.error('[IPC] Error tracking token usage:', error)
    }
  }

  private startMCPServer(repositoryId: string, repositoryPath: string, repositoryName: string): void {
    // Check if MCP server is already running for this repository
    if (this.mcpServers.has(repositoryId)) {
      console.log(`[IPC] MCP server already running for repository ${repositoryId}`)
      return
    }

    const mcpServerPath = path.join(repositoryPath, '.mdgent', 'mcp', 'mdgent-mcp-server.js')
    
    // Check if MCP server file exists
    if (!fs.existsSync(mcpServerPath)) {
      console.warn(`[IPC] MCP server file not found for repository ${repositoryId}: ${mcpServerPath}`)
      // Try again in a few seconds as the daemon might still be creating it
      setTimeout(() => {
        if (fs.existsSync(mcpServerPath) && this.repositories.has(repositoryId)) {
          const repo = this.repositories.get(repositoryId)
          if (repo) {
            this.startMCPServer(repositoryId, repo.path, repo.name)
          }
        }
      }, 5000)
      return
    }

    console.log(`[IPC] Starting MCP server for repository ${repositoryId}`)

    // Spawn the MCP server process
    const mcpProcess = spawn('node', [mcpServerPath], {
      env: {
        ...process.env,
        MDGENT_SERVER_PORT: this.serverPort.toString(),
        MDGENT_REPOSITORY_ID: repositoryId,
        MDGENT_REPOSITORY_PATH: repositoryPath,
        MDGENT_REPOSITORY_NAME: repositoryName
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    mcpProcess.on('error', (error) => {
      console.error(`[IPC] MCP server error for ${repositoryId}:`, error)
      this.mcpServers.delete(repositoryId)
      this.sendMCPServerStatus()
    })

    mcpProcess.on('exit', (code, signal) => {
      console.log(`[IPC] MCP server exited for ${repositoryId}: code=${code}, signal=${signal}`)
      this.mcpServers.delete(repositoryId)
      this.sendMCPServerStatus()
      
      // Auto-restart if it crashed unexpectedly
      if (code !== 0 && signal !== 'SIGTERM' && this.repositories.has(repositoryId)) {
        console.log(`[IPC] Restarting MCP server for ${repositoryId} in 5 seconds...`)
        setTimeout(() => {
          const repo = this.repositories.get(repositoryId)
          if (repo) {
            this.startMCPServer(repositoryId, repo.path, repo.name)
          }
        }, 5000)
      }
    })

    // Log stdout for debugging
    mcpProcess.stdout?.on('data', (data) => {
      console.log(`[MCP-${repositoryId}]:`, data.toString().trim())
    })

    // Log stderr for debugging
    mcpProcess.stderr?.on('data', (data) => {
      console.error(`[MCP-${repositoryId}] Error:`, data.toString().trim())
    })

    this.mcpServers.set(repositoryId, mcpProcess)
    
    // Notify renderer of MCP server status change
    this.sendMCPServerStatus()
  }

  private stopMCPServer(repositoryId: string): void {
    const mcpProcess = this.mcpServers.get(repositoryId)
    if (mcpProcess) {
      console.log(`[IPC] Stopping MCP server for repository ${repositoryId}`)
      mcpProcess.kill('SIGTERM')
      this.mcpServers.delete(repositoryId)
      
      // Notify renderer of MCP server status change
      this.sendMCPServerStatus()
    }
  }

  private stopAllMCPServers(): void {
    console.log('[IPC] Stopping all MCP servers...')
    for (const [repositoryId, mcpProcess] of this.mcpServers) {
      mcpProcess.kill('SIGTERM')
    }
    this.mcpServers.clear()
  }

  private sendMCPServerStatus(): void {
    const status: Record<string, boolean> = {}
    for (const [repoId, repo] of this.repositories) {
      status[repoId] = this.mcpServers.has(repoId)
    }
    this.sendToRenderer('mcp-server-status', status)
  }

  // Clean up all child processes on exit
  cleanup(): void {
    this.stopAllMCPServers()
    if (this.daemon) {
      this.daemon.kill()
      this.daemon = null
    }
  }
}