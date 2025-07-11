#!/usr/bin/env node

/**
 * MDgent Pretooluse Hook
 * This script is executed before tool operations to provide relevant context
 * from the vector database via RAG (Retrieval Augmented Generation)
 */

const https = require('http');
const fs = require('fs');
const path = require('path');

// Configuration - these will be replaced when the hook is installed
const CONFIG = {
  serverPort: '{{SERVER_PORT}}',
  repositoryId: '{{REPOSITORY_ID}}',
  repositoryPath: '{{REPOSITORY_PATH}}'
};

// Read the prompt from stdin or command line arguments
async function getPrompt() {
  // Check if prompt is provided as argument
  if (process.argv.length > 2) {
    return process.argv.slice(2).join(' ');
  }

  // Otherwise read from stdin
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('readable', () => {
      const chunk = process.stdin.read();
      if (chunk !== null) {
        input += chunk;
      }
    });
    
    process.stdin.on('end', () => {
      resolve(input.trim());
    });

    // Set a timeout to avoid hanging
    setTimeout(() => {
      if (!input) {
        resolve('');
      }
    }, 1000);
  });
}

// Make HTTP request to the pretooluse server
async function queryVectorDatabase(prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      prompt: prompt,
      repositoryId: CONFIG.repositoryId,
      options: {
        topK: 5,
        contextChunks: 2,
        weightFts: 1.0,
        weightVector: 1.0
      }
    });

    const options = {
      hostname: '127.0.0.1',
      port: parseInt(CONFIG.serverPort),
      path: '/pretooluse',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          resolve(response);
        } catch (e) {
          reject(new Error('Invalid JSON response'));
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

// Format the response for output
function formatResponse(response) {
  if (!response.success || !response.results || response.results.length === 0) {
    return null;
  }

  let output = '# MDgent Vector Search Results\\n\\n';
  output += `Query: "${response.query}"\\n\\n`;
  output += '## Relevant Context:\\n\\n';

  response.results.forEach((result, index) => {
    output += `### ${index + 1}. ${result.title || result.filePath} (score: ${result.score.toFixed(3)})\\n`;
    output += `File: ${result.filePath}\\n\\n`;
    output += '```\\n';
    output += result.content;
    output += '\\n```\\n\\n';
  });

  return output;
}

// Main execution
async function main() {
  try {
    // Get the prompt
    const prompt = await getPrompt();
    
    if (!prompt) {
      // No prompt provided, exit silently
      process.exit(0);
    }

    // Log execution (append to log file)
    const logPath = path.join(CONFIG.repositoryPath, '.mdgent', 'pretooluse.log');
    const logEntry = `[${new Date().toISOString()}] Prompt: ${prompt.substring(0, 100)}...\\n`;
    
    try {
      fs.appendFileSync(logPath, logEntry);
    } catch (e) {
      // Ignore logging errors
    }

    // Query the vector database
    const response = await queryVectorDatabase(prompt);
    
    // Format and output the response
    const formattedResponse = formatResponse(response);
    
    if (formattedResponse) {
      console.log(formattedResponse);
    }

    process.exit(0);
  } catch (error) {
    // Log error but don't fail the hook
    const errorLog = `[${new Date().toISOString()}] Error: ${error.message}\\n`;
    const logPath = path.join(CONFIG.repositoryPath, '.mdgent', 'pretooluse.log');
    
    try {
      fs.appendFileSync(logPath, errorLog);
    } catch (e) {
      // Ignore logging errors
    }

    // Exit silently to not disrupt the tool operation
    process.exit(0);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  // Exit silently
  process.exit(0);
});

// Run the hook
main();