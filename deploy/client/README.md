# Client deployment bundle

This directory is the complete pull-only production bundle. It contains no application source, build context, Git workflow, or registry publishing credential. Run it from a protected host directory; do not place it inside a source checkout.

## Host preparation

Install Docker Engine with Compose v2, `curl`, and Cosign. Create a dedicated configuration and state directory:

```sh
install -d -m 0700 /opt/quandatics-client /var/lib/quandatics-client/backup
cp compose.yaml Caddyfile deploy.sh verify-images.sh healthcheck.sh /opt/quandatics-client/
cp .env.example /opt/quandatics-client/.env
chmod 0700 /opt/quandatics-client/*.sh
chmod 0600 /opt/quandatics-client/.env
```

Cosign is mandatory. Deployment fails closed when it is missing; scripts never download executables. Pin an approved version and verify its release checksum before installation. Example for Linux AMD64, pinned to `v3.1.3`:

```sh
install_tmp=$(mktemp -d)
cd "$install_tmp"
curl --fail --location --remote-name https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64
curl --fail --location --remote-name https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign_checksums.txt
grep ' cosign-linux-amd64$' cosign_checksums.txt | sha256sum --check --strict
sudo install -m 0755 cosign-linux-amd64 /usr/local/bin/cosign
cosign version
```

Obtain `cosign_checksums.txt` through the vendor release channel too and compare it before installation; downloading binary and checksum through one compromised channel is not an independent trust check. Use matching pinned assets for another CPU architecture. Do not replace `v3.1.3` with `latest` in automation.

## Pull-only registry access

Use a dedicated GitHub service account or machine user with a classic PAT limited to `read:packages`. It needs access only to the private GHCR packages, never repository source or `write:packages`. Authenticate once as the deployment OS account:

```sh
printf '%s' "$GHCR_PULL_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
unset GHCR_PULL_TOKEN
```

Keep the token in the host secret manager, not `.env`, this bundle, shell history, or an image. Package access must be granted explicitly because `Quandatics-Malaysia/crm-v2` is private and client pull identities do not receive source access.

## Release configuration

Copy `.env.example` to `.env`, replace every placeholder, and paste all five digest references from the approved release manifest. Vendor images must remain under `ghcr.io/quandatics-malaysia/`; web, migrator, and backup signatures must resolve to this exact identity:

```text
https://github.com/Quandatics-Malaysia/crm-v2/.github/workflows/release-images.yml@refs/tags/<RELEASE_TAG>
```

The OIDC issuer is exactly `https://token.actions.githubusercontent.com`. Repository/workflow constants live together at the top of `verify-images.sh` so an ownership migration is explicit and reviewable.

`COMPOSE_PROJECT_NAME` is required. `quandatics-client` creates a project separate from source-based vendor environments. During migration of an existing installation, inventory its named volumes first and set this value to the existing Compose project name only after a restore rehearsal. A wrong project name creates new empty volumes. The deploy script never runs `down`, never deletes volumes, and never builds or fetches source.

Only the gateway publishes a non-loopback port. PostgreSQL administration stays on `127.0.0.1:${DB_HOST_PORT}` for an SSH tunnel. No database admin web UI is included.

## Verified backup gate

`BACKUP_IMAGE` remains required even while the dedicated backup target is delivered separately. Do not bypass this gate. Before deployment, the verified backup process must atomically write `BACKUP_MARKER_FILE` with exactly one line per field:

```text
RELEASE_TAG=v1.2.3
WEB_IMAGE=ghcr.io/quandatics-malaysia/crm-web@sha256:<64 lowercase hex>
MIGRATOR_IMAGE=ghcr.io/quandatics-malaysia/crm-migrator@sha256:<64 lowercase hex>
BACKUP_IMAGE=ghcr.io/quandatics-malaysia/crm-backup@sha256:<64 lowercase hex>
CREATED_AT_EPOCH=<10-digit UTC epoch>
DUMP_SHA256=<64 lowercase hex>
CHECKSUM_VERIFIED=true
RESTORE_VERIFIED=true
UPLOAD_VERIFIED=true
```

The marker must be newer than `BACKUP_MAX_AGE_SECONDS` and bound to the intended release tag and all three vendor digests. A timestamp-only marker is rejected.

## Deploy

```sh
cd /opt/quandatics-client
./deploy.sh ./.env
```

Order is fixed: validate configuration and tools, verify all vendor signatures, validate fresh backup evidence, pull every image, start/wait for PostgreSQL, run the migrator once, recreate web/backup/gateway, wait for `/api/health`, then atomically record deployed digests. Failed validation, verification, or pull never changes running containers. Migration and health failures stop without deleting data or volumes and do not write a deployment record.

The current record is stored at `DEPLOYMENT_RECORD_FILE` with mode `0600`. Retain the vendor release manifest, backup evidence, and this record together for audit and recovery.
