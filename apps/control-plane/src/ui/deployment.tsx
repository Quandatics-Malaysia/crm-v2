/** @jsxImportSource hono/jsx */
import type { DeploymentWorkspace, OnboardingNextAction } from "../repos/onboarding"
import { Card, DataList, EmptyState, PageHeader, ProgressSteps, StatusBadge, type StatusTone } from "./components"
import { OperatorLayout } from "./layout"

type StepState = "blocked" | "complete" | "current" | "upcoming"

interface NextAction {
  title: string
  description: string
  href?: string
  linkLabel?: string
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatUtc(value: string | null): string {
  if (value === null) return "Not available"
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "Not available"
}

function statusTone(status: string): StatusTone {
  if (["active", "healthy", "online"].includes(status)) return "success"
  if (["grace", "stale", "past_due", "unsigned"].includes(status)) return "warning"
  if (["disabled", "read_only", "unhealthy", "never_connected"].includes(status)) return "error"
  return "neutral"
}

function licenceLabel(state: DeploymentWorkspace["onboarding"]["licenceState"]): string {
  if (state === "active") return "Active licence"
  if (state === "grace") return "Grace period"
  if (state === "read_only") return "Read-only licence"
  return "Unsigned entitlement"
}

function connectivityLabel(state: DeploymentWorkspace["onboarding"]["connectivityState"]): string {
  if (state === "online") return "Online"
  if (state === "stale") return "Stale connection"
  return "Never connected"
}

function actionFor(action: OnboardingNextAction, workspace: DeploymentWorkspace): NextAction {
  if (workspace.client.status !== "active") {
    return {
      title: "Reactivate client",
      description: "Client is disabled. Reactivate the client before signing can continue.",
      href: `/operator/clients/${workspace.client.id}`,
      linkLabel: "Open client administration",
    }
  }
  if (workspace.deployment.status !== "active") {
    return {
      title: "Reactivate deployment",
      description: "Deployment is disabled. Reactivate the deployment before signing can continue.",
      href: `/operator/clients/${workspace.client.id}#deployments-heading`,
      linkLabel: "Open deployment administration",
    }
  }

  switch (action) {
    case "create_contract":
      return {
        title: "Create contract",
        description: "No active compatible contract covers this deployment. Add contract terms before installation can continue.",
        href: `/operator/clients/${workspace.client.id}#contracts-heading`,
        linkLabel: "Add contract",
      }
    case "issue_install_token":
      return {
        title: "Issue install token",
        description: "Deployment is not registered. Issue an install token, then complete registration from the deployment.",
        href: "#install-token",
        linkLabel: "Review install registration",
      }
    case "configure_entitlement":
      return {
        title: "Configure entitlement",
        description: "Registration is complete, but no compatible entitlement configuration is ready for signing.",
        href: "#entitlement-configuration",
        linkLabel: "Review entitlement configuration",
      }
    case "issue_entitlement":
      return {
        title: "Issue signed entitlement",
        description: "A compatible configuration is ready, but this deployment has no signed entitlement yet.",
        href: "#entitlement-review",
        linkLabel: "Review entitlement status",
      }
    case "verify_heartbeat":
      return {
        title: "Verify heartbeat",
        description: "A current healthy heartbeat has not acknowledged this deployment. Restore connectivity and send a healthy heartbeat.",
        href: "#heartbeat-status",
        linkLabel: "Review heartbeat status",
      }
    case "issue_new_version":
      return {
        title: "Issue new version",
        description: "Current lease is in grace or read-only mode. Issue a new signed entitlement version after reviewing the configuration.",
        href: "#entitlement-review",
        linkLabel: "Review entitlement status",
      }
    case "none":
      return {
        title: "Onboarding complete",
        description: "Deployment has an active entitlement and a current healthy heartbeat.",
      }
  }
}

function stepState(stage: OnboardingNextAction, action: OnboardingNextAction): StepState {
  const effectiveAction = action === "issue_new_version" ? "issue_entitlement" : action
  if (effectiveAction === "none") return "complete"
  if (stage === effectiveAction) return "blocked"
  const order: OnboardingNextAction[] = [
    "create_contract",
    "issue_install_token",
    "configure_entitlement",
    "issue_entitlement",
    "verify_heartbeat",
  ]
  return order.indexOf(stage) < order.indexOf(effectiveAction) ? "complete" : "upcoming"
}

function progressSteps(workspace: DeploymentWorkspace) {
  const action = workspace.onboarding.nextAction
  const clientState: StepState = workspace.client.status === "active" ? "complete" : "blocked"
  const deploymentState: StepState = workspace.deployment.status === "active" ? "complete" : "blocked"
  return [
    { label: "Client", state: clientState, href: `/operator/clients/${workspace.client.id}` },
    { label: "Contract", state: stepState("create_contract", action), href: `/operator/clients/${workspace.client.id}#contracts-heading` },
    { label: "Deployment", state: deploymentState, href: `/operator/clients/${workspace.client.id}#deployments-heading` },
    { label: "Install", state: stepState("issue_install_token", action), href: "#install-token" },
    { label: "Configure", state: stepState("configure_entitlement", action), href: "#entitlement-configuration" },
    { label: "Sign", state: stepState("issue_entitlement", action), href: "#entitlement-review" },
    { label: "Verify", state: stepState("verify_heartbeat", action), href: "#heartbeat-status" },
  ]
}

export function DeploymentPage(props: { workspace: DeploymentWorkspace; operatorEmail: string }) {
  const { workspace } = props
  const nextAction = actionFor(workspace.onboarding.nextAction, workspace)
  const tokenStatus = workspace.token === null
    ? "No install token issued"
    : workspace.token.usedAt !== null
      ? "Install token used"
      : Date.parse(workspace.token.expiresAt) <= Date.now()
        ? "Install token expired"
        : "Install token awaiting use"
  const registrationStatus = workspace.registration === null ? "Not registered" : "Registered"
  const heartbeatStatus = workspace.latestHeartbeat === null ? "No heartbeat received" : titleCase(workspace.latestHeartbeat.healthStatus)

  return (
    <OperatorLayout
      title={workspace.deployment.deploymentKey}
      operatorEmail={props.operatorEmail}
      breadcrumbs={[
        { label: "Dashboard", href: "/operator" },
        { label: "Clients", href: "/operator/clients" },
        { label: workspace.client.displayName, href: `/operator/clients/${workspace.client.id}` },
        { label: workspace.deployment.deploymentKey },
      ]}
    >
      <PageHeader
        eyebrow="Deployment signing workspace"
        title={workspace.deployment.deploymentKey}
        description={`${workspace.client.displayName} · ${titleCase(workspace.deployment.environment)} environment`}
        actions={<><StatusBadge tone={statusTone(workspace.onboarding.licenceState)}>{licenceLabel(workspace.onboarding.licenceState)}</StatusBadge><StatusBadge tone={statusTone(workspace.onboarding.connectivityState)}>{connectivityLabel(workspace.onboarding.connectivityState)}</StatusBadge></>}
      />

      <DataList items={[
        { term: "Client", details: workspace.client.displayName },
        { term: "Environment", details: titleCase(workspace.deployment.environment) },
        { term: "Registration", details: <StatusBadge tone={statusTone(registrationStatus.toLowerCase().replaceAll(" ", "_"))}>{registrationStatus}</StatusBadge> },
      ]} />
      {workspace.client.status !== "active" ? <p class="field-hint">Client is disabled. Reactivate the client before signing can continue.</p> : null}
      {workspace.deployment.status !== "active" ? <p class="field-hint">Deployment is disabled. Reactivate the deployment before signing can continue.</p> : null}
      <details class="field-hint">
        <summary>Advanced identifiers</summary>
        <DataList items={[
          { term: "Client ID", details: <code>{workspace.client.id}</code> },
          { term: "Deployment ID", details: <code>{workspace.deployment.id}</code> },
          { term: "Client key", details: <code>{workspace.client.clientKey}</code> },
          { term: "Deployment key", details: <code>{workspace.deployment.deploymentKey}</code> },
          ...(workspace.registration === null ? [] : [
            { term: "Deployment key ID", details: <code>{workspace.registration.keyId}</code> },
            { term: "Key fingerprint", details: <code>{workspace.registration.keyFingerprint}</code> },
          ]),
        ]} />
      </details>

      <section class="workspace-section" aria-label="Deployment signing progress">
        <ProgressSteps label="Deployment signing progress" steps={progressSteps(workspace)} />
      </section>

      <section class="workspace-section" aria-label="Required action">
        <Card title={nextAction.title} footer={nextAction.href ? <a class="button-link" href={nextAction.href}>{nextAction.linkLabel}</a> : undefined}>
          <p>{nextAction.description}</p>
        </Card>
      </section>

      <section id="install-token" class="workspace-section" aria-labelledby="install-token-heading">
        <h2 id="install-token-heading">Install registration</h2>
        <Card title="Install token status">
          <DataList items={[
            { term: "Token status", details: <StatusBadge tone={statusTone(tokenStatus.includes("awaiting") ? "stale" : tokenStatus.includes("used") ? "active" : "disabled")}>{tokenStatus}</StatusBadge> },
            { term: "Registered", details: registrationStatus },
            { term: "Registered at (UTC)", details: formatUtc(workspace.registration?.registeredAt ?? null) },
            { term: "Token expires at (UTC)", details: formatUtc(workspace.token?.expiresAt ?? null) },
            { term: "Token used at (UTC)", details: formatUtc(workspace.token?.usedAt ?? null) },
          ]} />
          <p class="field-hint">This read-only workspace does not issue or reveal install tokens. Token issuance appears here in the next workflow section.</p>
        </Card>
      </section>

      <section id="entitlement-configuration" class="workspace-section" aria-labelledby="entitlement-configuration-heading">
        <h2 id="entitlement-configuration-heading">Entitlement configuration</h2>
        <Card title="Configuration status">
          {workspace.schedule === null ? <p>No compatible entitlement configuration is ready.</p> : <DataList items={[
            { term: "Configuration version", details: workspace.schedule.configurationVersion },
            { term: "Release channel", details: titleCase(workspace.schedule.releaseChannel) },
            { term: "Minimum app version", details: workspace.schedule.minimumSupportedAppVersion },
            { term: "Next check at (UTC)", details: formatUtc(workspace.schedule.nextCheckAt) },
            { term: "Updated at (UTC)", details: formatUtc(workspace.schedule.updatedAt) },
          ]} />}
          <p class="field-hint">Configuration controls remain unavailable in this read-only workspace.</p>
        </Card>
      </section>

      <section id="entitlement-review" class="workspace-section" aria-labelledby="entitlement-history-heading">
        <h2 id="entitlement-history-heading">Entitlement history</h2>
        {workspace.recentEntitlements.length === 0 ? <EmptyState title="No signed entitlements">A signed entitlement will appear here after configuration is reviewed and issued.</EmptyState> : <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Version</th><th scope="col">Issued at (UTC)</th><th scope="col">Lease expires at (UTC)</th><th scope="col">Grace until (UTC)</th></tr></thead><tbody>{workspace.recentEntitlements.map((entitlement) => <tr><th scope="row">Version {entitlement.version}</th><td>{formatUtc(entitlement.issuedAt)}</td><td>{formatUtc(entitlement.leaseExpiresAt)}</td><td>{formatUtc(entitlement.graceUntil)}</td></tr>)}</tbody></table></div>}
        <p class="field-hint">Signing controls remain unavailable in this read-only workspace. Signed envelopes and private keys are never displayed.</p>
      </section>

      <section id="heartbeat-status" class="workspace-section" aria-labelledby="heartbeat-heading">
        <h2 id="heartbeat-heading">Heartbeat status</h2>
        <Card title="Latest heartbeat">
          <DataList items={[
            { term: "Connection", details: <StatusBadge tone={statusTone(workspace.onboarding.connectivityState)}>{connectivityLabel(workspace.onboarding.connectivityState)}</StatusBadge> },
            { term: "Health", details: <StatusBadge tone={statusTone(workspace.latestHeartbeat?.healthStatus ?? "never_connected")}>{heartbeatStatus}</StatusBadge> },
            { term: "Observed at (UTC)", details: formatUtc(workspace.latestHeartbeat?.observedAt ?? null) },
            { term: "Application version", details: workspace.latestHeartbeat?.applicationVersion ?? "Not available" },
            { term: "Occupied seats", details: workspace.latestHeartbeat?.occupiedSeats === undefined ? "Not available" : String(workspace.latestHeartbeat.occupiedSeats) },
          ]} />
        </Card>
      </section>

      <section class="workspace-section" aria-labelledby="audit-timeline-heading">
        <h2 id="audit-timeline-heading">Audit timeline</h2>
        {workspace.recentAuditEvents.length === 0 ? <EmptyState title="No deployment audit events">Deployment activity will appear here as it is recorded.</EmptyState> : <ol class="attention-list">{workspace.recentAuditEvents.map((event) => <li class="attention-item"><StatusBadge tone={statusTone(event.outcome === "success" ? "active" : event.outcome === "denied" ? "disabled" : "stale")}>{titleCase(event.outcome)}</StatusBadge><div><h3>{titleCase(event.action)}</h3><p>Created at (UTC): {formatUtc(event.createdAt)}</p></div></li>)}</ol>}
      </section>
    </OperatorLayout>
  )
}
