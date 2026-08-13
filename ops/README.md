# Operations scripts

This directory supports source-based local development and staging. It is not
the production deployment contract.

## Production

Production uses the pull-only, source-free bundle in `deploy/client/`:

1. Create a signed SemVer release with `scripts/release-one-command.sh`.
2. Run the manual `deploy-production` workflow with that exact tag.
3. The self-hosted runner verifies the bundle and Cosign identities, applies
   immutable image digests, migrates once, starts the deployment agent, and
   verifies application and entitlement health.

See [`deploy/client/README.md`](../deploy/client/README.md) for the deployment
contract and [`OPERATIONS.md`](../OPERATIONS.md) for release and recovery steps.
Do not deploy production with the root `docker-compose.yaml`.

## Source stacks

The root Compose files and scripts here remain useful for local development,
staging, backup testing, and recovery rehearsals. They build from source and do
not replace the signed production bundle.

Never run volume deletion, restore, or pruning commands until the exact Compose
project and backup have been verified.
