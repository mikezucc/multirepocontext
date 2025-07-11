import React, { useState, useEffect } from 'react'
import MasterDetail from './components/MasterDetail'
import SettingsModal from './components/SettingsModal'
import StatusBar from './components/StatusBar'
import TabBar from './components/TabBar'
import { PromptDebugger } from './components/PromptDebugger'
import { Repository } from '@shared/types'

declare global {
  interface Window {
    electronAPI: {
      send: (channel: string, data: any) => void
      on: (channel: string, callback: Function) => void
      removeListener: (channel: string, callback: Function) => void
    }
  }
}

function App() {
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [currentView, setCurrentView] = useState<'files' | 'debug'>('files')

  useEffect(() => {
    window.electronAPI.send('get-repositories', null)

    const handleRepoStatus = (repos: Repository[]) => {
      setRepositories(repos)
    }

    const handleRepoRemoved = (data: { id: string }) => {
      setRepositories(prev => prev.filter(r => r.id !== data.id))
    }

    window.electronAPI.on('repository-status', handleRepoStatus)
    window.electronAPI.on('repository-removed', handleRepoRemoved)

    return () => {
      window.electronAPI.removeListener('repository-status', handleRepoStatus)
      window.electronAPI.removeListener('repository-removed', handleRepoRemoved)
    }
  }, [])

  const handleAddRepository = () => {
    window.electronAPI.send('add-repository', {})
  }

  const handleCloseRepo = (repo: Repository) => {
    window.electronAPI.send('remove-repository', { id: repo.id })
    if (selectedRepo?.id === repo.id) {
      const remainingRepos = repositories.filter(r => r.id !== repo.id)
      setSelectedRepo(remainingRepos.length > 0 ? remainingRepos[0] : null)
    }
  }

  return (
    <div className="app">
      <div className="titlebar">
        <div className="title">MDgent v0.1.0</div>
        <TabBar
          repositories={repositories}
          selectedRepo={selectedRepo}
          onSelectRepo={setSelectedRepo}
          onCloseRepo={handleCloseRepo}
          onAddRepo={handleAddRepository}
        />
        <div className="view-switcher" style={{ marginLeft: 'auto', marginRight: '8px' }}>
          <button 
            className={`view-btn ${currentView === 'files' ? 'active' : ''}`}
            onClick={() => setCurrentView('files')}
            style={{
              padding: '4px 8px',
              marginRight: '4px',
              background: currentView === 'files' ? '#3b82f6' : 'transparent',
              color: currentView === 'files' ? 'white' : '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            📁 Files
          </button>
          <button 
            className={`view-btn ${currentView === 'debug' ? 'active' : ''}`}
            onClick={() => setCurrentView('debug')}
            style={{
              padding: '4px 8px',
              background: currentView === 'debug' ? '#3b82f6' : 'transparent',
              color: currentView === 'debug' ? 'white' : '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            🔍 Debug
          </button>
        </div>
        <button className="settings-btn" onClick={() => setShowSettings(true)}>
          ⚙
        </button>
      </div>
      {currentView === 'files' ? (
        <MasterDetail
          repositories={repositories}
          selectedRepo={selectedRepo}
          onSelectRepo={setSelectedRepo}
          onAddRepo={handleAddRepository}
        />
      ) : (
        <PromptDebugger
          repositoryId={selectedRepo?.id || null}
          repositoryName={selectedRepo?.name}
        />
      )}
      <SettingsModal 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
      <StatusBar repositories={repositories} />
    </div>
  )
}

export default App