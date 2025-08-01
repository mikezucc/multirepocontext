export interface CodeAnalysisResponse {
  documentation: string
  tokensUsed: {
    input: number
    output: number
  }
}

export abstract class DaemonAIProviderBase {
  protected apiKey: string
  protected model?: string
  
  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey
    this.model = model
  }
  
  abstract analyzeCode(filePath: string, content: string, customPrompt?: string): Promise<CodeAnalysisResponse>
  abstract isConfigured(): boolean
  abstract getProviderName(): string
  abstract getDefaultModel(): string
  
  getModel(): string {
    return this.model || this.getDefaultModel()
  }
}