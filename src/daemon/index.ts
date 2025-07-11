import { watch, FSWatcher } from 'chokidar'
import { Anthropic } from '@anthropic-ai/sdk'
import * as path from 'path'
import { promises as fs } from 'fs'
import { Repository, Documentation, AnalysisProgress } from '../shared/types'
import * as gitignoreParser from 'gitignore-parser'

interface DaemonConfig {
  apiKey: string
  repositories: Repository[]
}

interface IpcMessage {
  type: string
  data: any
}

class MDgentDaemon {
  private anthropic: Anthropic | null = null
  private watchers: Map<string, FSWatcher> = new Map()
  private repositories: Map<string, Repository> = new Map()
  private analysisQueue: string[] = []
  private isAnalyzing = false
  private maxWatchers = 100 // Limit concurrent watchers
  private batchSize = 10 // Process files in batches
  private watchDepth = 3 // Maximum directory depth to watch
  private gitignores: Map<string, any> = new Map()

  constructor() {
    this.setupIpc()
  }

  private setupIpc() {
    console.log('[DAEMON] Setting up IPC communication')
    process.on('message', (message: IpcMessage) => {
      console.log('[DAEMON] Received IPC message:', message.type, message.data)
      this.handleMessage(message)
    })
    
    process.on('disconnect', () => {
      console.log('[DAEMON] IPC disconnected, shutting down')
      process.exit(0)
    })
  }

  private sendMessage(type: string, data: any) {
    if (process.send) {
      process.send({ type, data })
    }
  }

  private async handleMessage(message: IpcMessage) {
    switch (message.type) {
      case 'configure':
        this.configure(message.data)
        break
      case 'add-repository':
        await this.addRepository(message.data)
        break
      case 'remove-repository':
        this.removeRepository(message.data.id)
        break
      case 'analyze-repository':
        await this.analyzeRepository(message.data.id)
        break
      case 'get-directory-tree':
        await this.getDirectoryTree(message.data.id)
        break
    }
  }

  private configure(config: DaemonConfig) {
    console.log('[DAEMON] Configuring daemon')
    if (config.apiKey) {
      console.log('[DAEMON] API key received, initializing Anthropic client')
      this.anthropic = new Anthropic({
        apiKey: config.apiKey
      })
    } else {
      console.log('[DAEMON] WARNING: No API key provided')
    }
  }

  private async addRepository(repo: Repository) {
    console.log('[DAEMON] Adding repository:', repo.path)
    this.repositories.set(repo.id, repo)
    
    // Load gitignore
    console.log('[DAEMON] Loading gitignore for:', repo.path)
    await this.loadGitignore(repo.path)
    
    // Set up progressive file watching
    console.log('[DAEMON] Setting up file watchers for:', repo.path)
    await this.setupProgressiveWatcher(repo.id, repo.path)
    
    // Don't start analysis automatically - wait for explicit request
    console.log('[DAEMON] Repository added, waiting for scan request')
    this.updateRepoStatus(repo.id, 'idle')
  }

  private async loadGitignore(repoPath: string) {
    try {
      const gitignorePath = path.join(repoPath, '.gitignore')
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8')
      const compiled = gitignoreParser.compile(gitignoreContent)
      this.gitignores.set(repoPath, compiled)
      console.log('[DAEMON] Loaded .gitignore from:', gitignorePath)
    } catch (error) {
      console.log('[DAEMON] No .gitignore found, using default ignores')
      const defaultIgnores = `
node_modules
.git
dist
build
out
*.log
.DS_Store
.env
.env.local
*.mdgent.md
`
      const compiled = gitignoreParser.compile(defaultIgnores)
      this.gitignores.set(repoPath, compiled)
    }
  }

  private async setupProgressiveWatcher(repoId: string, repoPath: string, currentDepth = 0) {
    if (currentDepth > this.watchDepth) {
      console.log('[DAEMON] Max watch depth reached for:', repoPath)
      return
    }
    if (this.watchers.size >= this.maxWatchers) {
      console.log('[DAEMON] Max watchers limit reached:', this.watchers.size)
      return
    }

    const gitignore = this.gitignores.get(repoPath)
    
    // Watch only the current directory level
    const watcher = watch(repoPath, {
      ignored: (filePath: string) => {
        const relativePath = path.relative(repoPath, filePath)
        if (!relativePath) return false
        
        // Check gitignore
        if (gitignore && gitignore.denies(relativePath)) {
          return true
        }
        
        // Additional hard-coded ignores
        const hardIgnores = ['node_modules', '.git', 'dist', 'build', 'out']
        const parts = relativePath.split(path.sep)
        return parts.some(part => hardIgnores.includes(part))
      },
      persistent: true,
      ignoreInitial: true,
      depth: 0, // Only watch immediate children
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    })

    watcher.on('add', (filePath) => this.onFileAdded(repoId, filePath))
    watcher.on('change', (filePath) => this.onFileChanged(repoId, filePath))
    watcher.on('unlink', (filePath) => this.onFileRemoved(repoId, filePath))
    watcher.on('addDir', async (dirPath) => {
      // Progressively add watchers for subdirectories
      if (dirPath !== repoPath) {
        await this.setupProgressiveWatcher(repoId, dirPath, currentDepth + 1)
      }
    })

    this.watchers.set(`${repoId}-${repoPath}`, watcher)
    console.log('[DAEMON] Watcher created for:', repoPath, 'Total watchers:', this.watchers.size)
  }

