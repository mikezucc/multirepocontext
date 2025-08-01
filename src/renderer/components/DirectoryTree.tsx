import React, { useState, useEffect } from 'react'
import { formatCompactTime } from '../utils/timeFormat'
import './DirectoryTree.css'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  isMdgent?: boolean
  modifiedTime?: number
  lastModified?: number
}

interface DirectoryTreeProps {
  repositoryId: string
  onFileSelect?: (path: string) => void
}

const DirectoryTree: React.FC<DirectoryTreeProps> = ({ repositoryId, onFileSelect }) => {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchResults, setSearchResults] = useState<Set<string>>(new Set())
  const [isSearching, setIsSearching] = useState(false)
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [processingPath, setProcessingPath] = useState<string | null>(null)

  useEffect(() => {
    // Reset state
    setLoading(true)
    setError(null)
    setTree([])

        // Set a loading timeout
    const loadingTimeoutId = setTimeout(() => {
      setLoading(false)
      setError('Failed to load directory structure. Repository may not be accessible.')
    }, 5000)

    const handleDirectoryTree = (data: { repositoryId: string, tree: TreeNode[] }) => {
      console.log('DirectoryTree: Received tree data:', data)
      if (data.repositoryId === repositoryId) {
        clearTimeout(loadingTimeoutId)
        setTree(data.tree)
        setLoading(false)
        setError(null)
        // Auto-expand directories with multirepocontext files
        autoExpandMdgentPaths(data.tree)
      }
    }

    window.electronAPI.on('directory-tree', handleDirectoryTree)
    
    // Request directory tree with a small delay to ensure repository is set up
    console.log('DirectoryTree: Requesting tree for repository:', repositoryId)
    console.log('SENDSENDSEND!!! DirectoryTree: Requesting tree for repository:', repositoryId)
    window.electronAPI.send('get-directory-tree', { id: repositoryId })

    return () => {
      // clearTimeout(requestTimeoutId)
      clearTimeout(loadingTimeoutId)
      window.electronAPI.removeListener('directory-tree', handleDirectoryTree)
    }
  }, [repositoryId])

  const autoExpandMdgentPaths = (nodes: TreeNode[], parentPath = '') => {
    const pathsToExpand = new Set<string>()
    
    const findMdgentPaths = (nodes: TreeNode[], currentPath: string) => {
      for (const node of nodes) {
        const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name
        
        if (node.isMdgent) {
          // Expand all parent directories
          let pathParts = nodePath.split('/')
          pathParts.pop() // Remove the file itself
          let path = ''
          for (const part of pathParts) {
            path = path ? `${path}/${part}` : part
            pathsToExpand.add(path)
          }
        }
        
        if (node.children) {
          findMdgentPaths(node.children, nodePath)
        }
      }
    }
    
    findMdgentPaths(nodes, '')
    setExpandedPaths(pathsToExpand)
  }

  const toggleExpand = (path: string) => {
    const newExpanded = new Set(expandedPaths)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedPaths(newExpanded)
  }

  const handleFileClick = (path: string) => {
    setSelectedPath(path)
    if (onFileSelect) {
      onFileSelect(path)
    }
  }

  const handleProcessDirectory = async (dirPath: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent expanding/collapsing the directory
    setProcessingPath(dirPath)
    
    // Send request to process this directory
    window.electronAPI.send('process-directory', { 
      repositoryId, 
      directoryPath: dirPath 
    })
    
    // Clear processing state after 2 seconds
    setTimeout(() => setProcessingPath(null), 2000)
  }

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setIsSearching(query.length > 0)
    
    if (query.length === 0) {
      setSearchResults(new Set())
      return
    }
    
    const results = new Set<string>()
    const searchLower = query.toLowerCase()
    
    const searchNodes = (nodes: TreeNode[], parentPath = '') => {
      for (const node of nodes) {
        const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name
        
        if (node.name.toLowerCase().includes(searchLower)) {
          results.add(nodePath)
          
          // Expand parent directories
          let pathParts = nodePath.split('/')
          pathParts.pop()
          let path = ''
          for (const part of pathParts) {
            path = path ? `${path}/${part}` : part
            expandedPaths.add(path)
          }
        }
        
        if (node.children) {
          searchNodes(node.children, nodePath)
        }
      }
    }
    
    searchNodes(tree)
    setSearchResults(results)
    setExpandedPaths(new Set(expandedPaths))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      const searchInput = document.querySelector('.tree-search-input') as HTMLInputElement
      if (searchInput) {
        searchInput.focus()
      }
    }
  }

  const renderNode = (node: TreeNode, level = 0, parentPath = ''): JSX.Element | null => {
    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name
    const isExpanded = expandedPaths.has(nodePath)
    const isSelected = selectedPath === nodePath
    const isSearchMatch = searchResults.has(nodePath)
    
    // If searching, only show matching nodes and their children
    if (isSearching && node.type === 'file' && !isSearchMatch) {
      return null
    }

    console.log('Rendering node:', nodePath, 'type:', node.type);

    if (node.type === 'directory') {
      const isProcessing = processingPath === node.path
      const isHovered = hoveredPath === nodePath
      
      return (
        <div 
          key={nodePath} 
          className="tree-node"
          onMouseEnter={() => setHoveredPath(nodePath)}
          onMouseLeave={() => setHoveredPath(null)}
        >
          <div
            className={`tree-item directory ${isExpanded ? 'expanded' : ''} ${isSearching && !hasMatchingChildren(node, nodePath) ? 'search-dim' : ''}`}
            style={{ paddingLeft: `${level * 16}px` }}
            onClick={() => toggleExpand(nodePath)}
          >
            <span className="tree-icon">{isExpanded ? '▼' : '▶'}</span>
            <span className="tree-name">{node.name}</span>
            {node.children?.some(child => child.isMdgent) && (
              <span className="has-multirepocontext">●</span>
            )}
            {(isHovered || isProcessing) && (
              <button
                className={`process-dir-btn ${isProcessing ? 'processing' : ''}`}
                onClick={(e) => handleProcessDirectory(node.path, e)}
                title="Generate AI documentation for this directory"
                disabled={isProcessing}
              >
                {isProcessing ? '⏳' : 'Start'}
              </button>
            )}
            {(node.lastModified || node.modifiedTime) && (
              <span className="tree-time">{formatCompactTime(node.lastModified || node.modifiedTime || 0)}</span>
            )}
          </div>
          {isExpanded && node.children && (
            <div className="tree-children" style={{ '--indent-level': level + 1 } as React.CSSProperties}>
              {node.children.map(child => renderNode(child, level + 1, nodePath)).filter(Boolean)}
            </div>
          )}
        </div>
      )
    }

    return (
      <div key={nodePath} className="tree-node">
        <div
          className={`tree-item file ${node.isMdgent ? 'multirepocontext-file' : ''} ${isSelected ? 'selected' : ''} ${isSearchMatch ? 'search-match' : ''}`}
          style={{ paddingLeft: `${level * 16}px` }}
          onClick={() => handleFileClick(node.path)}
        >
          <span className="file-icon">
            {node.isMdgent ? '' : ''}
          </span>
          <span className="tree-name">{node.name}</span>
          {node.modifiedTime && (
            <span className="tree-time">{formatCompactTime(node.modifiedTime)}</span>
          )}
        </div>
      </div>
    )
  }

  const hasMatchingChildren = (node: TreeNode, parentPath: string): boolean => {
    if (!node.children) return false
    
    for (const child of node.children) {
      const childPath = parentPath ? `${parentPath}/${child.name}` : child.name
      if (searchResults.has(childPath)) return true
      if (child.children && hasMatchingChildren(child, childPath)) return true
    }
    
    return false
  }

  return (
    <div className="directory-tree" onKeyDown={handleKeyDown}>
      <div className="tree-search">
        <input
          type="text"
          className="tree-search-input"
          placeholder="Search files... (⌘F)"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />
        {searchQuery && (
          <button
            className="tree-search-clear"
            onClick={() => handleSearch('')}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      <div className="tree-content">
        {loading ? (
          <div className="tree-empty">Loading directory structure...</div>
        ) : error ? (
          <div className="tree-error">{error}</div>
        ) : tree.length === 0 ? (
          <div className="tree-empty">No files found in repository</div>
        ) : (
          tree.map(node => renderNode(node)).filter(Boolean)
        )}
      </div>
    </div>
  )
}

export default DirectoryTree