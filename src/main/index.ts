import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IpcHandler } from './ipc'
import { vectorDB } from './vectordb/database'
import { searchServer } from './server'
import log from 'electron-log/main'

let mainWindow: BrowserWindow | null = null
let ipcHandler: IpcHandler | null = null
let serverPort: number = 0

function createWindow(): void {
  // Set the icon path based on environment
  const iconPath = is.dev 
    ? join(__dirname, '../../src/AppIcon.icns')
    : process.platform === 'darwin'
      ? undefined // macOS uses icon from app bundle
      : join(process.resourcesPath, '../build/icon.png')

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    show: false,
    ...(iconPath && { icon: iconPath }),
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

// Configure electron-log
log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = is.dev ? 'debug' : 'warn'

// Log file locations:
// macOS: ~/Library/Logs/{app name}/main.log
// Windows: %USERPROFILE%\AppData\Roaming\{app name}\logs\main.log
// Linux: ~/.config/{app name}/logs/main.log

log.info('Application starting...')
log.info('App version:', app.getVersion())
log.info('Electron version:', process.versions.electron)
log.info('Node version:', process.versions.node)
log.info('Platform:', process.platform)

app.whenReady().then(async () => {
  // Set dock icon for macOS in development
  if (process.platform === 'darwin' && is.dev && app.dock) {
    const dockIconPath = join(__dirname, '../../src/AppIcon.icns')
    app.dock.setIcon(dockIconPath)
  }
  
  createWindow()
  
  try {
    // Initialize vector database
    log.info('[Main] Initializing vector database...')
    await vectorDB.initialize()
    
    // Start search server
    log.info('[Main] Starting search server...')
    serverPort = await searchServer.start()
    log.info('[Main] Search server started on port:', serverPort)
  } catch (error) {
    log.error('[Main] Failed to initialize services:', error)
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
  await searchServer.stop()
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
  await searchServer.stop()
  await vectorDB.close()
})