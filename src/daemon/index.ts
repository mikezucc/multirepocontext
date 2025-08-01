import { watch, FSWatcher } from 'chokidar'
import { Anthropic } from '@anthropic-ai/sdk'
import * as path from 'path'
import { promises as fs } from 'fs'
import { Repository, Documentation, AnalysisProgress } from '../shared/types'
import * as gitignoreParser from 'gitignore-parser'
import { countTokens } from '../shared/tokenUtils'

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
  private customPrompt: string | null = null

  constructor() {
    this.setupIpc()
    this.loadPromptConfig()
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
      case 'configure-provider':
        this.configureProvider(message.data)
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
      
      case 'analyze-directory':
        await this.analyzeDirectory(message.data)
        break
      case 'get-directory-tree':
        await this.getDirectoryTree(message.data.id)
        break
      case 'setup-mcp':
        await this.setupMCPServer(message.data)
        break
      case 'regenerate-embeddings':
        await this.regenerateEmbeddings(message.data)
        break
      case 'get-prompt-config':
        await this.getPromptConfig()
        break
      case 'save-prompt-config':
        await this.savePromptConfig(message.data)
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

  private configureProvider(settings: any) {
    console.log('[DAEMON] Configuring AI provider:', settings.provider)
    // For now, the daemon only uses Anthropic for analysis
    // The prompt expansion uses the configured provider
    if (settings.provider === 'anthropic' && settings.apiKeys?.anthropic) {
      console.log('[DAEMON] Anthropic API key received, initializing client')
      this.anthropic = new Anthropic({
        apiKey: settings.apiKeys.anthropic
      })
    } else if (settings.apiKeys?.anthropic) {
      // Still use Anthropic for analysis even if another provider is selected for prompt expansion
      console.log('[DAEMON] Using Anthropic for code analysis')
      this.anthropic = new Anthropic({
        apiKey: settings.apiKeys.anthropic
      })
    } else {
      console.log('[DAEMON] WARNING: No Anthropic API key provided for code analysis')
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
    const ignorePatterns = await this.loadIgnorePatterns(repoPath)
    
    // Watch only the current directory level
    const watcher = watch(repoPath, {
      ignored: (filePath: string) => {
        const relativePath = path.relative(repoPath, filePath)
        if (!relativePath) return false
        
        // Check gitignore
        if (gitignore && gitignore.denies(relativePath)) {
          return true
        }
        
        // Check MDgent ignore patterns
        if (ignorePatterns.some(pattern => this.matchesPattern(relativePath, pattern))) {
          return true
        }
        
        // Additional hard-coded ignores
        const hardIgnores = ['node_modules', '.git', 'dist', 'build', 'out', '.mdgent', '.DS_Store']
        const parts = relativePath.split(path.sep)
        const fileName = path.basename(filePath)
        return parts.some(part => hardIgnores.includes(part)) || fileName === '.DS_Store'
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
    
    // Send message to remove from index
    this.sendMessage('remove-indexed-repository', {
      repositoryId: repoId
    })
    
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

  private async analyzeDirectory(data: { repositoryId: string; directoryPath: string; repository: Repository }) {
    const { repositoryId, directoryPath, repository } = data
    
    if (!this.anthropic) {
      console.log('[DAEMON] Cannot analyze - Anthropic client not initialized (missing API key?)')
      this.sendMessage('analysis-progress', {
        repositoryId,
        currentFile: directoryPath,
        progress: 100,
        totalFiles: 0,
        processedFiles: 0,
        tokensUsed: 0,
        estimatedCost: 0,
        error: 'API key not configured'
      })
      return
    }

    console.log('[DAEMON] Starting directory analysis:', directoryPath)
    
    try {
      // Scan only the specified directory recursively
      const files = await this.scanDirectory(directoryPath)
      const totalFiles = files.length
      console.log('[DAEMON] Found', totalFiles, 'files to analyze in directory:', directoryPath)

      if (totalFiles === 0) {
        this.sendMessage('analysis-progress', {
          repositoryId,
          currentFile: directoryPath,
          progress: 100,
          totalFiles: 0,
          processedFiles: 0,
          tokensUsed: 0,
          estimatedCost: 0
        })
        return
      }
      
      // Process files in batches
      for (let i = 0; i < files.length; i += this.batchSize) {
        const batch = files.slice(i, i + this.batchSize)
        
        await Promise.all(
          batch.map(async (file, batchIndex) => {
            const fileIndex = i + batchIndex
            const progress: AnalysisProgress = {
              repositoryId,
              currentFile: file,
              progress: ((fileIndex + 1) / totalFiles) * 100,
              totalFiles,
              processedFiles: fileIndex + 1,
              tokensUsed: 0,
              estimatedCost: 0
            }
            
            this.sendMessage('analysis-progress', progress)
            
            console.log('[DAEMON] Analyzing file', fileIndex + 1, 'of', totalFiles, ':', file)
            await this.analyzeFile(repositoryId, file)
          })
        )
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // Regenerate embeddings for the processed files
      console.log('[DAEMON] Directory analysis complete, regenerating embeddings...')
      await this.regenerateEmbeddingsForDirectory(repositoryId, directoryPath)
      
    } catch (error) {
      console.error('[DAEMON] Error analyzing directory:', error)
      this.sendMessage('analysis-progress', {
        repositoryId,
        currentFile: directoryPath,
        progress: 100,
        totalFiles: 0,
        processedFiles: 0,
        tokensUsed: 0,
        estimatedCost: 0,
        error: error.message
      })
    }
  }

  private async scanRepository(repoPath: string): Promise<string[]> {
    const files: string[] = []
    // Only scan for .mdgent.md files for embeddings
    const gitignore = this.gitignores.get(repoPath)
    const maxFiles = 1000 // Limit total files to prevent memory issues
    
    // Load user-configurable ignore patterns
    const ignorePatterns = await this.loadIgnorePatterns(repoPath)
    
    const scan = async (dir: string, depth = 0): Promise<void> => {
      if (files.length >= maxFiles) return
      if (depth > this.watchDepth * 2) return // Scan deeper than watch for initial analysis
      
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })

        console.log(`[DAEMON] Scanning directory: ${dir} (depth: ${depth}) - ${entries.length} entries found`)
        
        for (const entry of entries) {
          if (files.length >= maxFiles) break
          
          const fullPath = path.join(dir, entry.name)
          const relativePath = path.relative(repoPath, fullPath)
          
          // Check gitignore
          if (gitignore && gitignore.denies(relativePath)) {
            continue
          }
          
          if (entry.isDirectory()) {
            const hardIgnores = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '.mdgent']
            if (!hardIgnores.includes(entry.name) && !entry.name.startsWith('.')) {
              await scan(fullPath, depth + 1)
            }
          } else if (entry.isFile()) {
            // Only include .mdgent.md files for embeddings
            if (!ignorePatterns.some(pattern => this.matchesPattern(relativePath, pattern))) {
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

  private async scanDirectory(dirPath: string): Promise<string[]> {
    const files: string[] = []
    const maxFiles = 1000 // Limit total files to prevent memory issues
    
    const scan = async (dir: string): Promise<void> => {
      if (files.length >= maxFiles) return
      
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        
        for (const entry of entries) {
          if (files.length >= maxFiles) break
          
          const fullPath = path.join(dir, entry.name)
          
          // Skip hidden files/folders except .gitignore
          if (entry.name.startsWith('.') && entry.name !== '.gitignore') {
            continue
          }
          
          if (entry.isDirectory()) {
            const hardIgnores = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '.mdgent']
            if (!hardIgnores.includes(entry.name)) {
              await scan(fullPath)
            }
          } else if (entry.isFile()) {
            // Include all code files for documentation generation
            const ext = path.extname(entry.name).toLowerCase()
            const codeExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.r', '.m', '.mm']
            if (codeExtensions.includes(ext) && !entry.name.endsWith('.mdgent.md')) {
              files.push(fullPath)
            }
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${dir}:`, error)
      }
    }
    
    await scan(dirPath)
    console.log('[DAEMON] Directory scan complete. Found', files.length, 'files')
    return files
  }

  private async regenerateEmbeddingsForDirectory(repositoryId: string, directoryPath: string) {
    try {
      // Find all .mdgent.md files in the directory
      const mdgentFiles: string[] = []
      
      const findMdgentFiles = async (dir: string): Promise<void> => {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true })
          
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            
            if (entry.isDirectory()) {
              // Skip common directories
              const skipDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.next']
              if (!skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                await findMdgentFiles(fullPath)
              }
            } else if (entry.isFile() && entry.name.endsWith('.mdgent.md')) {
              mdgentFiles.push(fullPath)
            }
          }
        } catch (error) {
          console.error('[DAEMON] Error scanning for mdgent files:', dir, error)
        }
      }
      
      await findMdgentFiles(directoryPath)
      
      console.log(`[DAEMON] Found ${mdgentFiles.length} .mdgent.md files to index in directory`)
      
      // Send files for indexing
      for (const file of mdgentFiles) {
        try {
          const content = await fs.readFile(file, 'utf-8')
          this.sendMessage('index-file', {
            repositoryId,
            filePath: file,
            content
          })
        } catch (error) {
          console.error('[DAEMON] Error reading file for indexing:', file, error)
        }
      }
      
      // Send completion message
      this.sendMessage('embeddings-status', {
        repositoryId,
        success: true,
        filesProcessed: mdgentFiles.length,
        message: `Successfully indexed ${mdgentFiles.length} files from ${path.basename(directoryPath)}`
      })
      
    } catch (error) {
      console.error('[DAEMON] Error regenerating embeddings for directory:', error)
      this.sendMessage('embeddings-status', {
        repositoryId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to regenerate embeddings'
      })
    }
  }

  private async analyzeFile(repoId: string, filePath: string) {
    try {
      const repo = this.repositories.get(repoId)
      if (!repo) return
      
      const relativePath = path.relative(repo.path, filePath)
      
      // Skip MDgent-specific files
      const ignorePatterns = await this.loadIgnorePatterns(repo.path)
      if (ignorePatterns.some(pattern => this.matchesPattern(relativePath, pattern))) {
        console.log('[DAEMON] Skipping ignored file:', relativePath)
        return
      }
      
      const content = await fs.readFile(filePath, 'utf-8')
      
      // Only send .mdgent.md files for indexing (embeddings)
      if (filePath.endsWith('.mdgent.md')) {
        this.sendMessage('index-file', {
          repositoryId: repoId,
          filePath: filePath,
          content: content
        })
      }
      
      // Generate documentation if Anthropic client is available
      if (this.anthropic && !filePath.endsWith('.mdgent.md')) {
        // Use custom prompt if available, otherwise use default
        const defaultPrompt = `You are a technical Product Manager who is compiling the tribal knowledge of the codebase. Analyze this code file and generate comprehensive documentation that serves to both describe the product and design considerations, as well as the detaield technical specifications.

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

        // Replace placeholders in custom prompt
        let prompt = this.customPrompt || defaultPrompt
        prompt = prompt.replace(/{relativePath}/g, relativePath)
        prompt = prompt.replace(/{content}/g, content)

        // Count input tokens
        const inputTokens = countTokens(prompt)
        
        const response = await this.anthropic.messages.create({
          model: 'claude-3-7-sonnet-latest',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })

        const documentation = response.content[0].type === 'text' 
          ? response.content[0].text 
          : ''
        
        // Count output tokens
        const outputTokens = countTokens(documentation)
        
        // Send token usage to main process
        this.sendMessage('track-token-usage', {
          source: 'anthropic_api',
          input: inputTokens,
          output: outputTokens
        })

        await this.saveDocumentation(repoId, filePath, documentation)
        console.log('[DAEMON] Successfully analyzed:', relativePath, `(${inputTokens} in, ${outputTokens} out tokens)`)

        // index the file into the vector database as well
        this.sendMessage('index-file', {
          repositoryId: repoId,
          filePath: filePath,
          content: documentation
        })
      } else {
        console.log('[DAEMON] File sent for indexing:', filePath)
      }
      
    } catch (error) {
      console.error(`[DAEMON] Error analyzing file ${filePath}:`, error)
    }
  }

  private async saveDocumentation(repoId: string, filePath: string, content: string) {
    const repo = this.repositories.get(repoId)
    if (!repo) return

    const dir = path.dirname(filePath)
    
    // Skip creating documentation at repository root level
    if (dir === repo.path) {
      console.log('[DAEMON] Skipping documentation at repository root')
      return
    }
    
    const docPath = path.join(dir, 'info.mdgent.md')
    
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
    // Only process .mdgent.md files for embeddings
    if (filePath.endsWith('.mdgent.md')) {
      this.queueAnalysis(repoId, filePath)
    }
  }

  private onFileChanged(repoId: string, filePath: string) {
    console.log('[DAEMON] File changed:', filePath)
    // Only process .mdgent.md files for embeddings
    if (filePath.endsWith('.mdgent.md')) {
      this.queueAnalysis(repoId, filePath)
    }
  }

  private async onFileRemoved(repoId: string, filePath: string) {
    console.log('[DAEMON] File removed:', filePath)
    
    // Only remove from index if it's a .mdgent.md file
    if (filePath.endsWith('.mdgent.md')) {
      this.sendMessage('remove-indexed-file', {
        repositoryId: repoId,
        filePath: filePath
      })
    }
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
      modifiedTime?: number // Unix timestamp in milliseconds
      lastModified?: number // For directories, the latest modified time of its contents
    }

    const buildTree = async (dirPath: string, depth = 0): Promise<TreeNode[]> => {
      if (depth > 10) return [] // Limit depth to prevent infinite recursion
      
      const nodes: TreeNode[] = []
      const gitignore = this.gitignores.get(repo.path)
      
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name)
          // console.log('[DAEMON] Processing entry:', fullPath)
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
          
          // Get file stats for modification time
          const stats = await fs.stat(fullPath)
          
          const node: TreeNode = {
            name: entry.name,
            path: fullPath,  // Use absolute path instead of relative
            type: entry.isDirectory() ? 'directory' : 'file',
            isMdgent: entry.name.endsWith('.mdgent.md'),
            modifiedTime: stats.mtime.getTime()
          }
          
          if (entry.isDirectory()) {
            node.children = await buildTree(fullPath, depth + 1)
            // Calculate the latest modified time from all children
            if (node.children.length > 0) {
              const childTimes = node.children.map(child => 
                child.type === 'directory' ? (child.lastModified || child.modifiedTime || 0) : (child.modifiedTime || 0)
              )
              node.lastModified = Math.max(stats.mtime.getTime(), ...childTimes)
            } else {
              node.lastModified = stats.mtime.getTime()
            }
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


  private async setupMCPServer(data: { repositoryId: string, repository: Repository, serverPort?: number }) {
    const { repositoryId, repository, serverPort } = data
    console.log('[DAEMON] Setting up MCP server for repository:', repository.path)
    
    try {
      // Create .mdgent directory if it doesn't exist
      const mdgentDir = path.join(repository.path, '.mdgent')
      const mcpDir = path.join(mdgentDir, 'mcp')
      
      await fs.mkdir(mdgentDir, { recursive: true })
      await fs.mkdir(mcpDir, { recursive: true })
      
      // Also create .claude directory for Claude Code configuration
      const claudeDir = path.join(repository.path, '.claude')
      await fs.mkdir(claudeDir, { recursive: true })
      
      // Determine if we're in development mode
      const isDev = process.env.NODE_ENV === 'development'
      
      // Copy MCP server script
      const mcpServerTemplatePath = isDev 
        ? path.join(__dirname, '../../resources/mcp-server.js')
        : path.join(process.resourcesPath, 'resources/mcp-server.js')
      const mcpServerContent = await fs.readFile(mcpServerTemplatePath, 'utf-8')
      
      const mcpServerPath = path.join(mcpDir, 'mdgent-mcp-server.js')
      await fs.writeFile(mcpServerPath, mcpServerContent, { mode: 0o755 })
      
      // Check for existing .mcp.json and merge if it exists
      const rootMcpPath = path.join(repository.path, '.mcp.json')
      let rootMcpConfig: any = {
        mcpServers: {}
      }

      // initialize rootMCPConfig from rootMCPPath if it exists
      try {
        const existingMcpContent = await fs.readFile(rootMcpPath, 'utf-8')
        rootMcpConfig = JSON.parse(existingMcpContent)
        if (!rootMcpConfig.mcpServers) {
          rootMcpConfig.mcpServers = {}
        }
        console.log('[DAEMON] Existing .mcp.json found, merging configuration')
      } catch (error) {
        console.log('[DAEMON] No existing .mcp.json found, creating new one')
      }

      // Add MDgent server to the configuration
      rootMcpConfig.mcpServers["mdgent-rag"] = {
        command: "node",
        args: [mcpServerPath],
        env: {
          MDGENT_SERVER_PORT: (serverPort || 3989).toString(),
          MDGENT_REPOSITORY_ID: repositoryId,
          MDGENT_REPOSITORY_PATH: repository.path,
          MDGENT_REPOSITORY_NAME: repository.name
        },
        description: "For every prompt, this MCP server provides highly relevant context for every single prompt from the codebase using advanced semantic search powered by embeddings. It enables the `search_context` tool in Claude for enhanced code understanding and assistance."
      }
      
      // Write the merged configuration
      await fs.writeFile(rootMcpPath, JSON.stringify(rootMcpConfig, null, 2))
      
      // Generate Cursor deeplink
      const cursorConfig = {
        command: "node",
        args: [mcpServerPath],
        env: {
          MDGENT_SERVER_PORT: (serverPort || 3989).toString(),
          MDGENT_REPOSITORY_ID: repositoryId,
          MDGENT_REPOSITORY_PATH: repository.path,
          MDGENT_REPOSITORY_NAME: repository.name
        }
      }
      const encodedConfig = Buffer.from(JSON.stringify(cursorConfig)).toString('base64')
      const cursorDeeplink = `cursor://anysphere.cursor-deeplink/mcp/install?name=mdgent-rag&config=${encodedConfig}`
      
      // Create .mdgentignore file if it doesn't exist
      const mdgentIgnorePath = path.join(repository.path, '.mdgentignore')
      try {
        await fs.access(mdgentIgnorePath)
        console.log('[DAEMON] .mdgentignore already exists')
      } catch (error) {
        // File doesn't exist, create it
        const ignoreContent = `# MDgent ignore patterns
# Lines starting with # are comments
# Patterns support * and ** wildcards

# MDgent generated files
*.mdgent.md
.mdgent/**
.mcp.json
CLAUDE.md
.claude/**

# Minified and compiled files
*.min.js
*.min.css
*.map

# Lock files
*.lock
package-lock.json
yarn.lock
pnpm-lock.yaml

# Large binary files
*.jpg
*.jpeg
*.png
*.gif
*.ico
*.pdf
*.zip
*.tar.gz

# Test snapshots
__snapshots__/**

# Custom patterns (add your own below)
`
        await fs.writeFile(mdgentIgnorePath, ignoreContent)
        console.log('[DAEMON] Created .mdgentignore file')
      }
      
      // Create README for MCP setup
//       const readmeContent = `# MDgent MCP Server Setup

// This directory contains the MCP (Model Context Protocol) server configuration for MDgent.

// ## Automatic Setup

// ### Claude Code (Recommended)

// Claude Code will automatically detect and use the MCP server configuration when you run it in this repository:

// 1. A \`.mcp.json\` file has been created at the repository root
// 2. Simply run \`claude\` in this directory or any subdirectory
// 3. Claude Code will automatically load the MDgent RAG server
// 4. You'll be prompted to approve the server on first use

// ### Cursor IDE

// To install in Cursor:

// 1. Click the "Install to Cursor" button in MDgent after setting up the MCP server
// 2. Or use this deeplink: \`${cursorDeeplink}\`
// 3. Cursor will prompt you to approve the MCP server installation
// 4. Once approved, you can use the \`search_context\` tool in Cursor

// ### Claude Desktop (Manual Setup)

// If you prefer to use Claude Desktop, you can manually add the configuration:

// 1. Open Claude Desktop settings
// 2. Go to the "Developer" section
// 3. Click "Edit Config" 
// 4. Add the following configuration to your settings:

// \`\`\`json
// ${configContent}
// \`\`\`

// 5. Restart Claude Desktop

// ## Claude Code Integration

// MDgent has automatically configured this repository for optimal Claude Code usage:

// 1. **CLAUDE.md** - Created at the repository root with project-specific configuration
// 2. **.claude/settings.json** - Contains Claude Code settings and context rules
// 3. **.mcp.json** - Enables automatic MCP server loading in Claude Code
// 4. **MCP Server** - Provides enhanced search capabilities through the \`search_context\` tool

// ## Usage

// ### In Claude Desktop
// Once configured, you can use the \`search_context\` tool to search for relevant context in your codebase.

// ### In Claude Code
// When you open this repository in Claude Code, it will automatically:
// - Load the CLAUDE.md configuration
// - Apply context inclusion/exclusion rules from .claude/settings.json
// - Enable the MDgent search capabilities

// ### Search Examples
// - "search_context: authentication flow"
// - "search_context: database schema"
// - "search_context: API endpoints"
// - "search_context: error handling"
// - "search_context: configuration"

// ## Files

// ### MCP Server Files
// - \`mdgent-mcp-server.js\` - The MCP server implementation
// - \`mcp-config.json\` - The configuration for manual Claude Desktop setup

// ### Claude Code Files
// - \`../../.mcp.json\` - Auto-detected MCP configuration for Claude Code
// - \`../../CLAUDE.md\` - Claude Code configuration for this repository
// - \`../../.claude/settings.json\` - Additional Claude Code settings

// ## Benefits

// With MDgent's Claude integration, you get:
// 1. **Semantic Search**: Find code by meaning, not just text matching
// 2. **AI-Generated Documentation**: Access .mdgent.md files for comprehensive code analysis
// 3. **Context-Aware Assistance**: Claude understands your project structure and dependencies
// 4. **Efficient Navigation**: Quickly locate relevant code sections
// `
      
      // await fs.writeFile(path.join(mcpDir, 'README.md'), readmeContent)
      
      // Update .gitignore to include .mdgent/
      await this.updateGitignore(repository.path)
      
      // Update CLAUDE.md for Claude Code environment (append if exists)
      await this.updateClaudeMd(repository)
      
      // Create .claude/settings.json for additional Claude Code configuration
      // const claudeSettings = {
      //   "tools": {
      //     "search_context": {
      //       "enabled": true,
      //       "description": "Before every response no matter what, use this tool to search the MDgent vector database for relevant code context.",
      //       "mcp_tool": "mdgent-rag"
      //     }
      //   },
      //   "context": {
      //     "include_patterns": [
      //       "**/*.ts",
      //       "**/*.tsx",
      //       "**/*.js",
      //       "**/*.jsx",
      //       "**/*.py",
      //       "**/*.java",
      //       "**/*.go",
      //       "**/*.rs",
      //       "**/*.cpp",
      //       "**/*.c",
      //       "**/*.md",
      //       "**/*.mdx"
      //     ],
      //     "exclude_patterns": [
      //       "**/node_modules/**",
      //       "**/dist/**",
      //       "**/build/**",
      //       "**/.git/**",
      //       "**/coverage/**",
      //       "**/*.min.js",
      //       "**/*.mdgent.md"
      //     ]
      //   },
      //   "mdgent": {
      //     "server_port": serverPort || 3000,
      //     "repository_id": repositoryId,
      //     "mcp_enabled": true
      //   }
      // }
      
      // const claudeSettingsPath = path.join(claudeDir, 'settings.json')
      // await fs.writeFile(claudeSettingsPath, JSON.stringify(claudeSettings, null, 2))
      
      console.log('[DAEMON] MCP server setup at:', mcpServerPath)
      // console.log('[DAEMON] MCP config created at:', mcpConfigPath)
      console.log('[DAEMON] Root .mcp.json updated at:', rootMcpPath)
      console.log('[DAEMON] CLAUDE.md updated at:', path.join(repository.path, 'CLAUDE.md'))
      // console.log('[DAEMON] Claude settings created at:', claudeSettingsPath)
      
      // Send success status back
      this.sendMessage('mcp-status', {
        repositoryId,
        success: true,
        serverPath: mcpServerPath,
        // configPath: mcpConfigPath,
        rootMcpPath,
        claudeMdPath: path.join(repository.path, 'CLAUDE.md'),
        // claudeSettingsPath,
        cursorDeeplink,
        message: 'MCP server and Claude Code environment configured successfully. Claude Code will auto-detect the .mcp.json configuration.'
      })
      
    } catch (error) {
      console.error('[DAEMON] Error setting up MCP server:', error)
      this.sendMessage('mcp-status', {
        repositoryId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to setup MCP server'
      })
    }
  }

  private async updateGitignore(repoPath: string): Promise<void> {
    try {
      const gitignorePath = path.join(repoPath, '.gitignore')
      let gitignoreContent = ''
      
      // Check if .gitignore exists
      try {
        gitignoreContent = await fs.readFile(gitignorePath, 'utf-8')
      } catch (error) {
        console.log('[DAEMON] No .gitignore found, will create one')
      }
      
      // Check if .mdgent/ is already in gitignore
      const lines = gitignoreContent.split('\n')
      const mdgentPatterns = ['.mdgent/', '.mdgent', '/.mdgent/']
      const hasRule = lines.some(line => 
        mdgentPatterns.some(pattern => line.trim() === pattern || line.trim() === `/${pattern}`)
      )
      
      if (!hasRule) {
        // Add .mdgent/ to gitignore
        const newContent = gitignoreContent.trim() === '' 
          ? '.mdgent/'
          : gitignoreContent.trim() + '\n\n# MDgent files\n.mdgent/'
        
        await fs.writeFile(gitignorePath, newContent + '\n')
        console.log('[DAEMON] Added .mdgent/ to .gitignore')
      } else {
        console.log('[DAEMON] .mdgent/ already in .gitignore')
      }
    } catch (error) {
      console.error('[DAEMON] Error updating .gitignore:', error)
    }
  }

  private async updateClaudeMd(repository: Repository): Promise<void> {
    try {
      const claudeMdPath = path.join(repository.path, 'CLAUDE.md')
      let existingContent = ''
      
      // Check if CLAUDE.md exists
      try {
        existingContent = await fs.readFile(claudeMdPath, 'utf-8')
      } catch (error) {
        console.log('[DAEMON] No existing CLAUDE.md found')
      }
      
      // Check if MDgent is already mentioned
      const mdgentKeywords = ['mdgent', 'MDgent', 'Model Context Protocol', 'search_context']
      const hasMdgentMention = mdgentKeywords.some(keyword => 
        existingContent.toLowerCase().includes(keyword.toLowerCase())
      )
      
      if (hasMdgentMention) {
        console.log('[DAEMON] CLAUDE.md already contains MDgent information')
        return
      }
      
      // Append MDgent information
      const mdgentSection = `

## MDgent Integration

This repository is enhanced with MDgent's semantic search capabilities:

- **Vector Search**: Use \`search_context: <query>\` to find relevant code
- **AI Documentation**: Check \`.mdgent.md\` files for comprehensive code analysis
- **MCP Server**: Auto-loaded via \`.mcp.json\` in Claude Code

### Search Examples:
- \`search_context: authentication\`
- \`search_context: database schema\`
- \`search_context: error handling\`
`

      const newContent = existingContent.trim() === ''
        ? await this.generateClaudeMdContent(repository)
        : existingContent.trim() + mdgentSection
      
      await fs.writeFile(claudeMdPath, newContent + '\n')
      console.log('[DAEMON] Updated CLAUDE.md with MDgent information')
    } catch (error) {
      console.error('[DAEMON] Error updating CLAUDE.md:', error)
    }
  }

  private async generateClaudeMdContent(repository: Repository): Promise<string> {
    const repoName = path.basename(repository.path)
    const gitignore = this.gitignores.get(repository.path)
    
    // Analyze repository structure
    const projectInfo = await this.analyzeProjectStructure(repository.path)
    
    return `# ${repoName}

## Project Overview

${projectInfo.structure}

## Key Technologies

${projectInfo.technologies.map(tech => `- ${tech}`).join('\n')}

## Development Commands

${projectInfo.scripts}

## MDgent Integration

This repository is enhanced with MDgent's semantic search capabilities:

- **Vector Search**: Use \`search_context: <query>\` to find relevant code
- **AI Documentation**: Check \`.mdgent.md\` files for comprehensive code analysis
- **MCP Server**: Auto-loaded via \`.mcp.json\` in Claude Code

### Search Examples:
- \`search_context: authentication\`
- \`search_context: database schema\`
- \`search_context: error handling\`
`
  }

  private async analyzeProjectStructure(repoPath: string): Promise<{
    structure: string,
    technologies: string[],
    scripts: string,
    sourceExtensions: string[]
  }> {
    const technologies: Set<string> = new Set()
    const sourceExtensions: Set<string> = new Set()
    let scripts = ''
    let structure = ''
    
    try {
      // Check for package.json
      try {
        const packageJsonPath = path.join(repoPath, 'package.json')
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'))
        
        // Detect technologies from dependencies
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
        if (deps.react) technologies.add('React')
        if (deps.vue) technologies.add('Vue')
        if (deps.angular) technologies.add('Angular')
        if (deps.typescript) technologies.add('TypeScript')
        if (deps.express) technologies.add('Express')
        if (deps.next) technologies.add('Next.js')
        if (deps.electron) technologies.add('Electron')
        if (deps['@anthropic-ai/sdk']) technologies.add('Anthropic SDK')
        
        // Extract scripts
        if (packageJson.scripts) {
          const commonScripts = ['dev', 'start', 'build', 'test', 'lint']
          const availableScripts = commonScripts.filter(s => packageJson.scripts[s])
          if (availableScripts.length > 0) {
            scripts = '```bash\n' + availableScripts.map(s => `npm run ${s}`).join('\n') + '\n```'
          }
        }
        
        sourceExtensions.add('.js', '.jsx', '.ts', '.tsx')
      } catch (e) {
        // No package.json
      }
      
      // Check for other project files
      const files = await fs.readdir(repoPath)
      
      if (files.includes('requirements.txt') || files.includes('setup.py')) {
        technologies.add('Python')
        sourceExtensions.add('.py')
      }
      if (files.includes('go.mod')) {
        technologies.add('Go')
        sourceExtensions.add('.go')
      }
      if (files.includes('Cargo.toml')) {
        technologies.add('Rust')
        sourceExtensions.add('.rs')
      }
      if (files.includes('pom.xml') || files.includes('build.gradle')) {
        technologies.add('Java')
        sourceExtensions.add('.java')
      }
      
      // Generate simple structure
      const importantDirs = ['src', 'lib', 'components', 'pages', 'api', 'tests', 'docs']
      const existingDirs = []
      
      for (const dir of importantDirs) {
        try {
          const stats = await fs.stat(path.join(repoPath, dir))
          if (stats.isDirectory()) existingDirs.push(dir)
        } catch (e) {
          // Directory doesn't exist
        }
      }
      
      if (existingDirs.length > 0) {
        structure = '```\n' + existingDirs.map(d => `├── ${d}/`).join('\n') + '\n```'
      } else {
        structure = 'Standard project structure'
      }
      
    } catch (error) {
      console.error('[DAEMON] Error analyzing project structure:', error)
    }
    
    return {
      structure: structure || 'Project structure analysis unavailable',
      technologies: Array.from(technologies).length > 0 ? Array.from(technologies) : ['JavaScript/TypeScript'],
      scripts: scripts || 'No npm scripts found',
      sourceExtensions: Array.from(sourceExtensions).length > 0 ? Array.from(sourceExtensions) : ['.js', '.ts']
    }
  }

  private async loadIgnorePatterns(repoPath: string): Promise<string[]> {
    const defaultPatterns = [
      '*.mdgent.md',
      '.mdgent/**',
      '.mcp.json',
      'CLAUDE.md',
      '.claude/**',
      '*.min.js',
      '*.min.css',
      '*.map',
      '*.lock',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml'
    ]
    
    try {
      // Check for .mdgentignore file
      const ignorePath = path.join(repoPath, '.mdgentignore')
      const ignoreContent = await fs.readFile(ignorePath, 'utf-8')
      const customPatterns = ignoreContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
      
      return [...defaultPatterns, ...customPatterns]
    } catch (error) {
      // No .mdgentignore file, use defaults
      return defaultPatterns
    }
  }
  
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Simple glob-like pattern matching
    if (pattern.includes('**')) {
      // Convert ** to regex
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
      return new RegExp(`^${regexPattern}$`).test(filePath)
    } else if (pattern.includes('*')) {
      // Simple wildcard
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      return new RegExp(`^${regexPattern}$`).test(path.basename(filePath))
    } else {
      // Exact match or suffix match
      return filePath === pattern || filePath.endsWith(pattern)
    }
  }

  private async regenerateEmbeddings(data: { repositoryId: string, repository: Repository }) {
    const { repositoryId, repository } = data
    console.log('[DAEMON] Regenerating embeddings for repository:', repository.path)
    
    try {
      // Update status
      this.updateRepoStatus(repositoryId, 'analyzing')
      
      // Find all .mdgent.md files
      const mdgentFiles: string[] = []
      
      const findMdgentFiles = async (dir: string): Promise<void> => {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true })
          
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            
            if (entry.isDirectory()) {
              // Skip common directories
              const skipDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.next']
              if (!skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                await findMdgentFiles(fullPath)
              }
            } else if (entry.isFile() && entry.name.endsWith('.mdgent.md')) {
              mdgentFiles.push(fullPath)
            }
          }
        } catch (error) {
          console.error('[DAEMON] Error scanning directory:', dir, error)
        }
      }
      
      await findMdgentFiles(repository.path)
      
      console.log(`[DAEMON] Found ${mdgentFiles.length} .mdgent.md files to index`)
      
      // Send files for indexing
      for (let i = 0; i < mdgentFiles.length; i++) {
        const file = mdgentFiles[i]
        
        // Send progress
        const progress: AnalysisProgress = {
          repositoryId,
          currentFile: file,
          totalFiles: mdgentFiles.length,
          processedFiles: i,
          progress: (i / mdgentFiles.length) * 100,
          tokensUsed: 0,
          estimatedCost: 0
        }
        this.sendMessage('analysis-progress', progress)
        
        // Read and send file for indexing
        try {
          const content = await fs.readFile(file, 'utf-8')
          this.sendMessage('index-file', {
            repositoryId,
            filePath: file,
            content
          })
        } catch (error) {
          console.error('[DAEMON] Error reading file:', file, error)
        }
      }
      
      // Wait a moment for indexing to complete
      // This is a simple approach - in production you'd want proper async tracking
      setTimeout(() => {
        // Update status
        this.updateRepoStatus(repositoryId, 'ready')
        
        console.log('[DAEMON] Embedding regeneration complete')
        
        // Request vector stats to include in completion message
        this.sendMessage('get-vector-stats', { repositoryId })
        
        this.sendMessage('embeddings-status', {
          repositoryId,
          success: true,
          filesProcessed: mdgentFiles.length,
          message: `Successfully regenerated embeddings for ${mdgentFiles.length} .mdgent.md files`
        })
      }, 2000) // Wait 2 seconds for indexing to complete
      
    } catch (error) {
      console.error('[DAEMON] Error regenerating embeddings:', error)
      this.updateRepoStatus(repositoryId, 'error', error.message)
      
      this.sendMessage('embeddings-status', {
        repositoryId,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to regenerate embeddings'
      })
    }
  }

  private async loadPromptConfig() {
    try {
      const configPath = path.join(process.env.HOME || '', '.mdgent', 'prompt-config.json')
      const configData = await fs.readFile(configPath, 'utf-8')
      const config = JSON.parse(configData)
      this.customPrompt = config.prompt || null
      console.log('[DAEMON] Loaded custom prompt configuration')
    } catch (error) {
      console.log('[DAEMON] No custom prompt configuration found, using default')
    }
  }

  private async getPromptConfig() {
    const defaultPrompt = `You are a technical Product Manager who is compiling the tribal knowledge of the codebase. Analyze this code file and generate comprehensive documentation that serves to both describe the product and design considerations, as well as the detaield technical specifications.

File: {relativePath}

\`\`\`
{content}
\`\`\`

Please provide:
1. A clear description of the file's purpose and role in the codebase
2. List of all public interfaces, classes, and functions with their signatures
3. Dependencies and imports that other parts of the codebase might need
4. Usage examples if applicable
5. Any important implementation details or design decisions

Format the response as markdown suitable for a README file.`

    this.sendMessage('prompt-config', {
      prompt: this.customPrompt || defaultPrompt
    })
  }

  private async savePromptConfig(data: { prompt: string }) {
    try {
      const configDir = path.join(process.env.HOME || '', '.mdgent')
      const configPath = path.join(configDir, 'prompt-config.json')
      
      // Ensure config directory exists
      await fs.mkdir(configDir, { recursive: true })
      
      // Save the prompt configuration
      await fs.writeFile(configPath, JSON.stringify({ prompt: data.prompt }, null, 2))
      
      // Update the current prompt
      this.customPrompt = data.prompt
      
      console.log('[DAEMON] Saved custom prompt configuration')
      this.sendMessage('prompt-config-saved', { success: true })
    } catch (error) {
      console.error('[DAEMON] Error saving prompt configuration:', error)
      this.sendMessage('prompt-config-saved', { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to save prompt configuration'
      })
    }
  }
}

// Start the daemon
const daemon = new MDgentDaemon()
console.log('[DAEMON] MDgent daemon started')
console.log('[DAEMON] Process ID:', process.pid)
console.log('[DAEMON] Waiting for IPC messages...')