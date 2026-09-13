'use client'

/** −, + and "fit all" buttons (README §2), plus the subtle "following" indicator during
 *  playback (README §4). Presentational — the caller owns what each button actually does. */

import type { CSSProperties } from 'react'

import { usePrefersReducedMotion } from '../usePrefersReducedMotion'

const buttonStyle: CSSProperties = {
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid rgba(231,226,214,0.2)',
  borderRadius: 3,
  background: 'transparent',
  color: 'rgba(231,226,214,0.75)',
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1,
  padding: 0,
}

interface ZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitAll: () => void
  following: boolean
}

export function ZoomControls({ onZoomIn, onZoomOut, onFitAll, following }: ZoomControlsProps) {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut} style={buttonStyle}>
        {'−'}
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn} style={buttonStyle}>
        {'+'}
      </button>
      <button type="button" aria-label="Fit all" title="Fit all of Earth's history" onClick={onFitAll} style={buttonStyle}>
        {'⤢'}
      </button>
      <span
        aria-live="polite"
        style={{
          fontSize: 10,
          letterSpacing: '0.04em',
          color: 'rgba(217,154,78,0.85)',
          opacity: following ? 1 : 0,
          transition: reducedMotion ? 'none' : 'opacity 200ms ease',
          minWidth: 0,
        }}
      >
        {following ? 'following' : ''}
      </span>
    </div>
  )
}
