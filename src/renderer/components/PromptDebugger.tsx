import React, { useState, useEffect } from 'react'
import { Search, Database, Clock, FileText, Hash, ChevronRight, ChevronDown } from 'lucide-react'

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
      // Request vector stats
      window.electronAPI.send('get-vector-stats', { id: repositoryId })
    }
  }, [repositoryId])

  useEffect(() => {
    // Listen for vector stats
    const handleVectorStats = (_: any, data: { repositoryId: string, stats: VectorStats }) => {
      if (data.repositoryId === repositoryId) {
        setStats(data.stats)
      }
    }

    // Listen for search results
    const handleSearchResults = (_: any, data: { repositoryId: string, results: DebugSearchResults, error?: string }) => {
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
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Select a repository to view vector statistics</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Database className="w-5 h-5" />
          Vector Database Debug
          {repositoryName && <span className="text-gray-500 font-normal">- {repositoryName}</span>}
        </h2>
      </div>

      {/* Search Bar */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Enter a search query to debug..."
            className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Search className="w-4 h-4" />
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Stats and Results List */}
        <div className="w-1/2 border-r bg-white overflow-y-auto">
          {/* Vector Stats Section */}
          {stats && (
            <div className="border-b">
              <button
                onClick={() => toggleSection('stats')}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
              >
                <h3 className="font-medium flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Vector Database Statistics
                </h3>
                {expandedSections.stats ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              
              {expandedSections.stats && (
                <div className="px-4 pb-4 space-y-2">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Documents:</span>
                      <span className="ml-2 font-medium">{formatNumber(stats.totalDocuments)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Chunks:</span>
                      <span className="ml-2 font-medium">{formatNumber(stats.totalChunks)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Total Size:</span>
                      <span className="ml-2 font-medium">{formatBytes(stats.totalSize)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Vector Dims:</span>
                      <span className="ml-2 font-medium">{stats.vectorDimensions}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Avg Chunks/Doc:</span>
                      <span className="ml-2 font-medium">{stats.avgChunksPerDocument.toFixed(1)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Avg Chunk Size:</span>
                      <span className="ml-2 font-medium">{formatBytes(stats.avgChunkSize)}</span>
                    </div>
                  </div>
                  {stats.lastUpdated && (
                    <div className="text-sm text-gray-500 mt-2">
                      Last updated: {new Date(stats.lastUpdated).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search Results Section */}
          {searchResults && (
            <div>
              <button
                onClick={() => toggleSection('results')}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50"
              >
                <h3 className="font-medium flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  Search Results ({searchResults.results.length})
                </h3>
                {expandedSections.results ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>

              {expandedSections.results && (
                <>
                  {/* Timing Info */}
                  <div className="px-4 pb-2 flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Total: {searchResults.timing.totalTime}ms
                    </span>
                    <span>Embedding: {searchResults.timing.embeddingTime}ms</span>
                    <span>Search: {searchResults.timing.searchTime}ms</span>
                  </div>

                  {/* Results List */}
                  <div className="divide-y">
                    {searchResults.results.map((result, index) => (
                      <div
                        key={`${result.documentId}-${result.chunkIndex}`}
                        onClick={() => setSelectedResult(result)}
                        className={`px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                          selectedResult === result ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-sm">
                              <FileText className="w-4 h-4 text-gray-400" />
                              <span className="font-medium truncate">
                                {result.filePath.split('/').pop()}
                              </span>
                              <span className="text-gray-500">
                                #{result.chunkIndex}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                              {result.content.substring(0, 150)}...
                            </p>
                          </div>
                          <div className="ml-2 text-right">
                            <div className="text-sm font-medium text-blue-600">
                              {(result.score * 100).toFixed(1)}%
                            </div>
                            <div className="text-xs text-gray-500">
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
        <div className="flex-1 bg-white overflow-y-auto">
          {selectedResult ? (
            <div>
              <div className="px-4 py-3 border-b">
                <h3 className="font-medium">Result Details</h3>
              </div>
              
              <div className="p-4 space-y-4">
                {/* File Info */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    File Information
                  </h4>
                  <div className="space-y-1 text-sm">
                    <div>
                      <span className="text-gray-500">Path:</span>
                      <span className="ml-2 font-mono text-xs">{selectedResult.filePath}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Document ID:</span>
                      <span className="ml-2">{selectedResult.documentId}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Chunk Index:</span>
                      <span className="ml-2">{selectedResult.chunkIndex}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Score:</span>
                      <span className="ml-2 font-medium text-blue-600">
                        {(selectedResult.score * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Search Method:</span>
                      <span className="ml-2">{selectedResult.method}</span>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Hash className="w-4 h-4" />
                    Chunk Content
                  </h4>
                  <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap">
                    {selectedResult.content}
                  </div>
                </div>

                {/* Metadata */}
                {selectedResult.metadata && Object.keys(selectedResult.metadata).length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Metadata</h4>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <pre className="text-sm overflow-x-auto">
                        {JSON.stringify(selectedResult.metadata, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Search className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Enter a query to see search results</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}