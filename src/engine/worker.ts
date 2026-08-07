/**
 * Runs synthesis off the main thread.
 *
 * A render is tens of megabytes of model weights and several seconds of maths,
 * so keeping it here is what lets the studio stay responsive while it works.
 */

import { render, type Progress, type RenderRequest } from './synth'
import { encodeWav } from './wav'

export type WorkerRequest = { id: number } & RenderRequest

export type WorkerResponse =
  | ({ id: number; type: 'progress' } & Progress)
  | { id: number; type: 'done'; wav: ArrayBuffer; seconds: number; clauses: number }
  | { id: number; type: 'error'; message: string }

function post(message: WorkerResponse, transfer?: Transferable[]) {
  self.postMessage(message, { transfer: transfer ?? [] })
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const { id, ...request } = event.data

  try {
    const result = await render(request, (progress) => post({ id, type: 'progress', ...progress }))
    const wav = encodeWav(result.audio, result.sampleRate)
    post({ id, type: 'done', wav, seconds: result.seconds, clauses: result.clauses }, [wav])
  } catch (error) {
    post({ id, type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})
