/**
 * The HUD speaker toggle + master volume (ADR-023, DESIGN.md §11's v1 note: "a HUD speaker
 * toggle... a master volume alongside it"). Renders as its own fixed-position element rather
 * than through a `ShellLayout` slot — this package's scope boundary is "one hook call + one
 * component render inside `Experience.tsx`", and `ShellLayout.tsx`/`.module.css` are being
 * edited concurrently by another agent (never `Write`-replaced from here), so the toggle owns
 * a small chrome-less corner of its own instead of asking for a new named slot. Placed top
 * right, clear of the ancestor panel's own `padding-top` gap and of the bottom transport row
 * another agent is centring — see `toggle.module.css`.
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

export function SoundToggle({ enabled, masterVolume, setEnabled, setMasterVolume }: SoundToggleProps) {
  const [justChanged, setJustChanged] = useState(false)
  useMuteShortcut(enabled, setEnabled)

  return (
    <div className={styles.wrap} data-expanded={enabled}>
      <button
        type="button"
        className={styles.button}
        aria-pressed={enabled}
        aria-label={enabled ? 'Mute ambience and score (M)' : 'Play ambience and score (M)'}
        title={enabled ? 'Mute (M)' : 'Sound (M)'}
        onClick={() => {
          setEnabled(!enabled)
          setJustChanged(true)
          window.setTimeout(() => setJustChanged(false), 300)
        }}
        data-just-changed={justChanged}
      >
        <SpeakerIcon muted={!enabled} />
      </button>
      {enabled && (
        <input
          type="range"
          className={styles.volume}
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          aria-label="Master volume"
          onChange={(event) => setMasterVolume(Number(event.target.value))}
        />
      )}
    </div>
  )
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" strokeLinejoin="round" />
      {muted ? (
        <path d="M16 9l5 6M21 9l-5 6" strokeLinecap="round" />
      ) : (
        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" />
      )}
    </svg>
  )
}
