PYTHON ?= .venv/bin/python

.PHONY: data data-force pins test web-dev web-build deploy deploy-media deploy-site

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

deploy-media:
	deploy/sync-media.sh

deploy-site:
	MEDIA_BASE=$(MEDIA_BASE) deploy/build-site.sh
	npx wrangler deploy --config deploy/wrangler.jsonc

deploy: deploy-media deploy-site
