# Production promotion checklist

- Staging acceptance recorded for exact candidate commit and digest.
- Final annotated SemVer tag points to accepted commit.
- CI scan, SBOM, provenance, Cosign signing, verification, and manifest passed.
- Fresh encrypted backup, restore verification, upload verification, and signed evidence passed.
- Vendor entitlement approves final web digest and stable channel.
- Deploy exact manifest digests; never rebuild on host.
- Health, agent entitlement, migration, runtime identity, and `/settings/system` pass.
- Prior digests and protected deployment record remain available for rollback.
