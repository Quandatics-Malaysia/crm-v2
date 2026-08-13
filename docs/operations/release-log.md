# Release log

Signed immutable releases are recorded here as `release-images` runs complete.
Entries are appended by `scripts/release-one-command.sh`.

Documentation-only preparation, including operator-workflow updates, does not
create a release-log entry or indicate a live deployment. Add an entry only
after its signed release completes.

## v1.2.26

- released_at_utc: 2026-08-13T17:17:00Z
- source_sha: 2edc0d43e3ccffb7d1c90572adb5258145dd9b26
- workflow_run: 31723355859
- workflow: release-images.yml
- production_deploy_run: 31726310905
- web_image: ghcr.io/super-erp/crm-web@sha256:9d006e480ab8ed3ddab95866f2a5e0e747131c50853b54dde5b0ad9ed320e75a
- migrator_image: ghcr.io/super-erp/crm-migrator@sha256:ae48df0c09153d26e942d9f4659d7388e30dd1ca54a84e11c8bdb87b0c338ca8
- backup_image: ghcr.io/super-erp/crm-backup@sha256:21f0b6204a223a1c4e5418d991bef73531c13c71177467ec4a98b9c527b056fc
- agent_image: ghcr.io/super-erp/crm-deployment-agent@sha256:82da8835d5749e8c64056f03d5b6baf0b239e00107634aa7752fc7c6c36c89cc
