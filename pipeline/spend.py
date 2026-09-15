"""Budget ledger and hard ceiling. NORMATIVE.

The total generation budget for this project is 100 USD. An agent in a retry loop can
consume that in twenty minutes, so the ceiling is enforced in code rather than by intention.

Rules, restated from CLAUDE.md because this is where they bite:

* No agent may raise the ceiling. If a build hits it, the build stops and reports.
* Cost is reserved *before* the call and committed *after* it, so a crash mid-call cannot
  produce spend the ledger never saw.
* The ledger is append-only and local (gitignored) — it is a record, not shared state.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field

DEFAULT_CEILING_USD = 100.0


class BudgetExceeded(RuntimeError):
    """Raised instead of spending past the ceiling. Do not catch this to continue —
    catch it to report and stop."""


class Entry(BaseModel):
    node_id: str
    generator: str
    n: int
    estimated_usd: float
    actual_usd: float | None = None
    note: str | None = None


class Ledger(BaseModel):
    ceiling_usd: float = DEFAULT_CEILING_USD
    entries: list[Entry] = Field(default_factory=list)

    # -- accounting -------------------------------------------------------------------

    @property
    def spent(self) -> float:
        """Actual where known, estimate where a call is still in flight. Deliberately
        pessimistic: an unresolved reservation counts against the budget."""
        return sum(
            e.actual_usd if e.actual_usd is not None else e.estimated_usd for e in self.entries
        )

    @property
    def remaining(self) -> float:
        return max(0.0, self.ceiling_usd - self.spent)

    def check(self, cost: float) -> None:
        """Raise if `cost` would breach the ceiling. Call before every paid operation."""
        if self.spent + cost > self.ceiling_usd:
            raise BudgetExceeded(
                f"would spend ${self.spent + cost:.2f} of ${self.ceiling_usd:.2f} ceiling "
                f"(${self.spent:.2f} already committed, this call ${cost:.2f}). "
                f"Stopping. Do not raise the ceiling — reduce the work."
            )

    def reserve(self, node_id: str, generator: str, n: int, estimated_usd: float) -> Entry:
        self.check(estimated_usd)
        entry = Entry(node_id=node_id, generator=generator, n=n, estimated_usd=estimated_usd)
        self.entries.append(entry)
        return entry

    def settle(self, entry: Entry, actual_usd: float) -> None:
        entry.actual_usd = actual_usd

    # -- persistence ------------------------------------------------------------------

    @classmethod
    def load(cls, path: Path, ceiling_usd: float = DEFAULT_CEILING_USD) -> Ledger:
        if not path.exists():
            return cls(ceiling_usd=ceiling_usd)
        led = cls.model_validate_json(path.read_text())
        led.ceiling_usd = ceiling_usd  # CLI flag wins over whatever was stored
        return led

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.model_dump(), indent=2))

    def summary(self) -> str:
        return (
            f"${self.spent:.2f} spent of ${self.ceiling_usd:.2f} "
            f"(${self.remaining:.2f} left, {len(self.entries)} calls)"
        )
