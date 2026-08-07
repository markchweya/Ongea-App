/** Wrap a mono float buffer as 16-bit PCM in a RIFF container. */
export function encodeWav(audio: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + audio.length * bytesPerSample)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + audio.length * bytesPerSample, true)
  ascii(8, 'WAVE')

  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // format: uncompressed PCM
  view.setUint16(22, 1, true) // channels
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  view.setUint16(32, bytesPerSample, true) // block align
  view.setUint16(34, 8 * bytesPerSample, true)

  ascii(36, 'data')
  view.setUint32(40, audio.length * bytesPerSample, true)

  for (let i = 0; i < audio.length; i++) {
    const sample = Math.max(-1, Math.min(1, audio[i]))
    view.setInt16(44 + i * bytesPerSample, Math.round(sample * 32767), true)
  }

  return buffer
}
