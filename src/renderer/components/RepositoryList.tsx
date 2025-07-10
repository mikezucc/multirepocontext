import React from 'react'
import { Repository } from '@shared/types'
import './RepositoryList.css'

interface RepositoryListProps {
  repositories: Repository[]
  selectedRepo: Repository | null
  onSelectRepo: (repo: Repository) => void
}

const RepositoryList: React.FC<RepositoryListProps> = ({
  repositories,
  selectedRepo,
  onSelectRepo
}) => {
  const getStatusIcon = (status: Repository['status']) => {
    switch (status) {
      case 'idle':
        return '□'
      case 'scanning':
      case 'analyzing':
        return '◧'
      case 'ready':
        return '■'
      case 'error':
        return '⊗'
      default:
        return '□'
    }
  }

  const getStatusClass = (status: Repository['status']) => {
    switch (status) {
      case 'scanning':
      case 'analyzing':
        return 'processing'
      case 'ready':
        return 'ready'
      case 'error':
        return 'error'
      default:
        return 'idle'
    }
  }

  return (
    <div className="repository-list">
      {repositories.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">[ ]</div>
          <div className="empty-text">No repositories added</div>
          <div className="empty-hint">Click below to add your first repository</div>
        </div>
      ) : (
        <ul className="repo-items">
          {repositories.map((repo) => (
            <li
              key={repo.id}
              className={`repo-item ${selectedRepo?.id === repo.id ? 'selected' : ''}`}
              onClick={() => onSelectRepo(repo)}
            >
              <span className={`status-icon ${getStatusClass(repo.status)}`}>
                {getStatusIcon(repo.status)}
              </span>
              <span className="repo-name">{repo.name}</span>
              {repo.documentCount && (
                <span className="doc-count">[{repo.documentCount}]</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default RepositoryList