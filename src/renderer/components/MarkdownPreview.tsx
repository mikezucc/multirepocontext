import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import Prism from 'prismjs'
import '../styles/prism-beige.css'
// Import common language components for markdown code blocks
// Base languages first
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-css'
// Languages that depend on others
import 'prismjs/components/prism-typescript' // depends on javascript
import 'prismjs/components/prism-jsx' // depends on javascript
import 'prismjs/components/prism-tsx' // depends on typescript
// Other languages
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
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
    console.log('MarkdownPreview: Loading file:', filePath)
    setLoading(true)
    setError(null)
    setContent('') // Reset content when file changes
    setHtml('') // Reset HTML too

    // Create a timeout to handle the case where no response is received
    const timeoutId = setTimeout(() => {
      console.log('MarkdownPreview: Timeout reached for file:', filePath)
      setLoading(false)
      setError('File reading timed out. The file may not be accessible.')
    }, 5000)

    const handleFileContent = (data: { path: string; content: string | null; error: string | null }) => {
      console.log('MarkdownPreview: Received file-content event:', data.path, 'matches:', data.path === filePath)
      if (data.path === filePath) {
        clearTimeout(timeoutId)
        setLoading(false)
        if (data.error) {
          console.error('MarkdownPreview: Error loading file:', data.error)
          setError(data.error)
        } else if (data.content !== null && data.content !== undefined) {
          console.log('MarkdownPreview: Content received, length:', data.content.length)
          setContent(data.content)
        } else {
          console.log('MarkdownPreview: No content received')
          setError('File is empty or could not be read')
        }
      }
    }

    window.electronAPI.on('file-content', handleFileContent)
    
    // Small delay to ensure the listener is set up before sending the request
    const requestId = setTimeout(() => {
      console.log('MarkdownPreview: Sending read-file request for:', filePath)
      window.electronAPI.send('read-file', { path: filePath })
    }, 50)

    return () => {
      console.log('MarkdownPreview: Cleaning up listener for:', filePath)
      clearTimeout(timeoutId)
      clearTimeout(requestId)
      window.electronAPI.removeListener('file-content', handleFileContent)
    }
  }, [filePath])

  useEffect(() => {
    console.log('MarkdownPreview: Content changed, length:', content.length)
    if (content) {
      // Configure marked
      marked.use({
        renderer: {
          code(this: any, { text, lang }: { text: string; lang?: string }) {
            const language = lang || ''
            
            // Escape HTML entities
            const escapedCode = text.replace(/[&<>'"]/g, (char) => {
              const escapeMap: {[key: string]: string} = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
              }
              return escapeMap[char]
            })
            
            // Return formatted code block with language class for Prism
            if (language) {
              return `<pre class="language-${language}"><code class="language-${language}">${escapedCode}</code></pre>`
            }
            return `<pre class="language-plaintext"><code class="language-plaintext">${escapedCode}</code></pre>`
          },
          heading(this: any, { text, depth }: { text: string; depth: number }) {
            const textStr = String(text)
            const anchor = textStr.toLowerCase().replace(/[^\w]+/g, '-')
            return `<h${depth} id="${anchor}">${text}</h${depth}>`
          },
          link(this: any, { href, title, text }: { href: string; title?: string | null; text: string }) {
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
        // Apply syntax highlighting after a small delay to ensure DOM is updated
        setTimeout(() => {
          Prism.highlightAll()
        }, 0)
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