import { AIProviderBase } from './base'
import { PromptExpansionResponse } from '../../../shared/types/aiProvider'
import { countTokens } from '../../../shared/tokenUtils'

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

export class GrokProvider extends AIProviderBase {
  private baseUrl = 'https://api.x.ai/v1'
  
  isConfigured(): boolean {
    return !!this.apiKey
  }
  
  getProviderName(): string {
    return 'Grok'
  }
  
  async expandPrompt(originalPrompt: string): Promise<PromptExpansionResponse> {
    if (!this.isConfigured()) {
      throw new Error('Grok provider not configured')
    }
    
    const systemPrompt = `You are a search query expansion assistant. Given a user's search query, generate EXACTLY 5 related keywords or short phrases that would help find relevant code or documentation. 

IMPORTANT RULES:
- Output ONLY the 5 keywords/phrases, one per line
- No explanations, numbering, or formatting
- Focus on technical terms, function names, class names, or concepts related to the query
- Include synonyms, related concepts, or implementation details
- Each keyword/phrase should be 1-3 words maximum`
    
    const messages: GrokMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: originalPrompt }
    ]
    
    const inputTokens = countTokens(systemPrompt + originalPrompt)
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-beta',
        messages,
        max_tokens: 50,
        temperature: 0.3
      })
    })
    
    if (!response.ok) {
      throw new Error(`Grok API error: ${response.statusText}`)
    }
    
    const data: GrokResponse = await response.json()
    const content = data.choices[0]?.message?.content || ''
    
    const expandedTerms = content.trim().split('\n')
      .filter(term => term.trim().length > 0)
      .slice(0, 5)
    
    const outputTokens = data.usage?.completion_tokens || countTokens(expandedTerms.join(' '))
    
    return {
      expandedTerms,
      tokensUsed: {
        input: data.usage?.prompt_tokens || inputTokens,
        output: outputTokens
      }
    }
  }
}