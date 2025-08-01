import React, { useState, useEffect } from 'react'
import { Repository } from '@shared/types'
import './RepositoryAccessSettings.css'

interface RepositoryWithAccess {
  id: string
  name: string
  path: string
  hasAccess: boolean
}

interface RepositoryAccessSettingsProps {
  activeRepository: Repository | null
}

export function RepositoryAccessSettings({ activeRepository }: RepositoryAccessSettingsProps) {
  const [repositories, setRepositories] = useState<RepositoryWithAccess[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (activeRepository) {
      loadRepositoryPermissions()
    }
  }, [activeRepository])

  const loadRepositoryPermissions = async () => {
    if (!activeRepository) return
    
    setLoading(true)
    try {
      // Send request
      window.electronAPI.send('get-repository-access-permissions', {
        repositoryId: activeRepository.id
      })
      
      // Wait for response
      const handlePermissions = (result: any) => {
        if (result.success && result.repositoryId === activeRepository.id) {
          setRepositories(result.permissions)
        }
        setLoading(false)
        window.electronAPI.removeListener('repository-access-permissions', handlePermissions)
      }
      
      window.electronAPI.on('repository-access-permissions', handlePermissions)
    } catch (error) {
      console.error('Error loading repository permissions:', error)
      setLoading(false)
    }
  }

  const toggleAccess = async (targetRepo: RepositoryWithAccess) => {
    if (!activeRepository || targetRepo.id === activeRepository.id) return
    
    setSaving(targetRepo.id)
    try {
      const handleResult = (result: any) => {
        if (result.success) {
          // Reload permissions after successful change
          loadRepositoryPermissions()
        }
        setSaving(null)
      }
      
      if (targetRepo.hasAccess) {
        // Revoke access
        window.electronAPI.on('revoke-repository-access-result', handleResult)
        window.electronAPI.send('revoke-repository-access', {
          sourceRepositoryId: activeRepository.id,
          targetRepositoryId: targetRepo.id
        })
      } else {
        // Grant access
        window.electronAPI.on('grant-repository-access-result', handleResult)
        window.electronAPI.send('grant-repository-access', {
          sourceRepositoryId: activeRepository.id,
          targetRepositoryId: targetRepo.id,
          grantedBy: 'user'
        })
      }
      
      // Clean up listeners after a timeout
      setTimeout(() => {
        window.electronAPI.removeListener('grant-repository-access-result', handleResult)
        window.electronAPI.removeListener('revoke-repository-access-result', handleResult)
      }, 5000)
    } catch (error) {
      console.error('Error toggling repository access:', error)
      setSaving(null)
    }
  }

  const filteredRepositories = repositories.filter(repo => 
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.path.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const accessibleCount = repositories.filter(r => r.hasAccess && r.id !== activeRepository?.id).length

  if (!activeRepository) {
    return (
      <div className="access-settings-container">
        <div className="access-empty-state">
          <h3>No Repository Selected</h3>
          <p>Select a repository to manage its access permissions</p>
        </div>
      </div>
    )
  }

  return (
    <div className="access-settings-container">
      <div className="access-header">
        <div className="header-content">
          <h2 className="header-title">Cross-Repository Access</h2>
          <p className="header-subtitle">
            Configure which repositories <strong>{activeRepository.name}</strong> can search
          </p>
        </div>
        <div className="header-stats">
          <div className="stat-item">
            <span className="stat-value">{repositories.length - 1}</span>
            <span className="stat-label">Available</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{accessibleCount}</span>
            <span className="stat-label">Accessible</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading repository permissions...</p>
        </div>
      ) : (
        <>
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="repository-list">
            {filteredRepositories.length === 0 ? (
              <div className="no-results">
                <p>No repositories found matching "{searchQuery}"</p>
              </div>
            ) : (
              filteredRepositories.map((repo) => (
                <div
                  key={repo.id}
                  className={`repository-item ${repo.id === activeRepository.id ? 'current' : ''}`}
                >
                  <div className="repo-info">
                    <div className="repo-details">
                      <h4 className="repo-name">{repo.name}</h4>
                      <p className="repo-path">{repo.path}</p>
                    </div>
                  </div>
                  
                  <div className="repo-action">
                    {repo.id === activeRepository.id ? (
                      <span className="current-badge">Current</span>
                    ) : (
                      <label className="switch" style={{ opacity: saving === repo.id ? 0.5 : 1 }}>
                        <input
                          type="checkbox"
                          checked={repo.hasAccess}
                          onChange={() => toggleAccess(repo)}
                          disabled={saving === repo.id}
                        />
                        <span className="slider"></span>
                      </label>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {repositories.length === 1 && (
            <div className="empty-message">
              <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <p>Add more repositories to enable cross-repository search</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}