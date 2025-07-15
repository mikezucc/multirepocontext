import { Anthropic } from '@anthropic-ai/sdk'
import { AIProviderBase } from './base'
import { PromptExpansionResponse } from '../../../shared/types/aiProvider'
import { countTokens } from '../../../shared/tokenUtils'

export class AnthropicProvider extends AIProviderBase {
  private client: Anthropic | null = null
  
  constructor(apiKey: string) {
    super(apiKey)
    if (apiKey) {
      this.client = new Anthropic({ apiKey })
    }
  }
  
  isConfigured(): boolean {
    return !!this.client && !!this.apiKey
  }
  
  getProviderName(): string {
    return 'Anthropic'
  }
  
  async expandPrompt(originalPrompt: string): Promise<PromptExpansionResponse> {
    if (!this.isConfigured()) {
      throw new Error('Anthropic provider not configured')
    }
    
    const systemPrompt = `You are a search query expansion assistant. Given a user's search query, generate EXACTLY 5 related keywords or short phrases that would help find relevant code or documentation. 

IMPORTANT RULES:
- Output ONLY the 5 keywords/phrases, one per line
- No explanations, numbering, or formatting
- Focus on technical terms, function names, class names, or concepts related to the query
- Include synonyms, related concepts, or implementation details
- Each keyword/phrase should be 1-3 words maximum`
    
    const inputTokens = countTokens(systemPrompt + originalPrompt)
    
    const response = await this.client!.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 50,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: originalPrompt
      }]
    })
    
    const expandedTerms = response.content[0].type === 'text' 
      ? response.content[0].text.trim().split('\n').filter(term => term.trim().length > 0).slice(0, 5)
      : []
    
    const outputTokens = countTokens(expandedTerms.join(' '))
    
    return {
      expandedTerms,
      tokensUsed: {
        input: inputTokens,
        output: outputTokens
      }
    }
  }
}