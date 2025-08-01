import Database from 'better-sqlite3'
import { getDatabase } from './database'

export interface RepositoryAccessPermission {
  id?: number
  sourceRepositoryId: string
  targetRepositoryId: string
  permissionType: 'read'
  grantedAt?: string
  grantedBy?: string
  expiresAt?: string
}

export interface RepositoryWithAccess {
  id: string
  name: string
  path: string
  hasAccess: boolean
}

class RepositoryAccessStore {
  private db: Database.Database

  constructor() {
    this.db = getDatabase()
  }

  // Grant access from one repository to another
  grantAccess(sourceRepositoryId: string, targetRepositoryId: string, grantedBy?: string, expiresAt?: Date): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO repository_access_permissions 
      (source_repository_id, target_repository_id, permission_type, granted_by, expires_at)
      VALUES (?, ?, 'read', ?, ?)
    `)
    
    stmt.run(sourceRepositoryId, targetRepositoryId, grantedBy || null, expiresAt?.toISOString() || null)
  }

  // Revoke access from one repository to another
  revokeAccess(sourceRepositoryId: string, targetRepositoryId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM repository_access_permissions
      WHERE source_repository_id = ? AND target_repository_id = ?
    `)
    
    stmt.run(sourceRepositoryId, targetRepositoryId)
  }

  // Check if a repository has access to another
  hasAccess(sourceRepositoryId: string, targetRepositoryId: string): boolean {
    // A repository always has access to itself
    if (sourceRepositoryId === targetRepositoryId) {
      return true
    }

    const stmt = this.db.prepare(`
      SELECT 1 FROM repository_access_permissions
      WHERE source_repository_id = ? 
      AND target_repository_id = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      LIMIT 1
    `)
    
    const result = stmt.get(sourceRepositoryId, targetRepositoryId)
    return !!result
  }

  // Get all repositories that a source repository has access to
  getAccessibleRepositories(sourceRepositoryId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT target_repository_id 
      FROM repository_access_permissions
      WHERE source_repository_id = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    `)
    
    const results = stmt.all(sourceRepositoryId) as { target_repository_id: string }[]
    const accessibleRepos = results.map(r => r.target_repository_id)
    
    // Always include the source repository itself
    if (!accessibleRepos.includes(sourceRepositoryId)) {
      accessibleRepos.push(sourceRepositoryId)
    }
    
    return accessibleRepos
  }

  // Get all repositories with their access status for a given source repository
  getAllRepositoriesWithAccessStatus(sourceRepositoryId: string): RepositoryWithAccess[] {
    const stmt = this.db.prepare(`
      SELECT 
        r.id,
        r.name,
        r.path,
        CASE 
          WHEN r.id = ? THEN 1
          WHEN p.id IS NOT NULL AND (p.expires_at IS NULL OR p.expires_at > datetime('now')) THEN 1
          ELSE 0
        END as has_access
      FROM repositories r
      LEFT JOIN repository_access_permissions p 
        ON p.source_repository_id = ? 
        AND p.target_repository_id = r.id
      ORDER BY r.name
    `)
    
    const results = stmt.all(sourceRepositoryId, sourceRepositoryId) as Array<{
      id: string
      name: string
      path: string
      has_access: number
    }>
    
    return results.map(r => ({
      id: r.id,
      name: r.name,
      path: r.path,
      hasAccess: r.has_access === 1
    }))
  }

  // Get all permissions for a source repository
  getPermissionsForRepository(sourceRepositoryId: string): RepositoryAccessPermission[] {
    const stmt = this.db.prepare(`
      SELECT 
        p.*,
        r.name as target_repository_name
      FROM repository_access_permissions p
      JOIN repositories r ON p.target_repository_id = r.id
      WHERE p.source_repository_id = ?
      ORDER BY p.granted_at DESC
    `)
    
    return stmt.all(sourceRepositoryId) as RepositoryAccessPermission[]
  }

  // Clean up expired permissions
  cleanupExpiredPermissions(): number {
    const stmt = this.db.prepare(`
      DELETE FROM repository_access_permissions
      WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
    `)
    
    const result = stmt.run()
    return result.changes
  }
}

export const repositoryAccessStore = new RepositoryAccessStore()