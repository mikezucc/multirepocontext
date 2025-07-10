import React, { useState, useEffect } from 'react'
import MasterDetail from './components/MasterDetail'
import SettingsModal from './components/SettingsModal'
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

  return (
    <div className="app">
      <div className="titlebar">
        <div className="title">MDgent v0.1.0</div>
        <button className="settings-btn" onClick={() => setShowSettings(true)}>
          ⚙
        </button>
      </div>
      <MasterDetail
        repositories={repositories}
        selectedRepo={selectedRepo}
        onSelectRepo={setSelectedRepo}
        onAddRepo={handleAddRepository}
      />
      <SettingsModal 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  )
}

export default App