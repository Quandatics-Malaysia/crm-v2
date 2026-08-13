/** @jsxImportSource hono/jsx */
import type { DeploymentWorkspace, OnboardingNextAction } from "../repos/onboarding"
import { Card, DataList, EmptyState, Notice, PageHeader, ProgressSteps, StatusBadge, type NoticeTone, type StatusTone } from "./components"
import { OperatorLayout } from "./layout"

type StepState = "blocked" | "complete" | "current" | "upcoming"

interface NextAction {
  title: string
  description: string
  href?: string
  linkLabel?: string
}

interface DeploymentNotice {
  tone: NoticeTone
  title: string
  message: string
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
      title: "Client disabled",
      description: "Client is disabled. Reactivation is not available in this workspace. Contact a vendor owner, then review the client record for status changes.",
      href: `/operator/clients/${workspace.client.id}`,
      linkLabel: "Review client record",
    }
  }
  if (workspace.deployment.status !== "active") {
    return {
      title: "Deployment disabled",
      description: "Deployment is disabled. Reactivation is not available in this workspace. Contact a vendor owner, then review the client deployment list for status changes.",
      href: `/operator/clients/${workspace.client.id}#deployments-heading`,
      linkLabel: "Review deployment record",
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
        linkLabel: "Issue install token",
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
        href: `/operator/deployments/${workspace.deployment.id}/entitlements/review`,
        linkLabel: "Review and issue entitlement",
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
        href: `/operator/deployments/${workspace.deployment.id}/entitlements/review`,
        linkLabel: "Review and issue new version",
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
    { label: "Sign", state: stepState("issue_entitlement", action), href: `/operator/deployments/${workspace.deployment.id}/entitlements/review` },
    { label: "Verify", state: stepState("verify_heartbeat", action), href: "#heartbeat-status" },
  ]
}

function EntitlementHistory(props: {
  entitlements: DeploymentWorkspace["recentEntitlements"]
  capped: boolean
}) {
  if (props.entitlements.length === 0) {
    return <EmptyState title="No signed entitlements">A signed entitlement will appear here after configuration is reviewed and issued.</EmptyState>
  }
  return (
    <>
      <div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Version</th><th scope="col">Issued at (UTC)</th><th scope="col">Lease expires at (UTC)</th><th scope="col">Grace until (UTC)</th></tr></thead><tbody>{props.entitlements.map((entitlement) => <tr><th scope="row">Version {entitlement.version}</th><td>{formatUtc(entitlement.issuedAt)}</td><td>{formatUtc(entitlement.leaseExpiresAt)}</td><td>{formatUtc(entitlement.graceUntil)}</td></tr>)}</tbody></table></div>
      {props.capped ? <p class="field-hint">Showing the latest 10 immutable versions. Older versions remain stored.</p> : null}
    </>
  )
}

