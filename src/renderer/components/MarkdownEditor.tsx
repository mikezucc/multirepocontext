import React, { useState, useEffect, useRef } from 'react'
import './MarkdownEditor.css'

interface MarkdownEditorProps {
  filePath: string
  content: string
  onSave: (content: string) => void
  onCancel?: () => void
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ filePath, content, onSave, onCancel }) => {
  const [editContent, setEditContent] = useState(content)
  const [isDirty, setIsDirty] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(-1)
  const [totalMatches, setTotalMatches] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEditContent(content)
    setIsDirty(false)
    setIsSearchOpen(false)
    setSearchQuery('')
    setReplaceQuery('')
    setCurrentMatch(-1)
    setTotalMatches(0)
  }, [content, filePath])

  useEffect(() => {
    if (searchQuery && textareaRef.current) {
      const matches = editContent.toLowerCase().split(searchQuery.toLowerCase()).length - 1
      setTotalMatches(matches)
      if (matches > 0 && currentMatch === -1) {
        setCurrentMatch(0)
        highlightMatch(0)
      }
    } else {
      setTotalMatches(0)
      setCurrentMatch(-1)
    }
  }, [searchQuery, editContent])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditContent(e.target.value)
    setIsDirty(true)
  }

  const handleSave = () => {
    onSave(editContent)
    setIsDirty(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey && e.key === 's') {
      e.preventDefault()
      handleSave()
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      setIsSearchOpen(true)
      setTimeout(() => searchInputRef.current?.focus(), 0)
    } else if (e.key === 'Escape' && isSearchOpen) {
      setIsSearchOpen(false)
      textareaRef.current?.focus()
    }
  }

  const highlightMatch = (matchIndex: number) => {
    if (!textareaRef.current || !searchQuery) return
    
    const text = editContent.toLowerCase()
    const searchLower = searchQuery.toLowerCase()
    let currentIndex = 0
    let foundIndex = 0
    
    while (foundIndex <= matchIndex) {
      const index = text.indexOf(searchLower, currentIndex)
      if (index === -1) break
      
      if (foundIndex === matchIndex) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(index, index + searchQuery.length)
        // Scroll to selection
        const lineHeight = 20
        const lines = editContent.substring(0, index).split('\n').length
        textareaRef.current.scrollTop = (lines - 10) * lineHeight
        break
      }
      
      currentIndex = index + 1
      foundIndex++
    }
  }

  const findNext = () => {
    if (totalMatches === 0) return
    const nextMatch = (currentMatch + 1) % totalMatches
    setCurrentMatch(nextMatch)
    highlightMatch(nextMatch)
    // Refocus the search input to maintain highlighting
    const searchInput = document.querySelector('.editor-search-input') as HTMLInputElement
    if (searchInput) searchInput.focus()
  }

  const findPrevious = () => {
    if (totalMatches === 0) return
    const prevMatch = currentMatch === 0 ? totalMatches - 1 : currentMatch - 1
    setCurrentMatch(prevMatch)
    highlightMatch(prevMatch)
    // Refocus the search input to maintain highlighting
    const searchInput = document.querySelector('.editor-search-input') as HTMLInputElement
    if (searchInput) searchInput.focus()
  }

  const replaceOne = () => {
    if (!searchQuery || currentMatch === -1) return
    
    const text = editContent
    const searchLower = searchQuery.toLowerCase()
    const textLower = text.toLowerCase()
    let currentIndex = 0
    let foundIndex = 0
    
    while (foundIndex <= currentMatch) {
      const index = textLower.indexOf(searchLower, currentIndex)
      if (index === -1) break
      
      if (foundIndex === currentMatch) {
        const newContent = text.substring(0, index) + replaceQuery + text.substring(index + searchQuery.length)
        setEditContent(newContent)
        setIsDirty(true)
        break
      }
      
      currentIndex = index + 1
      foundIndex++
    }
  }

  const replaceAll = () => {
    if (!searchQuery) return
    
    const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    const newContent = editContent.replace(regex, replaceQuery)
    setEditContent(newContent)
    setIsDirty(true)
    setSearchQuery('')
  }

  const fileName = filePath.split('/').pop() || 'Untitled'

  return (
    <div className="markdown-editor">
      {isSearchOpen && (
        <div className="editor-search">
          <div className="search-row">
            <input
              ref={searchInputRef}
              type="text"
              className="search-input"
              placeholder="Find"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
            <input
              type="text"
              className="search-input"
              placeholder="Replace"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  replaceOne()
                }
              }}
            />
            <div className="search-actions">
              <button
                className="search-btn"
                onClick={findPrevious}
                disabled={totalMatches === 0}
                title="Previous match (Shift+Enter)"
              >
                ↑
              </button>
              <button
                className="search-btn"
                onClick={findNext}
                disabled={totalMatches === 0}
                title="Next match (Enter)"
              >
                ↓
              </button>
              <span className="match-count">
                {totalMatches > 0 ? `${currentMatch + 1}/${totalMatches}` : 'No results'}
              </span>
              <button
                className="search-btn replace-btn"
                onClick={replaceOne}
                disabled={totalMatches === 0}
                title="Replace"
              >
                Replace
              </button>
              <button
                className="search-btn replace-btn"
                onClick={replaceAll}
                disabled={totalMatches === 0}
                title="Replace All"
              >
                Replace All
              </button>
              <button
                className="search-close"
                onClick={() => {
                  setIsSearchOpen(false)
                  textareaRef.current?.focus()
                }}
                title="Close (Esc)"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="editor-header">
        <div className="file-info">
          <span className="file-icon">📝</span>
          <span className="file-name">{fileName}</span>
          {isDirty && <span className="dirty-indicator">●</span>}
        </div>
        <div className="editor-actions">
          {onCancel && (
            <button 
              className="cancel-btn" 
              onClick={onCancel}
            >
              Back to Preview
            </button>
          )}
          <button 
            className="save-btn" 
            onClick={handleSave}
            disabled={!isDirty}
          >
            Save (⌘S)
          </button>
        </div>
      </div>
      <div className="editor-content">
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          value={editContent}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Start typing your markdown... (⌘F to search)"
          spellCheck={false}
        />
      </div>
    </div>
  )
}

export default MarkdownEditor