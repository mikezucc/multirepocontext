import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import { Repository } from '@shared/types'
import DirectoryTree from './DirectoryTree'
import MarkdownPreview from './MarkdownPreview'
import MarkdownEditor from './MarkdownEditor'
import CodePreview from './CodePreview'
import { ResizablePane } from '../../components/ResizablePane'
import '../../components/ResizablePane.css'
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
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [showTree, setShowTree] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [fileContent, setFileContent] = useState<string>('')

  // Load file content when a markdown file is selected
  useEffect(() => {
    if (selectedFile && (selectedFile.endsWith('.md') || selectedFile.endsWith('.multirepocontext'))) {
      window.electronAPI.send('read-file', { path: selectedFile })
    }
  }, [selectedFile])

  // Reset edit mode when file changes
  useEffect(() => {
    setEditMode(false)
  }, [selectedFile])

  useEffect(() => {
    const handleDocReady = (data: { repositoryId: string, content: string }) => {
      if (repository && data.repositoryId === repository.id) {
        setCurrentDoc(data.content)
      }
    }

    const handleFileContent = (data: { path: string; content: string | null; error: string | null }) => {
      if (data.path === selectedFile && data.content !== null) {
        setFileContent(data.content)
      }
    }

    const handleFileSaved = (data: { path: string; success: boolean; error?: string }) => {
      if (data.path === selectedFile && data.success) {
        // File saved successfully
        console.log('File saved successfully')
      }
    }

    window.electronAPI.on('documentation-ready', handleDocReady)
    window.electronAPI.on('file-content', handleFileContent)
    window.electronAPI.on('file-saved', handleFileSaved)

    return () => {
      window.electronAPI.removeListener('documentation-ready', handleDocReady)
      window.electronAPI.removeListener('file-content', handleFileContent)
      window.electronAPI.removeListener('file-saved', handleFileSaved)
    }
  }, [repository, selectedFile])

  useEffect(() => {
    if (currentDoc) {
      // Configure marked with custom renderer
      marked.use({
        renderer: {
          code(this: any, codeOrToken: any, infostring?: string | undefined) {
            const code = typeof codeOrToken === 'string' ? codeOrToken : codeOrToken.text;
            const language = typeof codeOrToken === 'string' ? infostring : codeOrToken.lang;
            const lang = (language || infostring || '').match(/\S*/)?.[0] || ''
            
            // Escape HTML entities
            const escapedCode = code.replace(/[&<>'"]/g, (char: string) => {
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

  const handleSaveFile = (content: string) => {
    if (selectedFile) {
      window.electronAPI.send('save-file', { path: selectedFile, content })
    }
  }

  const renderFileContent = () => {
    if (!selectedFile) return null

    const isMarkdown = selectedFile.endsWith('.md') || selectedFile.endsWith('.multirepocontext')
    
    if (isMarkdown && editMode) {
      return <MarkdownEditor filePath={selectedFile} content={fileContent} onSave={handleSaveFile} />
    } else if (isMarkdown) {
      return (
        <div className="preview-with-controls">
          <div className="preview-controls">
            <button className="edit-btn" onClick={() => setEditMode(true)}>
              Edit
            </button>
          </div>
          <MarkdownPreview filePath={selectedFile} />
        </div>
      )
    } else {
      return <CodePreview filePath={selectedFile} />
    }
  }

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

  // Show directory tree for idle repositories
  if (repository.status === 'idle') {
    const treePanel = (
      <div className="tree-panel">
        <DirectoryTree 
          repositoryId={repository.id}
          onFileSelect={setSelectedFile}
        />
      </div>
    );
    
    const contentPanel = (
      <div className="content-panel">
        {selectedFile ? (
          renderFileContent()
        ) : (
          <div className="idle-state">
            <div className="idle-icon">⚡</div>
            <h3>Repository Ready for Analysis</h3>
            <p>This repository hasn't been analyzed yet. Click the button below to scan all files and generate documentation.</p>
            <button 
              className="scan-button"
              onClick={() => window.electronAPI.send('scan-repository', { id: repository.id })}
            >
              Start Analysis
            </button>
          </div>
        )}
      </div>
    );
    
    return (
      <div className="documentation-viewer with-tree">
        <ResizablePane
          leftPane={treePanel}
          rightPane={contentPanel}
          initialLeftWidth={300}
          minLeftWidth={200}
          maxLeftWidth={500}
        />
      </div>
    )
  }

  const treePanel = (
    <div className="tree-panel">
      <DirectoryTree 
        repositoryId={repository.id}
        onFileSelect={setSelectedFile}
      />
    </div>
  );
  
  const contentPanel = (
    <div className="content-panel">
      {selectedFile ? (
        renderFileContent()
      ) : html ? (
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
  );
  
  return (
    <div className="documentation-viewer with-tree">
      <ResizablePane
        leftPane={treePanel}
        rightPane={contentPanel}
        initialLeftWidth={300}
        minLeftWidth={200}
        maxLeftWidth={500}
      />
    </div>
  )
}

export default DocumentationViewer