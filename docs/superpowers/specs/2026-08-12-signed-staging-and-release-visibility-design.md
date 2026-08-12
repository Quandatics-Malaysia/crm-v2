# Signed staging and release visibility design

**Date:** 2026-08-12  
**Status:** Approved  
**Supersedes:** `2026-07-18-staging-environment-design.md`

## Goal

Run production and staging on the Quandatics host without exposing product
source. Both environments consume vendor-built, scanned, signed images by
immutable digest. Staging lets approved client developers validate changes;
only the vendor promotes a tested digest to production. Both applications show
their deployed version and release channel.

## Environment topology

| Property | Production | Staging |
| --- | --- | --- |
| Public URL | `https://app.quandatics.com` | `https://staging.app.quandatics.com` |
| Compose project | `crm-v2` | `crm-v2-staging` |
| Deployment environment | `production` | `staging` |
| Release channel | `stable` | `beta` |
| Gateway loopback port | `8091` | `8092` |
| PostgreSQL loopback port | existing production value | `5434` |
| Database and volumes | production-only | staging-only |
| Agent identity | production deployment | separate staging deployment |
| Data | customer data | generated or anonymised data only |

Staging receives separate database credentials, Better Auth secret, agent web
secret, installation token, storage identity, backup state, uploads, and
entitlement. No production volume or credential may be mounted into staging.

Staging uses the existing source-free `deploy/client` bundle. It must not use a
Git checkout, Docker build context, self-hosted GitHub runner, or mutable image
tag on the client host.

## Host resource policy

Production keeps priority. Staging defaults:

- PostgreSQL: 1 GiB memory
- Web: 768 MiB memory
- Agent: 128 MiB memory
- Backup: 256 MiB memory
- Gateway: 128 MiB memory
- No production data copy
- Log rotation uses the existing 10 MiB by 3-file policy

Staging may be stopped without changing production. If the host shows memory,
disk, or latency pressure, staging is the first workload stopped and moved to a
separate VM.

## Access model

Cloudflare Access protects `staging.app.quandatics.com` before CRM auth. Initial
allowlist contains only `laijienweng@gmail.com`. Additional developers receive
individual identities; shared accounts are prohibited.

Quandatics developers receive:

- Staging URL and individual CRM account
- Generated test organisations and data
- API/webhook documentation and staging credentials
- Integration repository access
- Issue and acceptance workflow
- Release notes

They do not receive core source, production SSH/database access, registry write
access, signing keys, vendor console access, or production deployment tokens.

## Version and release metadata

The runtime already requires `APPLICATION_VERSION`, `MIGRATION_VERSION`,
`RELEASE_TAG`, `SOURCE_COMMIT_SHA`, `IMAGE_DIGEST`, and deployment identity.
Expose a read-only **System version** card to authenticated users with:

- Application version
- Release tag
- Release channel (`stable`, `beta`, or `canary`)
- Environment (`production` or `staging`)
- Web image digest, abbreviated to 12 hexadecimal characters
- Migration version
- Deployment timestamp when available

Production therefore visibly reports, for example, `v1.2.14 / stable`.
Staging reports `v1.2.14-rc.1 / beta`. Full digests and source commit remain
available only to superadmins and vendor diagnostics; ordinary users see the
short digest and no repository link.

The health endpoint remains non-sensitive and must not expose source commit,
credentials, or full image provenance.

## Version policy

Production releases use strict SemVer annotated tags:

- Patch: `v1.2.14`
- Minor: `v1.3.0`
- Major: `v2.0.0`

Staging candidates use SemVer prereleases such as `v1.2.14-rc.1`. Release CI
must accept and validate prerelease tags while preserving strict annotated-tag
and workflow-identity checks.

Every release manifest records release tag, source commit, build time, workflow
identity, and immutable web/migrator/backup/agent image digests. CI scans,
generates SPDX SBOMs and provenance, signs each digest with keyless Cosign, and
verifies signatures before publication.

No environment deploys `latest`. Human-readable tags are discovery aliases;
Compose always receives digest references.

## Promotion workflow

1. Merge approved code into the vendor release branch.
2. Create annotated release-candidate tag, such as `v1.2.14-rc.1`.
3. CI builds, scans, SBOMs, signs, verifies, and publishes all four images.
4. Vendor control plane approves those digests for the staging deployment.
5. Staging deployment verifies signatures, backup evidence, and identity before
   migration and rollout.
6. Quandatics validates staging and records acceptance.
7. Create final annotated tag `v1.2.14` from the accepted commit.
8. CI produces final signed manifest. Production deploys those final digests
   only after a verified encrypted backup.
9. Deployment checks application health, agent entitlement, version, migration,
   and exact digest. Failure restores the prior runtime configuration.

Production promotion is vendor-controlled. A client developer cannot publish an
image, alter an approved digest, issue an entitlement, or deploy production.

## DNS and routing

Create `staging.app.quandatics.com` in Cloudflare and route it to the existing
host. The host TLS proxy forwards only that hostname to
`http://127.0.0.1:8092`. `app.quandatics.com` keeps its existing production
route. Cloudflare Access applies only to staging; production continues using CRM
authentication.

## Deployment safety gates

Before staging starts:

- Confirm staging project, ports, deployment ID, storage ID, DB name, secrets,
  and volume names differ from production.
- Confirm every vendor image is digest-pinned and Cosign-verified.
- Confirm staging entitlement is non-billable and independent of production.
- Confirm no source checkout or GitHub runner exists on the client host.
- Confirm Cloudflare Access blocks an unapproved email.

After staging starts:

- Both `/api/health` endpoints return HTTP 200.
- Production container IDs, volumes, and release metadata remain unchanged.
- Staging version card shows `beta`; production version card shows `stable`.
- Staging login and tenant creation do not affect production seat usage or data.
- Stopping the staging Compose project leaves production healthy.

## Documentation deliverables

- Vendor release and versioning runbook
- Client staging developer guide
- Production promotion and rollback checklist
- Environment inventory template containing no secrets
- Incident procedure for staging resource pressure or failed promotion

## Out of scope

- Source-code access for client developers
- Direct client production deployments
- Production data cloning
- Per-pull-request environments
- Permanent same-host staging if capacity becomes insufficient
