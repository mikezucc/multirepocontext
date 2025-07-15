import React, { useState, useEffect } from 'react'
import './SettingsModal.css'
import { AIProvider, AIProviderSettings } from '../../shared/types/aiProvider'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [provider, setProvider] = useState<AIProvider>('anthropic')
  const [apiKeys, setApiKeys] = useState<{
    anthropic?: string
    openai?: string
    grok?: string
  }>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isSaved, setIsSaved] = useState(false)

  useEffect(() => {
    if (isOpen) {
      // Get provider settings instead of just API key
      window.electronAPI.send('get-provider-settings', null)
      
      const handleProviderSettings = (settings: AIProviderSettings) => {
        setProvider(settings.provider || 'anthropic')
        setApiKeys(settings.apiKeys || {})
      }
      
      window.electronAPI.on('provider-settings', handleProviderSettings)
      
      // Also get legacy API key for backward compatibility
      window.electronAPI.send('get-api-key', null)
      const handleApiKey = (key: string | null) => {
        if (key && !apiKeys.anthropic) {
          setApiKeys(prev => ({ ...prev, anthropic: key }))
        }
      }
      window.electronAPI.on('api-key', handleApiKey)
      
      return () => {
        window.electronAPI.removeListener('provider-settings', handleProviderSettings)
        window.electronAPI.removeListener('api-key', handleApiKey)
      }
    }
  }, [isOpen])

  const handleSave = () => {
    setIsLoading(true)
    
    // Save provider settings
    const settings: AIProviderSettings = {
      provider,
      apiKeys
    }
    window.electronAPI.send('set-provider-settings', settings)
    
    // Also save to legacy API key field for backward compatibility
    if (apiKeys.anthropic) {
      window.electronAPI.send('set-api-key', { apiKey: apiKeys.anthropic })
    }
    
    setTimeout(() => {
      setIsLoading(false)
      setIsSaved(true)
      setTimeout(() => {
        setIsSaved(false)
        onClose()
      }, 1000)
    }, 500)
  }

  const updateApiKey = (providerName: AIProvider, value: string) => {
    setApiKeys(prev => ({ ...prev, [providerName]: value }))
  }

  const getPlaceholder = (providerName: AIProvider): string => {
    switch (providerName) {
      case 'anthropic':
        return 'sk-ant-...'
      case 'openai':
        return 'sk-...'
      case 'grok':
        return 'xai-...'
    }
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
              AI PROVIDER
              <span className="setting-hint">Select which AI service to use for code analysis</span>
            </label>
            <select 
              className="setting-input"
              value={provider}
              onChange={e => setProvider(e.target.value as AIProvider)}
              disabled={isLoading}
            >
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai">OpenAI GPT</option>
              <option value="grok">Grok</option>
            </select>
          </div>
          
          <div className="setting-group">
            <label className="setting-label">
              {provider.toUpperCase()} API KEY
              <span className="setting-hint">Required for the selected provider</span>
            </label>
            <input
              type="password"
              className="setting-input"
              value={apiKeys[provider] || ''}
              onChange={e => updateApiKey(provider, e.target.value)}
              placeholder={getPlaceholder(provider)}
              disabled={isLoading}
            />
          </div>
          
          {provider !== 'anthropic' && apiKeys.anthropic && (
            <div className="setting-group">
              <label className="setting-label">
                ANTHROPIC API KEY
                <span className="setting-hint">Previously configured</span>
              </label>
              <input
                type="password"
                className="setting-input"
                value={apiKeys.anthropic || ''}
                onChange={e => updateApiKey('anthropic', e.target.value)}
                placeholder="sk-ant-..."
                disabled={isLoading}
              />
            </div>
          )}
          
          {provider !== 'openai' && apiKeys.openai && (
            <div className="setting-group">
              <label className="setting-label">
                OPENAI API KEY
                <span className="setting-hint">Previously configured</span>
              </label>
              <input
                type="password"
                className="setting-input"
                value={apiKeys.openai || ''}
                onChange={e => updateApiKey('openai', e.target.value)}
                placeholder="sk-..."
                disabled={isLoading}
              />
            </div>
          )}
          
          {provider !== 'grok' && apiKeys.grok && (
            <div className="setting-group">
              <label className="setting-label">
                GROK API KEY
                <span className="setting-hint">Previously configured</span>
              </label>
              <input
                type="password"
                className="setting-input"
                value={apiKeys.grok || ''}
                onChange={e => updateApiKey('grok', e.target.value)}
                placeholder="xai-..."
                disabled={isLoading}
              />
            </div>
          )}
          
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
              disabled={isLoading || !apiKeys[provider]}
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