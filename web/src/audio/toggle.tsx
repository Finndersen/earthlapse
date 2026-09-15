/**
 * The HUD speaker toggle + master volume (ADR-023, DESIGN.md §11's v1 note: "a HUD speaker
 * toggle... a master volume alongside it"). Rendered inline, as the first item of the timeline
 * transport's secondary control group (`timeline/components/Transport.tsx`'s
 * `<TransportSecondary sound={...}>`), right beside play/back/forward — follow-up pass item 2.
 * It previously owned a small fixed-position corner of its own (top right, clear of the
 * ancestor panel and the transport row) while `ShellLayout` was being edited concurrently by
 * another agent; now that it lives inside the transport it needs no position of its own at all,
 * and `ShellLayout.module.css`'s phone `.ancestor` rule no longer reserves room for it there.
 * `M` still mutes/unmutes from anywhere in the document (`useMuteShortcut`, independent of
 * `timeline/keyboard.ts`'s own, differently-scoped intent map — see that hook's own comment).
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
      {/* Always rendered, not conditional on `enabled` (re-review fix, 2026-09-15): mounting/
          unmounting the slider changed this control's own rendered width, which shifted every
          sibling in the transport's secondary group — on desktop the sound button itself jumped
          left, so a second click meant to mute instead landed on the now-relocated slider; on
          phone the speed select and mode toggle shifted too. `visibility`/`pointer-events` hide
          it while muted instead, the same "reserve the space, don't remove the element" pattern
          `Transport.module.css`'s `.rateReadout` already uses for item 10 — `tabIndex={-1}` and
          `aria-hidden` while muted keep it out of both the tab order and the accessibility tree,
          since it controls a volume that has no audible effect until sound is on. */}
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
