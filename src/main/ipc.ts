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
  }

  private startDaemon() {
    const daemonPath = path.join(__dirname, 'daemon.js')
    
    this.daemon = spawn('node', [daemonPath], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    })

    this.daemon.on('message', (message: any) => {
      this.handleDaemonMessage(message)
    })

    this.daemon.on('error', (error) => {
      console.error('Daemon error:', error)
    })

    this.daemon.on('exit', (code) => {
      console.log(`Daemon exited with code ${code}`)
      // Restart daemon if it crashes
      setTimeout(() => this.startDaemon(), 5000)
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