  private removeRepository(repoId: string) {
    // Close all watchers for this repository
    for (const [key, watcher] of this.watchers.entries()) {
      if (key.startsWith(`${repoId}-`)) {
        watcher.close()
        this.watchers.delete(key)
      }
    }
    this.repositories.delete(repoId)
    
    // Clean up gitignore cache
    const repo = this.repositories.get(repoId)
    if (repo) {
      this.gitignores.delete(repo.path)
    }
  }

  private async analyzeRepository(repoId: string) {
    const repo = this.repositories.get(repoId)
    if (!repo) {
      console.log('[DAEMON] Repository not found:', repoId)
      return
    }
    if (!this.anthropic) {
      console.log('[DAEMON] Cannot analyze - Anthropic client not initialized (missing API key?)')
      this.updateRepoStatus(repoId, 'error', 'API key not configured')
      return
    }

    console.log('[DAEMON] Starting repository analysis:', repo.path)
    this.updateRepoStatus(repoId, 'scanning')
    
    try {
      const files = await this.scanRepository(repo.path)
      const totalFiles = files.length
      console.log('[DAEMON] Found', totalFiles, 'files to analyze in:', repo.path)

      this.updateRepoStatus(repoId, 'analyzing')
      
      // Process files in batches to avoid overwhelming the system
      for (let i = 0; i < files.length; i += this.batchSize) {
        const batch = files.slice(i, i + this.batchSize)
        
        // Process batch concurrently but with a limit
        await Promise.all(
          batch.map(async (file, batchIndex) => {
            const fileIndex = i + batchIndex
            const progress: AnalysisProgress = {
              repositoryId: repoId,
              currentFile: file,
              progress: (fileIndex / totalFiles) * 100,
              totalFiles,
              processedFiles: fileIndex,
              tokensUsed: 0,
              estimatedCost: 0
            }
            
            this.sendMessage('analysis-progress', progress)
            
            console.log('[DAEMON] Analyzing file', fileIndex + 1, 'of', totalFiles, ':', file)
            await this.analyzeFile(repoId, file)
          })
        )
        
        // Small delay between batches to prevent resource exhaustion
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      this.updateRepoStatus(repoId, 'ready')
      console.log('[DAEMON] Repository analysis complete:', repo.path)
    } catch (error) {
      console.error('[DAEMON] Error analyzing repository:', error)
      this.updateRepoStatus(repoId, 'error', error.message)
    }
  }

  private async scanRepository(repoPath: string): Promise<string[]> {
    const files: string[] = []
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c']
    const gitignore = this.gitignores.get(repoPath)
    const maxFiles = 1000 // Limit total files to prevent memory issues
    
    const scan = async (dir: string, depth = 0): Promise<void> => {
      if (files.length >= maxFiles) return
      if (depth > this.watchDepth * 2) return // Scan deeper than watch for initial analysis
      
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        
        for (const entry of entries) {
          if (files.length >= maxFiles) break
          
          const fullPath = path.join(dir, entry.name)
          const relativePath = path.relative(repoPath, fullPath)
          
          // Check gitignore
          if (gitignore && gitignore.denies(relativePath)) {
            continue
          }
          
          if (entry.isDirectory()) {
            const hardIgnores = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage']
            if (!hardIgnores.includes(entry.name) && !entry.name.startsWith('.')) {
              await scan(fullPath, depth + 1)
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name)
            if (extensions.includes(ext) && !entry.name.endsWith('.mdgent.md')) {
              files.push(fullPath)
            }
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error)
      }
    }
    
    await scan(repoPath)
    console.log('[DAEMON] Scan complete. Found', files.length, 'files matching criteria')
    return files
  }

  private async analyzeFile(repoId: string, filePath: string) {
    if (!this.anthropic) {
      console.log('[DAEMON] Skipping file analysis - no Anthropic client')
      return
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const relativePath = path.relative(this.repositories.get(repoId)!.path, filePath)
      
      const prompt = `Analyze this code file and generate comprehensive documentation for it.

File: ${relativePath}

\`\`\`
${content}
\`\`\`

Please provide:
1. A clear description of the file's purpose and role in the codebase
2. List of all public interfaces, classes, and functions with their signatures
3. Dependencies and imports that other parts of the codebase might need
4. Usage examples if applicable
5. Any important implementation details or design decisions

Format the response as markdown suitable for a README file.`

      const response = await this.anthropic.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })

      const documentation = response.content[0].type === 'text' 
        ? response.content[0].text 
        : ''

      await this.saveDocumentation(repoId, filePath, documentation)
      console.log('[DAEMON] Successfully analyzed:', relativePath)
      
    } catch (error) {
      console.error(`[DAEMON] Error analyzing file ${filePath}:`, error)
    }
  }

  private async saveDocumentation(repoId: string, filePath: string, content: string) {
    const repo = this.repositories.get(repoId)
    if (!repo) return

    const dir = path.dirname(filePath)
    const docPath = path.join(dir, 'README.mdgent.md')
    
    // Read existing documentation if it exists
    let existingContent = ''
    try {
      existingContent = await fs.readFile(docPath, 'utf-8')
    } catch (e) {
      // File doesn't exist yet
    }

    // Append or update the documentation
    const fileName = path.basename(filePath)
    const separator = '\n\n---\n\n'
    const fileSection = `## ${fileName}\n\n${content}`
    
    let newContent = existingContent
    if (existingContent.includes(`## ${fileName}`)) {
      // Update existing section
      const regex = new RegExp(`## ${fileName}[\\s\\S]*?(?=\\n## |$)`)
      newContent = existingContent.replace(regex, fileSection)
    } else {
      // Add new section
      newContent = existingContent 
        ? existingContent + separator + fileSection
        : fileSection
    }

    await fs.writeFile(docPath, newContent)
    console.log('[DAEMON] Documentation saved to:', docPath)
    
    this.sendMessage('documentation-updated', {
      repositoryId: repoId,
      filePath: docPath,
      content: newContent
    })
  }

  private updateRepoStatus(repoId: string, status: Repository['status'], error?: string) {
    const repo = this.repositories.get(repoId)
    if (repo) {
      repo.status = status
      if (error) repo.error = error
      this.sendMessage('repository-status', { id: repoId, status, error })
    }
  }

  private onFileAdded(repoId: string, filePath: string) {
    console.log('[DAEMON] File added:', filePath)
    this.queueAnalysis(repoId, filePath)
  }

  private onFileChanged(repoId: string, filePath: string) {
    console.log('[DAEMON] File changed:', filePath)
    this.queueAnalysis(repoId, filePath)
  }

  private onFileRemoved(repoId: string, filePath: string) {
    // Handle file removal if needed
  }

  private queueAnalysis(repoId: string, filePath: string) {
    const key = `${repoId}:${filePath}`
    if (!this.analysisQueue.includes(key)) {
      this.analysisQueue.push(key)
      console.log('[DAEMON] Added to analysis queue:', filePath, 'Queue length:', this.analysisQueue.length)
      this.processQueue()
    }
  }

  private async processQueue() {
    if (this.isAnalyzing || this.analysisQueue.length === 0) return

    this.isAnalyzing = true
    const item = this.analysisQueue.shift()!
    const [repoId, filePath] = item.split(':')
    
    await this.analyzeFile(repoId, filePath)
    
    this.isAnalyzing = false
    this.processQueue()
  }

  private async getDirectoryTree(repoId: string) {
    const repo = this.repositories.get(repoId)
    if (!repo) {
      console.log('[DAEMON] Repository not found for tree:', repoId)
      console.log('[DAEMON] Available repositories:', Array.from(this.repositories.keys()))
      return
    }

    console.log('[DAEMON] Building directory tree for:', repo.path)
    
    interface TreeNode {
      name: string
      path: string
      type: 'file' | 'directory'
      children?: TreeNode[]
      isMdgent?: boolean
    }

    const buildTree = async (dirPath: string, depth = 0): Promise<TreeNode[]> => {
      if (depth > 10) return [] // Limit depth to prevent infinite recursion
      
      const nodes: TreeNode[] = []
      const gitignore = this.gitignores.get(repo.path)
      
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name)
          console.log('[DAEMON] Processing entry:', fullPath)
          const relativePath = path.relative(repo.path, fullPath)
          
          // Skip gitignored files
          if (gitignore && gitignore.denies(relativePath)) {
            continue
          }
          
          // Skip hidden files/folders except .gitignore
          if (entry.name.startsWith('.') && entry.name !== '.gitignore') {
            continue
          }
          
          // Skip common build/dependency folders
          const skipDirs = ['node_modules', 'dist', 'build', 'out', '.git', 'coverage', '.next']
          if (entry.isDirectory() && skipDirs.includes(entry.name)) {
            continue
          }
          
          const node: TreeNode = {
            name: entry.name,
            path: fullPath,  // Use absolute path instead of relative
            type: entry.isDirectory() ? 'directory' : 'file',
            isMdgent: entry.name.endsWith('.mdgent.md')
          }
          
          if (entry.isDirectory()) {
            node.children = await buildTree(fullPath, depth + 1)
          }
          
          nodes.push(node)
        }
        
        // Sort: directories first, then files, mdgent files highlighted
        nodes.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
          if (a.isMdgent !== b.isMdgent) return a.isMdgent ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        
      } catch (error) {
        console.error('[DAEMON] Error reading directory:', dirPath, error)
      }
      
      return nodes
    }
    
    const tree = await buildTree(repo.path)
    
    this.sendMessage('directory-tree', {
      repositoryId: repoId,
      tree
    })
    
    console.log('[DAEMON] Directory tree sent for:', repo.path)
  }
}

// Start the daemon
const daemon = new MDgentDaemon()
console.log('[DAEMON] MDgent daemon started')
console.log('[DAEMON] Process ID:', process.pid)
console.log('[DAEMON] Waiting for IPC messages...')