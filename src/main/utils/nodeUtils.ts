import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main'

/**
 * Gets the correct Node.js executable path for spawning child processes
 * In development, uses system Node.js
 * In production, uses Electron's bundled Node.js
 */
export function getNodePath(): string {
  if (is.dev) {
    // In development, use system Node.js
    return 'node'
  }

  // In production, we need to use Electron's process.execPath
  // which points to the Electron executable that includes Node.js
  return process.execPath
}

/**
 * Gets the correct arguments for spawning a Node.js script
 * In production, we need to pass additional flags to Electron
 */
export function getNodeArgs(scriptPath: string): string[] {
  if (is.dev) {
    // In development, just pass the script path
    return [scriptPath]
  }

  // In production, we need to tell Electron to run in Node mode
  // and execute our script
  return [scriptPath]
}

/**
 * Spawn options for Node.js processes that work in both dev and production
 */
export function getSpawnOptions(additionalEnv?: Record<string, string>) {
  const options: any = {
    stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // This tells Electron to run as Node.js
      ...additionalEnv
    }
  }

  // In production on macOS, we might need to set the PATH
  if (!is.dev && process.platform === 'darwin') {
    options.env.PATH = `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`
  }

  return options
}

/**
 * Helper to spawn a Node.js child process that works in both dev and production
 */
export function spawnNode(scriptPath: string, args: string[] = [], options: any = {}) {
  const { spawn } = require('child_process')
  
  const nodePath = getNodePath()
  const nodeArgs = getNodeArgs(scriptPath)
  const spawnOptions = getSpawnOptions(options.env)
  
  // Merge spawn options
  const finalOptions = {
    ...spawnOptions,
    ...options,
    env: {
      ...spawnOptions.env,
      ...(options.env || {})
    }
  }
  
  log.info(`Spawning Node.js process: ${nodePath} ${[...nodeArgs, ...args].join(' ')}`)
  
  return spawn(nodePath, [...nodeArgs, ...args], finalOptions)
}