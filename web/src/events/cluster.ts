/**
 * Partitions an event list into bursts of near-simultaneous events (DESIGN § Event feed,
 * ADR-040) so the feed can show one digest card per burst instead of letting a dense stretch
 * evict its own cards faster than anyone can read them.
 *
 * A candidate event joins the current cluster only when **both** the gap to the immediately
 * preceding event and the gap back to the cluster's own first (freshest) member are smaller
 * than `CLUSTER_SPAN` — bounding the cluster's *total* extent, not just each adjacent step.
 * Single-linkage on adjacent gaps alone chains without limit: a long run of events each just
 * under the threshold apart can accumulate a total span many multiples of `CLUSTER_SPAN`, which
 * stops meaning "these happened at essentially the same time" for the run as a whole. A gap —
 * `log2((newer + RECENCY_FLOOR_YEARS) / (older + RECENCY_FLOOR_YEARS))` — is a fixed property of
 * the two events' own placements: the playhead `t` cancels out of the ratio entirely, so
 * membership never depends on where playback currently is. Clusters are therefore static —
 * computed once per event list, never re-forming or flickering as `t` scrubs — which is what
 * lets `selectFeedEvents` treat them as the unit of selection without breaking purity in `t`.
 */

import type { TimelineEvent } from '@/types/layer'

import { placementT } from './placement'

/** The floor added to both sides of an age ratio so an event at `t = 0` still has a defined,
 *  nonzero reference age. Shared between a cluster's own gap and `select.ts`'s per-event
 *  freshness — both are the same log2-ratio measurement applied to a different pair of times. */
export const RECENCY_FLOOR_YEARS = 25

/**
 * The `distanceFraction` gap that bounds both a cluster's adjacent steps and its total extent
 * (see this module's own doc comment). `0.20` is the smallest value that lifts the published
 * event set's median 1x feed-slot dwell to roughly the ~2s it takes to read a short card, while
 * still capping the largest digest at a browsable size — see ADR-040 for the swept alternatives
 * and the measured numbers this trades against.
 */
export const CLUSTER_SPAN = 0.2

export interface EventCluster {
  /** Every event in the cluster, freshest first (ascending `placementT`). Ties in `placementT`
   *  break by importance (higher first), then id — the same order `select.ts` ranks distinct
   *  candidates by, so a tie between two events always resolves the same way whether or not
   *  clustering happens to put them in the same card. */
  members: readonly TimelineEvent[]
}

function comparePlacement(a: TimelineEvent, b: TimelineEvent): number {
  const byPlacement = placementT(a) - placementT(b)
  if (byPlacement !== 0) return byPlacement
  if (a.importance !== b.importance) return b.importance - a.importance
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** `log2` of the age ratio between two placements, `newer <= older`. */
function gap(olderT: number, newerT: number): number {
  return Math.log2((olderT + RECENCY_FLOOR_YEARS) / (newerT + RECENCY_FLOOR_YEARS))
}

function partition(events: readonly TimelineEvent[]): EventCluster[] {
  if (events.length === 0) return []

  const sorted = [...events].sort(comparePlacement)
  const clusters: TimelineEvent[][] = [[sorted[0]!]]
  // The freshest (smallest-`placementT`) member of the cluster currently being built — always
  // its first element, since `sorted` is ascending — so `totalGap` below measures the whole
  // cluster's extent so far, not just the latest step.
  let clusterStartT = placementT(sorted[0]!)
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!
    const current = sorted[i]!
    const adjacentGap = gap(placementT(current), placementT(previous))
    const totalGap = gap(placementT(current), clusterStartT)
    if (adjacentGap < CLUSTER_SPAN && totalGap < CLUSTER_SPAN) {
      clusters[clusters.length - 1]!.push(current)
    } else {
      clusters.push([current])
      clusterStartT = placementT(current)
    }
  }
  return clusters.map((members) => ({ members }))
}

const cache = new WeakMap<readonly TimelineEvent[], EventCluster[]>()

/**
 * `events` partitioned into `EventCluster`s, freshest cluster's own freshest member first.
 * Memoised by the `events` array's identity: `selectFeedEvents` calls this every frame of
 * playback, but the manifest's event list is a stable reference that only changes when the
 * manifest reloads, so the partition itself only needs computing once per list.
 */
export function clusterEvents(events: readonly TimelineEvent[]): EventCluster[] {
  const cached = cache.get(events)
  if (cached !== undefined) return cached
  const computed = partition(events)
  cache.set(events, computed)
  return computed
}
