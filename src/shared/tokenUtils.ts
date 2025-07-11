/**
 * Token counting utilities
 * Based on the approximation: 1 token ≈ 0.75 words
 */

export function countTokens(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0
  }

  // Remove extra whitespace and split by whitespace
  const words = text.trim().split(/\s+/).filter(word => word.length > 0)
  
  // Apply the approximation: 1 token ≈ 0.75 words
  // So words / 0.75 = tokens (or words * 1.333)
  const estimatedTokens = Math.ceil(words.length / 0.75)
  
  return estimatedTokens
}

export function formatTokenCount(count: number): string {
  if (count < 1000) {
    return count.toString()
  } else if (count < 1000000) {
    return `${(count / 1000).toFixed(1)}k`
  } else {
    return `${(count / 1000000).toFixed(2)}M`
  }
}

export interface TokenUsageData {
  today: {
    mcp: { input: number; output: number }
    anthropic: { input: number; output: number }
  }
  total: {
    mcp: { input: number; output: number }
    anthropic: { input: number; output: number }
  }
}