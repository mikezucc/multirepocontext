import { pipeline, env } from '@huggingface/transformers'
import path from 'path'
import { app } from 'electron'
import fs from 'fs/promises'

// Configure transformers.js
env.localURL = path.join(app.getPath('userData'), 'models')
env.allowRemoteModels = true
env.allowLocalModels = true

export class EmbeddingGenerator {
  private model: any = null
  private modelName = 'Xenova/jina-embeddings-v2-base-en'
  private isInitialized = false

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    try {
      console.log('[Embeddings] Initializing embedding model...')
      
      // Ensure model directory exists
      await fs.mkdir(env.localURL, { recursive: true })
      
      // Load the embedding pipeline
      this.model = await pipeline('feature-extraction', this.modelName, {
        quantized: true // Use quantized model for smaller size
      })
      
      this.isInitialized = true
      console.log('[Embeddings] Model initialized successfully')
    } catch (error) {
      console.error('[Embeddings] Failed to initialize model:', error)
      throw error
    }
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    try {
      // Generate embeddings
      const output = await this.model(text, {
        pooling: 'mean',
        normalize: true
      })
      
      // Convert to Float32Array
      const embedding = new Float32Array(output.data)
      return embedding
    } catch (error) {
      console.error('[Embeddings] Failed to generate embedding:', error)
      throw error
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<Float32Array[]> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const embeddings: Float32Array[] = []
    
    // Process in batches to avoid memory issues
    const batchSize = 8
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      
      // Generate embeddings for batch
      const batchPromises = batch.map(text => this.generateEmbedding(text))
      const batchEmbeddings = await Promise.all(batchPromises)
      embeddings.push(...batchEmbeddings)
    }

    return embeddings
  }

  // Get embedding dimension (useful for vector database setup)
  getEmbeddingDimension(): number {
    // Jina embeddings v2 base produces 768-dimensional vectors
    return 768
  }

  // Clean up resources
  async dispose(): void {
    if (this.model) {
      // Transformers.js doesn't have explicit dispose, but we can null the reference
      this.model = null
      this.isInitialized = false
    }
  }
}

export const embeddingGenerator = new EmbeddingGenerator()