import { AIProvider, AIProviderSettings } from '../../shared/types/aiProvider'
import { DaemonAIProviderBase } from './base'
import { AnthropicDaemonProvider } from './anthropic'
import { OpenAIDaemonProvider } from './openai'
import { GrokDaemonProvider } from './grok'

export class DaemonAIProviderFactory {
  static createProvider(settings: AIProviderSettings): DaemonAIProviderBase | null {
    const { provider, apiKeys, modelSettings } = settings
    
    switch (provider) {
      case 'anthropic':
        if (apiKeys.anthropic) {
          return new AnthropicDaemonProvider(
            apiKeys.anthropic, 
            modelSettings?.anthropic?.model
          )
        }
        break
      
      case 'openai':
        if (apiKeys.openai) {
          return new OpenAIDaemonProvider(
            apiKeys.openai,
            modelSettings?.openai?.model
          )
        }
        break
      
      case 'grok':
        if (apiKeys.grok) {
          return new GrokDaemonProvider(
            apiKeys.grok,
            modelSettings?.grok?.model
          )
        }
        break
    }
    
    return null
  }
}