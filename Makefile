PYTHON ?= .venv/bin/python

.PHONY: data data-force test web-dev web-build

data:
	$(PYTHON) -m pipeline.databuild

data-force:
	$(PYTHON) -m pipeline.databuild --force

test:
	.venv/bin/pytest

web-dev:
	cd web && pnpm dev

web-build:
	cd web && pnpm build
