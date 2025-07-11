import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  filePath: string
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ filePath }) => {
  const [content, setContent] = useState<string>('')
  const [html, setHtml] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    const handleFileContent = (data: { path: string; content: string | null; error: string | null }) => {
      if (data.path === filePath) {
        setLoading(false)
        if (data.error) {
          setError(data.error)
        } else if (data.content) {
          setContent(data.content)
        }
      }
    }

    window.electronAPI.on('file-content', handleFileContent)
    window.electronAPI.send('read-file', { path: filePath })

    return () => {
      window.electronAPI.removeListener('file-content', handleFileContent)
    }
  }, [filePath])

  useEffect(() => {
    if (content) {
      // Configure marked
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
          },
          heading(text: string, level: number) {
            const anchor = text.toLowerCase().replace(/[^\w]+/g, '-')
            return `<h${level} id="${anchor}">${text}</h${level}>`
          },
          link(href: string, title: string | null, text: string) {
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
      } catch (err) {
        console.error('Markdown parsing error:', err)
        setError('Failed to parse markdown content')
      }
    }
  }, [content])

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
    <div className="markdown-preview">
      <div className="preview-header">
        <div className="file-info">
          <span className="file-icon">📄</span>
          <span className="file-name">{fileName}</span>
        </div>
        <div className="file-path">{filePath}</div>
      </div>
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