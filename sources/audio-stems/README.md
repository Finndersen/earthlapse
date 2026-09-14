# Source: audio-stems

CC0 / public-domain ambience loops for the continuous backing "soundtrack" (DESIGN.md §11
tier 1, ADR-023). Not one of the four curated shapes — see ADR-023's Decision for why this
source bypasses `WorldModel` entirely.

## Schema

Unlike every other source here, this one bundles several independently-licensed files under
one directory, so per-file provenance lives in **`stems.toml`** (`pipeline.audio.StemBook`),
not `manifest.toml` (which still exists, and still feeds `pipeline.publish._credit`'s generic
one-`Credit`-per-source listing, but only points at `stems.toml` rather than naming a single
upstream file). Each `[[stems]]` entry:

| field | meaning |
|---|---|
| `id` | slug, matches a `SceneRecord.sound.stem` / the web engine's `AmbienceStemId` |
| `title`, `author`, `licence` | credit, shown per-stem on the credits page (`Manifest.audioStems`) |
| `url` | the **direct, machine-fetchable download URL** `fetch.py` actually downloads -- the same convention every other source's `manifest.toml` `url` follows (e.g. `sources/co2-o2`) -- and what ships as `AudioStem.source_url` on the credits page. For a Freesound clip this is the CDN URL of Freesound's own unauthenticated "-hq" preview transcode (128 kbps MP3): Freesound's original-quality download requires a logged-in session this offline pipeline cannot perform, so the HQ preview is what was fetched, hashed and shipped -- still the genuine CC0-dedicated recording, just Freesound's own lossy transcode of it. Each `stems.toml` entry's own comment also cites the human-readable source page. |
| `sha256`, `raw_filename` | what `fetch.py` downloads into `data/raw/audio-stems/` |
| `format` | published extension; `normalise.py` copies the raw file through **unchanged** under this name |
| `duration_seconds`, `loop_safe` | curator-attested, not measured — see "Why no automated loudness/trim pass" below |

`fetch.py` loops `pipeline.fetching.ensure_verified_artefact` once per `[[stems]]` entry.
`normalise.py`'s `normalise()` returns no `CuratedShape` (there is nothing WorldState-shaped
to write); its `write_outputs()` hook does the real work, copying each verified raw file to
`data/media/audio/<id>.<format>` after checking (`pipeline.audio.sniff_audio`) that the raw
bytes' real container matches the declared `format`.

## Gotchas

- **An empty `stems.toml` is valid** (though this one now carries all ten stems, sourced
  2026-09-14 per `/audio-stem-wishlist.md`) — `pipeline.audio.load_stem_book` treats a missing
  or empty catalogue as zero stems, not an error, matching how `data/portraits.yaml`/
  `data/scenes.yaml` ship partially before everything is pinned. A future stem added or
  replaced here works the same way.
- **Why no automated loudness/trim pass.** This machine has neither `ffmpeg` nor `sox`, and
  macOS's `/usr/bin/afconvert` must not become a hard pipeline dependency — every source must
  build and its tests must run offline on any machine (CLAUDE.md, CONTRIBUTING.md). `write_outputs()`
  therefore does no DSP: it is a verified copy, nothing else. The consequence is a sourcing
  requirement, not a pipeline gap — whoever fills in `stems.toml` must pick clips that already
  arrive **pre-trimmed to a clean loop point, ≥20s, and reasonably level-matched** to the rest
  of the set (by ear against the others already sourced), the same way `sources/astronomy`'s
  checkpoint values are cited numbers a human entered, not something this pipeline computes.
  A local, optional `afconvert`-based re-encode/trim script may be added later as a
  *sourcing-time* convenience (never invoked by `earthtime build`/tests) if this proves
  tedious by hand.
- **Licence is CC0 / public domain only** (ADR-023, user decision) — no CC-BY (attribution
  clutters a HUD, and stems fade in and out constantly so there is no good place to show it),
  no NC. `licence` is a free-text field like every other source's, so this is enforced by the
  human filling in `stems.toml`, not mechanically.
- **`format` must match reality.** `write_outputs()` sniffs the raw file's real container
  (`pipeline.audio.sniff_audio`: RIFF/WAVE, OggS, an `ftyp` box, or an MP3 frame/ID3 header)
  and raises if it disagrees with the declared `format` — the same "trust bytes over any
  declared type" discipline `pipeline.generators.image.sniff_image` applies to images.

## Measured volume

~11.0 MB (10 stems, `data/raw/audio-stems/`, sourced 2026-09-14) — within DESIGN.md §11's
<~15 MB total budget, with headroom. Every stem is CC0 or public domain; sourcing notes
(candidates considered, why each was picked, the ones the wishlist's brief could not find
under CC0) are in the sourcing session's own report, not duplicated here.

## Storage tier chosen

`git-lfs`. Unlike `paleodem`'s ~100+ regenerable globe textures (left uncommitted, regenerated
locally by `make data`), a specific CC0 clip picked from a specific archive is a curatorial
choice as irreplaceable as a pinned generated image — ADR-018's reasoning for committing
`data/media/` applies here too, and the total budget (<~15 MB) is cheap to store. `.gitattributes`
tracks `data/media/**/*.{ogg,m4a,mp3,wav}` through LFS accordingly.
