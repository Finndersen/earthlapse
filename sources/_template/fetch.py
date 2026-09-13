"""Download raw data into data/raw/<name>/. Record sha256 in manifest.toml.

If this source downloads a single upstream file, call
`pipeline.fetching.ensure_verified_artefact` rather than reimplementing the
download/verify/cache logic -- see sources/co2-o2/fetch.py or sources/paleodem/fetch.py for
worked examples."""
