import React from 'react'
import { Repository } from '@shared/types'
import './TabBar.css'

interface TabBarProps {
  repositories: Repository[]
  selectedRepo: Repository | null
  onSelectRepo: (repo: Repository) => void
  onCloseRepo: (repo: Repository) => void
  onAddRepo: () => void
}

const TabBar: React.FC<TabBarProps> = ({
  repositories,
  selectedRepo,
  onSelectRepo,
  onCloseRepo,
  onAddRepo
}) => {
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
    <div className="tab-bar">
      <div className="tabs-container">
        {repositories.map((repo) => (
          <div
            key={repo.id}
            className={`tab ${selectedRepo?.id === repo.id ? 'active' : ''}`}
            onClick={() => onSelectRepo(repo)}
          >
            <span className={`tab-status ${getStatusClass(repo.status)}`}></span>
            <span className="tab-title">{repo.name}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onCloseRepo(repo)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="tab-add" onClick={onAddRepo} title="Add repository">
          +
        </button>
      </div>
    </div>
  )
}

export default TabBar