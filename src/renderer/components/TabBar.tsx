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
  const [visibleTabs, setVisibleTabs] = useState<number>(repositories.length)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const tabsContainerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLDivElement | null)[]>([])
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

  useEffect(() => {
    const calculateVisibleTabs = () => {
      if (!tabsContainerRef.current) return

      const containerWidth = tabsContainerRef.current.offsetWidth
      const addButtonWidth = 36
      const overflowButtonWidth = 100
      const tabGap = 4
      let availableWidth = containerWidth - addButtonWidth - tabGap

      let visibleCount = 0
      let totalWidth = 0

      for (let i = 0; i < repositories.length; i++) {
        const tabElement = tabRefs.current[i]
        if (!tabElement) continue

        const tabWidth = tabElement.scrollWidth + tabGap
        
        if (totalWidth + tabWidth + overflowButtonWidth <= availableWidth || i === 0) {
          totalWidth += tabWidth
          visibleCount++
        } else {
          break
        }
      }

      setVisibleTabs(Math.max(1, visibleCount))
    }

    calculateVisibleTabs()
    const resizeObserver = new ResizeObserver(calculateVisibleTabs)
    if (tabsContainerRef.current) {
      resizeObserver.observe(tabsContainerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [repositories.length])

  const hiddenRepos = repositories.slice(visibleTabs)
  const visibleRepos = repositories.slice(0, visibleTabs)

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
            ref={(el) => (tabRefs.current[index] = el)}
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
        
        {hiddenRepos.length > 0 && (
          <div className="tab-overflow-container">
            <button
              ref={overflowButtonRef}
              className="tab-overflow-button"
              onClick={handleOverflowClick}
              title="Show more repositories"
            >
              <span>{hiddenRepos.length} more</span>
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
          {hiddenRepos.map((repo) => {
            const isActive = selectedRepo?.id === repo.id
            return (
              <div
                key={repo.id}
                className={`tab-overflow-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  onSelectRepo(repo)
                  setShowOverflowMenu(false)
                }}
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