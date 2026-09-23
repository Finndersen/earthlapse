'use client'

/** The main scrub track: pointer-drag scrubbing, room-decluttered event uncertainty bands
 *  (ADR-019), clustered scene checkpoint pips (ADR-019), the playhead, the fisheye hover
 *  readout (ADR-017, precision-adaptive per ADR-021), a cluster's member-list popover and the
 *  touch press-and-drag magnifier (both ADR-021). A luminous hairline baseline rather than a
 *  filled panel, per the shared visual language — the hit area (`.hitArea`) stays taller than
 *  anything drawn inside it so the track stays easy to grab. Each pip carries
 *  `data-checkpoint-pip` (a cluster marker carries `data-checkpoint-cluster` instead), a stable
 *  hook the shell uses to recede whatever sits where a pip's hover preview rises.
 *
 *  `scale` is the fisheye-distorted track scale (`fisheyeScale`, owned by `Timeline`) — what is
 *  drawn and what pointer x maps through, over the selected era section's window (ADR-024;
 *  there is no free zoom or pan). No separate undistorted "base" scale is needed to convert a
 *  displayed anchor back: every position on the track *is* `scale.fromUnit(u)`, and dragging
 *  can never leave the window. Because both the event declutter and the pip clustering run on this same distorted
 *  scale, hovering the track reveals detail the resting (undistorted) layout had no room for —
 *  that magnification, not zooming the window, is how a viewer resolves events sitting close
 *  together in time. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { layoutCheckpointPips, type CheckpointClusterLayout, type CheckpointLayoutEntry } from '../checkpointLayout'
import type { TimelineCheckpoint } from '../checkpoints'
import { declutterEvents } from '../declutter'
import type { FisheyeScale } from '../fisheye'
import { yearsPerDisplayedPixelAt } from '../fisheye'
import { formatGeoTime, formatGeoTimePrecise } from '../format'
import { hasExceededTapSlop } from '../markerGesture'
import type { TimeWindow } from '../scale'
import { findSnapTarget, snapCandidates } from '../snap'
import { useTrackWidth } from '../useTrackWidth'
import { clamp, clampUnit } from '../util'
import { ClusterPopover } from './ClusterPopover'
import styles from './ScrubTrack.module.css'
import { TouchMagnifier } from './TouchMagnifier'

/** Most member rows a cluster's hover preview lists before collapsing the rest into "+N more"
 *  — long enough to be useful, short enough to still read as a preview, not a panel. */
const CLUSTER_PREVIEW_MAX_ITEMS = 4

/** Half of `.pipPreview`'s (and the hover readout's) width in the CSS module: content closer
 *  than this to either end of the track anchors to that side instead of centring, so it is
 *  never clipped by the window edge. */
const PREVIEW_HALF_WIDTH_PX = 60

/** Half of `.cluster .pipPreview`'s own (wider, list-carrying) width in the CSS module — a
 *  cluster preview anchored using the plain pip half-width would still overflow the track edge
 *  in the 60-75px band, since it is 30px wider than a lone pip's preview. */
const CLUSTER_PREVIEW_HALF_WIDTH_PX = 75

/** Half of `ClusterPopover`'s own width (`.popover`, 210px, in its CSS module) — same edge-
 *  anchoring role as `CLUSTER_PREVIEW_HALF_WIDTH_PX` above, for the interactive popover rather
 *  than the passive hover preview. */
const CLUSTER_POPOVER_HALF_WIDTH_PX = 105

/** Half of the fisheye hover readout's own realistic worst-case width — wider than a lone pip
 *  preview's `PREVIEW_HALF_WIDTH_PX`: a snapped checkpoint's `.snapLabel` can run up to its own
 *  220px `max-width` (see `ScrubTrack.module.css`) alongside the time text, where a bare pip
 *  preview never carries more than a short label. Anchoring the readout at the narrower,
 *  pip-sized threshold let a long label still run past the viewport edge before the anchor class
 *  kicked in — this is sized for the readout's own content, reusing the same
 *  `previewAnchorClass` edge-anchoring `pipPreview`/`ClusterPopover` already use rather than a
 *  new mechanism. */
