# Production Build Node.js Fix

## Issue
The production build was failing with `spawn node ENOENT` error because the packaged Electron app couldn't find the system Node.js executable.

## Solution
Created a utility module (`src/main/utils/nodeUtils.ts`) that:

1. **In Development**: Uses system Node.js (`node` command)
2. **In Production**: Uses Electron's bundled Node.js (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`)

## Changes Made

### 1. Created `src/main/utils/nodeUtils.ts`
- `getNodePath()`: Returns correct Node.js executable path
- `getNodeArgs()`: Returns appropriate arguments for the script
- `getSpawnOptions()`: Provides spawn options with proper environment variables
- `spawnNode()`: Helper function that wraps child_process.spawn with correct settings

### 2. Updated `src/main/ipc.ts`
- Replaced direct `spawn('node', ...)` calls with `spawnNode()` utility
- Applied to both daemon and MCP server spawning

### 3. Key Environment Variable
- `ELECTRON_RUN_AS_NODE=1`: Tells Electron to run as Node.js instead of Electron

## Testing

1. Build the app: `npm run dist:mac`
2. Run the built app from `dist/mac-arm64/MultiRepoContext.app`
3. Check logs at `~/Library/Logs/MultiRepoContext/main.log`
4. Verify daemon starts without ENOENT errors

## Additional Notes

- The fix ensures child processes work in both development and production
- No external Node.js installation required for production builds
- Maintains full compatibility with existing code