import React, { useState, useEffect } from 'react'
import './ConfigView.css'

interface ConfigViewProps {
  repositoryId: string | null
  repositoryName?: string
}

export const ConfigView: React.FC<ConfigViewProps> = ({ repositoryId, repositoryName }) => {
  // Default prompt
  const defaultPrompt = `You are a technical Product Manager who is compiling the tribal knowledge of the codebase. Analyze this code file and generate comprehensive documentation that serves to both describe the product and design considerations, as well as the detaield technical specifications.

File: {relativePath}

\`\`\`
{content}
\`\`\`

Please provide:
1. A clear description of the file's purpose and role in the codebase
2. List of all public interfaces, classes, and functions with their signatures
3. Dependencies and imports that other parts of the codebase might need
4. Usage examples if applicable
5. Any important implementation details or design decisions

Format the response as markdown suitable for a README file.`

  const [prompt, setPrompt] = useState(defaultPrompt)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    let cleanup: (() => void) | undefined
    
    const load = async () => {
      cleanup = await loadPromptConfig()
    }
    
    load()
    
    return () => {
      if (cleanup) cleanup()
    }
  }, [])

  const loadPromptConfig = async () => {
    setIsLoading(true)
    try {
      // Set up listener first
      const handlePromptConfig = (data: { prompt: string; error?: string }) => {
        if (data.error) {
          console.error('Failed to load prompt config:', data.error)
          setPrompt(defaultPrompt)
        } else {
          setPrompt(data.prompt || defaultPrompt)
        }
        setIsLoading(false)
      }
      
      window.electronAPI.on('prompt-config', handlePromptConfig)
      
      // Request the config
      window.electronAPI.send('get-prompt-config', {})
      
      // Set a timeout to ensure loading state is cleared
      const timeoutId = setTimeout(() => {
        setIsLoading(false)
      }, 1000)
      
      // Clean up listener on unmount
      return () => {
        clearTimeout(timeoutId)
        window.electronAPI.removeListener('prompt-config', handlePromptConfig)
      }
    } catch (error) {
      console.error('Failed to load prompt config:', error)
      setPrompt(defaultPrompt)
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage('')
    
    const handleSaveResponse = (data: { success: boolean; error?: string }) => {
      if (data.success) {
        setSaveMessage('Prompt saved successfully!')
        setTimeout(() => setSaveMessage(''), 3000)
      } else {
        setSaveMessage(data.error || 'Failed to save prompt. Please try again.')
      }
      setIsSaving(false)
      window.electronAPI.removeListener('prompt-config-saved', handleSaveResponse)
    }
    
    try {
      window.electronAPI.on('prompt-config-saved', handleSaveResponse)
      window.electronAPI.send('save-prompt-config', { prompt })
    } catch (error) {
      console.error('Failed to save prompt:', error)
      setSaveMessage('Failed to save prompt. Please try again.')
      setIsSaving(false)
      window.electronAPI.removeListener('prompt-config-saved', handleSaveResponse)
    }
  }

  const handleReset = () => {
    setPrompt(defaultPrompt)
  }

  return (
    <div className="config-view">
      <div className="config-header">
        <h2>Configuration</h2>
        <p className="config-description">
          Customize the prompt used for generating documentation when analyzing code files.
        </p>
      </div>

      <div className="config-content">
        <div className="prompt-section">
          <div className="prompt-header">
            <h3>Documentation Generation Prompt</h3>
            <div className="prompt-actions">
              <button 
                className="reset-btn"
                onClick={handleReset}
                disabled={isLoading || isSaving}
              >
                Reset to Default
              </button>
              <button 
                className="save-btn"
                onClick={handleSave}
                disabled={isLoading || isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>

          {saveMessage && (
            <div className={`save-message ${saveMessage.includes('Failed') ? 'error' : 'success'}`}>
              {saveMessage}
            </div>
          )}

          <div className="prompt-info">
            <p>Available variables:</p>
            <ul>
              <li><code>{'{relativePath}'}</code> - The relative path of the file being analyzed</li>
              <li><code>{'{content}'}</code> - The content of the file being analyzed</li>
            </ul>
          </div>

          <textarea
            className="prompt-editor"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your custom prompt here..."
            disabled={isLoading || isSaving}
            spellCheck={false}
          />
        </div>

        <div className="additional-settings">
          <h3>Additional Settings</h3>
          <p className="coming-soon">More configuration options coming soon...</p>
        </div>
      </div>
    </div>
  )
}