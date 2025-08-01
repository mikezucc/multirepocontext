import { DaemonAIProviderBase, CodeAnalysisResponse } from './base'
import { countTokens } from '../../shared/tokenUtils'

interface GrokMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface GrokResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

export class GrokDaemonProvider extends DaemonAIProviderBase {
  private baseUrl = 'https://api.x.ai/v1'
  
  isConfigured(): boolean {
    return !!this.apiKey
  }
  
  getProviderName(): string {
    return 'Grok'
  }
  
  getDefaultModel(): string {
    return 'grok-beta'
  }
  
  async analyzeCode(relativePath: string, content: string, customPrompt?: string): Promise<CodeAnalysisResponse> {
    if (!this.isConfigured()) {
      throw new Error('Grok provider not configured')
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
    
    const messages: GrokMessage[] = [
      { role: 'user', content: prompt }
    ]
    
    // Count input tokens
    const inputTokens = countTokens(prompt)
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.getModel(),
        messages,
        max_tokens: 2000,
        temperature: 0.3
      })
    })
    
    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(`Grok API error: ${response.statusText} - ${errorData}`)
    }
    
    const data: GrokResponse = await response.json()
    const documentation = data.choices[0]?.message?.content || ''
    
    return {
      documentation,
      tokensUsed: {
        input: data.usage?.prompt_tokens || inputTokens,
        output: data.usage?.completion_tokens || countTokens(documentation)
      }
    }
  }
}