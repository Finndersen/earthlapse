PYTHON ?= .venv/bin/python

.PHONY: data data-force pins test web-dev web-build

data:
	$(PYTHON) -m pipeline.databuild

data-force:
	$(PYTHON) -m pipeline.databuild --force

pins:
	$(PYTHON) -m pipeline.stage_pins

test:
	.venv/bin/pytest

web-dev:
	cd web && pnpm dev

web-build:
	cd web && pnpm build
