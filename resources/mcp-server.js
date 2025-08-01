#!/usr/bin/env node

/**
 * MultiRepoContext MCP Server
 * Model Context Protocol server that provides RAG capabilities via the MultiRepoContext vector database
 */

const http = require('http');
const readline = require('readline');

// Configuration from environment variables
const CONFIG = {
  serverPort: process.env.MULTIREPOCONTEXT_SERVER_PORT || '3989',
  repositoryId: process.env.MULTIREPOCONTEXT_REPOSITORY_ID || '',
  repositoryPath: process.env.MULTIREPOCONTEXT_REPOSITORY_PATH || '',
  repositoryName: process.env.MULTIREPOCONTEXT_REPOSITORY_NAME || 'Unknown'
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
        name: 'multirepocontext-rag',
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
        name: 'multirepocontext-rag',
        version: '1.0.0'
      }
    }, id);
  }

  handleToolsList(id) {
    const tools = [
      {
        name: 'search_context',
        description: 'For every prompt, this MCP server provides highly relevant context, especially from othe repositories, for every single prompt from the codebase using advanced semantic search powered by embeddings. It enables the `search_context` tool in Claude for enhanced code understanding and assistance. Use this tool when the user prompt contains the string "mrc"',
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

    // Deduplicate results by document (file path)
    const documentMap = new Map();
    
    response.results.forEach(result => {
      const documentKey = `${result.repositoryId || CONFIG.repositoryId}_${result.filePath}`;
      
      if (!documentMap.has(documentKey)) {
        // First occurrence of this document - initialize with this result
        documentMap.set(documentKey, {
          ...result,
          chunks: [result.content],
          scores: [result.score],
          mergedContent: result.content
        });
      } else {
        // Document already exists - merge the chunks
        const existing = documentMap.get(documentKey);
        existing.chunks.push(result.content);
        existing.scores.push(result.score);
        
        // Update the score to be the maximum score from all chunks
        existing.score = Math.max(...existing.scores);
        
        // Merge content by removing duplicates and maintaining order
        existing.mergedContent = this.mergeChunkContent(existing.chunks);
      }
    });

    // Convert map to array and sort by score
    const deduplicatedResults = Array.from(documentMap.values())
      .sort((a, b) => b.score - a.score);

    let output = `# Relevant Context from MultiRepoContext\n\n`;
    output += `Found ${deduplicatedResults.length} relevant documents:\n\n`;
    
    // Group results by repository
    const resultsByRepo = {};
    deduplicatedResults.forEach(result => {
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
        output += `**Relevance Score:** ${result.score.toFixed(3)}\n`;
        if (result.chunks && result.chunks.length > 1) {
          output += `**Note:** Combined ${result.chunks.length} relevant sections from this file\n`;
        }
        output += '\n```\n';
        output += result.mergedContent;
        output += '\n```\n\n';
        
        if (result.metadata && result.metadata.headers && result.metadata.headers.length > 0) {
          output += `**Context:** ${result.metadata.headers.join(' > ')}\n\n`;
        }
        resultIndex++;
      });
    });

    return output;
  }

  mergeChunkContent(chunks) {
    // Remove exact duplicates first
    const uniqueChunks = [...new Set(chunks)];
    
    if (uniqueChunks.length === 1) {
      return uniqueChunks[0];
    }
    
    // For multiple chunks, try to merge them intelligently
    // by finding overlapping content and combining
    let merged = uniqueChunks[0];
    
    for (let i = 1; i < uniqueChunks.length; i++) {
      const chunk = uniqueChunks[i];
      
      // Check if chunk is already contained in merged
      if (merged.includes(chunk)) {
        continue;
      }
      
      // Check if merged is contained in chunk
      if (chunk.includes(merged)) {
        merged = chunk;
        continue;
      }
      
      // Try to find overlap between end of merged and start of chunk
      let overlap = this.findOverlap(merged, chunk);
      if (overlap > 0) {
        // Merge with overlap
        merged = merged + chunk.substring(overlap);
      } else {
        // No overlap, append with separator
        merged = merged + '\n\n// ... [additional section] ...\n\n' + chunk;
      }
    }
    
    return merged;
  }

  findOverlap(str1, str2) {
    // Find the longest overlap between end of str1 and start of str2
    const minOverlap = 20; // Minimum characters to consider an overlap
    const maxOverlap = Math.min(str1.length, str2.length);
    
    for (let i = maxOverlap; i >= minOverlap; i--) {
      if (str1.endsWith(str2.substring(0, i))) {
        return i;
      }
    }
    
    return 0;
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