PYTHON ?= .venv/bin/python

# Deploy credentials: from the gitignored .env on a workstation (plain KEY=value lines), from the
# workflow's secrets in CI, where there is no .env.
-include .env
export R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET MEDIA_BASE

.PHONY: setup data data-force test web-dev web-build check check-quick hooks preflight deploy deploy-media deploy-site

# Every part of the environment; `scripts/setup.sh <part>...` for only some (its own header).
setup:
	scripts/setup.sh

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
	deploy/build-site.sh
	pnpm -C web exec wrangler deploy --config ../deploy/wrangler.jsonc

deploy: preflight deploy-media deploy-site
