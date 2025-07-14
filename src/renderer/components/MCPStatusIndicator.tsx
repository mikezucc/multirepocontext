import React, { useState, useEffect } from 'react'
import { Repository } from '@shared/types'

interface MCPStatusIndicatorProps {
  repositories: Repository[]
  selectedRepo: Repository | null
}

interface MCPServerStatus {
  [repositoryId: string]: boolean
}

const MCPStatusIndicator: React.FC<MCPStatusIndicatorProps> = ({ repositories, selectedRepo }) => {
  const [mcpStatus, setMcpStatus] = useState<MCPServerStatus>({})
  const [showTooltip, setShowTooltip] = useState(false)

  useEffect(() => {
    // Request initial MCP server status
    window.electronAPI.send('get-mcp-server-status', {})

    const handleMCPServerStatus = (status: MCPServerStatus) => {
      setMcpStatus(status)
    }

    // Listen for MCP server status updates
    window.electronAPI.on('mcp-server-status', handleMCPServerStatus)

    // Poll for status every 5 seconds
    const interval = setInterval(() => {
      window.electronAPI.send('get-mcp-server-status', {})
    }, 5000)

    return () => {
      window.electronAPI.removeListener('mcp-server-status', handleMCPServerStatus)
      clearInterval(interval)
    }
  }, [])

  // Calculate overall MCP status
  const totalServers = repositories.length
  const runningServers = repositories.filter(repo => mcpStatus[repo.id]).length
  
  // Determine status color and icon
  let statusColor = '#666' // gray - no servers
  let statusIcon = '○' // empty circle - no servers
  let statusText = 'No MCP servers'
  
  if (totalServers > 0) {
    if (runningServers === totalServers) {
      statusColor = '#4CAF50' // green - all running
      statusIcon = '●' // filled circle
      statusText = `MCP: ${runningServers}/${totalServers} running`
    } else if (runningServers > 0) {
      statusColor = '#ff9800' // orange - some running
      statusIcon = '◐' // half circle
      statusText = `MCP: ${runningServers}/${totalServers} running`
    } else {
      statusColor = '#f44336' // red - none running
      statusIcon = '○' // empty circle
      statusText = `MCP: 0/${totalServers} running`
    }
  }

  // Show selected repo status if available
  if (selectedRepo && totalServers > 0) {
    const isRunning = mcpStatus[selectedRepo.id]
    statusText = isRunning ? 'Running' : 'Stopped'
  }

  return (
    <div 
      className="mcp-status-indicator"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        color: '#888',
        position: 'relative',
        cursor: 'help',
        WebkitAppRegion: 'no-drag' as any,
      }}
    >
      <span 
        style={{ 
          color: statusColor,
          fontSize: '10px',
          lineHeight: '1',
        }}
      >
        {statusIcon}
      </span>
      <span style={{ 
        textTransform: 'uppercase', 
        letterSpacing: '0.5px',
        fontSize: '11px',
      }}>
        {statusText}
      </span>
      
      {showTooltip && totalServers > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: '8px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          padding: '8px 12px',
          fontSize: '11px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>MCP Server Status:</div>
          {repositories.map(repo => (
            <div key={repo.id} style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              marginTop: '2px',
            }}>
              <span style={{ 
                color: mcpStatus[repo.id] ? '#4CAF50' : '#f44336',
                fontSize: '10px',
              }}>
                {mcpStatus[repo.id] ? '●' : '○'}
              </span>
              <span>{repo.name}: {mcpStatus[repo.id] ? 'Running' : 'Stopped'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MCPStatusIndicator