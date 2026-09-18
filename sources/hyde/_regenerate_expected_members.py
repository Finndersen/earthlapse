"""Regenerates `_expected_members.json` from the live remote archive's own central directory.

Not part of the normal `fetch()` path (which reads `_expected_members.json`, not the network,
for its tag list and expected CRCs -- see README.md "Fetch strategy") -- a maintenance script,
run by hand only if the pinned HYDE 3.2.1 deposit is ever superseded by a new DANS version.
Requires network access; not run in tests or in `pipeline.databuild`.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from pipeline.databuild import load_source_module

_SOURCE_DIR = Path(__file__).resolve().parent
_OUTPUT = _SOURCE_DIR / "_expected_members.json"


def main() -> None:
    fetch_mod = load_source_module(_SOURCE_DIR, "fetch")
    with httpx.Client(follow_redirects=True) as client:
        tags = fetch_mod.discover_tags(client)
        infos = fetch_mod.list_member_infos(fetch_mod.baseline_url(), client)
    crc_by_path = {info.filename: info.CRC for info in infos}
    members = {
        tag: {
            variable: crc_by_path[fetch_mod._member_path(tag, variable)]
            for variable in fetch_mod.VARIABLES
        }
        for tag in tags
    }
    out = {
        "_comment": (
            f"Expected CRC-32 (zlib.crc32, unsigned decimal) of each timestep's "
            f"{'/'.join(fetch_mod.VARIABLES)} members inside HYDE3_2_1-baseline.zip, pinned "
            f"from that archive's own central directory -- see sources/hyde/README.md 'Fetch "
            f"strategy'. Regenerate with sources/hyde/_regenerate_expected_members.py if the "
            f"pinned HYDE 3.2.1 deposit is ever superseded (it is a fixed, versioned DANS "
            f"deposit, not expected to change), or if `fetch.VARIABLES` changes."
        ),
        "members": members,
    }
    _OUTPUT.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    print(f"wrote {_OUTPUT} ({len(members)} tags)")


if __name__ == "__main__":
    main()
