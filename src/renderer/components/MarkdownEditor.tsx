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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setEditContent(content)
    setIsDirty(false)
  }, [content, filePath])

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
    }
  }

  const fileName = filePath.split('/').pop() || 'Untitled'

  return (
    <div className="markdown-editor">
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
          placeholder="Start typing your markdown..."
          spellCheck={false}
        />
      </div>
    </div>
  )
}

export default MarkdownEditor