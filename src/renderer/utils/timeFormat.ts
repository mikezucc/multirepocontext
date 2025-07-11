export function formatTimeSince(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)
  
  if (years > 0) {
    return years === 1 ? '1 year ago' : `${years} years ago`
  } else if (months > 0) {
    return months === 1 ? '1 month ago' : `${months} months ago`
  } else if (weeks > 0) {
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  } else if (days > 0) {
    return days === 1 ? '1 day ago' : `${days} days ago`
  } else if (hours > 0) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  } else if (minutes > 0) {
    return minutes === 1 ? '1 min ago' : `${minutes} mins ago`
  } else if (seconds > 30) {
    return `${seconds} secs ago`
  } else {
    return 'just now'
  }
}

export function formatCompactTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)
  
  if (years > 0) {
    return `${years}y`
  } else if (months > 0) {
    return `${months}mo`
  } else if (weeks > 0) {
    return `${weeks}w`
  } else if (days > 0) {
    return `${days}d`
  } else if (hours > 0) {
    return `${hours}h`
  } else if (minutes > 0) {
    return `${minutes}m`
  } else {
    return 'now'
  }
}