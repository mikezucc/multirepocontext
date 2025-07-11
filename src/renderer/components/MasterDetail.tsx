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

  useEffect(() => {
    const handleAnalysisUpdate = (data: any) => {
      if (selectedRepo && data.repositoryId === selectedRepo.id) {
        setIsRegeneratingEmbeddings(true)
      }
    }

    const handleEmbeddingsStatus = (data: any) => {
      if (selectedRepo && data.repositoryId === selectedRepo.id) {
        setIsRegeneratingEmbeddings(false)
      }
    }

    window.electronAPI.on('analysis-update', handleAnalysisUpdate)
    window.electronAPI.on('embeddings-status', handleEmbeddingsStatus)

    return () => {
      window.electronAPI.removeListener('analysis-update', handleAnalysisUpdate)
      window.electronAPI.removeListener('embeddings-status', handleEmbeddingsStatus)
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
              onClick={() => window.electronAPI.send('scan-repository', { id: selectedRepo.id })}
              disabled={selectedRepo.status === 'scanning' || selectedRepo.status === 'analyzing'}
            >
              {selectedRepo.status === 'scanning' || selectedRepo.status === 'analyzing' 
                ? '[◧] Scanning...' 
                : '[►] Scan Repository'}
            </button>
            <button 
              className="scan-btn"
              onClick={() => window.electronAPI.send('setup-mcp-server', { id: selectedRepo.id })}
              style={{ marginTop: '8px' }}
              title="Setup MCP server configuration for enhanced context retrieval"
            >
              [⚙] Setup MCP Server
            </button>
            <button 
              className="scan-btn"
              onClick={() => {
                if (!isRegeneratingEmbeddings) {
                  window.electronAPI.send('regenerate-embeddings', { id: selectedRepo.id })
                  setIsRegeneratingEmbeddings(true)
                }
              }}
              style={{ marginTop: '8px' }}
              title={isRegeneratingEmbeddings ? "Regenerating embeddings..." : "Regenerate embeddings for all .mdgent.md files"}
              disabled={isRegeneratingEmbeddings}
            >
              {isRegeneratingEmbeddings ? '[⟳] Regenerating...' : '[↻] Regenerate Embeddings'}
            </button>
            
            {selectedRepo.vectorStats && (
              <div className="vector-stats" style={{ marginTop: '16px', fontSize: '0.85em', opacity: 0.8 }}>
                <div>Vector Database Stats:</div>
                <div>• Documents: {selectedRepo.vectorStats.documentCount}</div>
                <div>• Chunks: {selectedRepo.vectorStats.chunkCount}</div>
                {selectedRepo.vectorStats.lastIndexed && (
                  <div>• Last indexed: {new Date(selectedRepo.vectorStats.lastIndexed).toLocaleString()}</div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-text">Select a repository tab</div>
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