const HOVER_READOUT_HALF_WIDTH_PX = 150

/** Rough px per character of the playhead readout (12px monospace). */
const PLAYHEAD_LABEL_CHAR_PX = 7.5

/** Which edge the playhead readout hugs. Selecting an era section puts the playhead on the
 *  track's left edge (ADR-024), where a centred label would hang off screen. */
function playheadLabelAnchor(u: number, label: string, trackWidthPx: number): 'start' | 'center' | 'end' {
  if (!(trackWidthPx > 0)) return 'center'
  const halfWidthPx = (label.length * PLAYHEAD_LABEL_CHAR_PX) / 2
  if (u * trackWidthPx < halfWidthPx) return 'start'
  if ((1 - u) * trackWidthPx < halfWidthPx) return 'end'
  return 'center'
}

function previewAnchorClass(u: number, trackWidthPx: number, halfWidthPx: number = PREVIEW_HALF_WIDTH_PX): string {
  if (u * trackWidthPx < halfWidthPx) return styles.previewStart ?? ''
  if ((1 - u) * trackWidthPx < halfWidthPx) return styles.previewEnd ?? ''
  return ''
}

interface ScrubTrackProps {
  t: GeoTime
  window: TimeWindow
  scale: FisheyeScale
  events: readonly TimelineEvent[]
  checkpoints: readonly TimelineCheckpoint[]
  onScrub: (t: GeoTime) => void
  /** Clicking or tapping a checkpoint cluster marker (ADR-019) both scrubs to its first (oldest)
   *  member via `onScrub` and opens its own in-track member-list popover (`ClusterPopover`,
   *  ADR-021) — this component owns that surface itself, so `onOpenCluster` is only a
   *  notification for a caller that wants to know (e.g. analytics); it is not required to build
   *  any UI in response. */
  onOpenCluster: (members: readonly TimelineCheckpoint[]) => void
  /** The pointer is over the track at displayed unit `u` (a `trackWidthPx`-wide track) — feeds
   *  `Timeline`'s fisheye lens (ADR-017). Fired on hover (mouse) and while dragging (any
   *  pointer type), matching the hover-readout visibility rules below. */
  onLensPointer: (u: number, trackWidthPx: number) => void
  /** The pointer has left the track (or a non-mouse drag ended) — let the lens fade back to
   *  rest. */
  onLensRelease: () => void
}

