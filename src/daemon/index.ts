import { watch } from 'chokidar'
import { Anthropic } from '@anthropic-ai/sdk'
import * as path from 'path'
import { promises as fs } from 'fs'
import { Repository, Documentation, AnalysisProgress } from '../shared/types'

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
  private watchers: Map<string, any> = new Map()
  private repositories: Map<string, Repository> = new Map()
  private analysisQueue: string[] = []
  private isAnalyzing = false

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
    
    // Set up file watcher
    const watcher = watch(repo.path, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/*.mdgent.md'
      ],
      persistent: true,
      ignoreInitial: true
    })

    watcher.on('add', (filePath) => this.onFileAdded(repo.id, filePath))
    watcher.on('change', (filePath) => this.onFileChanged(repo.id, filePath))
    watcher.on('unlink', (filePath) => this.onFileRemoved(repo.id, filePath))

    this.watchers.set(repo.id, watcher)
    
    // Start initial analysis
    await this.analyzeRepository(repo.id)
  }

  private removeRepository(repoId: string) {
    const watcher = this.watchers.get(repoId)
    if (watcher) {
      watcher.close()
      this.watchers.delete(repoId)
    }
    this.repositories.delete(repoId)
  }

  private async analyzeRepository(repoId: string) {
    const repo = this.repositories.get(repoId)
    if (!repo || !this.anthropic) return

    this.updateRepoStatus(repoId, 'scanning')
    
    try {
      const files = await this.scanRepository(repo.path)
      const totalFiles = files.length

      this.updateRepoStatus(repoId, 'analyzing')
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const progress: AnalysisProgress = {
          repositoryId: repoId,
          currentFile: file,
          progress: (i / totalFiles) * 100,
          totalFiles,
          processedFiles: i,
          tokensUsed: 0,
          estimatedCost: 0
        }
        
        this.sendMessage('analysis-progress', progress)
        
        await this.analyzeFile(repoId, file)
      }

      this.updateRepoStatus(repoId, 'ready')
    } catch (error) {
      this.updateRepoStatus(repoId, 'error', error.message)
    }
  }

  private async scanRepository(repoPath: string): Promise<string[]> {
    const files: string[] = []
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c']
    
    async function scan(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            await scan(fullPath)
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name)
          if (extensions.includes(ext)) {
            files.push(fullPath)
          }
        }
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