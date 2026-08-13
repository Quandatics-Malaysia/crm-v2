# Client deployment bundle

This directory is the complete pull-only production bundle. It contains no application source, build context, Git operations, registry publishing credential, or volume-deletion command.

## Host preparation

Install Docker Engine with Compose v2, `curl`, `jq`, OpenSSL, and Cosign. Deploy as a dedicated root-controlled OS identity. The deploy script rejects symlinks, a different owner, and any mode other than `0600` for configuration, backup evidence, its detached signature, the pinned public key, backup artifact, and prior deployment record. State directories must be owned by that identity with mode `0700`.

```sh
install -d -m 0700 /opt/quandatics-client /var/lib/quandatics-client /var/lib/quandatics-client/backup /etc/quandatics-client
cp compose.yaml Caddyfile deploy.sh verify-images.sh healthcheck.sh /opt/quandatics-client/
cp -R ops /opt/quandatics-client/
cp .env.example /opt/quandatics-client/.env
chmod 0700 /opt/quandatics-client/*.sh
chmod 0600 /opt/quandatics-client/.env
```

`.env` is strict data, not shell. Use exactly one documented `KEY=value` per line. Do not add `export`, quotes, command substitutions, or unknown keys. Values after the first `=` are literal; database passwords may contain reserved URL characters because `deploy.sh` encodes them with `jq @uri` before Compose receives derived URLs.

Cosign is mandatory and never auto-downloaded. Pin an approved release and verify its checksum before installation. Linux AMD64 example pinned to `v3.1.3`:

```sh
install_tmp=$(mktemp -d)
cd "$install_tmp"
curl --fail --location --remote-name https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64
curl --fail --location --remote-name https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign_checksums.txt
grep ' cosign-linux-amd64$' cosign_checksums.txt | sha256sum --check --strict
sudo install -m 0755 cosign-linux-amd64 /usr/local/bin/cosign
cosign version
```

Compare `cosign_checksums.txt` with the vendor-provided copy through an independent release channel before installation. Do not replace the pinned version with `latest`.

## Pull-only registry access and image trust

Use a dedicated GitHub machine user with a classic PAT limited to `read:packages`. It needs GHCR package access, never repository write access or `write:packages`.

```sh
printf '%s' "$GHCR_PULL_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
unset GHCR_PULL_TOKEN
```

Keep the token in the host secret manager, not `.env`, this bundle, shell history, or an image. Client pull identities need package-read access only; repository visibility is not part of the deployment trust boundary.

The four vendor references must use exactly these repositories:

- `ghcr.io/quandatics-malaysia/crm-web@sha256:...`
- `ghcr.io/quandatics-malaysia/crm-migrator@sha256:...`
- `ghcr.io/quandatics-malaysia/crm-backup@sha256:...`
- `ghcr.io/quandatics-malaysia/crm-deployment-agent@sha256:...`

Each signature must resolve to exact workflow identity `https://github.com/Quandatics-Malaysia/crm-v2/.github/workflows/release-images.yml@refs/tags/<RELEASE_TAG>` and issuer `https://token.actions.githubusercontent.com`. Repository/workflow constants are grouped at the top of `verify-images.sh` for an explicit ownership migration.

PostgreSQL and Caddy must use exact `docker.io/library/postgres@sha256:...` and `docker.io/library/caddy@sha256:...` references. A digest alone proves immutability, not publisher trust. Operations must select these upstream digests from the vendor-reviewed release manifest after upstream provenance, vulnerability, and compatibility review; never substitute a client-selected registry mirror or mutable tag.

## Project, storage, and network identity

`COMPOSE_PROJECT_NAME`, `DEPLOYMENT_ID`, `STORAGE_ID`, and `DB_NAME` are mandatory stable identities. `quandatics-client` creates volumes separate from source-based vendor environments. For an existing installation, inventory its Compose project and named volumes, rehearse restoration, then set the exact existing project identity. A wrong value creates empty volumes or makes signed backup evidence fail closed.

Compose separates networks:

- `gateway` joins frontend only.
- `db` and `migrate` join internal backend only.
- `backup` joins backend plus its isolated outbound transport network for verified off-host copies.
- `web` bridges frontend/backend and a separate internal `agent-web` network.
- `agent` joins only `agent-web` and its outbound control-plane network. It has no published port, database network, database credential, Docker socket, or application-source mount. Its only volume is private agent state.

Both PostgreSQL administration and Caddy bind to host loopback. Host Nginx must terminate public TLS on TCP `:443`, apply the public security/firewall policy, and proxy only to `http://127.0.0.1:${GATEWAY_HOST_PORT}`. Do not expose port 8081 through a host firewall or load balancer. Minimal Nginx location:

```nginx
server {
    listen 443 ssl http2;
    server_name crm.example.com;
    # ssl_certificate and ssl_certificate_key are host-managed.
    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_pass http://127.0.0.1:8081;
    }
}
```

The deployment health URL is derived internally and must be exactly `http://127.0.0.1:<numeric-port>/api/health`; user info, queries, fragments, alternate hosts, and alternate paths are rejected.
Health probes clear all common upper/lower-case proxy variables, pass `curl --disable` to ignore user configuration, and force `--noproxy '*'`, so the loopback request cannot be redirected through a configured proxy.

