import React, { useState } from 'react'
import RepositoryList from './RepositoryList'
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
        <div className="pane-header">
          <span className="header-text">REPOSITORIES</span>
          <span className="header-line">{'─'.repeat(20)}</span>
        </div>
        <RepositoryList
          repositories={repositories}
          selectedRepo={selectedRepo}
          onSelectRepo={onSelectRepo}
        />
        <div className="master-footer">
          <button onClick={onAddRepo} className="add-repo-btn">
            [+] Add Repository
          </button>
        </div>
      </div>
      <div className="detail-pane">
        <div className="pane-header">
          <span className="header-text">README.mdgent.md</span>
          <span className="header-line">{'─'.repeat(40)}</span>
        </div>
        <DocumentationViewer
          repository={selectedRepo}
          documentation={documentation}
        />
      </div>
    </div>
  )
}

export default MasterDetail