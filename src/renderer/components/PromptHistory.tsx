import React, { useState, useEffect } from 'react'
import './PromptHistory.css'

declare global {
  interface Window {
    electronAPI: {
      send: (channel: string, data: any) => void
      on: (channel: string, callback: Function) => void
      removeListener: (channel: string, callback: Function) => void
    }
  }
}

interface PromptHistoryEntry {
  id: string
  prompt: string
  repository_id: string
  repository_name: string
  options: string
  timestamp: string
  total_results: number
}

interface PromptResult {
  id: string
  prompt_history_id: string
  document_id: string
  document_path: string
  chunk_index: number
  score: number
  content: string
  metadata: string
}

interface PromptHistoryProps {
  repositoryId: string | null
  repositoryName?: string
  onCopyPrompt?: (prompt: string) => void
}

export const PromptHistory: React.FC<PromptHistoryProps> = ({ 
  repositoryId, 
  repositoryName,
  onCopyPrompt 
}) => {
  const [history, setHistory] = useState<PromptHistoryEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<PromptHistoryEntry | null>(null)
  const [results, setResults] = useState<PromptResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showAllRepos, setShowAllRepos] = useState(false)
  const [serverPort, setServerPort] = useState<number>(3989)

  useEffect(() => {
    // Get server port on mount
    const handleServerPort = (port: number) => {
      setServerPort(port)
    }
    
    window.electronAPI.send('get-server-port', null)
    window.electronAPI.on('server-port', handleServerPort)
    
    return () => {
      window.electronAPI.removeListener('server-port', handleServerPort)
    }
  }, [])

  const fetchHistory = async () => {
    // Only skip if we're not showing all repos AND there's no repository selected
    setLoading(true)
    try {
      const url = showAllRepos 
        ? `http://localhost:${serverPort}/prompt-history`
        : `http://localhost:${serverPort}/prompt-history/${repositoryId}`
      
      console.log('[PromptHistory] Fetching from URL:', url)
      const response = await fetch(url)
      const data = await response.json()
      
      console.log('[PromptHistory] Received data:', data)
      if (data.success) {
        setHistory(data.history)
        console.log('[PromptHistory] Set history with', data.history.length, 'entries')
      }
    } catch (error) {
      console.error('Failed to fetch prompt history:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchResults = async (promptId: string) => {
    setLoading(true)
    try {
      const response = await fetch(`http://localhost:${serverPort}/prompt-results/${promptId}`)
      const data = await response.json()
      
      if (data.success) {
        setResults(data.results)
      }
    } catch (error) {
      console.error('Failed to fetch prompt results:', error)
    } finally {
      setLoading(false)
    }
  }

  const searchHistory = async () => {
    if (!searchTerm.trim()) {
      fetchHistory()
      return
    }
    
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: searchTerm })
      if (!showAllRepos && repositoryId) {
        params.append('repositoryId', repositoryId)
      }
      
      const response = await fetch(`http://localhost:${serverPort}/prompt-history/search?${params}`)
      const data = await response.json()
      
      if (data.success) {
        setHistory(data.history)
      }
    } catch (error) {
      console.error('Failed to search prompt history:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    console.log('[PromptHistory] Repository ID or showAllRepos changed, fetching history', repositoryId, showAllRepos, serverPort);
    if (serverPort) {
      fetchHistory()
    }
  }, [repositoryId, showAllRepos, serverPort])

  useEffect(() => {
    if (selectedEntry) {
      fetchResults(selectedEntry.id)
    } else {
      setResults([])
    }
  }, [selectedEntry])

  const handleCopyPrompt = (prompt: string) => {
    if (onCopyPrompt) {
      onCopyPrompt(prompt)
    } else {
      navigator.clipboard.writeText(prompt)
    }
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date)
  }

  const formatOptions = (optionsStr: string) => {
    try {
      const options = JSON.parse(optionsStr)
      return `Top ${options.topK || 5} results`
    } catch {
      return 'Default settings'
    }
  }

  return (
    <div className="prompt-history">
      <div className="history-header">
        <h2>Prompt History</h2>
        <div className="history-controls">
          <label className="show-all-checkbox">
            <input 
              type="checkbox" 
              checked={showAllRepos}
              onChange={(e) => setShowAllRepos(e.target.checked)}
            />
            Show all repositories
          </label>
          <div className="search-box">
            <input
              type="text"
              placeholder="Search prompts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchHistory()}
            />
            <button onClick={searchHistory}>Search</button>
          </div>
        </div>
      </div>

      <div className="history-content">
        <div className="history-list">
          {loading && history.length === 0 ? (
            <div className="loading">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="empty-state">
              No prompt history yet. Start searching to build your history!
            </div>
          ) : (
            history.map((entry) => (
              <div
                key={entry.id}
                className={`history-entry ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
                onClick={() => setSelectedEntry(entry)}
              >
                <div className="entry-header">
                  <span className="entry-time">{formatTimestamp(entry.timestamp)}</span>
                  {showAllRepos && (
                    <span className="entry-repo">{entry.repository_name}</span>
                  )}
                  <span className="entry-results">{entry.total_results} results</span>
                </div>
                <div className="entry-prompt">{entry.prompt}</div>
                <div className="entry-options">{formatOptions(entry.options)}</div>
              </div>
            ))
          )}
        </div>

        <div className="history-details">
          {selectedEntry ? (
            <>
              <div className="details-header">
                <h3>Prompt Details</h3>
                <button 
                  className="copy-prompt-btn"
                  onClick={() => handleCopyPrompt(selectedEntry.prompt)}
                  title="Copy prompt to clipboard"
                >
                  Copy Prompt
                </button>
              </div>
              
              <div className="prompt-info">
                <div className="info-row">
                  <span className="info-label">Prompt:</span>
                  <span className="info-value">{selectedEntry.prompt}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Repository:</span>
                  <span className="info-value">{selectedEntry.repository_name}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Time:</span>
                  <span className="info-value">{new Date(selectedEntry.timestamp).toLocaleString()}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Results:</span>
                  <span className="info-value">{selectedEntry.total_results}</span>
                </div>
              </div>

              <div className="results-section">
                <h4>Search Results</h4>
                {loading && results.length === 0 ? (
                  <div className="loading">Loading results...</div>
                ) : results.length === 0 ? (
                  <div className="no-results">No results found</div>
                ) : (
                  <div className="results-list">
                    {results.map((result, index) => (
                      <div key={result.id} className="result-item">
                        <div className="result-header">
                          <span className="result-number">#{index + 1}</span>
                          <span className="result-path">{result.document_path}</span>
                          <span className="result-score">{result.score.toFixed(3)}</span>
                        </div>
                        <pre className="result-content">{result.content}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-details">
              Select a prompt from the history to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}