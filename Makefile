PYTHON ?= .venv/bin/python

.PHONY: setup data data-force pins test web-dev web-build check check-quick hooks preflight deploy deploy-media deploy-site

# Every part of the environment; `scripts/setup.sh <part>...` for only some (its own header).
setup:
	scripts/setup.sh

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

# The single definition of "checks pass" — see scripts/check.sh's own header.
check:
	scripts/check.sh

check-quick:
	scripts/check.sh --quick

# Opt-in per clone (CONTRIBUTING.md) — nothing runs this for you automatically.
hooks:
	git config core.hooksPath .githooks

preflight:
	deploy/preflight.sh

deploy-media:
	deploy/sync-media.sh

deploy-site:
	MEDIA_BASE=$(MEDIA_BASE) deploy/build-site.sh
	pnpm -C web exec wrangler deploy --config ../deploy/wrangler.jsonc

deploy: preflight deploy-media deploy-site
