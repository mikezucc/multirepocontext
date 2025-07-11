import { marked } from 'marked'

export interface DocumentChunk {
  content: string
  metadata: {
    headers: string[]      // Hierarchy of headers above this chunk
    chunkType: 'header' | 'content' | 'code'
    startLine?: number
    endLine?: number
    language?: string     // For code blocks
  }
}

export class DocumentChunker {
  // Chunk markdown document by header sections
  async chunkMarkdown(content: string, filePath: string): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = []
    
    // Parse markdown to get structure
    const tokens = marked.lexer(content)
    
    let currentHeaders: string[] = []
    let currentContent: string[] = []
    let currentMetadata: DocumentChunk['metadata'] = {
      headers: [],
      chunkType: 'content'
    }
    
    let lineNumber = 1
    let chunkStartLine = 1

    // Process each token
    for (const token of tokens) {
      if (token.type === 'heading') {
        // Only create new chunk for primary headers (depth 1)
        if (token.depth === 1) {
          // Save previous chunk if it has content
          if (currentContent.length > 0) {
            chunks.push({
              content: currentContent.join('\n').trim(),
              metadata: {
                ...currentMetadata,
                startLine: chunkStartLine,
                endLine: lineNumber - 1
              }
            })
            currentContent = []
          }

          // Start new chunk
          chunkStartLine = lineNumber
        }

        // Update header hierarchy
        const level = token.depth
        currentHeaders = currentHeaders.slice(0, level - 1)
        currentHeaders[level - 1] = token.text
        
        // Update metadata with current header hierarchy
        currentMetadata = {
          headers: [...currentHeaders],
          chunkType: 'header'
        }
        
        // Always add header to current content (whether primary or not)
        currentContent.push(token.raw)
        lineNumber += token.raw.split('\n').length
        
      } else if (token.type === 'code') {
        // Save previous chunk if it has content
        if (currentContent.length > 0) {
          chunks.push({
            content: currentContent.join('\n').trim(),
            metadata: {
              ...currentMetadata,
              startLine: chunkStartLine,
              endLine: lineNumber - 1
            }
          })
          currentContent = []
        }

        // Create code chunk
        chunks.push({
          content: token.text,
          metadata: {
            headers: [...currentHeaders],
            chunkType: 'code',
            language: token.lang || 'unknown',
            startLine: lineNumber,
            endLine: lineNumber + token.raw.split('\n').length - 1
          }
        })

        lineNumber += token.raw.split('\n').length
        chunkStartLine = lineNumber
        currentMetadata = {
          headers: [...currentHeaders],
          chunkType: 'content'
        }
        
      } else if (token.type === 'paragraph' || token.type === 'list' || token.type === 'blockquote') {
        // Add to current content
        currentContent.push(token.raw)
        lineNumber += token.raw.split('\n').length
        
      } else if (token.type === 'space') {
        lineNumber += token.raw.split('\n').length
      }
    }

    // Don't forget the last chunk
    if (currentContent.length > 0) {
      chunks.push({
        content: currentContent.join('\n').trim(),
        metadata: {
          ...currentMetadata,
          startLine: chunkStartLine,
          endLine: lineNumber - 1
        }
      })
    }

    // Add file path to metadata
    return chunks.map(chunk => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        filePath
      }
    }))
  }

  // Chunk code files by functions/classes
  async chunkCode(content: string, filePath: string, language: string): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = []
    const lines = content.split('\n')
    
    // Simple chunking by size for now
    // TODO: Implement language-specific parsing for better chunking
    const chunkSize = 50 // lines
    const overlap = 10   // lines
    
    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const chunkLines = lines.slice(i, i + chunkSize)
      const chunk: DocumentChunk = {
        content: chunkLines.join('\n'),
        metadata: {
          headers: [filePath],
          chunkType: 'code',
          language,
          startLine: i + 1,
          endLine: Math.min(i + chunkSize, lines.length),
          filePath
        }
      }
      chunks.push(chunk)
    }
    
    return chunks
  }

  // Main chunking method that handles different file types
  async chunkDocument(content: string, filePath: string): Promise<DocumentChunk[]> {
    const extension = filePath.split('.').pop()?.toLowerCase()
    
    // Handle markdown files
    if (extension === 'md' || extension === 'mdx' || extension === 'markdown') {
      return this.chunkMarkdown(content, filePath)
    }
    
    // Handle code files
    const codeExtensions: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'rb': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'r': 'r',
      'sql': 'sql',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'fish': 'bash'
    }
    
    if (extension && codeExtensions[extension]) {
      return this.chunkCode(content, filePath, codeExtensions[extension])
    }
    
    // Default: treat as plain text and chunk by paragraphs
    return this.chunkPlainText(content, filePath)
  }

  // Chunk plain text by paragraphs
  private async chunkPlainText(content: string, filePath: string): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = []
    const paragraphs = content.split(/\n\n+/)
    
    let currentLine = 1
    for (const paragraph of paragraphs) {
      if (paragraph.trim()) {
        const lines = paragraph.split('\n').length
        chunks.push({
          content: paragraph.trim(),
          metadata: {
            headers: [filePath],
            chunkType: 'content',
            startLine: currentLine,
            endLine: currentLine + lines - 1,
            filePath
          }
        })
        currentLine += lines + 2 // Account for paragraph breaks
      } else {
        currentLine += 2
      }
    }
    
    return chunks
  }

  // Combine adjacent small chunks to optimize storage
  optimizeChunks(chunks: DocumentChunk[], minSize: number = 100, maxSize: number = 1000): DocumentChunk[] {
    const optimized: DocumentChunk[] = []
    let currentCombined: DocumentChunk | null = null
    
    for (const chunk of chunks) {
      if (!currentCombined) {
        currentCombined = chunk
        continue
      }
      
      // Check if we can combine with current
      const combinedLength = currentCombined.content.length + chunk.content.length
      const sameType = currentCombined.metadata.chunkType === chunk.metadata.chunkType
      const sameHeaders = JSON.stringify(currentCombined.metadata.headers) === JSON.stringify(chunk.metadata.headers)
      
      if (combinedLength < maxSize && sameType && sameHeaders) {
        // Combine chunks
        currentCombined = {
          content: currentCombined.content + '\n\n' + chunk.content,
          metadata: {
            ...currentCombined.metadata,
            endLine: chunk.metadata.endLine
          }
        }
      } else {
        // Save current and start new
        if (currentCombined.content.length >= minSize) {
          optimized.push(currentCombined)
        }
        currentCombined = chunk
      }
    }
    
    // Don't forget the last chunk
    if (currentCombined && currentCombined.content.length >= minSize) {
      optimized.push(currentCombined)
    }
    
    return optimized
  }
}

export const documentChunker = new DocumentChunker()