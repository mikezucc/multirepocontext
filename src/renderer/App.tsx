import React, { useState, useEffect } from 'react'
import MasterDetail from './components/MasterDetail'
import SettingsModal from './components/SettingsModal'
import StatusBar from './components/StatusBar'
import TabBar from './components/TabBar'
import TokenUsageMeter from './components/TokenUsageMeter'
import MCPStatusIndicator from './components/MCPStatusIndicator'
import { PromptDebugger } from './components/PromptDebugger'
import { ConfigView } from './components/ConfigView'
import { PromptHistory } from './components/PromptHistory'
import { RepositoryAccessSettings } from './components/RepositoryAccessSettings'
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

// Interface for persisted debug state
interface DebugState {
  query: string
  searchResults: any | null
  selectedResult: any | null
  expandedSections: {
    stats: boolean
    results: boolean
    detail: boolean
  }
}

function App() {
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [currentView, setCurrentView] = useState<'files' | 'debug' | 'config' | 'history' | 'access'>('files')
  const [debugPrompt, setDebugPrompt] = useState<string>('')
  
  // Persistent debug state per repository
  const [debugStates, setDebugStates] = useState<Record<string, DebugState>>({})

  const handleSelectRepo = (repo: Repository) => {
    setSelectedRepo(repo)
    // Update last opened timestamp
    window.electronAPI.send('update-repository-opened', { id: repo.id })
  }

  useEffect(() => {
    window.electronAPI.send('get-repositories', null)

    const handleRepoStatus = (repos: Repository[]) => {
      setRepositories(repos)
      // Auto-select first repository if none selected and repos exist
      if (!selectedRepo && repos.length > 0) {
        handleSelectRepo(repos[0])
      }
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

  const handleCopyPrompt = (prompt: string) => {
    setDebugPrompt(prompt)
    setCurrentView('debug')
  }

  // Update debug state for current repository
  const updateDebugState = (updates: Partial<DebugState>) => {
    if (selectedRepo?.id) {
      setDebugStates(prev => ({
        ...prev,
        [selectedRepo.id]: {
          ...prev[selectedRepo.id],
          ...updates
        }
      }))
    }
  }

  // Get debug state for current repository
  const getDebugState = (): DebugState => {
    if (selectedRepo?.id && debugStates[selectedRepo.id]) {
      return debugStates[selectedRepo.id]
    }
    return {
      query: debugPrompt || '',
      searchResults: null,
      selectedResult: null,
      expandedSections: {
        stats: true,
        results: true,
        detail: true
      }
    }
  }

  useEffect(() => {
    // Don't clear debug prompt when switching views
    // This allows the state to persist
  }, [currentView])

  return (
    <div className="app">
      <div className="titlebar">
        <div className="title">MDgent v0.1.0</div>
        <TabBar
          repositories={repositories}
          selectedRepo={selectedRepo}
          onSelectRepo={handleSelectRepo}
          onCloseRepo={handleCloseRepo}
          onAddRepo={handleAddRepository}
        />
        <div className="view-switcher" style={{ 
          marginLeft: 'auto', 
          marginRight: '8px',
          display: 'flex',
          gap: '4px',
          WebkitAppRegion: 'no-drag' as any
        }}>
          <button 
            className={`view-btn ${currentView === 'files' ? 'active' : ''}`}
            onClick={() => setCurrentView('files')}
            style={{
              padding: '4px 12px',
              background: currentView === 'files' ? 'var(--text-primary)' : 'var(--bg-secondary)',
              color: currentView === 'files' ? 'var(--bg-primary)' : 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'inherit',
              WebkitAppRegion: 'no-drag' as any,
              transition: 'all 0.2s ease'
            }}
          >
            Files
          </button>
          <button 
            className={`view-btn ${currentView === 'debug' ? 'active' : ''}`}
            onClick={() => setCurrentView('debug')}
            style={{
              padding: '4px 12px',
              background: currentView === 'debug' ? 'var(--text-primary)' : 'var(--bg-secondary)',
              color: currentView === 'debug' ? 'var(--bg-primary)' : 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'inherit',
              WebkitAppRegion: 'no-drag' as any,
              transition: 'all 0.2s ease'
            }}
          >
            Debug
          </button>
          <button 
            className={`view-btn ${currentView === 'config' ? 'active' : ''}`}
            onClick={() => setCurrentView('config')}
            style={{
              padding: '4px 12px',
              background: currentView === 'config' ? 'var(--text-primary)' : 'var(--bg-secondary)',
              color: currentView === 'config' ? 'var(--bg-primary)' : 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'inherit',
              WebkitAppRegion: 'no-drag' as any,
              transition: 'all 0.2s ease'
            }}
          >
            Config
          </button>
          <button 
            className={`view-btn ${currentView === 'history' ? 'active' : ''}`}
            onClick={() => setCurrentView('history')}
            style={{
              padding: '4px 12px',
              background: currentView === 'history' ? 'var(--text-primary)' : 'var(--bg-secondary)',
              color: currentView === 'history' ? 'var(--bg-primary)' : 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'inherit',
              WebkitAppRegion: 'no-drag' as any,
              transition: 'all 0.2s ease'
            }}
          >
            History
          </button>
          <button 
            className={`view-btn ${currentView === 'access' ? 'active' : ''}`}
            onClick={() => setCurrentView('access')}
            style={{
              padding: '4px 12px',
              background: currentView === 'access' ? 'var(--text-primary)' : 'var(--bg-secondary)',
              color: currentView === 'access' ? 'var(--bg-primary)' : 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'inherit',
              WebkitAppRegion: 'no-drag' as any,
              transition: 'all 0.2s ease'
            }}
          >
            Access
          </button>
        </div>
        <MCPStatusIndicator 
          repositories={repositories}
          selectedRepo={selectedRepo}
        />
        <TokenUsageMeter />
        <button className="settings-btn" onClick={() => setShowSettings(true)}>
          ⚙
        </button>
      </div>
      {currentView === 'files' ? (
        <MasterDetail
          repositories={repositories}
          selectedRepo={selectedRepo}
          onSelectRepo={handleSelectRepo}
          onAddRepo={handleAddRepository}
        />
      ) : currentView === 'debug' ? (
        <PromptDebugger
          repositoryId={selectedRepo?.id || null}
          repositoryName={selectedRepo?.name}
          initialPrompt={debugPrompt}
          persistedState={getDebugState()}
          onStateChange={updateDebugState}
        />
      ) : currentView === 'config' ? (
        <ConfigView
          repositoryId={selectedRepo?.id || null}
          repositoryName={selectedRepo?.name}
        />
      ) : currentView === 'history' ? (
        <PromptHistory
          repositoryId={selectedRepo?.id || null}
          repositoryName={selectedRepo?.name}
          onCopyPrompt={handleCopyPrompt}
        />
      ) : (
        <RepositoryAccessSettings activeRepository={selectedRepo} />
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