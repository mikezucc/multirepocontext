export interface Repository {
  id: string
  path: string
  name: string
  status: 'idle' | 'scanning' | 'analyzing' | 'ready' | 'error'
  lastUpdated?: Date
  documentCount?: number
  error?: string
  vectorStats?: {
    totalDocuments: number
    totalChunks: number
    totalSize: number
    avgChunksPerDocument: number
    avgChunkSize: number
    vectorDimensions: number
    indexedFiles: string[]
    lastUpdated: string | null
  }
}

export interface Documentation {
  id: string
  repositoryId: string
  filePath: string
  content: string
  metadata: {
    purpose: string
    interfaces: string[]
    dependencies: string[]
    lastAnalyzed: Date
  }
}

export interface AnalysisProgress {
  repositoryId: string
  currentFile?: string
  progress: number
  totalFiles: number
  processedFiles: number
  tokensUsed: number
  estimatedCost: number
}