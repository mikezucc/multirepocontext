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
  const [modelSettings, setModelSettings] = useState<{
    anthropic?: { model?: string }
    openai?: { model?: string }
    grok?: { model?: string }
  }>({})
  const [useCustomModel, setUseCustomModel] = useState<{
    anthropic?: boolean
    openai?: boolean
    grok?: boolean
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
        setModelSettings(settings.modelSettings || {})
        
        // Check if any models are custom (not in the predefined list)
        const customModels: typeof useCustomModel = {}
        if (settings.modelSettings) {
          Object.entries(settings.modelSettings).forEach(([provider, config]) => {
            if (config?.model) {
              const availableModels = getAvailableModels(provider as AIProvider)
              customModels[provider as AIProvider] = !availableModels.includes(config.model)
            }
          })
        }
        setUseCustomModel(customModels)
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
      apiKeys,
      modelSettings
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

  const updateModel = (providerName: AIProvider, value: string) => {
    if (value === 'custom') {
      setUseCustomModel(prev => ({ ...prev, [providerName]: true }))
      setModelSettings(prev => ({ 
        ...prev, 
        [providerName]: { ...prev[providerName], model: '' }
      }))
    } else {
      setUseCustomModel(prev => ({ ...prev, [providerName]: false }))
      setModelSettings(prev => ({ 
        ...prev, 
        [providerName]: { ...prev[providerName], model: value }
      }))
    }
  }

  const updateCustomModel = (providerName: AIProvider, value: string) => {
    setModelSettings(prev => ({ 
      ...prev, 
      [providerName]: { ...prev[providerName], model: value }
    }))
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

  const getAvailableModels = (providerName: AIProvider): string[] => {
    switch (providerName) {
      case 'anthropic':
        return ['claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-haiku-latest', 'claude-3-5-haiku-latest']
      case 'openai':
        return ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo']
      case 'grok':
        return ['grok-beta', 'grok-2-beta']
      default:
        return []
    }
  }

  const getDefaultModel = (providerName: AIProvider): string => {
    switch (providerName) {
      case 'anthropic':
        return 'claude-3-7-sonnet-latest'
      case 'openai':
        return 'gpt-4o-mini'
      case 'grok':
        return 'grok-beta'
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
          
          <div className="setting-group">
            <label className="setting-label">
              MODEL OVERRIDE
              <span className="setting-hint">Optional: Override the default model for code analysis</span>
            </label>
            {!useCustomModel[provider] ? (
              <select 
                className="setting-input"
                value={modelSettings[provider]?.model || ''}
                onChange={e => updateModel(provider, e.target.value)}
                disabled={isLoading}
              >
                <option value="">Default ({getDefaultModel(provider)})</option>
                {getAvailableModels(provider).map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
                <option value="custom">Custom (enter manually)</option>
              </select>
            ) : (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="text"
                  className="setting-input"
                  style={{ flex: 1 }}
                  value={modelSettings[provider]?.model || ''}
                  onChange={e => updateCustomModel(provider, e.target.value)}
                  placeholder={`Enter custom ${provider} model name`}
                  disabled={isLoading}
                />
                <button
                  className="modal-button secondary"
                  style={{ padding: '8px 16px', minWidth: 'auto' }}
                  onClick={() => updateModel(provider, '')}
                  disabled={isLoading}
                >
                  Back
                </button>
              </div>
            )}
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