# Release log

## Overview

This file records signed immutable release manifests and can be used during
incident review, audit, and rollback decisions.

## Entries

- `release_tag`: annotated SemVer tag used by release workflow
- `source_sha`: source commit SHA from manifest
- `run_id`: GitHub Actions run id
- `web_image`: `ghcr.io/...@sha256:...`
- `migrator_image`: `ghcr.io/...@sha256:...`
- `backup_image`: `ghcr.io/...@sha256:...`
- `agent_image`: `ghcr.io/...@sha256:...`

The `scripts/release-one-command.sh` helper appends new entries here automatically
when run with default settings.
