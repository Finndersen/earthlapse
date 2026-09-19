/**
 * The HUD speaker toggle + master volume (ADR-023, DESIGN.md §11's v1 note: "a HUD speaker
 * toggle... a master volume alongside it"). Rendered in `ShellLayout.tsx`'s own `sound` slot,
 * beneath the ancestor panel — it needs no position of its own. `M` still mutes/unmutes from
 * anywhere in the document (`useMuteShortcut`, independent
 * of `timeline/keyboard.ts`'s own, differently-scoped intent map — see that hook's own comment).
 */

'use client'

import { useEffect, useRef, useState } from 'react'

import type { AudioEngineControls } from './engine'
import styles from './toggle.module.css'

export type SoundToggleProps = AudioEngineControls

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA'])

function isTextInputTarget(target: EventTarget | null): boolean {
  return target instanceof Element && TEXT_INPUT_TAGS.has(target.tagName)
}

/** `M` mutes/unmutes, mirroring `timeline/keyboard.ts`'s own contract (ignored while the
 *  event's target is a text input, so it never hijacks typing) — reimplemented locally rather
 *  than imported, since that module maps a different, timeline-focus-scoped set of intents and
 *  this package's scope boundary keeps it out of `web/src/timeline/**`. */
function useMuteShortcut(enabled: boolean, setEnabled: (enabled: boolean) => void): void {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'm' && event.key !== 'M') return
      if (isTextInputTarget(event.target)) return
      setEnabled(!enabledRef.current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setEnabled])
}

export function SoundToggle({ enabled, active, masterVolume, setEnabled, setMasterVolume }: SoundToggleProps) {
  const [justChanged, setJustChanged] = useState(false)
  useMuteShortcut(enabled, setEnabled)

  // The viewer has asked for sound, but the browser hasn't yet let `AudioContext` actually start
  // (no gesture on the page yet — e.g. straight off a cold load, sound on by default). `enabled`
  // alone would render this identically to genuinely-playing sound, which is exactly the lie
  // CLAUDE.md's "UI must not lie" rule calls out: nothing is audible yet, so the button must not
  // claim it is.
  const pending = enabled && !active

  return (
    <div className={styles.wrap} data-expanded={enabled}>
      <button
        type="button"
        className={styles.button}
        aria-pressed={enabled}
        aria-label={pending ? 'Sound on — starts on your next click or key press (M)' : enabled ? 'Mute ambience and score (M)' : 'Play ambience and score (M)'}
        title={pending ? 'Sound on — starting…' : enabled ? 'Mute (M)' : 'Sound (M)'}
        onClick={() => {
          setEnabled(!enabled)
          setJustChanged(true)
          window.setTimeout(() => setJustChanged(false), 300)
        }}
        data-just-changed={justChanged}
        data-pending={pending}
      >
        <SpeakerIcon muted={!enabled} pending={pending} />
      </button>
      {/* Always rendered, not conditional on `enabled`: mounting/unmounting the slider changes
          this control's own rendered width, which shifts every sibling in the transport's
          secondary group — the sound button itself would jump under a second click meant to
          mute it. `visibility`/`pointer-events` hide it while muted instead, the same "reserve
          the space, don't remove the element" pattern `Transport.module.css`'s `.rateReadout`
          uses — `tabIndex={-1}` and `aria-hidden` while muted keep it out of both the tab order
          and the accessibility tree, since it controls a volume that has no audible effect until
          sound is on. */}
      <input
        type="range"
        className={styles.volume}
        min={0}
        max={1}
        step={0.01}
        value={masterVolume}
        aria-label="Master volume"
        aria-hidden={!enabled}
        tabIndex={enabled ? 0 : -1}
        data-visible={enabled}
        onChange={(event) => setMasterVolume(Number(event.target.value))}
      />
    </div>
  )
}

/** Three distinct glyphs, not two — `muted` (crossed out), `pending` (one wave: sound is wanted
 *  but the browser hasn't let it start yet), and neither (two waves: genuinely audible). Collapsing
 *  `pending` into the same double-wave glyph as truly-active sound is exactly the lie CLAUDE.md's
 *  "UI must not lie" rule forbids — the button would look identical whether or not anything is
 *  actually playing. */
function SpeakerIcon({ muted, pending }: { muted: boolean; pending: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" strokeLinejoin="round" />
      {muted ? (
        <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />
      ) : pending ? (
        <path d="M16.5 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
      ) : (
        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" />
      )}
    </svg>
  )
}
