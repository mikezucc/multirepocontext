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
      'get-directory-tree',
      'scan-repository'
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
      'directory-tree',
      'daemon-status'
    ]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args))
    }
  },
  removeListener: (channel: string, callback: Function) => {
    ipcRenderer.removeListener(channel, callback)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api