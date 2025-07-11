import React, { useState, useEffect } from 'react'
import './DirectoryTree.css'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  isMdgent?: boolean
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
        // Auto-expand directories with mdgent files
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

  const renderNode = (node: TreeNode, level = 0, parentPath = ''): JSX.Element => {
    const nodePath = parentPath ? `${parentPath}/${node.name}` : node.name
    const isExpanded = expandedPaths.has(nodePath)
    const isSelected = selectedPath === nodePath

    if (node.type === 'directory') {
      return (
        <div key={nodePath} className="tree-node">
          <div
            className={`tree-item directory ${isExpanded ? 'expanded' : ''}`}
            style={{ paddingLeft: `${level * 16}px` }}
            onClick={() => toggleExpand(nodePath)}
          >
            <span className="tree-icon">{isExpanded ? '▼' : '▶'}</span>
            <span className="tree-name">{node.name}</span>
            {node.children?.some(child => child.isMdgent) && (
              <span className="has-mdgent">●</span>
            )}
          </div>
          {isExpanded && node.children && (
            <div className="tree-children">
              {node.children.map(child => renderNode(child, level + 1, nodePath))}
            </div>
          )}
        </div>
      )
    }

    return (
      <div key={nodePath} className="tree-node">
        <div
          className={`tree-item file ${node.isMdgent ? 'mdgent-file' : ''} ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${level * 16 + 20}px` }}
          onClick={() => handleFileClick(node.path)}
        >
          <span className="file-icon">
            {node.isMdgent ? '◈' : ''}
          </span>
          <span className="tree-name">{node.name}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="directory-tree">
      <div className="tree-content">
        {loading ? (
          <div className="tree-empty">Loading directory structure...</div>
        ) : error ? (
          <div className="tree-error">{error}</div>
        ) : tree.length === 0 ? (
          <div className="tree-empty">No files found in repository</div>
        ) : (
          tree.map(node => renderNode(node))
        )}
      </div>
    </div>
  )
}

export default DirectoryTree