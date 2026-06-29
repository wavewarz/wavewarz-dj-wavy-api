// eslint-disable-next-line @typescript-eslint/no-var-requires
const FFT: any = require('fft.js')

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const clamp10 = (x: number) => Math.max(0, Math.min(10, x))

const rms = (x: Float32Array): number => {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, x.length))
}

const peak = (x: Float32Array): number => {
  let p = 0
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i])
    if (a > p) p = a
  }
  return p
}

const zcr = (x: Float32Array): number => {
  let c = 0
  for (let i = 1; i < x.length; i++) {
    const a = x[i - 1]
    const b = x[i]
    if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) c++
  }
  return c / Math.max(1, x.length - 1)
}

const spectralFeatures = (input: {
  samples: Float32Array
  sampleRateHz: number
  frameSize: number
  hopSize: number
}): {
  centroidHz: number
  rolloffHz: number
  flatness: number
  bandEnergy: { low: number; mid: number; high: number }
  onsetDensityPerSec: number
} => {
  const { samples, sampleRateHz, frameSize, hopSize } = input

  const fft = new FFT(frameSize)
  const windowed = new Array<number>(frameSize)
  const out = fft.createComplexArray() as number[]

  let centroidAcc = 0
  let rolloffAcc = 0
  let flatnessAcc = 0
  let frames = 0

  let lowAcc = 0
  let midAcc = 0
  let highAcc = 0

  // onset via energy envelope peaks
  const energies: number[] = []

  const nyquist = sampleRateHz / 2
  const binHz = nyquist / (frameSize / 2)

  for (let off = 0; off + frameSize <= samples.length; off += hopSize) {
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameSize - 1))
      windowed[i] = samples[off + i] * w
    }

    // real input into complex array
    const inp = fft.createComplexArray() as number[]
    for (let i = 0; i < frameSize; i++) {
      inp[2 * i] = windowed[i]
      inp[2 * i + 1] = 0
    }

    fft.transform(out, inp)

    let magSum = 0
    let freqMagSum = 0

    let specSum = 0
    let specLogSum = 0

    let low = 0
    let mid = 0
    let high = 0

    const mags: number[] = []

    for (let k = 0; k < frameSize / 2; k++) {
      const re = out[2 * k]
      const im = out[2 * k + 1]
      const mag = Math.sqrt(re * re + im * im)
      mags.push(mag)

      const f = k * binHz
      magSum += mag
      freqMagSum += f * mag

      specSum += mag
      specLogSum += Math.log(Math.max(1e-12, mag))

      if (f < 250) low += mag
      else if (f < 4000) mid += mag
      else high += mag
    }

    const centroid = magSum > 0 ? freqMagSum / magSum : 0

    // rolloff (85%)
    const target = magSum * 0.85
    let run = 0
    let rolloff = 0
    for (let k = 0; k < mags.length; k++) {
      run += mags[k]
      if (run >= target) {
        rolloff = k * binHz
        break
      }
    }

    const arithmetic = specSum / Math.max(1, mags.length)
    const geometric = Math.exp(specLogSum / Math.max(1, mags.length))
    const flatness = arithmetic > 0 ? geometric / arithmetic : 0

    centroidAcc += centroid
    rolloffAcc += rolloff
    flatnessAcc += flatness

    lowAcc += low
    midAcc += mid
    highAcc += high

    // energy for onset
    let e = 0
    for (let i = 0; i < frameSize; i++) e += windowed[i] * windowed[i]
    energies.push(e)

    frames++
  }

  // onset density: count local peaks in energy derivative
  let onsets = 0
  for (let i = 2; i < energies.length; i++) {
    const d0 = energies[i - 1] - energies[i - 2]
    const d1 = energies[i] - energies[i - 1]
    if (d0 > 0 && d1 < 0 && energies[i - 1] > 0) onsets++
  }

  const durationSeconds = samples.length / Math.max(1, sampleRateHz)
  const onsetDensityPerSec = durationSeconds > 0 ? onsets / durationSeconds : 0

  const bandTotal = lowAcc + midAcc + highAcc
  const bandEnergy = {
    low: bandTotal > 0 ? lowAcc / bandTotal : 0,
    mid: bandTotal > 0 ? midAcc / bandTotal : 0,
    high: bandTotal > 0 ? highAcc / bandTotal : 0,
  }

  return {
    centroidHz: frames > 0 ? centroidAcc / frames : 0,
    rolloffHz: frames > 0 ? rolloffAcc / frames : 0,
    flatness: frames > 0 ? flatnessAcc / frames : 0,
    bandEnergy,
    onsetDensityPerSec,
  }
}

export type LocalAudioFeatures = {
  rms: number
  peak: number
  zcr: number
  centroidHz: number
  rolloffHz: number
  flatness: number
  bandEnergy: { low: number; mid: number; high: number }
  onsetDensityPerSec: number
}

export const analyzePcmWindow = (input: { samples: Float32Array; sampleRateHz: number }): LocalAudioFeatures => {
  const r = rms(input.samples)
  const p = peak(input.samples)
  const z = zcr(input.samples)

  const frameSize = 2048
  const hopSize = 512

  const spec = spectralFeatures({
    samples: input.samples,
    sampleRateHz: input.sampleRateHz,
    frameSize,
    hopSize,
  })

  return {
    rms: r,
    peak: p,
    zcr: z,
    centroidHz: spec.centroidHz,
    rolloffHz: spec.rolloffHz,
    flatness: spec.flatness,
    bandEnergy: spec.bandEnergy,
    onsetDensityPerSec: spec.onsetDensityPerSec,
  }
}

export const mapFeaturesToScores = (f: LocalAudioFeatures): {
  loudness: number
  brightness: number
  dynamicRange: number
  vocalPresence: number
  mixClarity: number
  energy: number
  notes: string
} => {
  // Loudness: rms roughly [0..0.3] typical after decode, scale to 0..10.
  const loudness = clamp10(f.rms * 50)

  // Brightness: spectral centroid normalized to nyquist ~8k (if 16k sample rate)
  const brightness = clamp10((f.centroidHz / 8000) * 10)

  // Dynamic range: peak/rms ratio (higher = more dynamic)
  const dr = f.rms > 1e-6 ? f.peak / f.rms : 0
  const dynamicRange = clamp10((dr / 6) * 10)

  // Vocal presence: midband energy proxy (250-4000Hz)
  const vocalPresence = clamp10(f.bandEnergy.mid * 12)

  // Mix clarity: inverse flatness (more tonal/less noise-like) + penalize extreme highs
  const clarityBase = 1 - clamp01(f.flatness)
  const mixClarity = clamp10(clarityBase * 10)

  // Energy: loudness + onset density
  const onsetScore = clamp10((f.onsetDensityPerSec / 6) * 10)
  const energy = clamp10(loudness * 0.6 + onsetScore * 0.4)

  const notes =
    `rms=${f.rms.toFixed(4)}, peak=${f.peak.toFixed(4)}, centroidHz=${Math.round(f.centroidHz)}, ` +
    `rolloffHz=${Math.round(f.rolloffHz)}, flatness=${f.flatness.toFixed(3)}, ` +
    `band(mid=${f.bandEnergy.mid.toFixed(2)}, high=${f.bandEnergy.high.toFixed(2)}), ` +
    `onsets/s=${f.onsetDensityPerSec.toFixed(2)}`

  return { loudness, brightness, dynamicRange, vocalPresence, mixClarity, energy, notes }
}
