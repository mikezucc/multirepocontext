export type AIProvider = 'anthropic' | 'openai' | 'grok'

export interface AIProviderConfig {
  provider: AIProvider
  apiKeys: {
    anthropic?: string
    openai?: string
    grok?: string
  }
}

export interface AIProviderSettings extends AIProviderConfig {
  modelSettings?: {
    anthropic?: {
      model?: string
      maxTokens?: number
      temperature?: number
    }
    openai?: {
      model?: string
      maxTokens?: number
      temperature?: number
    }
    grok?: {
      model?: string
      maxTokens?: number
      temperature?: number
    }
  }
}

export interface PromptExpansionResponse {
  expandedTerms: string[]
  tokensUsed: {
    input: number
    output: number
  }
}