export function ScrubTrack({
  t,
  window: visibleWindow,
  scale,
  events,
  checkpoints,
  onScrub,
  onOpenCluster,
  onLensPointer,
  onLensRelease,
}: ScrubTrackProps) {
  const [trackRef, trackWidthPx] = useTrackWidth<HTMLDivElement>()

  const uFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      if (rect.width === 0) return 0
      return clampUnit((clientX - rect.left) / rect.width)
    },
    [trackRef],
  )

  // Room-based declutter (ADR-019): every event overlapping the window is a candidate, and
  // importance only breaks a collision between two that would otherwise overlap on screen — see
  // `declutterEvents`'s own doc comment. Reads the fisheye-distorted `scale`, so a stretched
  // region reveals events that lacked room at the resting magnification.
  const shown = useMemo(() => declutterEvents(events, visibleWindow, scale, trackWidthPx), [events, visibleWindow, scale, trackWidthPx])

  const candidates = useMemo(() => snapCandidates(shown, checkpoints, visibleWindow), [shown, checkpoints, visibleWindow])

  // The decluttered events' own displayed bands, in the same `u` space everything else on the
  // track positions against — computed once and shared by the main render below and the touch
  // magnifier (ADR-021), rather than each re-deriving it from `shown`/`scale`.
  const eventBandsU = useMemo(
    () =>
      shown.map((event) => ({
        id: event.id,
        label: event.label,
        uStart: clamp(scale.toUnit(event.tMax), 0, 1),
        uEnd: clamp(scale.toUnit(event.tMin), 0, 1),
      })),
    [shown, scale],
  )

  const scrubToClientX = useCallback(
    (clientX: number): void => {
      const rawT = scale.fromUnit(uFromClientX(clientX))
      const snap = findSnapTarget(candidates, scale, rawT, trackWidthPx)
      onScrub(snap?.t ?? rawT)
    },
    [onScrub, scale, uFromClientX, candidates, trackWidthPx],
  )

  // Hover readout visibility (ADR-017, brief §3: "while the pointer is over the scrub track
  // (and while drag-scrubbing, incl. touch)"). Mouse gets a true hover; touch/pen have none, so
  // they only show it for the duration of an active pointer-down (tracked via
  // `activePointerTypeRef`, since `pointerleave` does not fire for the pointer-capturing
  // element while a drag is in flight, but *is* the right cue to hide it for a released touch).
  const [hoverU, setHoverU] = useState<number | null>(null)
  const activePointerTypeRef = useRef<string | null>(null)

  // A press that only dismisses an open cluster popover (the `handlePointerDown` early return
  // below) must not also scrub if that same gesture goes on to drag before lifting — otherwise a
  // touch drag that starts on a dismiss press moves the playhead as a side effect of what the
  // user meant only as "close this popup". Tracks the pointer id for the remainder of that one
  // gesture; `handlePointerMove` skips `scrubToClientX` while it matches, and it is cleared on
  // pointer up/cancel.
  const dismissingPopoverPointerIdRef = useRef<number | null>(null)

  // Touch/pen press-and-drag arbitration for a press that starts on a pip/cluster marker
  // (`markerGesture.ts`, ADR-021 follow-up) — a marker button's own `onPointerDown` (below, in
  // the render) records which entry a non-mouse press landed on here, for the one tick before
  // that same event reaches `handlePointerDown` (mouse never reaches this: its `onPointerDown`
  // stops propagation before bubbling here, exactly as before this pass). `handlePointerDown`
  // reads and clears it immediately, turning it into `pendingMarkerPressRef` below — this ref
  // only ever holds a value for the instant between those two handlers running.
  const pendingMarkerEntryRef = useRef<CheckpointLayoutEntry | null>(null)

  // The still-undecided half of that same gesture: a touch/pen press that landed on a marker and
  // has not yet moved past `hasExceededTapSlop`, so it could still resolve into either a tap
  // (select the pip / open the cluster, on lift) or a scrub (once `handlePointerMove` sees it
  // clear the slop). Cleared the instant either outcome is decided; `null` whenever no marker
  // press is in this undecided state, which is true for the entire rest of the time (including
  // every mouse gesture, and a touch/pen drag that started on empty track).
  const pendingMarkerPressRef = useRef<{ pointerId: number; entry: CheckpointLayoutEntry; startX: number; startY: number } | null>(null)

  // The touch/pen magnifier's own anchor (ADR-021, brief §4) — screen coordinates, since the
  // bubble floats above the finger via `position: fixed`, not track-relative like everything
  // else here. `null` for a mouse pointer (the magnifier is touch/pen-only) and whenever nothing
  // is currently pressed.
  const [touchPoint, setTouchPoint] = useState<{ clientX: number; clientY: number } | null>(null)

  // The open checkpoint cluster's member-list popover (ADR-021) — tracked by id, not a frozen
  // snapshot of its layout entry, so it stays in sync with `checkpointLayout` as the fisheye lens
  // keeps moving: if the lens spreads the cluster's own members apart into individual pips while
  // the popover is open, `openClusterEntry` below simply stops finding it and the effect after it
  // closes the popover rather than going stale.
  const [openClusterId, setOpenClusterId] = useState<string | null>(null)

  // The popover renders inside `.hitArea`, so its pointer events bubble here. A gesture that
  // starts on it belongs to the popover alone: scrubbing or moving the lens would re-lay out the
  // markers, split the cluster and unmount the popover before its own `click` fires. A gesture
  // captured by the track keeps the track as its target, so this never cuts off a drag.
  const isInsideClusterPopover = (e: ReactPointerEvent<HTMLDivElement>): boolean =>
    e.target instanceof Element && e.target.closest('[data-cluster-popover]') !== null

  const updateHover = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const u = uFromClientX(e.clientX)
    setHoverU(u)
    onLensPointer(u, trackWidthPx)
    setTouchPoint(e.pointerType === 'mouse' ? null : { clientX: e.clientX, clientY: e.clientY })
  }

  // A pip's or cluster's own select/open action (mouse's `onClick` below does the same thing
  // directly; this is the touch/pen path's equivalent, reached from `handlePointerUp` once a
  // pending marker press resolves into a tap rather than a scrub).
  const commitMarkerTap = (entry: CheckpointLayoutEntry): void => {
    if (entry.kind === 'pip') {
      onScrub(entry.t)
      return
    }
    // A cluster tap both jumps to its first (oldest) member — the same immediate "go there" a
    // pip tap gives — and opens the popover, so a viewer who wants a different member can still
    // pick one. `members[0]` is documented as screen-order-first/oldest (`checkpointLayout.ts`),
    // the same checkpoint the cluster's own stable `id` is already keyed on.
    onScrub(entry.members[0]!.t)
    setOpenClusterId(entry.id)
    onOpenCluster(entry.members)
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // Consumed unconditionally, whichever branch below runs — a touch/pen press on a marker
    // always sets this (in the marker button's own `onPointerDown`) just before this handler
    // sees the same event, and it must never leak into a later, unrelated gesture (e.g. the
    // dismiss-popover branch immediately below, which this press might instead fall into).
    const markerEntry = pendingMarkerEntryRef.current
    pendingMarkerEntryRef.current = null

    // A press anywhere else on the track dismisses an open cluster popover rather than also
    // scrubbing through it — the same "tap elsewhere closes it" convention any popover uses. That
    // holds for the rest of this gesture too, not just this one event: see
    // `dismissingPopoverPointerIdRef`.
    if (openClusterId !== null) {
      setOpenClusterId(null)
      dismissingPopoverPointerIdRef.current = e.pointerId
      return
    }
    dismissingPopoverPointerIdRef.current = null
    activePointerTypeRef.current = e.pointerType
    e.currentTarget.setPointerCapture(e.pointerId)
    updateHover(e)

    if (markerEntry) {
      // Touch/pen gesture arbitration (`markerGesture.ts`, ADR-021 follow-up): don't scrub yet —
      // this press might still turn out to be a tap on the marker it landed on. Suppress the
      // compatibility `click` a real touch would otherwise fire on the marker button on lift
      // (per the Pointer Events spec, `preventDefault()` on `pointerdown` does this), since
      // `commitMarkerTap` above is this path's own equivalent, driven explicitly by
      // `handlePointerUp` rather than that native click.
      e.preventDefault()
      pendingMarkerPressRef.current = { pointerId: e.pointerId, entry: markerEntry, startX: e.clientX, startY: e.clientY }
      return
    }
    pendingMarkerPressRef.current = null
    scrubToClientX(e.clientX)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (isInsideClusterPopover(e)) return
    updateHover(e)
    if (dismissingPopoverPointerIdRef.current === e.pointerId) return
    const pendingMarker = pendingMarkerPressRef.current
    if (pendingMarker && pendingMarker.pointerId === e.pointerId) {
      if (!hasExceededTapSlop(e.clientX - pendingMarker.startX, e.clientY - pendingMarker.startY)) return
      // Committed to a scrub: the rest of this gesture behaves exactly like a drag that started
      // on empty track, from here on (including this very move).
      pendingMarkerPressRef.current = null
    }
    if (e.buttons === 0) return
    scrubToClientX(e.clientX)
  }

  // Shared by both release paths below — everything that ends a gesture regardless of how it
  // resolved (a tap, a scrub, or a cancelled pointer).
  //
  // Reads `e.pointerType` off the terminating event itself (re-review fix, 2026-09-15), not
  // `activePointerTypeRef`: the ref is only ever written by `handlePointerDown`'s *own* main
  // branch, which a mouse gesture that lands on a pip/cluster marker or on the "dismiss an open
  // popover" early return never reaches — a pip/cluster button's own `onPointerDown` stops
  // propagation before `.hitArea`'s handler runs at all (its `pointerup` is not stopped, though,
  // and bubbles here same as any other), and the popover-dismiss branch returns before the ref
  // assignment. Every one of those gestures then hit this function with the ref still at its
  // resting `null` (every previous gesture's own end already reset it below), which read as
  // "not a mouse" and released the lens/hover readout even though the mouse pointer was still
  // resting on the track — reported as "the fisheye effect is cancelled... the cursor is still
  // hovering there" when clicking a checkpoint pip, opening a cluster popover, or clicking the
  // track to dismiss one. `e.pointerType` is intrinsic to the event and correct regardless of
  // which element's handlers the matching pointerdown actually ran, so it needs no bookkeeping.
  const releasePointerState = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dismissingPopoverPointerIdRef.current === e.pointerId) {
      dismissingPopoverPointerIdRef.current = null
    }
    if (e.pointerType !== 'mouse') {
      setHoverU(null)
      onLensRelease()
    }
    setTouchPoint(null)
    activePointerTypeRef.current = null
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (isInsideClusterPopover(e)) return
    const pendingMarker = pendingMarkerPressRef.current
    if (pendingMarker && pendingMarker.pointerId === e.pointerId) {
      // Never exceeded the slop by the time it lifted — a tap, not a drag.
      pendingMarkerPressRef.current = null
      commitMarkerTap(pendingMarker.entry)
    }
    releasePointerState(e)
  }

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (isInsideClusterPopover(e)) return
    // A cancelled gesture (e.g. the system taking the pointer for its own gesture) is neither a
    // tap nor a scrub — unlike `handlePointerUp`, this never commits a pending marker press.
    if (pendingMarkerPressRef.current?.pointerId === e.pointerId) {
      pendingMarkerPressRef.current = null
    }
    releasePointerState(e)
  }

  const handlePointerLeave = (): void => {
    // Mid-drag, the capturing element keeps receiving move events even once the pointer has
    // physically left it — don't hide the readout (or release the lens) out from under an
    // active drag.
    if (activePointerTypeRef.current === null) {
      setHoverU(null)
      setTouchPoint(null)
      onLensRelease()
    }
  }

  const playheadU = clampUnit(scale.toUnit(t))

  const checkpointLayout = useMemo(
    () => layoutCheckpointPips(checkpoints, visibleWindow, scale, trackWidthPx),
    [checkpoints, visibleWindow, scale, trackWidthPx],
  )

  const openClusterEntry = useMemo(
    () =>
      openClusterId === null
        ? null
        : (checkpointLayout.find((e): e is CheckpointClusterLayout => e.kind === 'cluster' && e.id === openClusterId) ?? null),
    [checkpointLayout, openClusterId],
  )

  useEffect(() => {
    if (openClusterId !== null && openClusterEntry === null) setOpenClusterId(null)
  }, [openClusterId, openClusterEntry])

  // The readout's last real content, kept across `hoverU` going back to `null` so its fade-out
  // shows that content shrinking away in place rather than drifting: `scale` keeps changing
  // every frame while the lens relaxes after pointer-leave (`useFisheye`'s rAF loop), so once
  // `hoverU` is null the whole result — not just the position it was read at — must freeze,
  // or re-deriving `t`/`label` from the live scale each render would visibly slide the readout
  // during the fade even though its position looks pinned. Also doubles as "has this track ever
  // been hovered". `formattedTime` (ADR-021) is precomputed here too, at the precision the local
  // pixel budget (`yearsPerDisplayedPixelAt`) actually resolves — so a 1px hover move inside a
  // fisheye-resolved gap visibly changes what's shown, on both the in-track readout and the
  // touch magnifier below, which both just render this string rather than reformatting it.
  const lastHoverInfoRef = useRef<{ u: number; t: GeoTime; label: string | undefined; formattedTime: string } | null>(null)
  const hoverInfo = useMemo(() => {
    if (hoverU === null) return lastHoverInfoRef.current
    const rawT = scale.fromUnit(hoverU)
    const snap = findSnapTarget(candidates, scale, rawT, trackWidthPx)
    const t = snap?.t ?? rawT
    const precisionYears = yearsPerDisplayedPixelAt(scale, hoverU, trackWidthPx)
    const info = { u: hoverU, t, label: snap?.label, formattedTime: formatGeoTimePrecise(t, precisionYears) }
    lastHoverInfoRef.current = info
    return info
  }, [hoverU, scale, candidates, trackWidthPx])

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Scrub timeline"
      aria-valuemin={visibleWindow[0]}
      aria-valuemax={visibleWindow[1]}
      aria-valuenow={t}
      tabIndex={0}
      className={styles.hitArea}
      data-hover-active={hoverU !== null}
      data-cluster-open={openClusterEntry !== null}
      data-touch-active={touchPoint !== null}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
    >
      <div aria-hidden className={styles.baseline} />

      {eventBandsU.map((band) => (
        <div
          key={band.id}
          title={band.label}
          className={styles.eventBand}
          style={{ left: `${band.uStart * 100}%`, width: `${Math.max(band.uEnd - band.uStart, 0.002) * 100}%` }}
        />
      ))}

      {checkpointLayout.map((entry) =>
        entry.kind === 'pip' ? (
          <button
            key={entry.id}
            type="button"
            className={styles.pip}
            data-checkpoint-pip
            style={{ left: `${entry.u * 100}%` }}
            title={`${entry.label} — ${formatGeoTime(entry.t)}`}
            aria-label={`${entry.label}, ${formatGeoTime(entry.t)}`}
            onPointerDown={(e) => {
              // Mouse keeps the old "commit immediately" behaviour — stopping propagation here
              // keeps `handlePointerDown` from ever running for a mouse press on this pip, so
              // only `onClick` below decides anything. Touch/pen instead hands this press to the
              // track for gesture arbitration (`markerGesture.ts`, ADR-021 follow-up): letting
              // the event bubble (no `stopPropagation`) so `handlePointerDown` picks it up via
              // `pendingMarkerEntryRef`, set here.
              if (e.pointerType === 'mouse') {
                e.stopPropagation()
                return
              }
              pendingMarkerEntryRef.current = entry
            }}
            onClick={(e) => {
              e.stopPropagation()
              onScrub(entry.t)
            }}
          >
            <span aria-hidden className={styles.pipDiamond} />
            <span aria-hidden className={`${styles.pipPreview} ${previewAnchorClass(entry.u, trackWidthPx)}`}>
              {entry.thumbnailUrl && <img className={styles.pipThumb} src={entry.thumbnailUrl} alt="" />}
              <span className={styles.pipTime}>{formatGeoTime(entry.t)}</span>
              <span className={styles.pipLabel}>{entry.label}</span>
            </span>
          </button>
        ) : (
          <button
            key={entry.id}
            type="button"
            className={styles.cluster}
            data-checkpoint-cluster
            style={{ left: `${entry.u * 100}%` }}
            title={`${entry.members.length} scenes, ${formatGeoTime(entry.tMax)} – ${formatGeoTime(entry.tMin)}`}
            aria-label={`${entry.members.length} scenes, ${formatGeoTime(entry.tMax)} to ${formatGeoTime(entry.tMin)}`}
            onPointerDown={(e) => {
              // See the matching pip button's own comment above — identical arbitration, just
              // for a cluster marker (which opens the member popover instead of scrubbing to a
              // single `t`).
              if (e.pointerType === 'mouse') {
                e.stopPropagation()
                return
              }
              pendingMarkerEntryRef.current = entry
            }}
            onClick={(e) => {
              e.stopPropagation()
              // See `commitMarkerTap`'s own comment (the touch/pen path's equivalent) — a
              // cluster click jumps to its first (oldest) member as well as opening the popover.
              onScrub(entry.members[0]!.t)
              setOpenClusterId(entry.id)
              onOpenCluster(entry.members)
            }}
          >
            <span aria-hidden className={styles.clusterDiamond}>
              <span className={styles.clusterCount}>{entry.members.length}</span>
            </span>
            {/* Suppressed while this cluster's own member-list popover is open — showing both
                at once would just repeat the same members twice. */}
            {openClusterId !== entry.id && (
              <span aria-hidden className={`${styles.pipPreview} ${previewAnchorClass(entry.u, trackWidthPx, CLUSTER_PREVIEW_HALF_WIDTH_PX)}`}>
                {entry.members.slice(0, CLUSTER_PREVIEW_MAX_ITEMS).map((member) => (
                  <span key={member.id} className={styles.clusterPreviewRow}>
                    <span className={styles.pipTime}>{formatGeoTime(member.t)}</span>
                    <span className={styles.pipLabel}>{member.label}</span>
                  </span>
                ))}
                {entry.members.length > CLUSTER_PREVIEW_MAX_ITEMS && (
                  <span className={styles.clusterPreviewMore}>+{entry.members.length - CLUSTER_PREVIEW_MAX_ITEMS} more</span>
                )}
              </span>
            )}
          </button>
        ),
      )}

      {openClusterEntry && (
        <ClusterPopover
          members={openClusterEntry.members}
          anchorU={openClusterEntry.u}
          edgeAnchorClass={previewAnchorClass(openClusterEntry.u, trackWidthPx, CLUSTER_POPOVER_HALF_WIDTH_PX)}
          onSelect={(selectedT) => {
            onScrub(selectedT)
            setOpenClusterId(null)
          }}
          onClose={() => setOpenClusterId(null)}
        />
      )}

      <div aria-hidden className={styles.playhead} style={{ left: `${playheadU * 100}%` }}>
        <div className={styles.playheadKnob} />
      </div>
      <span
        aria-live="polite"
        className={styles.timeLabel}
        data-anchor={playheadLabelAnchor(playheadU, formatGeoTime(t), trackWidthPx)}
        style={{ left: `${playheadU * 100}%` }}
      >
        {formatGeoTime(t)}
      </span>

      {hoverInfo && (
        <div
          aria-hidden
          className={`${styles.hoverReadout} ${previewAnchorClass(hoverInfo.u, trackWidthPx, HOVER_READOUT_HALF_WIDTH_PX)}`}
          data-visible={hoverU !== null}
          style={{ left: `${hoverInfo.u * 100}%` }}
        >
          {hoverInfo.label && <span className={styles.snapLabel}>{hoverInfo.label}</span>}
          <span className={styles.time}>{hoverInfo.formattedTime}</span>
        </div>
      )}

      {touchPoint && hoverInfo && openClusterEntry === null && (
        <TouchMagnifier
          clientX={touchPoint.clientX}
          clientY={touchPoint.clientY}
          trackWidthPx={trackWidthPx}
          centerU={hoverInfo.u}
          time={hoverInfo.formattedTime}
          label={hoverInfo.label}
          pips={checkpointLayout}
          eventBands={eventBandsU}
        />
      )}
    </div>
  )
}
