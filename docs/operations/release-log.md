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


## v1.2.67
- released_at_utc: 2026-08-20T08:51:39Z
- source_sha: 0f263b43423e8b8749575e0fba4a50dbb6c7ce42
- workflow_run: 32350639243
- workflow: release-images.yml
- web_image: ghcr.io/super-erp/crm-web@sha256:e423d111a7949f4c101cc7bf9761717becf6c535afde5e6369d4326a5e181712
- migrator_image: ghcr.io/super-erp/crm-migrator@sha256:39b63b67b1c6e2fd570e45d8cf6d9bf8d4714c81b7f4c9890e02608c198c5b55
- backup_image: ghcr.io/super-erp/crm-backup@sha256:a25abc3195f57bcb1d686bcd09328465965d456b69486b849ba8f5633696bdda
- agent_image: ghcr.io/super-erp/crm-deployment-agent@sha256:f6f26e55e5ef2b7928de14ba7f8e8252a503f0ab3477860647400eb76a7afaa6


## v1.2.79
- released_at_utc: 2026-08-20T14:22:34Z
- source_sha: 7c1b1d9ccbdc249de4c1036c3dd4208ae1c550bf
- workflow_run: 32379373494
- workflow: release-images.yml
- web_image: ghcr.io/super-erp/crm-web@sha256:07918787a29454e30d35e570b1ed8af9ce462e0a9e6df104379efc3939b2ff46
- migrator_image: ghcr.io/super-erp/crm-migrator@sha256:5c238887640e5165cd819c2004656b54c2168fd946c112bf9d58f365e33a1a59
- backup_image: ghcr.io/super-erp/crm-backup@sha256:e2f78b0e590f514974c91858d1d1fe4242506b172a932a1c5c620e4659874acb
- agent_image: ghcr.io/super-erp/crm-deployment-agent@sha256:b1b515f8bdd7fe9d601487182c807b518bad512587cadabd1aa2312c5afed484


## v1.2.92
- released_at_utc: 2026-08-21T07:28:59Z
- source_sha: a5b96ce9ebb52017322533197fe7df92b4237ee8
- workflow_run: 32458387331
- workflow: release-images.yml
- web_image: ghcr.io/super-erp/crm-web@sha256:37fa9ab3ed475721c02f34864c7dce39bfd31cdfe98f2bf01248b0fb249dff00
- migrator_image: ghcr.io/super-erp/crm-migrator@sha256:3fca5f9cf32cc2326adb423363eb79bbc0f7c8fea3d245e3865408f2114a3232
- backup_image: ghcr.io/super-erp/crm-backup@sha256:ffad3e8eed1616aa7ff2eee4cae4cd2b7118825207d2ae400ee53ca2ec1d676c
- agent_image: ghcr.io/super-erp/crm-deployment-agent@sha256:c6b2759d167976eb921ef02805e997f0c07b9f6bf12432f703082bcc906c30b0


## v1.2.93
- released_at_utc: 2026-08-21T07:40:29Z
- source_sha: 21785f973602cdcf36f1eeed481a94f84e345c1c
- workflow_run: 32459239750
- workflow: release-images.yml
- web_image: ghcr.io/super-erp/crm-web@sha256:71cd6ad6a5e8e832fe5e7f0e7eea830b9f9bd6597fef7a9fffd0e2041855e691
- migrator_image: ghcr.io/super-erp/crm-migrator@sha256:f1d34a7de9d581c2bed1f811816e20a5405c956ae69e49b381b21f7726367fc5
- backup_image: ghcr.io/super-erp/crm-backup@sha256:d0f64b1e88702d35c59422f07ecf6f894b877a6516f1af66c42709c3bff4aced
- agent_image: ghcr.io/super-erp/crm-deployment-agent@sha256:7c09321f35b43dd1b86d55c63907d941a2f2a71915463fe949ebd0b2e2771ad9

