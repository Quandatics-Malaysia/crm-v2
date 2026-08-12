# Release and versioning runbook

## Versions

- Candidate: annotated tag `v1.2.14-rc.1`, channel `beta`.
- Production: annotated tag `v1.2.14`, channel `stable`.
- Never deploy `latest`; deployment uses `repository@sha256:digest`.

## Build and sign

1. Merge reviewed code in vendor repository.
2. Create annotated tag: `git tag -a v1.2.14-rc.1 -m "v1.2.14-rc.1"`.
3. Push tag. GitHub Actions builds web, migrator, backup, and agent for amd64/arm64.
4. CI scans HIGH/CRITICAL vulnerabilities and secrets, emits SPDX SBOM/provenance, signs each digest with Cosign, then verifies exact workflow identity.
5. Download and retain `release-manifest.json` and evidence artifacts.

## Promote

Deploy candidate manifest to staging. After acceptance, create final annotated tag from exact accepted commit. Produce fresh encrypted production backup and signed backup evidence. Update production entitlement to final web digest, then deploy all final manifest digests. Verify `/settings/system` reports final tag and `stable`.

Rollback uses protected prior deployment record and prior digests. Never delete volumes or reverse schema migrations.
