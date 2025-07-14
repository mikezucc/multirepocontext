import React, { useState, useEffect } from 'react'
import './StatusBar.css'

interface StatusBarProps {
  repositories: any[]
}

interface DaemonLog {
  timestamp: Date
  message: string
  type: 'info' | 'error' | 'warning'
}

const StatusBar: React.FC<StatusBarProps> = ({ repositories }) => {
  const [daemonStatus, setDaemonStatus] = useState<'running' | 'stopped' | 'error'>('running')
  const [logs, setLogs] = useState<DaemonLog[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [currentActivity, setCurrentActivity] = useState<string>('')

  useEffect(() => {
    const handleAnalysisUpdate = (data: any) => {
      setCurrentActivity(`(${Math.round(data.progress)}%) Regenerating embeddings: ${data.currentFile}`)
      addLog(`Processing file ${data.processedFiles + 1}/${data.totalFiles}: ${data.currentFile}`, 'info')
    }

    const handleDocumentationReady = (data: any) => {
      addLog(`Documentation updated: ${data.filePath}`, 'info')
    }

    const handleDaemonStatus = (status: any) => {
      setDaemonStatus(status.connected ? 'running' : 'stopped')
      if (status.message) {
        addLog(status.message, status.type || 'info')
      }
    }

    const handleRepoStatus = (repos: any[]) => {
      const activeRepo = repos.find(r => r.status === 'analyzing' || r.status === 'scanning')
      if (activeRepo) {
        if (activeRepo.status === 'scanning') {
          setCurrentActivity(`Scanning: ${activeRepo.name}`)
        }
        if (activeRepo.error) {
          addLog(`Error in ${activeRepo.name}: ${activeRepo.error}`, 'error')
        }
      } else {
        setCurrentActivity('')
      }
    }

    const handleEmbeddingsStatus = (data: any) => {
      if (data.success) {
        const completionMessage = data.message || `Successfully regenerated embeddings for ${data.filesProcessed} files`
        setCurrentActivity(completionMessage)
        addLog(completionMessage, 'info')
        // Clear the activity message after 5 seconds
        setTimeout(() => setCurrentActivity(''), 5000)
      } else {
        const errorMessage = data.error || 'Failed to regenerate embeddings'
        setCurrentActivity(`Error: ${errorMessage}`)
        addLog(errorMessage, 'error')
        // Clear the activity message after 5 seconds
        setTimeout(() => setCurrentActivity(''), 5000)
      }
    }

    window.electronAPI.on('analysis-update', handleAnalysisUpdate)
    window.electronAPI.on('documentation-ready', handleDocumentationReady)
    window.electronAPI.on('daemon-status', handleDaemonStatus)
    window.electronAPI.on('repository-status', handleRepoStatus)
    window.electronAPI.on('embeddings-status', handleEmbeddingsStatus)

    return () => {
      window.electronAPI.removeListener('analysis-update', handleAnalysisUpdate)
      window.electronAPI.removeListener('documentation-ready', handleDocumentationReady)
      window.electronAPI.removeListener('daemon-status', handleDaemonStatus)
      window.electronAPI.removeListener('repository-status', handleRepoStatus)
      window.electronAPI.removeListener('embeddings-status', handleEmbeddingsStatus)
    }
  }, [])

  const addLog = (message: string, type: DaemonLog['type'] = 'info') => {
    setLogs(prev => {
      // Check if the same message was logged within the last second
      const now = new Date()
      const oneSecondAgo = new Date(now.getTime() - 1000)
      
      const isDuplicate = prev.some(log => 
        log.message === message && 
        log.timestamp >= oneSecondAgo
      )
      
      if (isDuplicate) {
        return prev // Don't add duplicate
      }
      
      return [...prev, { timestamp: now, message, type }]
    })
  }

  const activeRepos = repositories.filter(r => r.status === 'analyzing' || r.status === 'scanning').length
  const errorRepos = repositories.filter(r => r.status === 'error').length

  return (
    <>
      <div className="status-bar">
        <div className="status-left">
          <span className={`daemon-indicator ${daemonStatus}`}>
            {daemonStatus === 'running' ? '●' : daemonStatus === 'error' ? '⊗' : '○'}
          </span>
          <span className="daemon-label">Daemon: {daemonStatus}</span>
          {activeRepos > 0 && (
            <span className="active-tasks">
              {activeRepos} active {activeRepos === 1 ? 'task' : 'tasks'}
            </span>
          )}
          {errorRepos > 0 && (
            <span className="error-count">
              {errorRepos} {errorRepos === 1 ? 'error' : 'errors'}
            </span>
          )}
        </div>
        
        <div className="status-center">
          {currentActivity && (
            <span className={`current-activity ${currentActivity.includes('Successfully') ? 'success' : ''}`}>
              {currentActivity}
            </span>
          )}
        </div>
        
        <div className="status-right">
          <button 
            className="log-toggle"
            onClick={() => setShowLogs(!showLogs)}
            title="Toggle daemon logs"
          >
            {showLogs ? '▼' : '▲'} Logs ({logs.length})
          </button>
        </div>
      </div>
      
      {showLogs && (
        <div className="log-panel">
          <div className="log-header">
            <span>Daemon Activity Log</span>
            <button 
              className="clear-logs"
              onClick={() => setLogs([])}
            >
              Clear
            </button>
          </div>
          <div className="log-content">
            {logs.length === 0 ? (
              <div className="log-empty">No activity yet</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={`log-entry ${log.type}`}>
                  <span className="log-time">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default StatusBar