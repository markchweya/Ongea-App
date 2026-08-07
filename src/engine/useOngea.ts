/** React binding for the synthesis worker. */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { RenderRequest } from './synth'
import type { WorkerRequest, WorkerResponse } from './worker'

export type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; ratio: number }
  | { kind: 'speaking'; clause: number; total: number }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string }

export interface Clip {
  url: string
  seconds: number
  clauses: number
}

export function useOngea() {
  const workerRef = useRef<Worker | null>(null)
  const pendingId = useRef(0)
  const clipUrl = useRef<string | null>(null)

  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [clip, setClip] = useState<Clip | null>(null)

  useEffect(() => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      // A newer request has already been sent; this one no longer matters.
      if (message.id !== pendingId.current) return

      if (message.type === 'progress') {
        setStatus(
          message.stage === 'loading'
            ? { kind: 'loading', ratio: message.ratio }
            : { kind: 'speaking', clause: message.clause, total: message.total },
        )
        return
      }

      if (message.type === 'error') {
        setStatus({ kind: 'failed', message: message.message })
        return
      }

      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current)
      const url = URL.createObjectURL(new Blob([message.wav], { type: 'audio/wav' }))
      clipUrl.current = url

      setClip({ url, seconds: message.seconds, clauses: message.clauses })
      setStatus({ kind: 'ready' })
    })

    return () => {
      worker.terminate()
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current)
    }
  }, [])

  const speak = useCallback((request: RenderRequest) => {
    const worker = workerRef.current
    if (!worker) return

    pendingId.current += 1
    setStatus({ kind: 'loading', ratio: 0 })
    worker.postMessage({ id: pendingId.current, ...request } satisfies WorkerRequest)
  }, [])

  const busy = status.kind === 'loading' || status.kind === 'speaking'
  return { clip, speak, status, busy }
}
