import { PromptExpansionResponse } from '../../../shared/types/aiProvider'

export abstract class AIProviderBase {
  protected apiKey: string
  
  constructor(apiKey: string) {
    this.apiKey = apiKey
  }
  
  abstract expandPrompt(originalPrompt: string): Promise<PromptExpansionResponse>
  abstract isConfigured(): boolean
  abstract getProviderName(): string
}