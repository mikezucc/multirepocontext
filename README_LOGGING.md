# Electron-log Implementation

electron-log has been successfully integrated into the application for better logging in production builds.

## Log File Locations

When running the built binary, logs are saved to:

- **macOS**: `~/Library/Logs/MultiRepoContext/main.log`
- **Windows**: `%USERPROFILE%\AppData\Roaming\MultiRepoContext\logs\main.log`
- **Linux**: `~/.config/MultiRepoContext/logs/main.log`

## Configuration

The logging system is configured with:
- File transport: `info` level and above
- Console transport: `debug` level in development, `warn` level in production

## Usage

### Main Process
```javascript
import log from 'electron-log/main'

log.info('Information message')
log.error('Error message')
log.warn('Warning message')
log.debug('Debug message')
```

### Renderer Process
```javascript
import logger from './lib/logger'

logger.info('Renderer information')
logger.error('Renderer error')
```

## Viewing Logs

1. **During Development**: Logs appear in the terminal/console
2. **Production Build**: Navigate to the log file location above
3. **Real-time Monitoring**: Use `tail -f ~/Library/Logs/MultiRepoContext/main.log` on macOS/Linux

## Features Implemented

- ✅ Replaced all console.log/error/warn statements with electron-log
- ✅ Configured separate logging for main and renderer processes
- ✅ Set appropriate log levels for development vs production
- ✅ Added application startup information logging
- ✅ Logs include timestamp, level, and process information

## Testing

1. Build the application: `npm run dist:mac`
2. Run the built application
3. Check the log file at `~/Library/Logs/MultiRepoContext/main.log`
4. You should see all application logs including startup info and any errors