# MDgent

An AI-powered tribal knowledge documentation system that automatically generates comprehensive README files for different code regions, making codebases more accessible to AI coding assistants.

## Features

- **AI-Powered Analysis**: Uses Anthropic's Claude API to understand code purpose and context
- **Automatic Documentation**: Generates detailed README.mdgent.md files for code regions
- **Real-time Monitoring**: Watches for file changes and updates documentation incrementally
- **Terminal Aesthetic**: Elegant retro terminal UI with master-detail layout
- **Multi-Repository Support**: Manage documentation for multiple projects simultaneously

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Anthropic API key

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/mdgent.git
cd mdgent

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

1. Launch MDgent
2. Click "[+] Add Repository" to add a local repository
3. Configure your Anthropic API key in settings
4. MDgent will automatically analyze your codebase and generate documentation
5. Browse generated documentation in the detail pane

## Architecture

- **Electron Desktop App**: Main UI for managing repositories
- **MDgent Daemon**: Background process that watches files and orchestrates analysis
- **LLM Integration**: Uses Claude API for intelligent code understanding
- **File Watcher**: Monitors changes and triggers incremental updates

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