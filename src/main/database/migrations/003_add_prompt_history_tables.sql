-- Migration to add prompt history tables
-- This migration adds tables for storing MCP server prompt history

-- Create prompt history table
CREATE TABLE IF NOT EXISTS prompt_history (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  options TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_results INTEGER DEFAULT 0,
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

-- Create prompt results table
CREATE TABLE IF NOT EXISTS prompt_results (
  id TEXT PRIMARY KEY,
  prompt_history_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  score REAL NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (prompt_history_id) REFERENCES prompt_history(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_prompt_history_repository_id ON prompt_history(repository_id);
CREATE INDEX IF NOT EXISTS idx_prompt_history_timestamp ON prompt_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_prompt_results_prompt_history_id ON prompt_results(prompt_history_id);
CREATE INDEX IF NOT EXISTS idx_prompt_results_score ON prompt_results(score);