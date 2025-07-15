import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { vectorDB } from '../vectordb/database'
import { AIProviderBase } from './aiProviders/base'
import { AIProviderFactory } from './aiProviders/factory'
import { AIProviderSettings } from '../../shared/types/aiProvider'

class PromptExpansionService {
  private provider: AIProviderBase | null = null
  
  constructor() {
    this.initializeProvider()
  }

  private async initializeProvider() {
    const settings = await this.getProviderSettings()
    this.provider = AIProviderFactory.createProvider(settings)
  }

  private async getProviderSettings(): Promise<AIProviderSettings> {
    const configPath = path.join(os.homedir(), '.mdgent', 'config.json')
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return {
        provider: config.provider || 'anthropic',
        apiKeys: {
          anthropic: config.apiKey || config.apiKeys?.anthropic,
          openai: config.apiKeys?.openai,
          grok: config.apiKeys?.grok
        }
      }
    } catch (e) {
      return {
        provider: 'anthropic',
        apiKeys: {}
      }
    }
  }

  async updateProviderSettings(settings: AIProviderSettings) {
    this.provider = AIProviderFactory.createProvider(settings)
  }

  async expandPrompt(originalPrompt: string): Promise<string[]> {
    if (!this.provider) {
      await this.initializeProvider()
      if (!this.provider) {
        console.warn('[PromptExpansion] No provider configured, skipping expansion')
        return []
      }
    }

    try {
      const response = await this.provider.expandPrompt(originalPrompt)
      
      // Track token usage
      const providerName = this.provider.getProviderName().toLowerCase()
      await vectorDB.trackTokenUsage(`${providerName}_api`, 'input', response.tokensUsed.input)
      await vectorDB.trackTokenUsage(`${providerName}_api`, 'output', response.tokensUsed.output)
      
      console.log('[PromptExpansion] Provider:', providerName)
      console.log('[PromptExpansion] Original:', originalPrompt)
      console.log('[PromptExpansion] Expanded terms:', response.expandedTerms)
      
      return response.expandedTerms
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