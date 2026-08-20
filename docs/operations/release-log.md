# Release log

Signed immutable releases are recorded here as `release-images` runs complete.
Entries are appended by `scripts/release-one-command.sh`.

Documentation-only preparation, including operator-workflow updates, does not
create a release-log entry or indicate a live deployment. Add an entry only
after its signed release completes.

## Unreleased — CRM sales lifecycle integration

This is documentation and verification preparation only; it is not a signed
release, deployment, or production migration record. The pending schema range
is 0076–0083, in journal order: saved views, Account currency, Opportunity
naming/project-code timing, Product taxonomy and quotation defaults, quotation
content, approval, revisions, and Payment Milestone decoupling. Apply the
sequence forward with RLS/views/permission synchronization. If rollout stops,
use application rollback, preserve additive and deprecated compatibility fields,
and resume forward; do not run destructive SQL rollback.

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

## v1.2.45
- released_at_utc: 2026-08-19T05:54:03Z
- source_sha: 0c9fd40a32c1726fc1c43f1a6f841a5b6b41369a
- workflow_run: 32220642966
- workflow: release-images.yml
- web_image: ghcr.io/super-erp/crm-web@sha256:fe25945f39768131c17f75d7b7bc1128bf33bd482fb9385bee16516eb7a2998e
- migrator_image: ghcr.io/super-erp/crm-migrator@sha256:646c5917b5b74f8da70c5155c52cc79101a19dc6415c2e947a8fa5bd9f64bc88
- backup_image: ghcr.io/super-erp/crm-backup@sha256:2f5872e7a59c73f52a1ceae17f5c927638223981abf914f80d56ad7e4c822f9c
- agent_image: ghcr.io/super-erp/crm-deployment-agent@sha256:e3e8f7089c6ce481d67efe2ef9b02c70c950f60fe9abca51f5f362adf49f8134


## v1.2.66
- released_at_utc: 2026-08-20T08:41:15Z
- source_sha: f936286437fc6f4c9033a08cfeda023e7966ec9f
- workflow_run: 32349785962
- workflow: release-images.yml
- web_image: ghcr.io/super-erp/crm-web@sha256:fffb554f3da334b4c67ad4140f1586e46f0ba12f21212752c475ed6037870a68
- migrator_image: ghcr.io/super-erp/crm-migrator@sha256:b085a9396b6dac97131597f8ddbdfffef5de010a93b4b2ef538eeb3cfef7259f
- backup_image: ghcr.io/super-erp/crm-backup@sha256:3a5aa0484e5f1c370b6f145184914d7792cbb07beda758b89899fe5de9691e83
- agent_image: ghcr.io/super-erp/crm-deployment-agent@sha256:66c6668def4784b035b81245db732bbcbdfce978bc0cf1716ef1b0b035455c78

