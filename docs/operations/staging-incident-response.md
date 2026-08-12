# Staging incident response

If production latency, memory, or disk pressure rises, stop only Compose project `crm-v2-staging`. Confirm production health and container identity. Do not delete staging volumes during incident response.

For failed staging rollout, keep prior staging runtime through protected rollback record. For failed production promotion, invoke hardened rollback and verify prior version, agent, and health. Never copy production data into staging to diagnose a defect.
