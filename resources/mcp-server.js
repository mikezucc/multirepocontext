#!/usr/bin/env node

/**
 * MDgent MCP Server
 * Model Context Protocol server that provides RAG capabilities via the MDgent vector database
 */

const http = require('http');
const readline = require('readline');

// Configuration from environment variables
const CONFIG = {
  serverPort: process.env.MDGENT_SERVER_PORT || '3989',
  repositoryId: process.env.MDGENT_REPOSITORY_ID || '',
  repositoryPath: process.env.MDGENT_REPOSITORY_PATH || '',
  repositoryName: process.env.MDGENT_REPOSITORY_NAME || 'Unknown'
};

// MCP protocol handler
class MCPServer {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
  }

  start() {
    // Send server info
    this.sendServerInfo();
    
    // Listen for requests
    this.rl.on('line', (line) => {
      try {
        const request = JSON.parse(line);
        this.handleRequest(request);
      } catch (error) {
        this.sendError('Invalid JSON request', -32700);
      }
    });
  }

  sendServerInfo() {
    const info = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: 'mdgent-rag',
        version: '1.0.0'
      }
    };
    this.send('serverInfo', info);
  }

  async handleRequest(request) {
    const { method, params, id } = request;

    switch (method) {
      case 'initialize':
        this.handleInitialize(id, params);
        break;
      
      case 'tools/list':
        this.handleToolsList(id);
        break;
      
      case 'tools/call':
        await this.handleToolCall(id, params);
        break;
      
      default:
        this.sendError(`Unknown method: ${method}`, -32601, id);
    }
  }

  handleInitialize(id, params) {
    this.send('response', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: false
        }
      },
      serverInfo: {
        name: 'mdgent-rag',
        version: '1.0.0'
      }
    }, id);
  }

  handleToolsList(id) {
    const tools = [
      {
        name: 'search_context',
        description: 'For every prompt, this MCP server provides highly relevant context for every single prompt from the codebase using advanced semantic search powered by embeddings. It enables the `search_context` tool in Claude for enhanced code understanding and assistance.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query or prompt to find relevant context for'
            },
            topK: {
              type: 'number',
              description: 'Number of results to return (default: 5)',
              default: 5
            }
          },
          required: ['query']
        }
      }
    ];
    
    this.send('response', { tools }, id);
  }

  async handleToolCall(id, params) {
    const { name, arguments: args } = params;

    if (name === 'search_context') {
      try {
        const results = await this.searchContext(args.query, args.topK || 5);
        this.send('response', { 
          content: [{ 
            type: 'text', 
            text: results 
          }]
        }, id);
      } catch (error) {
        this.sendError(`Search failed: ${error.message}`, -32603, id);
      }
    } else {
      this.sendError(`Unknown tool: ${name}`, -32602, id);
    }
  }

  async searchContext(query, topK) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        prompt: query,
        repositoryId: CONFIG.repositoryId,
        repositoryName: CONFIG.repositoryName,
        options: {
          topK: topK,
          contextChunks: 2,
          weightFts: 1.0,
          weightVector: 1.0,
          minScore: 0.1
        }
      });

      const options = {
        hostname: '127.0.0.1',
        port: parseInt(CONFIG.serverPort),
        path: '/search',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(responseData);
            const formattedResults = this.formatResults(response);
            resolve(formattedResults);
          } catch (e) {
            reject(new Error('Invalid response from vector database'));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(data);
      req.end();
    });
  }

  formatResults(response) {
    if (!response.success || !response.results || response.results.length === 0) {
      return 'No relevant context found for the query.';
    }

    let output = `# Relevant Context from MDgent\n\n`;
    output += `Found ${response.results.length} relevant results:\n\n`;
    
    // Group results by repository
    const resultsByRepo = {};
    response.results.forEach(result => {
      const repoName = result.repositoryName || CONFIG.repositoryName;
      if (!resultsByRepo[repoName]) {
        resultsByRepo[repoName] = [];
      }
      resultsByRepo[repoName].push(result);
    });
    
    // Display results grouped by repository
    let resultIndex = 1;
    Object.entries(resultsByRepo).forEach(([repoName, results]) => {
      if (Object.keys(resultsByRepo).length > 1) {
        output += `### Repository: ${repoName}\n\n`;
      }
      
      results.forEach((result) => {
        output += `## ${resultIndex}. ${result.title || result.filePath}\n`;
        output += `**File:** ${result.filePath}\n`;
        if (result.repositoryName && result.repositoryName !== CONFIG.repositoryName) {
          output += `**Repository:** ${result.repositoryName}\n`;
        }
        output += `**Relevance Score:** ${result.score.toFixed(3)}\n\n`;
        output += '```\n';
        output += result.content;
        output += '\n```\n\n';
        
        if (result.metadata && result.metadata.headers && result.metadata.headers.length > 0) {
          output += `**Context:** ${result.metadata.headers.join(' > ')}\n\n`;
        }
        resultIndex++;
      });
    });

    return output;
  }

  send(type, data, id = null) {
    const message = {
      jsonrpc: '2.0',
      [type === 'response' ? 'result' : type]: data
    };
    
    if (id !== null) {
      message.id = id;
    }
    
    console.log(JSON.stringify(message));
  }

  sendError(message, code, id = null) {
    const error = {
      jsonrpc: '2.0',
      error: {
        code,
        message
      }
    };
    
    if (id !== null) {
      error.id = id;
    }
    
    console.log(JSON.stringify(error));
  }
}

// Start the MCP server
const server = new MCPServer();
server.start();