import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import Prism from 'prismjs'
import '../styles/prism-beige.css'
// Import common language components for markdown code blocks
// Base languages first
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-css'
// Languages that depend on others
import 'prismjs/components/prism-typescript' // depends on javascript
import 'prismjs/components/prism-jsx' // depends on javascript
import 'prismjs/components/prism-tsx' // depends on typescript
// Other languages
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  filePath: string
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ filePath }) => {
  const [content, setContent] = useState<string>('')
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(-1)
  const [totalMatches, setTotalMatches] = useState(0)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  useEffect(() => {
    console.log('MarkdownPreview: Loading file:', filePath)
    setLoading(true)
    setError(null)
    setContent('') // Reset content when file changes
    setHtml('') // Reset HTML too

    // Create a timeout to handle the case where no response is received
    const timeoutId = setTimeout(() => {
      console.log('MarkdownPreview: Timeout reached for file:', filePath)
      setLoading(false)
      setError('File reading timed out. The file may not be accessible.')
    }, 5000)

    const handleFileContent = (data: { path: string; content: string | null; error: string | null }) => {
      console.log('MarkdownPreview: Received file-content event:', data.path, 'matches:', data.path === filePath)
      if (data.path === filePath) {
        clearTimeout(timeoutId)
        setLoading(false)
        if (data.error) {
          console.error('MarkdownPreview: Error loading file:', data.error)
          setError(data.error)
        } else if (data.content !== null && data.content !== undefined) {
          console.log('MarkdownPreview: Content received, length:', data.content.length)
          setContent(data.content)
        } else {
          console.log('MarkdownPreview: No content received')
          setError('File is empty or could not be read')
        }
      }
    }

    window.electronAPI.on('file-content', handleFileContent)
    
    // Small delay to ensure the listener is set up before sending the request
    const requestId = setTimeout(() => {
      console.log('MarkdownPreview: Sending read-file request for:', filePath)
      window.electronAPI.send('read-file', { path: filePath })
    }, 50)

    return () => {
      console.log('MarkdownPreview: Cleaning up listener for:', filePath)
      clearTimeout(timeoutId)
      clearTimeout(requestId)
      window.electronAPI.removeListener('file-content', handleFileContent)
    }
  }, [filePath])

  useEffect(() => {
    console.log('MarkdownPreview: Content changed, length:', content.length)
    if (content) {
      // Configure marked
      marked.use({
        renderer: {
          code(this: any, { text, lang }: { text: string; lang?: string }) {
            const language = lang || ''
            
            // Escape HTML entities
            const escapedCode = text.replace(/[&<>'"]/g, (char) => {
              const escapeMap: {[key: string]: string} = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
              }
              return escapeMap[char]
            })
            
            // Return formatted code block with language class for Prism
            if (language) {
              return `<pre class="language-${language}"><code class="language-${language}">${escapedCode}</code></pre>`
            }
            return `<pre class="language-plaintext"><code class="language-plaintext">${escapedCode}</code></pre>`
          },
          heading(this: any, { text, depth }: { text: string; depth: number }) {
            const textStr = String(text)
            const anchor = textStr.toLowerCase().replace(/[^\w]+/g, '-')
            return `<h${depth} id="${anchor}">${text}</h${depth}>`
          },
          link(this: any, { href, title, text }: { href: string; title?: string | null; text: string }) {
            const titleAttr = title ? ` title="${title}"` : ''
            return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
          }
        },
        gfm: true,
        breaks: true
      })

      try {
        const htmlContent = marked.parse(content)
        setHtml(htmlContent as string)
        // Apply syntax highlighting after a small delay to ensure DOM is updated
        setTimeout(() => {
          Prism.highlightAll()
          if (searchQuery) {
            highlightSearchResults()
          }
        }, 0)
      } catch (err) {
        console.error('Markdown parsing error:', err)
        setError('Failed to parse markdown content')
      }
    }
  }, [content])

  useEffect(() => {
    if (searchQuery && html) {
      highlightSearchResults()
    } else if (!searchQuery && html) {
      removeHighlights()
    }
  }, [searchQuery, html])

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
    const contentElement = document.querySelector('.markdown-rendered')
    if (!contentElement || !searchQuery) return

    removeHighlights()
    
    const searchRegex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
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
      } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName !== 'SCRIPT' && node.nodeName !== 'STYLE') {
        for (const child of node.childNodes) {
          walkTextNodes(child)
        }
      }
    }

    walkTextNodes(contentElement)
    setTotalMatches(matchCount)

    // Highlight all matches
    matches.forEach((range, index) => {
      const span = document.createElement('span')
      span.className = index === currentMatch ? 'search-highlight search-highlight-current' : 'search-highlight'
      span.dataset.matchIndex = String(index)
      try {
        range.surroundContents(span)
      } catch (e) {
        // Handle cases where the range spans multiple elements
        const contents = range.extractContents()
        span.appendChild(contents)
        range.insertNode(span)
      }
    })

    // Scroll to current match
    if (currentMatch >= 0 && currentMatch < matches.length) {
      const currentHighlight = document.querySelector('.search-highlight-current')
      if (currentHighlight) {
        currentHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }

  const removeHighlights = () => {
    const highlights = document.querySelectorAll('.search-highlight')
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
    // Refocus the search input to maintain highlighting
    const searchInput = document.querySelector('.preview-search-input') as HTMLInputElement
    if (searchInput) searchInput.focus()
  }

  const findPrevious = () => {
    if (totalMatches === 0) return
    const prevMatch = currentMatch === 0 ? totalMatches - 1 : currentMatch - 1
    setCurrentMatch(prevMatch)
    highlightSearchResults()
    // Refocus the search input to maintain highlighting
    const searchInput = document.querySelector('.preview-search-input') as HTMLInputElement
    if (searchInput) searchInput.focus()
  }

  if (loading) {
    return (
      <div className="markdown-preview loading">
        <div className="loading-spinner"></div>
        <div className="loading-text">Loading file...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="markdown-preview error">
        <div className="error-icon">⚠</div>
        <div className="error-message">{error}</div>
        <div className="error-path">{filePath}</div>
      </div>
    )
  }

  const fileName = filePath.split('/').pop() || 'Untitled'

  return (
    <div className="markdown-preview" onKeyDown={handleKeyDown} tabIndex={0}>
      {isSearchOpen && (
        <div className="preview-search">
          <input
            ref={searchInputRef}
            type="text"
            className="preview-search-input"
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
          <div className="preview-search-actions">
            <button
              className="preview-search-btn"
              onClick={findPrevious}
              disabled={totalMatches === 0}
              title="Previous match (Shift+Enter)"
            >
              ↑
            </button>
            <button
              className="preview-search-btn"
              onClick={findNext}
              disabled={totalMatches === 0}
              title="Next match (Enter)"
            >
              ↓
            </button>
            <span className="preview-match-count">
              {totalMatches > 0 ? `${currentMatch + 1}/${totalMatches}` : 'No results'}
            </span>
            <button
              className="preview-search-close"
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
      <div className="preview-content">
        <div 
          className="markdown-rendered"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}

export default MarkdownPreview