export function DeploymentPage(props: { workspace: DeploymentWorkspace; operatorEmail: string; notice?: DeploymentNotice }) {
  const { workspace } = props
  const nextAction = actionFor(workspace.onboarding.nextAction, workspace)
  const canIssueInstallToken = workspace.client.status === "active" &&
    workspace.deployment.status === "active" && workspace.registration === null
  const tokenStatus = workspace.token === null
    ? "No install token issued"
    : workspace.token.usedAt !== null
      ? "Install token used"
      : Date.parse(workspace.token.expiresAt) <= Date.now()
        ? "Install token expired"
        : "Install token awaiting use"
  const registrationStatus = workspace.registration === null ? "Not registered" : "Registered"
  const heartbeatStatus = workspace.latestHeartbeat === null ? "No heartbeat received" : titleCase(workspace.latestHeartbeat.healthStatus)
  const canConfigureSchedule = workspace.client.status === "active" && workspace.deployment.status === "active" &&
    workspace.registration !== null && workspace.compatibleContracts.length > 0
  const reviewHref = `/operator/deployments/${workspace.deployment.id}/entitlements/review`

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
      {props.notice ? <Notice tone={props.notice.tone} title={props.notice.title}>{props.notice.message}</Notice> : null}

      <DataList items={[
        { term: "Client", details: workspace.client.displayName },
        { term: "Environment", details: titleCase(workspace.deployment.environment) },
        { term: "Registration", details: <StatusBadge tone={statusTone(registrationStatus.toLowerCase().replaceAll(" ", "_"))}>{registrationStatus}</StatusBadge> },
      ]} />
      {workspace.client.status !== "active" ? <p class="field-hint">Client is disabled. Reactivation is not available in this workspace. Contact a vendor owner and review the client record.</p> : null}
      {workspace.deployment.status !== "active" ? <p class="field-hint">Deployment is disabled. Reactivation is not available in this workspace. Contact a vendor owner and review the deployment record.</p> : null}
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
          {canIssueInstallToken ? <form action={`/operator/deployments/${workspace.deployment.id}/install-tokens`} method="post">
            <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
            <div class="field">
              <label for="install-token-expires-at">Token expiry (UTC)</label>
              <input id="install-token-expires-at" name="expiresAt" type="datetime-local" required />
              <p class="field-hint">Choose an expiry within the next 24 hours. The token is shown once and cannot be recovered.</p>
            </div>
            <button type="submit">Issue install token</button>
          </form> : <p class="field-hint">Install tokens can be issued only for an active deployment that has not yet registered.</p>}
        </Card>
      </section>

      <section id="entitlement-configuration" class="workspace-section" aria-labelledby="entitlement-configuration-heading">
        <h2 id="entitlement-configuration-heading">Entitlement configuration</h2>
        <Card title="Configuration status">
          {workspace.schedule === null ? <p>No compatible entitlement configuration is ready.</p> : <DataList items={[
            { term: "Configuration version", details: workspace.schedule.configurationVersion },
            { term: "Channel", details: titleCase(workspace.schedule.releaseChannel) },
            { term: "Minimum app version", details: workspace.schedule.minimumSupportedAppVersion },
            { term: "Approved image digest", details: workspace.schedule.approvedImageDigest ?? "Not restricted" },
            { term: "Next check at (UTC)", details: formatUtc(workspace.schedule.nextCheckAt) },
            { term: "Updated at (UTC)", details: formatUtc(workspace.schedule.updatedAt) },
          ]} />}
          {canConfigureSchedule ? <form class="form-grid" method="post" action={`/operator/deployments/${workspace.deployment.id}/entitlements/schedule`}>
            <div class="field">
              <label for="entitlement-contract">Contract</label>
              <select id="entitlement-contract" name="contractId" required>
                {workspace.compatibleContracts.map((contract) => <option value={contract.id} selected={workspace.schedule?.contractId === contract.id}>{contract.id} — {contract.seatLimit} seats</option>)}
              </select>
              <p class="field-hint">Only active, current contracts for this client are available.</p>
            </div>
            <div class="field">
              <label for="configuration-version">Configuration version</label>
              <input id="configuration-version" name="configurationVersion" required maxLength={128} value={workspace.schedule?.configurationVersion ?? ""} placeholder="configuration-2026-08" />
            </div>
            <div class="field">
              <label for="release-channel">Channel</label>
              <select id="release-channel" name="releaseChannel" required>
                {(["stable", "beta", "canary"] as const).map((channel) => <option value={channel} selected={(workspace.schedule?.releaseChannel ?? "stable") === channel}>{titleCase(channel)}</option>)}
              </select>
            </div>
            <div class="field">
              <label for="minimum-app-version">Minimum app version</label>
              <input id="minimum-app-version" name="minimumSupportedAppVersion" required maxLength={64} value={workspace.schedule?.minimumSupportedAppVersion ?? ""} placeholder="2.3.0" />
            </div>
            <div class="field">
              <label for="approved-image-digest">Optional SHA-256 image digest</label>
              <input id="approved-image-digest" name="approvedImageDigest" maxLength={71} pattern="sha256:[a-f0-9]{64}" value={workspace.schedule?.approvedImageDigest ?? ""} placeholder={`sha256:${"a".repeat(64)}`} />
              <p class="field-hint">Leave empty when deployment image is not pinned. Use lowercase hexadecimal.</p>
            </div>
            <div><button type="submit">Save entitlement configuration</button></div>
          </form> : <p class="field-hint">Configuration requires an active client and deployment, completed registration, and a current compatible contract.</p>}
        </Card>
      </section>

      <section id="entitlement-review" class="workspace-section" aria-labelledby="entitlement-history-heading">
        <h2 id="entitlement-history-heading">{workspace.entitlementHistoryCapped ? "Latest 10 versions" : "Entitlement history"}</h2>
        <EntitlementHistory entitlements={workspace.recentEntitlements} capped={workspace.entitlementHistoryCapped} />
        {workspace.schedule !== null ? <p><a class="button-link" href={reviewHref}>Review entitlement terms</a></p> : null}
        <p class="field-hint">Prior versions are immutable. Signed envelopes and signing keys are never displayed.</p>
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

export function EntitlementReviewPage(props: {
  workspace: DeploymentWorkspace
  operatorEmail: string
  idempotencyKey: string
}) {
  const { workspace } = props
  const schedule = workspace.schedule
  const contract = schedule === null
    ? undefined
    : workspace.compatibleContracts.find((candidate) => candidate.id === schedule.contractId)
  const canIssue = workspace.client.status === "active" && workspace.deployment.status === "active" &&
    workspace.registration !== null && schedule !== null && contract !== undefined
  const workspaceHref = `/operator/deployments/${workspace.deployment.id}`
  const buttonLabel = workspace.latestEntitlement === null ? "Issue signed entitlement" : "Issue new version"

  return (
    <OperatorLayout
      title="Review entitlement issuance"
      operatorEmail={props.operatorEmail}
      breadcrumbs={[
        { label: "Dashboard", href: "/operator" },
        { label: "Clients", href: "/operator/clients" },
        { label: workspace.client.displayName, href: `/operator/clients/${workspace.client.id}` },
        { label: workspace.deployment.deploymentKey, href: workspaceHref },
        { label: "Review entitlement" },
      ]}
    >
      <PageHeader
        eyebrow="Entitlement signing review"
        title="Review entitlement issuance"
        description="Confirm current server-side contract and release terms before issuing an immutable signed version."
      />
      {canIssue ? <>
        <section class="workspace-section" aria-labelledby="review-summary-heading">
          <h2 id="review-summary-heading">Authoritative entitlement summary</h2>
          <Card title="Terms to issue">
            <DataList items={[
              { term: "Contract", details: <code>{contract.id}</code> },
              { term: "Contract status", details: titleCase(contract.status) },
              { term: "Contract period", details: `${contract.startsAt} through ${contract.endsAt}` },
              { term: "Seats", details: `${contract.seatLimit} seats` },
              { term: "Modules", details: contract.modules.length === 0 ? "Core CRM only" : contract.modules.map((module) => module.displayName).join(", ") },
              { term: "Configuration version", details: schedule.configurationVersion },
              { term: "Channel", details: titleCase(schedule.releaseChannel) },
              { term: "Minimum app version", details: schedule.minimumSupportedAppVersion },
              { term: "Approved image digest", details: schedule.approvedImageDigest === null ? "Not restricted" : <code>{schedule.approvedImageDigest}</code> },
              { term: "Lease duration", details: "24 hours" },
              { term: "Grace duration", details: "7 days after lease expiry" },
            ]} />
          </Card>
        </section>
        <section class="workspace-section" aria-labelledby="issue-entitlement-heading">
          <h2 id="issue-entitlement-heading">{buttonLabel}</h2>
          <Card title="Explicit confirmation">
            <form method="post" action={`/operator/deployments/${workspace.deployment.id}/entitlements/issue`}>
              <input type="hidden" name="contractId" value={contract.id} />
              <input type="hidden" name="expectedContractRevision" value={contract.entitlementRevision} />
              <input type="hidden" name="expectedScheduleRevision" value={schedule.stateRevision} />
              <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
              <div class="field">
                <label><input type="checkbox" name="confirmation" value="issue_entitlement" required /> I confirm these current terms and want to issue an immutable signed entitlement version.</label>
              </div>
              <button type="submit">{buttonLabel}</button>
            </form>
          </Card>
        </section>
      </> : <EmptyState title="Entitlement is not ready to issue" action={{ href: `${workspaceHref}#entitlement-configuration`, label: "Return to configuration" }}>Registration and a current compatible configuration are required. Review the deployment workspace and save current terms.</EmptyState>}

      <section class="workspace-section" aria-labelledby="immutable-history-heading">
        <h2 id="immutable-history-heading">{workspace.entitlementHistoryCapped ? "Latest 10 versions" : "Prior immutable versions"}</h2>
        <EntitlementHistory entitlements={workspace.recentEntitlements} capped={workspace.entitlementHistoryCapped} />
        <p class="field-hint">History shows lease timing only. Signed envelopes and signing keys are never rendered.</p>
      </section>
    </OperatorLayout>
  )
}

export function InstallTokenResultPage(props: {
  deploymentId: string
  token: string
  expiresAt: string
  operatorEmail: string
}) {
  return (
    <OperatorLayout
      title="Install token issued"
      operatorEmail={props.operatorEmail}
      breadcrumbs={[
        { label: "Dashboard", href: "/operator" },
        { label: "Deployment", href: `/operator/deployments/${props.deploymentId}` },
        { label: "Install token issued" },
      ]}
    >
      <PageHeader
        eyebrow="Deployment installation"
        title="Install token issued"
        description="Store this value in the deployment's protected environment now."
      />
      <section class="workspace-section" aria-label="Install token result">
        <Card title="One-time install token">
          <p>Expires at (UTC): {formatUtc(props.expiresAt)}</p>
          <p><code id="install-token-value">{props.token}</code></p>
          <button id="copy-install-token" type="button">Copy install token</button>
          <p class="field-hint">This token cannot be recovered. If copying is unavailable, select the value above and copy it manually.</p>
          <script src="/operator/install-token-copy.js" defer></script>
        </Card>
      </section>
      <p><a class="button-link" href={`/operator/deployments/${props.deploymentId}`}>Return to deployment status</a></p>
    </OperatorLayout>
  )
}
