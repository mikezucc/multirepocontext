import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IpcHandler } from './ipc'
import { vectorDB } from './vectordb/database'
import { pretoolUseServer } from './server'

let mainWindow: BrowserWindow | null = null
let ipcHandler: IpcHandler | null = null
let serverPort: number = 0

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  createWindow()
  
  try {
    // Initialize vector database
    console.log('[Main] Initializing vector database...')
    await vectorDB.initialize()
    
    // Start pretooluse server
    console.log('[Main] Starting pretooluse server...')
    serverPort = await pretoolUseServer.start()
    console.log('[Main] Pretooluse server started on port:', serverPort)
  } catch (error) {
    console.error('[Main] Failed to initialize services:', error)
  }
  
  // Initialize IPC handler
  ipcHandler = new IpcHandler()
  if (mainWindow) {
    ipcHandler.setMainWindow(mainWindow)
  }
  
  // Pass server port to IPC handler
  if (ipcHandler) {
    ipcHandler.setServerPort(serverPort)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  if (ipcHandler) {
    ipcHandler.cleanup()
  }
  
  // Stop services
  await pretoolUseServer.stop()
  await vectorDB.close()
  
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  if (ipcHandler) {
    ipcHandler.cleanup()
  }
  
  // Stop services
  await pretoolUseServer.stop()
  await vectorDB.close()
})