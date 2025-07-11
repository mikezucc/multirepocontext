import React, { useEffect, useState, useRef } from 'react'
import Prism from 'prismjs'
import '../styles/prism-beige.css'
// Import common language components
// Base languages first (order matters!)
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-css'
// Languages that depend on others
import 'prismjs/components/prism-typescript' // depends on javascript
import 'prismjs/components/prism-jsx' // depends on javascript
import 'prismjs/components/prism-tsx' // depends on typescript
import 'prismjs/components/prism-scss' // depends on css
import 'prismjs/components/prism-cpp' // depends on c
import 'prismjs/components/prism-csharp' // depends on c
// Other languages
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-java'
import './CodePreview.css'

interface CodePreviewProps {
  filePath: string
}

const CodePreview: React.FC<CodePreviewProps> = ({ filePath }) => {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(-1)
  const [totalMatches, setTotalMatches] = useState(0)
  const codeRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setContent('')

    const timeoutId = setTimeout(() => {
      setLoading(false)
      setError('File reading timed out')
    }, 5000)

    const handleFileContent = (data: { path: string; content: string | null; error: string | null }) => {
      if (data.path === filePath) {
        clearTimeout(timeoutId)
        setLoading(false)
        if (data.error) {
          setError(data.error)
        } else if (data.content !== null) {
          setContent(data.content)
        } else {
          setError('File is empty or could not be read')
        }
      }
    }

    window.electronAPI.on('file-content', handleFileContent)
    window.electronAPI.send('read-file', { path: filePath })

    return () => {
      clearTimeout(timeoutId)
      window.electronAPI.removeListener('file-content', handleFileContent)
    }
  }, [filePath])

  // Apply syntax highlighting when content changes
  useEffect(() => {
    if (codeRef.current && content) {
      Prism.highlightElement(codeRef.current)
      if (searchQuery) {
        highlightSearchResults()
      }
    }
  }, [content])

  useEffect(() => {
    if (searchQuery && content) {
      highlightSearchResults()
    } else if (!searchQuery && content) {
      removeHighlights()
    }
  }, [searchQuery, content])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      setIsSearchOpen(true)
      setTimeout(() => searchInputRef.current?.focus(), 0)
    } else if (e.key === 'Escape' && isSearchOpen) {
      setIsSearchOpen(false)
      setSearchQuery('')
      removeHighlights()
    }
  }

  const highlightSearchResults = () => {
    const codeElement = document.querySelector('.code-content code')
    if (!codeElement || !searchQuery) return

    removeHighlights()
    
    let matchCount = 0
    let matches: Range[] = []

    const walkTextNodes = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || ''
        const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
        let match
        
        while ((match = regex.exec(text)) !== null) {
          const range = document.createRange()
          range.setStart(node, match.index)
          range.setEnd(node, match.index + match[0].length)
          matches.push(range)
          matchCount++
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        for (const child of node.childNodes) {
          walkTextNodes(child)
        }
      }
    }

    walkTextNodes(codeElement)
    setTotalMatches(matchCount)

    // Highlight all matches
    matches.forEach((range, index) => {
      const span = document.createElement('span')
      span.className = index === currentMatch ? 'code-search-highlight code-search-highlight-current' : 'code-search-highlight'
      try {
        range.surroundContents(span)
      } catch (e) {
        const contents = range.extractContents()
        span.appendChild(contents)
        range.insertNode(span)
      }
    })

    // Scroll to current match
    if (currentMatch >= 0 && currentMatch < matches.length) {
      const currentHighlight = document.querySelector('.code-search-highlight-current')
      if (currentHighlight) {
        currentHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }

  const removeHighlights = () => {
    const highlights = document.querySelectorAll('.code-search-highlight')
    highlights.forEach(highlight => {
      const parent = highlight.parentNode
      if (parent) {
        while (highlight.firstChild) {
          parent.insertBefore(highlight.firstChild, highlight)
        }
        parent.removeChild(highlight)
      }
    })
  }

  const findNext = () => {
    if (totalMatches === 0) return
    const nextMatch = (currentMatch + 1) % totalMatches
    setCurrentMatch(nextMatch)
    highlightSearchResults()
  }

  const findPrevious = () => {
    if (totalMatches === 0) return
    const prevMatch = currentMatch === 0 ? totalMatches - 1 : currentMatch - 1
    setCurrentMatch(prevMatch)
    highlightSearchResults()
  }

  const getLanguageFromExtension = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase()
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'jsx',
      'ts': 'typescript',
      'tsx': 'tsx',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'fish': 'bash',
      'ps1': 'powershell',
      'r': 'r',
      'sql': 'sql',
      'html': 'html',
      'htm': 'html',
      'xml': 'xml',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      'conf': 'ini',
      'cfg': 'ini',
    }
    return languageMap[ext || ''] || 'plaintext'
  }

  if (loading) {
    return (
      <div className="code-preview loading">
        <div className="loading-spinner"></div>
        <div className="loading-text">Loading file...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="code-preview error">
        <div className="error-icon">⚠</div>
        <div className="error-message">{error}</div>
        <div className="error-path">{filePath}</div>
      </div>
    )
  }

  const fileName = filePath.split('/').pop() || 'Untitled'
  const language = getLanguageFromExtension(filePath)
  const lines = content.split('\n')

  return (
    <div className="code-preview" onKeyDown={handleKeyDown} tabIndex={0}>
      {isSearchOpen && (
        <div className="code-search">
          <input
            ref={searchInputRef}
            type="text"
            className="code-search-input"
            placeholder="Find..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setCurrentMatch(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) {
                  findPrevious()
                } else {
                  findNext()
                }
              }
            }}
          />
          <div className="code-search-actions">
            <button
              className="code-search-btn"
              onClick={findPrevious}
              disabled={totalMatches === 0}
              title="Previous match (Shift+Enter)"
            >
              ↑
            </button>
            <button
              className="code-search-btn"
              onClick={findNext}
              disabled={totalMatches === 0}
              title="Next match (Enter)"
            >
              ↓
            </button>
            <span className="code-match-count">
              {totalMatches > 0 ? `${currentMatch + 1}/${totalMatches}` : 'No results'}
            </span>
            <button
              className="code-search-close"
              onClick={() => {
                setIsSearchOpen(false)
                setSearchQuery('')
                removeHighlights()
              }}
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className="preview-header">
        <div className="file-info">
          <span className="file-icon">📄</span>
          <span className="file-name">{fileName}</span>
          <span className="file-language">{language}</span>
        </div>
        <div className="file-path">{filePath}</div>
      </div>
      <div className="preview-content-code">
        <div className="code-container">
          <div className="line-numbers">
            {lines.map((_, index) => (
              <div key={index} className="line-number">
                {index + 1}
              </div>
            ))}
          </div>
          <pre className="code-content">
            <code ref={codeRef} className={`language-${language}`}>
              {content}
            </code>
          </pre>
        </div>
      </div>
    </div>
  )
}

export default CodePreview