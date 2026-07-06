export type AudioChunkWindow = {
  startSeconds: number
  durationSeconds: number
}

export const DJ_WAVY_CHUNK_WINDOWS: AudioChunkWindow[] = [
  { startSeconds: 30, durationSeconds: 45 },
  { startSeconds: 90, durationSeconds: 45 },
]

export const getChunkWindows = (durationSeconds: number | null): AudioChunkWindow[] => {
  if (durationSeconds == null || durationSeconds >= 150) return DJ_WAVY_CHUNK_WINDOWS

  const d = durationSeconds

  const w1Start = Math.max(10, Math.floor(d * 0.20))
  const w1Dur = Math.min(45, Math.floor(d * 0.35))

  const w2Start = Math.max(w1Start + w1Dur + 5, Math.floor(d * 0.55))
  const w2Dur = Math.min(45, Math.floor(d - w2Start - 2))

  const windows: AudioChunkWindow[] = [{ startSeconds: w1Start, durationSeconds: w1Dur }]
  if (w2Dur >= 5) windows.push({ startSeconds: w2Start, durationSeconds: w2Dur })

  return windows
}
