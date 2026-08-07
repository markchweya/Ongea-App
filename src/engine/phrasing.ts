/**
 * Turn a written script into clauses the model can breathe through.
 *
 * MMS tokenizers have no symbol for a comma or a full stop. Punctuation is
 * stripped before the model ever sees it, which is why a paragraph comes back
 * as one unbroken run of words. Ongea cuts the script on its punctuation
 * instead, renders each clause separately, and rebuilds the pauses as silence.
 */

/** Rest after a clause, in seconds, at the default pause setting. */
const SENTENCE_PAUSE = 0.44
const PARAGRAPH_PAUSE = 0.8
const TRAILING_PAUSE = 0.12

const PAUSE_BY_MARK: Record<string, number> = {
  ',': 0.2,
  ';': 0.3,
  ':': 0.3,
  '-': 0.24,
  '.': SENTENCE_PAUSE,
  '!': SENTENCE_PAUSE,
  '?': SENTENCE_PAUSE,
  '…': 0.62,
}

/** A run of clause- or sentence-final punctuation, or a spaced dash used as one. */
const BREAK = /([,;:!?.…]+|\s+[-–—]\s+)(?=["'”’»)\]]*(\s|$))/g
/** A decimal point or thousands separator, which is not a pause. */
const INNER_NUMBER = /(?<=\d)[.,](?=\d)/g
const HORIZONTAL_SPACE = /[^\S\n]+/g
const UNSPEAKABLE = /[^\p{L}\p{N}\s'ʼ-]/gu

const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—]/g, '-'],
  [/&/g, ' and '],
  [/\.{3,}/g, '…'],
]

export interface Clause {
  /** Words to render, with every mark the model cannot pronounce removed. */
  text: string
  /** Silence to place after this clause, in seconds. */
  pause: number
}

/** Normalise a script without changing what it says. */
export function tidy(script: string): string {
  let text = script.normalize('NFC')
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement)

  return text
    .replace(HORIZONTAL_SPACE, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

function speakable(fragment: string): string {
  return fragment.replace(UNSPEAKABLE, ' ').replace(/\s+/g, ' ').trim()
}

function splitLine(line: string, closingPause: number): Clause[] {
  const clauses: Clause[] = []
  const guarded = line.replace(INNER_NUMBER, ' ')
  let cursor = 0

  for (const match of guarded.matchAll(BREAK)) {
    const mark = match[1].trim().charAt(0) || '-'
    const rest = PAUSE_BY_MARK[mark] ?? SENTENCE_PAUSE
    const spoken = speakable(guarded.slice(cursor, match.index))
    cursor = match.index + match[1].length

    if (spoken) {
      clauses.push({ text: spoken, pause: rest })
    } else if (clauses.length) {
      // Punctuation with no words in front of it, as in a stray "?!", only
      // lengthens the rest that is already pending.
      const previous = clauses[clauses.length - 1]
      previous.pause = Math.max(previous.pause, rest)
    }
  }

  const tail = speakable(guarded.slice(cursor))
  if (tail) {
    clauses.push({ text: tail, pause: closingPause })
  } else if (clauses.length) {
    clauses[clauses.length - 1].pause = closingPause
  }

  return clauses
}

/**
 * Break a script into clauses carrying the pause each one has earned.
 *
 * `pauseScale` stretches or tightens every rest together, so the Pause control
 * moves the whole delivery rather than a single mark.
 */
export function splitIntoClauses(script: string, pauseScale = 1): Clause[] {
  const text = tidy(script)
  if (!text) return []

  const clauses: Clause[] = []
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim())

  blocks.forEach((block, blockIndex) => {
    const lines = block.split('\n').filter((line) => line.trim())
    const lastBlock = blockIndex === blocks.length - 1

    lines.forEach((line, lineIndex) => {
      const lastLine = lineIndex === lines.length - 1
      const closing = lastLine ? (lastBlock ? TRAILING_PAUSE : PARAGRAPH_PAUSE) : SENTENCE_PAUSE
      clauses.push(...splitLine(line, closing))
    })
  })

  if (!clauses.length) return []

  const scaled = clauses.map(({ text: clauseText, pause }) => ({
    text: clauseText,
    pause: Math.round(pause * pauseScale * 1000) / 1000,
  }))
  // Nothing to wait for after the final word.
  const last = scaled[scaled.length - 1]
  last.pause = Math.min(last.pause, TRAILING_PAUSE)
  return scaled
}
