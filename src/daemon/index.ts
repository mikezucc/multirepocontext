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
    process.on('message', (message: IpcMessage) => {
      this.handleMessage(message)
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
    }
  }

  private configure(config: DaemonConfig) {
    if (config.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: config.apiKey
      })
    }
  }

  private async addRepository(repo: Repository) {
    this.repositories.set(repo.id, repo)
    
    // Load gitignore
    await this.loadGitignore(repo.path)
    
    // Set up progressive file watching
    await this.setupProgressiveWatcher(repo.id, repo.path)
    
    // Start initial analysis with batching
    await this.analyzeRepository(repo.id)
  }

  private async loadGitignore(repoPath: string) {
    try {
      const gitignorePath = path.join(repoPath, '.gitignore')
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8')
      const compiled = gitignoreParser.compile(gitignoreContent)
      this.gitignores.set(repoPath, compiled)
    } catch (error) {
      // No gitignore file, use default ignores
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
    if (currentDepth > this.watchDepth) return
    if (this.watchers.size >= this.maxWatchers) return

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
    if (!repo || !this.anthropic) return

    this.updateRepoStatus(repoId, 'scanning')
    
    try {
      const files = await this.scanRepository(repo.path)
      const totalFiles = files.length

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
            
            await this.analyzeFile(repoId, file)
          })
        )
        
        // Small delay between batches to prevent resource exhaustion
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      this.updateRepoStatus(repoId, 'ready')
    } catch (error) {
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
    return files
  }

  private async analyzeFile(repoId: string, filePath: string) {
    if (!this.anthropic) return

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
      
    } catch (error) {
      console.error(`Error analyzing file ${filePath}:`, error)
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
    this.queueAnalysis(repoId, filePath)
  }

  private onFileChanged(repoId: string, filePath: string) {
    this.queueAnalysis(repoId, filePath)
  }

  private onFileRemoved(repoId: string, filePath: string) {
    // Handle file removal if needed
  }

  private queueAnalysis(repoId: string, filePath: string) {
    const key = `${repoId}:${filePath}`
    if (!this.analysisQueue.includes(key)) {
      this.analysisQueue.push(key)
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
}

// Start the daemon
const daemon = new MDgentDaemon()
console.log('MDgent daemon started')