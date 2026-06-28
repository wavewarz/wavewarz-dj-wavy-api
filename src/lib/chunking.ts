export type AudioChunkWindow = {
  startSeconds: number
  durationSeconds: number
}

export const DJ_WAVY_CHUNK_WINDOWS: AudioChunkWindow[] = [
  { startSeconds: 30, durationSeconds: 45 },
  { startSeconds: 90, durationSeconds: 45 },
  { startSeconds: 150, durationSeconds: 45 },
]
