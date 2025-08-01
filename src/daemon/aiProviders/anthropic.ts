import { Anthropic } from '@anthropic-ai/sdk'
import { DaemonAIProviderBase, CodeAnalysisResponse } from './base'
import { countTokens } from '../../shared/tokenUtils'

export class AnthropicDaemonProvider extends DaemonAIProviderBase {
  private client: Anthropic | null = null
  
  constructor(apiKey: string, model?: string) {
    super(apiKey, model)
    if (apiKey) {
      this.client = new Anthropic({ apiKey })
    }
  }
  
  isConfigured(): boolean {
    return !!this.client
  }
  
  getProviderName(): string {
    return 'Anthropic'
  }
  
  getDefaultModel(): string {
    return 'claude-3-7-sonnet-latest'
  }
  
  async analyzeCode(relativePath: string, content: string, customPrompt?: string): Promise<CodeAnalysisResponse> {
    if (!this.client) {
      throw new Error('Anthropic provider not configured')
    }
    
    const defaultPrompt = `You are a technical Product Manager who is compiling the tribal knowledge of the codebase. Analyze this code file and generate comprehensive documentation that serves to both describe the product and design considerations, as well as the detaield technical specifications.

File: ${relativePath}

\`\`\`
${content}
\`\`\`

Please provide:
1. A clear description of the file's purpose and role in the codebase
2. List of all public interfaces, classes, and functions with their signatures
3. Dependencies and imports that other parts of the codebase might need
4. Usage examples if applicable
5. Any important implementation details or design decisions

Format the response as markdown suitable for a README file.`

    // Replace placeholders in custom prompt
    let prompt = customPrompt || defaultPrompt
    prompt = prompt.replace(/{relativePath}/g, relativePath)
    prompt = prompt.replace(/{content}/g, content)

    // Count input tokens
    const inputTokens = countTokens(prompt)
    
    const response = await this.client.messages.create({
      model: this.getModel(),
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })

    const documentation = response.content[0].type === 'text' 
      ? response.content[0].text 
      : ''
    
    // Count output tokens
    const outputTokens = countTokens(documentation)
    
    return {
      documentation,
      tokensUsed: {
        input: inputTokens,
        output: outputTokens
      }
    }
  }
}