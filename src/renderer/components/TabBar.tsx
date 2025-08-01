import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { Repository } from '@shared/types'
import { ChevronDown } from 'lucide-react'
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
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const tabsContainerRef = useRef<HTMLDivElement>(null)
  const overflowButtonRef = useRef<HTMLButtonElement>(null)
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

  // Removed complex visibility calculation as we only show one repo at a time

  // Show only the selected repository
  const visibleRepos = selectedRepo ? [selectedRepo] : []
  const hiddenRepos = repositories

  const handleOverflowClick = () => {
    if (overflowButtonRef.current) {
      const rect = overflowButtonRef.current.getBoundingClientRect()
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left
      })
    }
    setShowOverflowMenu(!showOverflowMenu)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const menuElement = document.querySelector('.tab-overflow-menu')
      
      if (showOverflowMenu && 
          overflowButtonRef.current && 
          !overflowButtonRef.current.contains(target) &&
          menuElement &&
          !menuElement.contains(target)) {
        setShowOverflowMenu(false)
      }
    }

    if (showOverflowMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showOverflowMenu])

  return (
    <div className="tab-bar">
      <div className="tabs-container" ref={tabsContainerRef}>
        {visibleRepos.map((repo, index) => (
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
        
        {repositories.length > 0 && (
          <div className="tab-overflow-container">
            <button
              ref={overflowButtonRef}
              className="tab-overflow-button"
              onClick={handleOverflowClick}
              title="Select repository"
              style={{ marginLeft: visibleRepos.length === 0 ? 0 : 4 }}
            >
              <span>{visibleRepos.length === 0 ? 'Select repository' : 'Change'}</span>
              <ChevronDown size={14} />
            </button>
          </div>
        )}
        
        <button className="tab-add" onClick={onAddRepo} title="Add repository">
          +
        </button>
      </div>
      
      {showOverflowMenu && ReactDOM.createPortal(
        <div 
          className="tab-overflow-menu"
          style={{
            position: 'fixed',
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`
          }}
        >
          {repositories.map((repo) => {
            const isActive = selectedRepo?.id === repo.id
            return (
              <div
                key={repo.id}
                className={`tab-overflow-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  onSelectRepo(repo)
                  setShowOverflowMenu(false)
                }}
                style={{ fontWeight: isActive ? 'bold' : 'normal' }}
              >
                <span className={`tab-status ${getStatusClass(repo.status)}`}></span>
                <span className="tab-overflow-title">{repo.name}</span>
                <button
                  className="tab-overflow-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseRepo(repo)
                    setShowOverflowMenu(false)
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}

export default TabBar