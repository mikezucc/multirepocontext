import { Anthropic } from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { countTokens } from '../../shared/tokenUtils'
import { vectorDB } from '../vectordb/database'

class PromptExpansionService {
  private anthropic: Anthropic | null = null
  
  constructor() {
    this.initializeClient()
  }

  private async initializeClient() {
    const apiKey = await this.getApiKey()
    if (apiKey) {
      this.anthropic = new Anthropic({
        apiKey: apiKey
      })
    }
  }

  private async getApiKey(): Promise<string | null> {
    const configPath = path.join(os.homedir(), '.mdgent', 'config.json')
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return config.apiKey || null
    } catch (e) {
      return null
    }
  }

  async expandPrompt(originalPrompt: string): Promise<string[]> {
    if (!this.anthropic) {
      await this.initializeClient()
      if (!this.anthropic) {
        console.warn('[PromptExpansion] No API key available, skipping expansion')
        return []
      }
    }

    try {
      const systemPrompt = `You are a search query expansion assistant. Given a user's search query, generate EXACTLY 5 related keywords or short phrases that would help find relevant code or documentation. 

IMPORTANT RULES:
- Output ONLY the 5 keywords/phrases, one per line
- No explanations, numbering, or formatting
- Focus on technical terms, function names, class names, or concepts related to the query
- Include synonyms, related concepts, or implementation details
- Each keyword/phrase should be 1-3 words maximum`

      const inputTokens = countTokens(systemPrompt + originalPrompt)
      
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307', // Using Haiku for fast, simple responses
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
      
      // Track token usage
      await vectorDB.trackTokenUsage('anthropic_api', 'input', inputTokens)
      await vectorDB.trackTokenUsage('anthropic_api', 'output', outputTokens)
      
      console.log('[PromptExpansion] Original:', originalPrompt)
      console.log('[PromptExpansion] Expanded terms:', expandedTerms)
      
      return expandedTerms
    } catch (error) {
      console.error('[PromptExpansion] Error expanding prompt:', error)
      return []
    }
  }

  async expandPromptForSearch(originalPrompt: string): Promise<string> {
    const expandedTerms = await this.expandPrompt(originalPrompt)

    console.log('[PromptExpansion] Combining original prompt with expanded terms for search', expandedTerms);
    
    // Combine original prompt with expanded terms for enhanced search
    // The expanded terms are added with OR operators to broaden the search
    if (expandedTerms.length > 0) {
      const expandedQuery = `${originalPrompt}. Related keywords: ${expandedTerms.join(' ')}`
      return expandedQuery
    }
    
    return originalPrompt
  }
}

export const promptExpansionService = new PromptExpansionService()