# MultiRepoContext

An AI-powered cross-repo knowledge system that generates comprehensive READMEs, making codebases more accessible to AI coding assistants.

Read more about this here: https://onpaper.dev/p/multirepocontext-dealing-with-repository-drift-1754455659640-59iebq

## Features

- **AI-Powered Analysis**: Uses Anthropic or OpenAI API to understand code purpose and context
- **Automatic Documentation**: Generates detailed info.multirepocontext.md files for code regions
- **Multi-Repository Support**: Manage permissions for cross-repo access

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/mikezucc/multirepocontext.git
cd multirepocontext

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Building

```bash
# Build for production
npm run build

# Package for distribution
npm run dist
```

## Usage

1. Launch MultiRepoContext
2. Click "[+] Add Repository" to add a local repository
3. Configure your Model API key in settings
4. MultiRepoContext will automatically analyze your codebase and generate documentation
5. Browse generated documentation in the detail pane

## Architecture

- **Electron**: Main UI for managing repositories
- **MultiRepoContext Daemon**: Background process that watches files and orchestrates analysis
- **LLM Integration**: Uses Claude API for intelligent code understanding
- **File Watcher**: Monitors changes and triggers incremental updates
- **SQLite-Vec**: Vector database for storing embeddings

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Run type checking
npm run typecheck

# Build for production
npm run build
```

## License

ISC
