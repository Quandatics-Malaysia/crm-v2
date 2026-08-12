# Environment inventory template

Record no passwords, tokens, private keys, or full environment files.

| Field | Production | Staging |
| --- | --- | --- |
| URL | `app.quandatics.com` | `staging.app.quandatics.com` |
| Compose project | `crm-v2` | `crm-v2-staging` |
| Deployment ID | record non-secret ID | record non-secret ID |
| Channel | `stable` | `beta` |
| Release tag | record value | record value |
| Short web digest | record 12 chars | record 12 chars |
| Gateway port | `8091` | `8092` |
| DB port | record value | `5434` |
| Rollback release | record value | record value |
