import { contextBridge, ipcRenderer } from 'electron'

const api = {
  send: (channel: string, data: any) => {
    const validChannels = [
      'add-repository', 
      'remove-repository', 
      'refresh-repository', 
      'get-repositories',
      'get-api-key',
      'set-api-key',
      'get-provider-settings',
      'set-provider-settings',
      'get-directory-tree',
      'scan-repository',
      'process-directory',
      'read-file',
      'save-file',
      'setup-mcp-server',
      'regenerate-embeddings',
      'get-vector-stats',
      'get-token-usage',
      'debug-search',
      'reset-vector-database',
      'update-repository-opened',
      'get-mcp-server-status',
      'get-repository-access-permissions',
      'grant-repository-access',
      'revoke-repository-access',
      'get-accessible-repositories'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },
  on: (channel: string, callback: Function) => {
    const validChannels = [
      'repository-status', 
      'repository-removed',
      'analysis-update', 
      'documentation-ready',
      'api-key',
      'provider-settings',
      'directory-tree',
      'daemon-status',
      'file-content',
      'file-saved',
      'mcp-status',
      'embeddings-status',
      'vector-stats',
      'token-usage-update',
      'debug-search-results',
      'vector-database-reset',
      'mcp-server-status',
      'repository-access-permissions',
      'grant-repository-access-result',
      'revoke-repository-access-result',
      'accessible-repositories'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args))
    }
  },
  removeListener: (channel: string, callback: Function) => {
    ipcRenderer.removeListener(channel, (event, ...args) => callback(...args))
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api