# Source: audio-stems

CC0 / public-domain clips for the continuous backing "soundtrack" (DESIGN.md §11 tier 1, ADR-023
and its 2026-09-14 "stem set v2", 2026-09-15 "era fit v3"/"era fit v3 fixes" and 2026-09-15
"wing-hum" amendments). Not one of the four curated shapes — see ADR-023's Decision for why this
source bypasses `WorldModel` entirely.

Two kinds of stem share one catalogue:

- **Ambience stems** (`wind`, `water`, `storm`, `volcanic`, `forest`, `wing-hum`, `insects`,
  `large-animal`, `birds`, `archosaurs`, `mammals`, `livestock`, `fire`, `settlement`, `industry`,
  `traffic`) have a web `stemGains` row and loop continuously at their curve gain. Always
  `loop_safe = true`.
- **Scene-only stems** have no curve and are reached only through a scene's `sound`:
  `geothermal`, `buzzing`, `knapping`, `artillery`, `lake-water`, `geiger-counter`, `chainsaw`,
  `howler-monkeys`, `hippo`, `wall-chiselling`, `church-bell` and `ship-rigging`
  (`loop_safe = true`, usable as `mode: loop`) and the one-shots `impact`, `rocket`, `aircraft`,
  `mammoth`, `steam-whistle`, `ship-horn`, `klaxon-horn` and `tram-bell` (`loop_safe = false`,
  `mode: once` only). No separate `kind` field: "one-shot" means
  "not loop-safe".

## Schema

Unlike every other source here, this one bundles several independently-licensed files under
one directory, so per-file provenance lives in **`stems.toml`** (`pipeline.audio.StemBook`),
not `manifest.toml` (which still exists, and still feeds `pipeline.publish._credit`'s generic
one-`Credit`-per-source listing, but only points at `stems.toml` rather than naming a single
upstream file). Each `[[stems]]` entry:

| field | meaning |
|---|---|
| `id` | slug, matches a `SceneRecord.sound.stem` / the web engine's `StemId` (`AmbienceStemId` or `SceneStemId`) |
| `title`, `author`, `licence` | credit, shown per-stem on the credits page (`Manifest.audioStems`) |
| `url` | the **direct, machine-fetchable download URL** `fetch.py` actually downloads -- the same convention every other source's `manifest.toml` `url` follows (e.g. `sources/co2-o2`) -- and what ships as `AudioStem.source_url` on the credits page. For a Freesound clip this is the CDN URL of Freesound's own unauthenticated "-hq" preview transcode (128 kbps MP3): Freesound's original-quality download requires a logged-in session this offline pipeline cannot perform, so the HQ preview is what was fetched, hashed and shipped -- still the genuine CC0-dedicated recording, just Freesound's own lossy transcode of it. Each `stems.toml` entry's own comment also cites the human-readable source page. |
| `sha256`, `raw_filename` | what `fetch.py` downloads into `data/raw/audio-stems/` |
| `format` | published extension; `normalise.py` copies the raw file through **unchanged** under this name |
| `duration_seconds`, `loop_safe` | curator-attested (duration read from the decoded clip at sourcing time), not measured by the pipeline — see "Why levels are attested, not measured at build time" below. `loop_safe = false` marks a one-shot |
| `loudness_db`, `peak_dbfs` | curator-attested, measured with `levels.py` on the decoded clip: gated A-weighted loudness and sample peak. Publish derives `AudioStem.level_trim_db` from them (`pipeline.audio.StemManifest.level_trim_db`): loops are trimmed to -30 dB, one-shots to -20 dB, never lifting a peak past full scale |
| `loop` | optional `{ start_seconds, end_seconds }`, loop-safe stems only: the span a looping player repeats, chosen from the decoded samples to skip a silent head/tail, a fade or an edit splice, with both ends at matched level and near-equal samples. Absent: the whole clip loops |
| `start_seconds` | optional, one-shots only (`loop_safe = false`; a loop trims its head via `loop` instead): playback start offset in seconds, skipping a silent (or otherwise unwanted) lead-in so a `once` sound starts right on the scene's trigger instead of lagging behind it (era-fit v3 fixes, 2026-09-15: `mammoth`'s ~1.4 s near-silent lead-in). Absent: starts at 0 |
| `end_seconds` | optional, one-shots only, at least a second after the start: where playback stops, the last second fading out, so a long recording plays only its opening (2026-09-25: scene-only stems play at most about 10 s). The published file is cut to the played span. Absent: plays to the end |

