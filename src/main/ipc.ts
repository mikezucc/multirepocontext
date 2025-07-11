import { ipcMain, dialog } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { Repository } from '../shared/types'

export class IpcHandler {
  private daemon: ChildProcess | null = null
  private repositories: Map<string, Repository> = new Map()
  private mainWindow: Electron.BrowserWindow | null = null

  constructor() {
    this.setupHandlers()
    this.startDaemon()
  }

  setMainWindow(window: Electron.BrowserWindow) {
    this.mainWindow = window
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
        
        const repository: Repository = {
          id: uuidv4(),
          path: repoPath,
          name: repoName,
          status: 'idle',
          lastUpdated: new Date()
        }

        this.repositories.set(repository.id, repository)
        
        // Send updated repository list
        this.sendToRenderer('repository-status', Array.from(this.repositories.values()))
        
        // Send to daemon
        this.sendToDaemon('add-repository', repository)
      }
    })

    ipcMain.on('remove-repository', (event, data) => {
      const { id } = data
      this.repositories.delete(id)
      this.sendToDaemon('remove-repository', { id })
      this.sendToRenderer('repository-removed', { id })
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

    ipcMain.on('get-directory-tree', (event, data) => {
      console.log('IPC: get-directory-tree request received for:', data)
      const { id } = data
      this.sendToDaemon('get-directory-tree', { id })
    })

    ipcMain.on('scan-repository', (event, data) => {
      const { id } = data
      this.sendToDaemon('analyze-repository', { id })
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

    ipcMain.on('setup-pretooluse-hook', (event, data) => {
      console.log('IPC: setup-pretooluse-hook request received for:', data)
      const { id } = data
      const repository = this.repositories.get(id)
      
      if (!repository) {
        console.error('IPC: Repository not found:', id)
        event.reply('hook-status', { 
          repositoryId: id, 
          success: false, 
          error: 'Repository not found' 
        })
        return
      }

      // Update repository with hook configuration
      repository.hooks = {
        pretooluse: {
          enabled: true,
          scriptPath: path.join(repository.path, '.mdgent', 'hooks', 'pretooluse.sh')
        }
      }
      this.repositories.set(id, repository)
      
      // Send to daemon to create the hook script
      this.sendToDaemon('setup-hook', { 
        repositoryId: id, 
        hookType: 'pretooluse',
        repository 
      })
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
        break
      
      case 'hook-status':
        this.sendToRenderer('hook-status', message.data)
        // Update repository with hook status
        const hookRepo = this.repositories.get(message.data.repositoryId)
        if (hookRepo && message.data.success) {
          hookRepo.hooks = {
            pretooluse: {
              enabled: true,
              scriptPath: message.data.scriptPath
            }
          }
          this.sendToRenderer('repository-status', Array.from(this.repositories.values()))
        }
        break
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

  cleanup() {
    if (this.daemon && !this.daemon.killed) {
      this.daemon.kill()
    }
  }
}