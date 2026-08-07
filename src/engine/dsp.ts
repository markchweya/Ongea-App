/**
 * Signal work that gives every render the same vocal register.
 *
 * All of it runs inside the synthesis worker, so nothing here may touch the
 * DOM or the Web Audio API — both are unavailable off the main thread. Buffers
 * are mono Float32Array in [-1, 1].
 */

/** Widest believable range for a speaking voice. Outside it the estimator is wrong, not the speaker. */
const PITCH_FLOOR_HZ = 55
const PITCH_CEILING_HZ = 400

/**
 * Median fundamental frequency across the voiced frames of a clip, or null when
 * there is too little voiced speech to judge.
 *
 * Normalised autocorrelation, taking the earliest qualifying peak rather than
 * the tallest. Picking the tallest lands on the sub-harmonic often enough to
 * throw a whole clause an octave off, which is exactly the failure this module
 * exists to prevent.
 */
export function medianPitch(audio: Float32Array, sampleRate: number): number | null {
  const frame = Math.round(0.04 * sampleRate)
  const hop = Math.round(0.01 * sampleRate)
  if (audio.length < frame * 2) return null

  const minLag = Math.max(1, Math.floor(sampleRate / PITCH_CEILING_HZ))
  const maxLag = Math.min(frame - 1, Math.floor(sampleRate / PITCH_FLOOR_HZ))
  if (maxLag <= minLag) return null

  // Voiced frames are loud relative to the clip, so gate on a share of the
  // overall level rather than a fixed threshold that breaks on quiet renders.
  const gate = rms(audio, 0, audio.length) * 0.5
  if (gate <= 0) return null

  const readings: number[] = []

  for (let start = 0; start + frame < audio.length; start += hop) {
    if (rms(audio, start, frame) < gate) continue

    const segment = centred(audio, start, frame)
    let energy = 0
    for (let i = 0; i < frame; i++) energy += segment[i] * segment[i]
    if (energy <= 0) continue

    let best = 0
    const scores = new Float32Array(maxLag - minLag + 1)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0
      for (let i = 0; i + lag < frame; i++) sum += segment[i] * segment[i + lag]
      const score = sum / energy
      scores[lag - minLag] = score
      if (score > best) best = score
    }
    if (best < 0.4) continue

    const threshold = best * 0.85
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] >= threshold) {
        readings.push(sampleRate / (i + minLag))
        break
      }
    }
  }

  if (readings.length < 4) return null
  readings.sort((a, b) => a - b)
  return readings[readings.length >> 1]
}

/**
 * Stretch a clip to `factor` times its length while holding pitch steady.
 *
 * Waveform-similarity overlap-add: the synthesis hop is fixed and each source
 * frame is nudged within a small search window onto the offset whose waveform
 * lines up with what has already been written. That alignment is what keeps the
 * joins from clicking through voiced speech.
 */
export function timeStretch(audio: Float32Array, factor: number): Float32Array {
  if (Math.abs(factor - 1) < 1e-3 || audio.length < 2048) return audio

  const frame = 1024
  const synthesisHop = frame >> 1
  const analysisHop = synthesisHop / factor
  const search = frame >> 2
  const window = hann(frame)

  const capacity = Math.ceil(audio.length * factor) + frame
  const output = new Float32Array(capacity)
  const weight = new Float32Array(capacity)

  let expected = audio.subarray(0, frame)
  let writeAt = 0
  let position = 0

  while (writeAt + frame <= capacity) {
    const centre = Math.round(position)
    const lowest = Math.min(Math.max(centre - search, 0), audio.length - frame)
    const highest = Math.min(centre + search, audio.length - frame)
    if (lowest > highest) break

    const offset = bestAlignment(audio, expected, lowest, highest, synthesisHop)
    for (let i = 0; i < frame; i++) {
      output[writeAt + i] += audio[offset + i] * window[i]
      weight[writeAt + i] += window[i]
    }

    if (offset + synthesisHop + frame > audio.length) break
    expected = audio.subarray(offset + synthesisHop, offset + synthesisHop + frame)
    writeAt += synthesisHop
    position += analysisHop
  }

  const length = writeAt + frame
  const stretched = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    stretched[i] = weight[i] > 1e-6 ? output[i] / weight[i] : 0
  }
  return stretched
}

