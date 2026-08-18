import { prepareOperatorAuditStatement } from "../audit"
import { badRequest, notFound } from "../http/errors"
import type { MutationActor } from "./clients"

function deploymentExists(database: D1Database, deploymentId: string) {
  return database.prepare(
    "SELECT id, status, registered_at FROM deployments WHERE id = ?",
  ).bind(deploymentId).first<{ id: string; status: string; registered_at: string | null }>()
}

export async function setDeploymentStatus(
  database: D1Database,
  deploymentId: string,
  status: unknown,
  actor: MutationActor,
): Promise<void> {
  if (status !== "active" && status !== "disabled") throw badRequest()
  const deployment = await deploymentExists(database, deploymentId)
  if (!deployment) throw notFound()

  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "deployment.status.update",
    targetType: "deployment",
    targetId: deploymentId,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { after: { status }, before: { status: deployment.status } },
    createdAt: now,
  })
  await database.batch([
    database.prepare(
      "UPDATE deployments SET status = ?, updated_at = ? WHERE id = ?",
    ).bind(status, now, deploymentId),
    audit.statement,
  ])
}

export async function revokeInstallTokens(
  database: D1Database,
  deploymentId: string,
  actor: MutationActor,
): Promise<void> {
  const deployment = await deploymentExists(database, deploymentId)
  if (!deployment) throw notFound()

  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(database, {
    operatorId: actor.operatorId,
    action: "install_token.revoke",
    targetType: "deployment",
    targetId: deploymentId,
    outcome: "success",
    requestId: actor.requestId,
    metadata: { status: deployment.status },
    createdAt: now,
  })
  await database.batch([
    database.prepare(
      "UPDATE install_tokens SET superseded_at = ? WHERE deployment_id = ? AND used_at IS NULL AND superseded_at IS NULL",
    ).bind(now, deploymentId),
    audit.statement,
  ])
}
