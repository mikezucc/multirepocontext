# Repository Persistence Feature

## Overview

MDgent now persists user-selected repositories across app sessions using a SQLite database. When users reopen the app, their previously added repositories are automatically restored.

## Implementation Details

### Database Schema

A new `repositories` table stores repository information:

```sql
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_opened DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Components

1. **`repositoryStore.ts`** - Handles all database operations:
   - `addRepository()` - Saves a repository to the database
   - `removeRepository()` - Removes a repository from the database
   - `getAllRepositories()` - Retrieves all stored repositories
   - `updateLastOpened()` - Updates the last opened timestamp when a repository is selected

2. **IPC Handler Updates**:
   - Modified `add-repository` to save repositories to the database
   - Modified `remove-repository` to remove repositories from the database
   - Added `update-repository-opened` to track when repositories are accessed
   - Added `loadStoredRepositories()` to restore repositories on app startup

3. **UI Updates**:
   - App component now tracks repository selection and updates timestamps
   - First repository is auto-selected when repositories are loaded

## User Experience

1. **Adding Repositories**: When users add a repository, it's automatically saved to the database
2. **Removing Repositories**: When users remove a repository, it's deleted from the database
3. **App Restart**: When the app restarts:
   - All previously added repositories are automatically restored
   - Repository paths are verified to ensure they still exist
   - Invalid paths are automatically cleaned up
   - The first repository is auto-selected for convenience
4. **Repository Selection**: When users select a repository, the `last_opened` timestamp is updated

## Benefits

- Users don't need to re-add repositories every time they open the app
- Repository order is preserved (sorted by last opened)
- Automatic cleanup of deleted/moved repositories
- Better user experience with persistent workspace

## Database Location

The SQLite database is stored in the app's user data directory:
- macOS: `~/Library/Application Support/mdgent/mdgent.db`
- Windows: `%APPDATA%/mdgent/mdgent.db`
- Linux: `~/.config/mdgent/mdgent.db`