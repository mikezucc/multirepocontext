import React, { useEffect, useState } from 'react'
import './CodePreview.css'

interface CodePreviewProps {
  filePath: string
}

const CodePreview: React.FC<CodePreviewProps> = ({ filePath }) => {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const getLanguageFromExtension = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase()
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
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
    <div className="code-preview">
      <div className="preview-header">
        <div className="file-info">
          <span className="file-icon">📄</span>
          <span className="file-name">{fileName}</span>
          <span className="file-language">{language}</span>
        </div>
        <div className="file-path">{filePath}</div>
      </div>
      <div className="preview-content">
        <div className="code-container">
          <div className="line-numbers">
            {lines.map((_, index) => (
              <div key={index} className="line-number">
                {index + 1}
              </div>
            ))}
          </div>
          <pre className="code-content">
            <code className={`language-${language}`}>
              {content}
            </code>
          </pre>
        </div>
      </div>
    </div>
  )
}

export default CodePreview