`fetch.py` loops `pipeline.fetching.ensure_verified_artefact` once per `[[stems]]` entry, sending a
descriptive `User-Agent` (Wikimedia's upload servers answer 403 without one).
`normalise.py`'s `normalise()` returns no `CuratedShape` (there is nothing WorldState-shaped
to write); its `write_outputs()` hook does the real work, copying each verified raw file to
`data/media/audio/<id>-<hash>.<format>` (`pipeline.audio.content_hashed_filename`, ADR-023
amendment "on-demand loading": `<hash>` is the first 10 hex characters of `sha256` of the
published bytes, so a CDN can cache the file `immutable` — the name only changes when the
content does) after checking (`pipeline.audio.sniff_audio`) that the raw bytes' real container
matches the declared `format`. Any other `<id>-*.<format>` file already at that path (a
previous run's, now-stale, hash) is removed first, so exactly one published file per stem id
ever exists. `pipeline.publish._audio_stems` discovers the actual filename by globbing at
publish time rather than re-deriving the hash — it refuses to publish if none or more than one
match, rather than guessing.

## Gotchas

- **An empty `stems.toml` is valid** (though this one now carries thirty-six stems: the
  seventeen v2 stems sourced 2026-09-14, `forest`, `large-animal`, `buzzing`, `knapping` and
  `mammoth` sourced 2026-09-15 "era fit v3", `archosaurs`/`livestock` re-sourced and `artillery`/
  `lake-water` added the same day by later 2026-09-15 amendments, `wing-hum` added by a
  further 2026-09-15 amendment, and eleven single-scene stems added 2026-09-25) —
  `pipeline.audio.load_stem_book` treats a missing or empty catalogue as zero stems, not an
  error, matching how `data/portraits.yaml`/`data/scenes.yaml` ship partially before everything
  is pinned. A future stem added or
  replaced here works the same way.
- **Why levels are attested, not measured at build time.** This machine has neither `ffmpeg`
  nor `sox`, and macOS's `/usr/bin/afconvert` must not become a hard pipeline dependency — every
  source must build and its tests must run offline on any machine (CLAUDE.md, CONTRIBUTING.md).
  `write_outputs()` therefore does no decoding or DSP: it publishes the downloaded bytes, except
  that a looping MP3 is cut losslessly, by whole frames, to its loop region plus 0.1 s either
  side (`pipeline/mp3.py`, ADR-023 amendment "looping MP3 stems publish cut to their loop
  region"); publish moves `loop` onto the cut file, and `stems.toml` stays in the raw clip's
  timeline. Level matching and loop points are instead
  **curator-attested numbers applied at playback**: `levels.py` (numpy, run by hand on a decoded
  16-bit WAV when a clip is sourced) prints `loudness_db`/`peak_dbfs`; publish turns them into a
  per-stem `level_trim_db` the web engine multiplies into every gain; and a `loop` region is
  handed to the looping player (`loopStart`/`loopEnd`), so a silent head, a fade or a splice is
  skipped without re-encoding. The same way `sources/astronomy`'s checkpoint values are cited
  numbers a human entered. Decoding for measurement: headless Chromium's
  `OfflineAudioContext.decodeAudioData` handles every published format (the 2026-09-15 values
  were measured that way); `afconvert -f WAVE -d LEI16` handles MP3/M4A where it is available.
  A decoder's MP3 priming offset can move a loop point by a few milliseconds in another browser,
  so the wrap is chosen at matched level as well as matched samples.
- **Licence is CC0 / public domain only** (ADR-023, user decision) — no CC-BY (attribution
  clutters a HUD, and stems fade in and out constantly so there is no good place to show it),
  no NC. `licence` is a free-text field like every other source's, so this is enforced by the
  human filling in `stems.toml`, not mechanically.
- **`format` must match reality.** `write_outputs()` sniffs the raw file's real container
  (`pipeline.audio.sniff_audio`: RIFF/WAVE, OggS, an `ftyp` box, or an MP3 frame/ID3 header)
  and raises if it disagrees with the declared `format` — the same "trust bytes over any
  declared type" discipline `pipeline.generators.image.sniff_image` applies to images.

## Measured volume

~44.9 MB (36 stems, `data/raw/audio-stems/`; v2 set sourced 2026-09-14, `birds`/`mammals`
re-sourced 2026-09-15, `large-animal`/`buzzing`/`knapping`/`mammoth` added 2026-09-15 "era fit v3",
`forest` re-sourced again the same day by the "era fit v3 fixes" amendment after its first pick
turned out to carry bird/primate-like FM chirps, `archosaurs`/`livestock` re-sourced and
`artillery`/`lake-water` added the same day again, `wing-hum` added by a further 2026-09-15
amendment and re-sourced the same day again after a review found its first pick carried faint
bird tones, an audible in-loop repeat and a memory footprint out of proportion to its audible
contribution — see its own `stems.toml` entry comment, `forest` re-sourced a THIRD time on
2026-09-16 after listening feedback found its second pick, though frog/bird-free, was a literal
rain recording, then a FOURTH time the same day after an independent review found the third pick
was itself low-frequency wind rumble rather than genuine leaf rustle, and eleven single-scene
stems added 2026-09-25, ~13.9 MB of the total) downloaded; ~20.2 MB published, since each looping stem publishes cut to its loop region and a one-shot to
its `start_seconds`..`end_seconds`, and every scene-only stem plays at most about 10 s. The
largest published files are ambience beds: `birds` (2.1 MB, its 92 s loop), `mammals` (1.6 MB)
and `storm` (1.5 MB). Every stem is CC0 or public domain.

## Sourcing checks (nobody can listen)

Every clip is spectrogram-checked before it is catalogued: decode it (headless Chromium
`OfflineAudioContext.decodeAudioData`, or macOS `afconvert` to WAV for analysis only), draw 0-8 kHz
and 0-1 kHz spectrograms with an RMS strip, and inspect for:

- **sirens**: smooth, periodic tonal sweeps around 500-1800 Hz (how v1 `machinery` failed);
- **speech**: harmonic formant arcs with syllabic onsets (how the "Atomic Bomb" impact candidate
  failed: a spoken slate in its first 1.5 s);
- **music**: stable harmonic stacks or rhythm;
- **birds where birds are an anachronism**: short FM chirps at 2-8 kHz (how v1 `water` and the
  "Alligatorbellow1" archosaur candidate failed — both stems play long before birds sing);
- **frogs where frogs are an anachronism** (era-fit v3): periodic pulsed croaking, typically
  500-1500 Hz — checked against `forest`, which plays from 385 Ma, long before anuran calls are
  plausible (~250 Ma);
- **rain/downpour character** (added 2026-09-16, after `forest`'s second pick passed every check
  above yet still turned out to be rain): near-stationary broadband 1-8 kHz energy with a LOW
  block-RMS envelope variance and no discrete events — checked quantitatively (400 ms blocks, the
  same block size `levels.py` uses), not by ear or by spectrogram shape alone: rain measures well
  under 1 dB of envelope standard deviation, because it has no gusts to swell and ease off;
  genuine wind-driven leaf rustle swells several dB as gusts come and go, even though both share
  the same broadband, no-tonal-ridge spectrum a bird/hum/siren check alone cannot tell apart. A
  candidate's envelope variance must be checked **inside its own chosen loop region**, not just
  over the whole clip — a dynamic clip can still have a flat, rain-like stretch that happens to be
  its only cleanly-loopable span;
- **spectral balance inside the loop region** (added 2026-09-16, after `forest`'s third pick
  passed the rain check above yet turned out to be low-frequency wind rumble, not leaf rustle): a
  Welch PSD (`nperseg` 2^15 or 2^16) over the candidate's own chosen loop region, not the whole
  clip. Report the median-energy frequency and the fraction of power in 2-8 kHz — broadband and
  non-stationary is necessary but not sufficient for "rustle": a directional mic in open wind
  produces broadband, gusty, LOW-frequency noise (50-200 Hz dominant) that clears the rain check
  above while still reading as rumble, not foliage. A bed meant to read as leaf rustle should clear
  roughly a 1 kHz median frequency and 25% of its loop-region power in 2-8 kHz — `wind` (open-air
  gusts, no foliage) sits at 696 Hz / 28.2% as a useful lower reference point for what "still mostly
  wind" looks like;
- **level and loop problems**: clipping, silence gaps, edit splices, and a level or sample step
  between the first and last 50 ms (fixed with a `loop` region, not by rejecting the clip);
- **repetition**: one call or phrase repeating on a short cycle, which a loop multiplies.

Then measure `loudness_db`/`peak_dbfs` with `levels.py`. What each check found is recorded in the
clip's own `stems.toml` comment.

## Storage tier chosen

`git-lfs`. Unlike `paleodem`'s ~100+ regenerable globe textures (left uncommitted, regenerated
locally by `make data`), a specific CC0 clip picked from a specific archive is a curatorial
choice as irreplaceable as a pinned generated image — ADR-018's reasoning for committing
`data/media/` applies here too, and the total (~21.6 MB in v2, pending sign-off) is cheap to store. `.gitattributes`
tracks `data/media/**/*.{ogg,m4a,mp3,wav}` through LFS accordingly.
