import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import Prism from 'prismjs'
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
      const renderer = new marked.Renderer()
      
      renderer.code = function(code, language) {
        if (language && Prism.languages[language]) {
          const highlighted = Prism.highlight(code, Prism.languages[language], language)
          return `<pre class="language-${language}"><code class="language-${language}">${highlighted}</code></pre>`
        }
        return `<pre><code>${code}</code></pre>`
      }

      marked.setOptions({
        renderer,
        gfm: true,
        breaks: true
      })

      const htmlContent = marked(currentDoc)
      setHtml(htmlContent as string)
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