## Authenticated backup evidence

`BACKUP_IMAGE` and authenticated backup evidence remain mandatory while the dedicated backup producer is delivered separately. Do not bypass this gate.

Provision the backup evidence verification public key as a regular root-owned `0600` file. Put its lowercase SHA-256 in `BACKUP_EVIDENCE_PUBLIC_KEY_SHA256`; this pins the key through protected configuration. Keep the signing private key outside the deployment bundle and available only to the verified backup producer.

The producer must atomically write a root-owned `0600` ciphertext/archive, then this strict evidence payload, then an OpenSSL SHA-256 detached signature over the exact evidence bytes:

```text
EVIDENCE_VERSION=1
DEPLOYMENT_ID=<stable deployment identity>
COMPOSE_PROJECT_NAME=<exact Compose project>
DB_NAME=<database name>
STORAGE_ID=<stable volume/storage identity>
POSTGRES_IMAGE=docker.io/library/postgres@sha256:<64 lowercase hex>
RELEASE_TAG=v1.2.3
WEB_IMAGE=ghcr.io/quandatics-malaysia/crm-web@sha256:<64 lowercase hex>
MIGRATOR_IMAGE=ghcr.io/quandatics-malaysia/crm-migrator@sha256:<64 lowercase hex>
BACKUP_IMAGE=ghcr.io/quandatics-malaysia/crm-backup@sha256:<64 lowercase hex>
SOURCE_COMMIT_SHA=<full release source object ID>
CREATED_AT_EPOCH=<10-digit UTC epoch>
BACKUP_ARTIFACT_FILE=<absolute ciphertext/archive path>
BACKUP_ARTIFACT_SHA256=<64 lowercase hex>
CHECKSUM_VERIFIED=true
RESTORE_VERIFIED=true
UPLOAD_VERIFIED=true
```

No extra, duplicate, blank, or comment lines are accepted. Deployment copies evidence once, verifies its detached signature against the pinned key, parses only that snapshot, binds every identity/provenance field to the intended release, checks freshness, then hashes the referenced artifact itself. Timestamp-only or self-asserted marker files are not accepted.

## Deploy, locking, and rollback

The vendor `deploy-production` workflow normally verifies the bundle's keyless
Cosign signature, extracts it, and applies `release-manifest.json` automatically.
For an audited manual deployment, verify the bundle first, then run:

```sh
cd /opt/quandatics-client
./apply-release-manifest.sh ./.env ./release-manifest.json v1.2.3
./deploy.sh ./.env
```

Order is fixed: validate protected data and exact references; derive encoded DB URLs; validate Compose; verify all vendor image signatures; authenticate and bind backup evidence; load the protected previous record; acquire an atomic project-scoped lock; pull every image; start/wait for PostgreSQL; immediately recheck the signed evidence timestamp and referenced artifact checksum; run the migrator once; recreate web/backup/gateway/agent; verify exact `/api/health`, wait for the agent to apply a valid entitlement, and verify release/agent identity; atomically replace the deployment record; release the lock. If that final evidence check fails after the target database swap, deployment first recreates the previous PostgreSQL configuration and verifies old readiness, while the old web/backup/gateway/agent services remain unchanged.

The lock remains held from before the first pull through record replacement, so concurrent releases cannot migrate or overwrite each other's record. A failed signature, evidence check, or pull leaves running containers unchanged. If the target PostgreSQL image cannot start or pass readiness before migration, the script recreates the previous PostgreSQL digest and verifies database health. On partial recreation, web or agent health/identity failure, or record-write failure, it recreates web/backup/gateway/agent with the complete previous release configuration and then requires old health and exact release/agent identity to pass. Migrations are expand-only; schema/data and volumes are never deleted or rolled back.

Deployment records use schema version 3. Besides prior digests and release identity, the protected record contains the prior runtime URLs, application/agent/migration versions, trust set, database/application/auth credentials, Microsoft integration values, demo settings, backup transport target, loopback gateway/database ports, all service memory limits, and application/database health retry timing needed for an exact rollback. These settings are validated before pull, restored before any rollback recreation, and used to derive the old loopback health URL so host Nginx continues to reach the restored gateway. The one-time installation token is intentionally never recorded; registered agent identity lives in the private `agent-state` volume. The record therefore has the same secret sensitivity as `.env`: retain owner-only `0600` permissions, include it in protected backup handling, and never copy it into tickets or logs. Earlier record schemas are rejected because they cannot reconstruct the agent-aware runtime; migrate any pre-release test installation to a complete protected version 3 record before relying on rollback.

The agent health command fails until a valid signed entitlement has been applied at least once. After that, a control-plane outage does not by itself fail health while the cached entitlement remains in its offline grace window. Inspect health with `docker compose --profile deploy exec -T agent /usr/local/bin/agent-health`; do not replace it with a process-only probe.

Retain the signed release manifest, signed backup evidence, backup artifact, and `DEPLOYMENT_RECORD_FILE` together for audit and recovery. Keep prior runtime digests available locally through the rollback window.
