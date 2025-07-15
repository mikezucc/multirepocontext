import { AIProvider, AIProviderSettings } from '../../../shared/types/aiProvider'
import { AIProviderBase } from './base'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { GrokProvider } from './grok'

export class AIProviderFactory {
  static createProvider(settings: AIProviderSettings): AIProviderBase | null {
    const { provider, apiKeys } = settings
    
    switch (provider) {
      case 'anthropic':
        if (apiKeys.anthropic) {
          return new AnthropicProvider(apiKeys.anthropic)
        }
        break
      
      case 'openai':
        if (apiKeys.openai) {
          return new OpenAIProvider(apiKeys.openai)
        }
        break
      
      case 'grok':
        if (apiKeys.grok) {
          return new GrokProvider(apiKeys.grok)
        }
        break
    }
    
    return null
  }
}