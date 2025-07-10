import React, { useState, useEffect } from 'react'
import './SettingsModal.css'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaved, setIsSaved] = useState(false)

  useEffect(() => {
    if (isOpen) {
      window.electronAPI.send('get-api-key', null)
      
      const handleApiKey = (key: string | null) => {
        if (key) setApiKey(key)
      }
      
      window.electronAPI.on('api-key', handleApiKey)
      
      return () => {
        window.electronAPI.removeListener('api-key', handleApiKey)
      }
    }
  }, [isOpen])

  const handleSave = () => {
    setIsLoading(true)
    window.electronAPI.send('set-api-key', { apiKey })
    
    setTimeout(() => {
      setIsLoading(false)
      setIsSaved(true)
      setTimeout(() => {
        setIsSaved(false)
        onClose()
      }, 1000)
    }, 500)
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">SETTINGS</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="setting-group">
            <label className="setting-label">
              ANTHROPIC API KEY
              <span className="setting-hint">Required for code analysis</span>
            </label>
            <input
              type="password"
              className="setting-input"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              disabled={isLoading}
            />
          </div>
          
          <div className="modal-footer">
            <button 
              className="modal-button secondary"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button 
              className="modal-button primary"
              onClick={handleSave}
              disabled={isLoading || !apiKey}
            >
              {isLoading ? 'Saving...' : isSaved ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal