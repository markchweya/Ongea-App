/**
 * What the three studio controls mean.
 *
 * Kept apart from `synth.ts` so the interface can show real units without
 * pulling the model runtime into the main bundle.
 */

export interface Controls {
  /** All three run 0-100 and sit at 50 by default. */
  pace: number
  pitch: number
  pause: number
}

export const DEFAULT_CONTROLS: Controls = { pace: 50, pitch: 50, pause: 50 }

/** Speaking rate as a multiple of the model's own pace. */
export function paceRate(pace: number): number {
  return 0.8 + (clamp(pace) / 100) * 0.4
}

/** How far the voice is trimmed from its register, in semitones. */
export function pitchSemitones(pitch: number): number {
  return ((clamp(pitch) - 50) / 50) * 4
}

/** The same trim as a frequency ratio. */
export function pitchTrim(pitch: number): number {
  return 2 ** (pitchSemitones(pitch) / 12)
}

/** Multiplier applied to every punctuation rest. */
export function pauseScale(pause: number): number {
  return 0.4 + (clamp(pause) / 100) * 1.2
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value))
}
