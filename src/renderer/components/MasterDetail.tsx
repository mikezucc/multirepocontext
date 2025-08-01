import React, { useState, useEffect } from 'react'
import DocumentationViewer from './DocumentationViewer'
import { Repository } from '@shared/types'
import { ResizablePane } from '../../components/ResizablePane'
import '../../components/ResizablePane.css'
import './MasterDetail.css'

interface MasterDetailProps {
  repositories: Repository[]
  selectedRepo: Repository | null
  onSelectRepo: (repo: Repository | null) => void
  onAddRepo: () => void
}

const MasterDetail: React.FC<MasterDetailProps> = ({
  repositories,
  selectedRepo,
  onSelectRepo,
  onAddRepo
}) => {
  const [documentation, setDocumentation] = useState<string>('')
  const [isRegeneratingEmbeddings, setIsRegeneratingEmbeddings] = useState(false)
  const [cursorDeeplink, setCursorDeeplink] = useState<string | null>(null)
  const [showMcpSuccess, setShowMcpSuccess] = useState(false)

  // Generate Cursor deeplink for the current repository
  const generateCursorDeeplink = (repo: Repository) => {
    const serverPort = 3989 // Fixed port to match CSP
    const mcpServerPath = `${repo.path}/.multirepocontext/mcp/multirepocontext-mcp-server.js`
    
    const cursorConfig = {
      command: "node",
      args: [mcpServerPath],
      env: {
        MULTIREPOCONTEXT_SERVER_PORT: serverPort.toString(),
        MULTIREPOCONTEXT_REPOSITORY_ID: repo.id,
        MULTIREPOCONTEXT_REPOSITORY_PATH: repo.path,
        MULTIREPOCONTEXT_REPOSITORY_NAME: repo.name
      }
    }
    
    const encodedConfig = btoa(JSON.stringify(cursorConfig))
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=multirepocontext-rag&config=${encodedConfig}`
  }

  useEffect(() => {
    const handleAnalysisUpdate = (data: any) => {
      if (selectedRepo && data.repositoryId === selectedRepo.id) {
        setIsRegeneratingEmbeddings(true)
      }
    }

    const handleEmbeddingsStatus = (data: any) => {
      console.log('Received embeddings-status:', data)
      if (selectedRepo && data.repositoryId === selectedRepo.id) {
        setIsRegeneratingEmbeddings(false)
      }
    }

    const handleMcpStatus = (data: any) => {
      if (selectedRepo && data.repositoryId === selectedRepo.id && data.success) {
        setCursorDeeplink(data.cursorDeeplink)
        setShowMcpSuccess(true)
        // Auto-hide success message after 10 seconds
        setTimeout(() => setShowMcpSuccess(false), 10000)
      }
    }

    window.electronAPI.on('analysis-update', handleAnalysisUpdate)
    window.electronAPI.on('embeddings-status', handleEmbeddingsStatus)
    window.electronAPI.on('mcp-status', handleMcpStatus)

    return () => {
      window.electronAPI.removeListener('analysis-update', handleAnalysisUpdate)
      window.electronAPI.removeListener('embeddings-status', handleEmbeddingsStatus)
      window.electronAPI.removeListener('mcp-status', handleMcpStatus)
    }
  }, [selectedRepo])

  const masterPane = (
    <div className="master-pane">
      <div className="master-content">
        {repositories.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">[ ]</div>
            <div className="empty-text">No repositories added</div>
            <div className="empty-hint">Click the + button to add your first repository</div>
          </div>
        ) : selectedRepo ? (
          <div className="repo-info">
            <div className="info-section">
              <div className="info-label">PATH</div>
              <div className="info-value">{selectedRepo.path}</div>
            </div>
            <div className="info-section">
              <div className="info-label">STATUS</div>
              <div className={`info-value status-${selectedRepo.status}`}>
                {selectedRepo.status.toUpperCase()}
              </div>
            </div>
            {selectedRepo.documentCount && (
              <div className="info-section">
                <div className="info-label">DOCUMENTS</div>
                <div className="info-value">{selectedRepo.documentCount}</div>
              </div>
            )}
            {selectedRepo.error && (
              <div className="info-section error">
                <div className="info-label">ERROR</div>
                <div className="info-value">{selectedRepo.error}</div>
              </div>
            )}
            <button 
              className="scan-btn"
              title="Analyzes the entire repository and generates context files"
              onClick={() => window.electronAPI.send('scan-repository', { id: selectedRepo.id })}
              disabled={selectedRepo.status === 'scanning' || selectedRepo.status === 'analyzing'}
            >
              {selectedRepo.status === 'scanning' || selectedRepo.status === 'analyzing' 
                ? '[◧] Analyzing...' 
                : '[►] Analyze Repository'}
            </button>
            <button 
              className="scan-btn"
              onClick={() => window.electronAPI.send('setup-mcp-server', { id: selectedRepo.id })}
              style={{ marginTop: '8px' }}
              title="Installs MCP server configuration for enhanced context retrieval"
            >
              [⚙] Setup MCP Server
            </button>
            
            <button 
              className="scan-btn"
              onClick={() => window.open(generateCursorDeeplink(selectedRepo), '_blank')}
              style={{ marginTop: '8px' }}
              title="Install MCP server in Cursor IDE"
            >
              [↗] Install MCP to Cursor
            </button>
            
            {showMcpSuccess && (
              <div style={{ marginTop: '8px', padding: '8px', borderRadius: '4px', border: '1px solid #3a5f8f' }}>
                <div style={{ color: '#4caf50', fontSize: '0.9em' }}>✓ MCP Server Configured!</div>
                <div style={{ marginTop: '4px', fontSize: '0.8em', opacity: 0.8 }}>
                  Use Claude Code (auto-detected via .mcp.json)
                </div>
              </div>
            )}
            <button 
              className="scan-btn"
              onClick={() => {
                if (!isRegeneratingEmbeddings) {
                  window.electronAPI.send('regenerate-embeddings', { id: selectedRepo.id })
                  setIsRegeneratingEmbeddings(true)
                }
              }}
              style={{ marginTop: '8px' }}
              title={isRegeneratingEmbeddings ? "Regenerating embeddings..." : "Regenerate embeddings for all .multirepocontext.md files"}
              disabled={isRegeneratingEmbeddings}
            >
              {isRegeneratingEmbeddings ? '[⟳] Regenerating...' : '[↻] Regenerate Embeddings'}
            </button>
            
            {selectedRepo.vectorStats && (
              <div className="vector-stats" style={{ marginTop: '16px', fontSize: '0.85em', opacity: 0.8 }}>
                <div>Vector Database Stats:</div>
                <div>• Documents: {selectedRepo.vectorStats.indexedFiles.length}</div>
                <div>• Chunks: {selectedRepo.vectorStats.totalChunks}</div>
                {selectedRepo.vectorStats.lastUpdated && (
                  <div>• Last indexed: {new Date(selectedRepo.vectorStats.lastUpdated).toLocaleString()}</div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-text">No repository selected</div>
            <button 
              className="scan-btn"
              onClick={onAddRepo}
              style={{ marginTop: '16px' }}
            >
              [+] Add Repository
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const detailPane = (
    <div className="detail-pane">
      <DocumentationViewer
        repository={selectedRepo}
        documentation={documentation}
      />
    </div>
  );

  return (
    <div className="master-detail">
      <ResizablePane
        leftPane={masterPane}
        rightPane={detailPane}
        initialLeftWidth={300}
        minLeftWidth={200}
        maxLeftWidth={500}
      />
    </div>
  )
}

export default MasterDetail