// Internet speed: the level shown by the header's Wi-Fi icon.

export type SpeedLevel = 'offline' | 'unknown' | 'slow' | 'medium' | 'good'

/** Megabits per second, from bytes received in a time. */
export function toMbps(bytes: number, ms: number): number {
  return ms > 0 ? (bytes * 8) / (ms * 1000) : 0
}

/** good: videos start at once; medium: photos are fine, videos may wait; slow: everything waits. */
export function speedLevel(mbps: number | null, online = true): SpeedLevel {
  if (!online) return 'offline'
  if (mbps === null) return 'unknown'
  return mbps >= 10 ? 'good' : mbps >= 2 ? 'medium' : 'slow'
}
