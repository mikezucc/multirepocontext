import React, { useState, useEffect } from 'react'
import { formatTokenCount, TokenUsageData } from '@shared/tokenUtils'
import './TokenUsageMeter.css'

const TokenUsageMeter: React.FC = () => {
  const [tokenUsage, setTokenUsage] = useState<TokenUsageData>({
    today: {
      mcp: { input: 0, output: 0 },
      anthropic: { input: 0, output: 0 }
    },
    total: {
      mcp: { input: 0, output: 0 },
      anthropic: { input: 0, output: 0 }
    }
  })
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    // Request initial token usage stats
    window.electronAPI.send('get-token-usage')

    // Listen for token usage updates
    const handleTokenUsageUpdate = (data: TokenUsageData) => {
      setTokenUsage(data)
    }

    window.electronAPI.on('token-usage-update', handleTokenUsageUpdate)

    return () => {
      window.electronAPI.removeListener('token-usage-update', handleTokenUsageUpdate)
    }
  }, [])

  const totalTokensToday = 
    tokenUsage.today.mcp.input + tokenUsage.today.mcp.output +
    tokenUsage.today.anthropic.input + tokenUsage.today.anthropic.output

  const totalTokensAllTime = 
    tokenUsage.total.mcp.input + tokenUsage.total.mcp.output +
    tokenUsage.total.anthropic.input + tokenUsage.total.anthropic.output

  return (
    <div className="token-usage-meter">
      <div 
        className="token-summary"
        onClick={() => setShowDetails(!showDetails)}
        title="Click to see detailed token usage"
      >
        <span className="token-icon">🪙</span>
        <span className="token-count">
          Today: {formatTokenCount(totalTokensToday)} | 
          Total: {formatTokenCount(totalTokensAllTime)}
        </span>
        <span className="expand-icon">{showDetails ? '▼' : '▶'}</span>
      </div>

      {showDetails && (
        <div className="token-details">
          <div className="token-section">
            <h4>Today's Usage</h4>
            <div className="token-grid">
              <div className="token-source">
                <div className="source-label">MCP Server</div>
                <div className="token-io">
                  <span className="input">↓ {formatTokenCount(tokenUsage.today.mcp.input)}</span>
                  <span className="output">↑ {formatTokenCount(tokenUsage.today.mcp.output)}</span>
                </div>
              </div>
              <div className="token-source">
                <div className="source-label">Anthropic API</div>
                <div className="token-io">
                  <span className="input">↓ {formatTokenCount(tokenUsage.today.anthropic.input)}</span>
                  <span className="output">↑ {formatTokenCount(tokenUsage.today.anthropic.output)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="token-section">
            <h4>All-Time Usage</h4>
            <div className="token-grid">
              <div className="token-source">
                <div className="source-label">MCP Server</div>
                <div className="token-io">
                  <span className="input">↓ {formatTokenCount(tokenUsage.total.mcp.input)}</span>
                  <span className="output">↑ {formatTokenCount(tokenUsage.total.mcp.output)}</span>
                </div>
              </div>
              <div className="token-source">
                <div className="source-label">Anthropic API</div>
                <div className="token-io">
                  <span className="input">↓ {formatTokenCount(tokenUsage.total.anthropic.input)}</span>
                  <span className="output">↑ {formatTokenCount(tokenUsage.total.anthropic.output)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="token-legend">
            <span>↓ Input tokens</span>
            <span>↑ Output tokens</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default TokenUsageMeter