/** Offset in [lowest, highest] whose opening samples best match `expected`. */
function bestAlignment(
  audio: Float32Array,
  expected: Float32Array,
  lowest: number,
  highest: number,
  compareLength: number,
): number {
  if (highest <= lowest) return lowest

  let bestOffset = lowest
  let bestScore = -Infinity
  const length = Math.min(compareLength, expected.length)

  for (let offset = lowest; offset <= highest; offset++) {
    let score = 0
    for (let i = 0; i < length; i++) score += audio[offset + i] * expected[i]
    if (score > bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }
  return bestOffset
}

/**
 * Read a clip back at `ratio` times speed, band-limiting as it goes.
 *
 * The windowed-sinc kernel narrows its cutoff when the ratio is above one,
 * which is what stops a downward read from folding high frequencies back into
 * the speech as aliasing.
 */
export function resample(audio: Float32Array, ratio: number): Float32Array {
  if (Math.abs(ratio - 1) < 1e-4 || audio.length === 0) return audio

  const cutoff = Math.min(1, 1 / ratio)
  const lobes = 12
  const halfWidth = lobes / cutoff
  const length = Math.max(1, Math.floor(audio.length / ratio))
  const output = new Float32Array(length)

  for (let i = 0; i < length; i++) {
    const centre = i * ratio
    const first = Math.max(0, Math.ceil(centre - halfWidth))
    const last = Math.min(audio.length - 1, Math.floor(centre + halfWidth))

    let sum = 0
    let gain = 0
    for (let j = first; j <= last; j++) {
      const distance = (j - centre) * cutoff
      const tap = sinc(distance) * blackman(distance / lobes)
      sum += audio[j] * tap
      gain += tap
    }
    output[i] = gain > 1e-6 ? sum / gain : 0
  }
  return output
}

/**
 * Positions of the glottal pulses, roughly one period apart.
 *
 * Walks outward from the loudest sample, each step taking the largest peak in
 * the window where the next pulse is due. Anchoring on real pulses is what lets
 * the grains below be re-spaced without smearing the waveform.
 */
function pitchMarks(audio: Float32Array, period: number): number[] {
  const lowest = Math.round(period * 0.7)
  const highest = Math.round(period * 1.4)
  if (lowest < 2 || audio.length < highest * 3) return []

  let loudest = 0
  for (let i = 1; i < audio.length; i++) {
    if (Math.abs(audio[i]) > Math.abs(audio[loudest])) loudest = i
  }

  const peakBetween = (from: number, to: number) => {
    let best = from
    for (let i = from; i <= to; i++) {
      if (Math.abs(audio[i]) > Math.abs(audio[best])) best = i
    }
    return best
  }

  const marks = [loudest]
  for (let at = loudest; ; ) {
    const from = at + lowest
    const to = Math.min(at + highest, audio.length - 1)
    if (from >= to) break
    at = peakBetween(from, to)
    marks.push(at)
  }
  for (let at = loudest; ; ) {
    const to = at - lowest
    const from = Math.max(at - highest, 0)
    if (from >= to) break
    at = peakBetween(from, to)
    marks.unshift(at)
  }

  return marks
}

/**
 * Whether the waveform repeats across a mark, which is what voicing looks like.
 *
 * `period` must be the distance to the neighbouring mark, not the clause median.
 * Correlating at a lag the speaker is not currently using reports almost
 * everything as unvoiced, and unvoiced grains are the ones PSOLA leaves alone.
 */
function isVoiced(audio: Float32Array, at: number, period: number): boolean {
  const half = Math.round(period)
  const from = at - half
  const to = at + half
  if (half < 2 || from < 0 || to + half >= audio.length) return false

  let cross = 0
  let here = 0
  let there = 0
  for (let i = 0; i < half * 2; i++) {
    const a = audio[from + i]
    const b = audio[from + i + half]
    cross += a * b
    here += a * a
    there += b * b
  }
  const scale = Math.sqrt(here * there)
  return scale > 1e-9 && cross / scale > 0.35
}

/**
 * Move a clip onto a new pitch and duration, leaving the formants where they
 * are.
 *
 * Time-domain PSOLA: one grain is cut around each glottal pulse and the grains
 * are laid back down at a new spacing. Because each grain keeps its own
 * waveform, the resonances of the speaker's vocal tract survive the move — which
 * is the whole point. Resampling instead would scale the formants by the same
 * ratio as the pitch, and a clause that had to travel an octave would come back
 * sounding like a chipmunk or a giant rather than like a person.
 *
 * Unvoiced grains are re-laid at their original spacing. Squeezing noise into a
 * shorter period gives it a pitch it should not have, and it buzzes.
 */
export function repitch(
  audio: Float32Array,
  sourcePitch: number,
  pitchScale: number,
  timeScale: number,
  sampleRate: number,
): Float32Array {
  const period = sampleRate / sourcePitch
  const marks = pitchMarks(audio, period)
  if (marks.length < 4) return timeStretch(audio, timeScale)

  // Spacing to the next mark, which tracks the pitch contour where a single
  // median period would not.
  const periods = marks.map((at, i) => (i + 1 < marks.length ? marks[i + 1] - at : at - marks[i - 1]))
  const voiced = marks.map((at, i) => isVoiced(audio, at, periods[i]))
  const length = Math.max(1, Math.round(audio.length * timeScale))
  const output = new Float32Array(length)
  const weight = new Float32Array(length)

  let at = marks[0] * timeScale
  let cursor = 0

  while (at < length) {
    // Follow the analysis marks at whatever rate the time scale asks for.
    const wanted = at / timeScale
    while (cursor < marks.length - 2 && marks[cursor + 1] < wanted) cursor++

    const localPeriod = Math.max(2, marks[cursor + 1] - marks[cursor])
    const centre = marks[cursor]
    const half = Math.min(localPeriod, centre, audio.length - 1 - centre)
    if (half < 2) break

    const start = Math.round(at) - half
    for (let i = -half; i < half; i++) {
      const target = start + i + half
      if (target < 0 || target >= length) continue
      // Hann grain, two periods wide, so neighbours sum back to unity.
      const gain = 0.5 + 0.5 * Math.cos((Math.PI * i) / half)
      output[target] += audio[centre + i] * gain
      weight[target] += gain
    }

    at += voiced[cursor] ? localPeriod / pitchScale : localPeriod
  }

  for (let i = 0; i < length; i++) {
    // A floor of one keeps thin overlap from being amplified into noise.
    output[i] /= Math.max(weight[i], 1)
  }
  return output
}

/**
 * Move a clip onto a voice: pitch to the target, formants only part of the way.
 *
 * Pitch alone does not carry gender. Shifting a low male render up to a female
 * fundamental while leaving male resonances behind produces falsetto, not a
 * woman. So the formants are nudged in the same direction, but gently and
 * within bounds — the resample handles those, and PSOLA then puts the pitch
 * exactly where it belongs without disturbing them again.
 */
export function reshape(
  audio: Float32Array,
  sourcePitch: number,
  targetPitch: number,
  formantRatio: number,
  durationRatio: number,
  sampleRate: number,
): Float32Array {
  const warped = formantRatio === 1 ? audio : resample(audio, formantRatio)
  return repitch(
    warped,
    sourcePitch * formantRatio,
    targetPitch / (sourcePitch * formantRatio),
    durationRatio * formantRatio,
    sampleRate,
  )
}

/** Drop the lead-in and run-out silence, leaving a short cushion of each. */
export function trimSilence(audio: Float32Array, sampleRate: number, keepSeconds = 0.02): Float32Array {
  const frame = Math.max(1, Math.round(0.01 * sampleRate))
  const frames = Math.floor(audio.length / frame)
  if (frames === 0) return audio

  const levels = new Float32Array(frames)
  let peak = 0
  for (let i = 0; i < frames; i++) {
    levels[i] = rms(audio, i * frame, frame)
    if (levels[i] > peak) peak = levels[i]
  }
  if (peak <= 0) return new Float32Array(0)

  const floor = peak * 0.06
  let first = 0
  while (first < frames && levels[first] <= floor) first++
  let last = frames - 1
  while (last > first && levels[last] <= floor) last--
  if (first > last) return new Float32Array(0)

  const cushion = Math.round(keepSeconds * sampleRate)
  const start = Math.max(0, first * frame - cushion)
  const stop = Math.min(audio.length, (last + 1) * frame + cushion)
  return audio.slice(start, stop)
}

/** Taper both ends so concatenated clauses meet without a click. */
export function fadeEdges(audio: Float32Array, sampleRate: number, seconds = 0.008): Float32Array {
  const length = Math.round(seconds * sampleRate)
  if (length < 2 || audio.length < length * 2) return audio

  const faded = audio.slice()
  for (let i = 0; i < length; i++) {
    const gain = i / (length - 1)
    faded[i] *= gain
    faded[faded.length - 1 - i] *= gain
  }
  return faded
}

export function normalisePeak(audio: Float32Array, target = 0.89): Float32Array {
  let peak = 0
  for (let i = 0; i < audio.length; i++) {
    const magnitude = Math.abs(audio[i])
    if (magnitude > peak) peak = magnitude
  }
  if (peak <= 1e-6) return audio

  const gain = target / peak
  const levelled = new Float32Array(audio.length)
  for (let i = 0; i < audio.length; i++) levelled[i] = audio[i] * gain
  return levelled
}

export function concatenate(parts: Float32Array[]): Float32Array {
  let length = 0
  for (const part of parts) length += part.length

  const joined = new Float32Array(length)
  let cursor = 0
  for (const part of parts) {
    joined.set(part, cursor)
    cursor += part.length
  }
  return joined
}

export function silence(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.max(0, Math.round(seconds * sampleRate)))
}

function rms(audio: Float32Array, start: number, length: number): number {
  const stop = Math.min(audio.length, start + length)
  if (stop <= start) return 0

  let sum = 0
  for (let i = start; i < stop; i++) sum += audio[i] * audio[i]
  return Math.sqrt(sum / (stop - start))
}

function centred(audio: Float32Array, start: number, length: number): Float32Array {
  const segment = audio.slice(start, start + length)
  let mean = 0
  for (let i = 0; i < segment.length; i++) mean += segment[i]
  mean /= segment.length || 1
  for (let i = 0; i < segment.length; i++) segment[i] -= mean
  return segment
}

function hann(length: number): Float32Array {
  const window = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1))
  }
  return window
}

function sinc(x: number): number {
  if (Math.abs(x) < 1e-8) return 1
  const scaled = Math.PI * x
  return Math.sin(scaled) / scaled
}

/** Blackman window over [-1, 1], zero outside. */
function blackman(x: number): number {
  if (Math.abs(x) >= 1) return 0
  const phase = Math.PI * (x + 1)
  return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase)
}
