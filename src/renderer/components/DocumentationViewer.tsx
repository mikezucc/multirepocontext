import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import { Repository } from '@shared/types'
import './DocumentationViewer.css'

interface DocumentationViewerProps {
  repository: Repository | null
  documentation: string
}

declare global {
  interface Window {
    electronAPI: {
      send: (channel: string, data: any) => void
      on: (channel: string, callback: Function) => void
      removeListener: (channel: string, callback: Function) => void
    }
  }
}

const DocumentationViewer: React.FC<DocumentationViewerProps> = ({
  repository,
  documentation
}) => {
  const [html, setHtml] = useState('')
  const [currentDoc, setCurrentDoc] = useState(documentation)

  useEffect(() => {
    const handleDocReady = (data: { repositoryId: string, content: string }) => {
      if (repository && data.repositoryId === repository.id) {
        setCurrentDoc(data.content)
      }
    }

    window.electronAPI.on('documentation-ready', handleDocReady)

    return () => {
      window.electronAPI.removeListener('documentation-ready', handleDocReady)
    }
  }, [repository])

  useEffect(() => {
    if (currentDoc) {
      // Configure marked with custom renderer
      marked.use({
        renderer: {
          code(code: string, infostring: string | undefined) {
            const lang = (infostring || '').match(/\S*/)?.[0] || ''
            
            // Escape HTML entities
            const escapedCode = code.replace(/[&<>'"]/g, (char) => {
              const escapeMap: {[key: string]: string} = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
              }
              return escapeMap[char]
            })
            
            // Return formatted code block with language class
            if (lang) {
              return `<pre class="language-${lang}"><code class="language-${lang}">${escapedCode}</code></pre>`
            }
            return `<pre><code>${escapedCode}</code></pre>`
          }
        },
        gfm: true,
        breaks: true
      })

      try {
        const htmlContent = marked.parse(currentDoc)
        setHtml(htmlContent as string)
      } catch (error) {
        console.error('Markdown parsing error:', error)
        setHtml('<p>Error parsing markdown content</p>')
      }
    }
  }, [currentDoc])

  if (!repository) {
    return (
      <div className="documentation-viewer empty">
        <div className="ascii-art">
          <pre>{`
┌─────────────────────────────┐
│                             │
│    Select a repository      │
│    to view documentation    │
│                             │
└─────────────────────────────┘
          `}</pre>
        </div>
      </div>
    )
  }

  if (repository.status === 'scanning' || repository.status === 'analyzing') {
    return (
      <div className="documentation-viewer loading">
        <div className="loading-animation">
          <div className="loading-text">
            Analyzing repository<span className="dots">...</span>
          </div>
          <div className="loading-bar">
            <div className="loading-progress"></div>
          </div>
        </div>
      </div>
    )
  }

  if (repository.status === 'error') {
    return (
      <div className="documentation-viewer error">
        <div className="error-message">
          <span className="error-icon">⚠</span>
          <div className="error-text">
            Error analyzing repository
            {repository.error && <div className="error-detail">{repository.error}</div>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="documentation-viewer">
      {html ? (
        <div 
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="no-content">
          <div className="no-content-message">
            No documentation generated yet
          </div>
        </div>
      )}
    </div>
  )
}

export default DocumentationViewer