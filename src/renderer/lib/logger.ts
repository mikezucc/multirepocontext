import log from 'electron-log/renderer'

// Configure renderer logging
log.transports.console.level = 'info'

// Create a scoped logger for easier tracking
export const logger = log.scope('renderer')

// Export specific log methods for convenience
export const logInfo = (message: string, ...args: any[]) => logger.info(message, ...args)
export const logError = (message: string, ...args: any[]) => logger.error(message, ...args)
export const logWarn = (message: string, ...args: any[]) => logger.warn(message, ...args)
export const logDebug = (message: string, ...args: any[]) => logger.debug(message, ...args)

export default logger