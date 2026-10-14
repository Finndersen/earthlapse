/**
 * The page's one native `AudioContext`, owned here rather than by Tone.js so it can be created
 * and resumed synchronously inside a user-gesture handler. WebKit (iOS Safari above all) honours
 * `resume()` only within the gesture's own call stack — never after a React re-render or an
 * awaited `import('tone')` — so `engine.ts` calls `unlockAudio()` straight from its handlers and
 * hands this same context to Tone (`setContext`) before building any node. Imports no `tone`:
 * nothing here costs anything until sound is wanted.
 */

/** Events that grant user activation for touch as well as mouse and keyboard. A touch
 *  `pointerdown` is not one of them (only a mouse's is), so listening on it alone never unlocks
 *  audio on a phone. */
export const ACTIVATION_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const

let context: AudioContext | null = null

/** Lazily created; null where Web Audio is unavailable (jsdom, very old browsers). */
export function sharedAudioContext(): AudioContext | null {
  if (context === null && typeof AudioContext !== 'undefined') context = new AudioContext()
  return context
}

/** Must be called synchronously from a user-gesture handler. Also recovers a context iOS left
 *  `suspended` or `interrupted` (a call, Siri, an app switch), which only a gesture can resume. */
export function unlockAudio(): void {
  preferPlaybackSession()
  const ctx = sharedAudioContext()
  if (ctx !== null && ctx.state !== 'running') ctx.resume().catch(() => {})
}

/** iOS plays Web Audio in the "ambient" session by default, which the ring/silent switch mutes
 *  outright. "playback" ignores the switch — what a deliberate "sound on" means. Safari 16.4+;
 *  absent elsewhere. */
function preferPlaybackSession(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session !== undefined && session.type !== 'playback') session.type = 'playback'
}
