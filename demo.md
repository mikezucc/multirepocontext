# MDgent Demo

## Running the Application

1. Start the development server:
   ```bash
   npm run dev
   ```

2. The MDgent window will open with the terminal-style UI

## Using MDgent

### Setting up API Key
1. Click the settings button (⚙) in the top right
2. Enter your Anthropic API key
3. Click Save

### Adding a Repository
1. Click "[+] Add Repository" button
2. Select a directory containing code
3. MDgent will automatically start analyzing the codebase

### Viewing Documentation
1. Select a repository from the left panel
2. Documentation will appear in the right panel
3. Status indicators show progress:
   - ○ Idle
   - ◐ Processing
   - ● Ready
   - × Error

### Generated Files
- MDgent creates `info.mdgent.md` files in each directory
- These files contain AI-generated documentation for the code
- Files are updated automatically when code changes

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 Electron Main                    │
│  - Window Management                             │
│  - IPC Handler                                   │
│  - Daemon Spawning                               │
└──────────────────┬──────────────────────────────┘
                   │ IPC
┌──────────────────┴──────────────────────────────┐
│                MDgent Daemon                     │
│  - File Watching (Chokidar)                      │
│  - Code Analysis (Anthropic API)                 │
│  - Documentation Generation                      │
└─────────────────────────────────────────────────┘
```

## Features
- Real-time file watching
- Incremental documentation updates
- Terminal aesthetic UI
- Master-detail layout
- Progress tracking
- Cost estimation