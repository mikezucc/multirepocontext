import React, { useState } from 'react'
import DocumentationViewer from './DocumentationViewer'
import { Repository } from '@shared/types'
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

  return (
    <div className="master-detail">
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
                onClick={() => window.electronAPI.send('setup-pretooluse-hook', { id: selectedRepo.id })}
                style={{ marginTop: '8px' }}
              >
                {selectedRepo.hooks?.pretooluse?.enabled 
                  ? '[✓] Hook Enabled' 
                  : '[⚙] Setup Hook'}
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-text">Select a repository tab</div>
            </div>
          )}
        </div>
      </div>
      <div className="detail-pane">
        <DocumentationViewer
          repository={selectedRepo}
          documentation={documentation}
        />
      </div>
    </div>
  )
}

export default MasterDetail