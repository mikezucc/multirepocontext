import React, { useState, useEffect } from 'react'
import { Search, Database, Clock, FileText, Hash, ChevronRight, ChevronDown } from 'lucide-react'
import './PromptDebugger.css'

declare global {
  interface Window {
    electronAPI: {
      send: (channel: string, data: any) => void
      on: (channel: string, callback: Function) => void
      removeListener: (channel: string, callback: Function) => void
    }
  }
}

interface VectorStats {
  totalDocuments: number
  totalChunks: number
  totalSize: number
  avgChunksPerDocument: number
  avgChunkSize: number
  vectorDimensions: number
  indexedFiles: string[]
  lastUpdated: string | null
}

interface SearchResult {
  documentId: number
  filePath: string
  chunkIndex: number
  content: string
  score: number
  method: 'vector' | 'fts' | 'hybrid'
  metadata: any
}

interface DebugSearchResults {
  query: string
  queryEmbedding?: number[]
  results: SearchResult[]
  timing: {
    embeddingTime: number
    searchTime: number
    totalTime: number
  }
}

interface PromptDebuggerProps {
  repositoryId: string | null
  repositoryName?: string
}

export const PromptDebugger: React.FC<PromptDebuggerProps> = ({ repositoryId, repositoryName }) => {
  const [stats, setStats] = useState<VectorStats | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DebugSearchResults | null>(null)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    stats: true,
    results: true,
    detail: true
  })

  useEffect(() => {
    if (repositoryId) {
      // Reset state when repository changes
      setStats(null)
      setSearchResults(null)
      setSelectedResult(null)
      setQuery('')
      
      // Request vector stats
      window.electronAPI.send('get-vector-stats', { id: repositoryId })
    }
  }, [repositoryId])

  useEffect(() => {
    // Listen for vector stats
    const handleVectorStats = (data: { repositoryId: string, stats: VectorStats | null, error?: string }) => {
      console.log('Renderer: Received vector-stats:', data);
      if (data.error) {
        console.error('Vector stats error:', data.error)
        return
      }
      if (data.repositoryId === repositoryId && data.stats) {
        setStats(data.stats)
      }
    }

    // Listen for search results
    const handleSearchResults = (data: { repositoryId: string, results: DebugSearchResults, error?: string }) => {
      setLoading(false)
      if (data.error) {
        console.error('Search error:', data.error)
        return
      }
      if (data.repositoryId === repositoryId) {
        setSearchResults(data.results)
        if (data.results.results.length > 0) {
          setSelectedResult(data.results.results[0])
        }
      }
    }

    window.electronAPI.on('vector-stats', handleVectorStats)
    window.electronAPI.on('debug-search-results', handleSearchResults)

    return () => {
      window.electronAPI.removeListener('vector-stats', handleVectorStats)
      window.electronAPI.removeListener('debug-search-results', handleSearchResults)
    }
  }, [repositoryId])

  const handleSearch = () => {
    if (!repositoryId || !query.trim()) return
    
    setLoading(true)
    setSearchResults(null)
    setSelectedResult(null)
    window.electronAPI.send('debug-search', { 
      repositoryId, 
      query,
      limit: 20 
    })
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num)
  }

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  if (!repositoryId) {
    return (
      <div className="prompt-debugger-empty-state">
        <div className="prompt-debugger-empty-text">
          <Database className="prompt-debugger-empty-icon" />
          <p>[No repository selected]</p>
        </div>
      </div>
    )
  }

  return (
    <div className="prompt-debugger prompt-debugger-container">
      {/* Header */}
      <div className="prompt-debugger-header">
        <h2 className="prompt-debugger-title">
          Vector Database Debug
          {repositoryName && <span style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}> - {repositoryName}</span>}
        </h2>
      </div>

      {/* Search Bar */}
      <div className="prompt-debugger-search">
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Enter a search query to debug..."
            className="prompt-debugger-search-input"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="prompt-debugger-search-button"
          >
            {loading ? '[◧]' : '[►]'} {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      <div className="prompt-debugger-content">
        {/* Left Panel - Stats and Results List */}
        <div className="prompt-debugger-left-panel">
          {/* Vector Stats Section */}
          {stats && (
            <div className="prompt-debugger-section">
              <button
                onClick={() => toggleSection('stats')}
                className="prompt-debugger-section-header"
              >
                <h3 className="prompt-debugger-section-title">
                  Vector Database Statistics
                </h3>
                {expandedSections.stats ? '[▼]' : '[▶]'}
              </button>
              
              {expandedSections.stats && (
                <div style={{ padding: '16px 16px 16px' }}>
                  <div className="prompt-debugger-stats-grid">
                    <div>
                      <span className="prompt-debugger-stat-label">Documents:</span>
                      <span className="prompt-debugger-stat-value">{formatNumber(stats.totalDocuments)}</span>
                    </div>
                    <div>
                      <span className="prompt-debugger-stat-label">Chunks:</span>
                      <span className="prompt-debugger-stat-value">{formatNumber(stats.totalChunks)}</span>
                    </div>
                    <div>
                      <span className="prompt-debugger-stat-label">Total Size:</span>
                      <span className="prompt-debugger-stat-value">{formatBytes(stats.totalSize)}</span>
                    </div>
                    <div>
                      <span className="prompt-debugger-stat-label">Vector Dims:</span>
                      <span className="prompt-debugger-stat-value">{stats.vectorDimensions}</span>
                    </div>
                    <div>
                      <span className="prompt-debugger-stat-label">Avg Chunks/Doc:</span>
                      <span className="prompt-debugger-stat-value">{stats.avgChunksPerDocument.toFixed(1)}</span>
                    </div>
                    <div>
                      <span className="prompt-debugger-stat-label">Avg Chunk Size:</span>
                      <span className="prompt-debugger-stat-value">{formatBytes(stats.avgChunkSize)}</span>
                    </div>
                  </div>
                  {stats.lastUpdated && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                      Last updated: {new Date(stats.lastUpdated).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search Results Section */}
          {searchResults && (
            <div className="prompt-debugger-section">
              <button
                onClick={() => toggleSection('results')}
                className="prompt-debugger-section-header"
              >
                <h3 className="prompt-debugger-section-title">
                  [◎] Search Results ({searchResults.results.length})
                </h3>
                {expandedSections.results ? '[▼]' : '[▶]'}
              </button>

              {expandedSections.results && (
                <>
                  {/* Timing Info */}
                  <div className="prompt-debugger-timing">
                    <span className="prompt-debugger-timing-item">
                      [⏱] Total: {searchResults.timing.totalTime}ms
                    </span>
                    <span>Embedding: {searchResults.timing.embeddingTime}ms</span>
                    <span>Search: {searchResults.timing.searchTime}ms</span>
                  </div>

                  {/* Results List */}
                  <div>
                    {searchResults.results.map((result, index) => (
                      <div
                        key={`${result.documentId}-${result.chunkIndex}`}
                        onClick={() => setSelectedResult(result)}
                        className={`prompt-debugger-result-item ${selectedResult === result ? 'selected' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="prompt-debugger-file-name">
                                [{result.filePath.split('/').pop()}]
                              </span>
                              <span className="prompt-debugger-chunk-index">
                                #{result.chunkIndex}
                              </span>
                            </div>
                            <p className="prompt-debugger-content-preview">
                              {result.content.substring(0, 150)}...
                            </p>
                          </div>
                          <div style={{ textAlign: 'right', marginLeft: '8px' }}>
                            <div className="prompt-debugger-score">
                              {(result.score * 100).toFixed(1)}%
                            </div>
                            <div className="prompt-debugger-method">
                              {result.method}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right Panel - Result Detail */}
        <div className="prompt-debugger-right-panel">
          {selectedResult ? (
            <div>
              <div className="prompt-debugger-detail-header">
                [■] Result Details
              </div>
              
              <div className="prompt-debugger-detail-content">
                {/* File Info */}
                <div className="prompt-debugger-info-box">
                  <h4 className="prompt-debugger-info-title">
                    [▪] File Information
                  </h4>
                  <div className="prompt-debugger-info-row">
                    <span className="prompt-debugger-info-label">Path:</span>
                    <span className="prompt-debugger-info-value" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {selectedResult.filePath}
                    </span>
                  </div>
                  <div className="prompt-debugger-info-row">
                    <span className="prompt-debugger-info-label">Document ID:</span>
                    <span className="prompt-debugger-info-value">{selectedResult.documentId}</span>
                  </div>
                  <div className="prompt-debugger-info-row">
                    <span className="prompt-debugger-info-label">Chunk Index:</span>
                    <span className="prompt-debugger-info-value">{selectedResult.chunkIndex}</span>
                  </div>
                  <div className="prompt-debugger-info-row">
                    <span className="prompt-debugger-info-label">Score:</span>
                    <span className="prompt-debugger-info-value" style={{ fontWeight: 600 }}>
                      {(selectedResult.score * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="prompt-debugger-info-row">
                    <span className="prompt-debugger-info-label">Search Method:</span>
                    <span className="prompt-debugger-info-value">{selectedResult.method}</span>
                  </div>
                </div>

                {/* Content */}
                <div>
                  <h4 className="prompt-debugger-info-title">
                    [#] Chunk Content
                  </h4>
                  <div className="prompt-debugger-code-block">
                    {selectedResult.content}
                  </div>
                </div>

                {/* Metadata */}
                {selectedResult.metadata && Object.keys(selectedResult.metadata).length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <h4 className="prompt-debugger-info-title">[◊] Metadata</h4>
                    <div className="prompt-debugger-code-block">
                      <pre style={{ margin: 0, fontSize: '12px' }}>
                        {JSON.stringify(selectedResult.metadata, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="prompt-debugger-empty-state">
              <div className="prompt-debugger-empty-text">
                <Search className="prompt-debugger-empty-icon" />
                <p>[Enter a query to see search results]</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}