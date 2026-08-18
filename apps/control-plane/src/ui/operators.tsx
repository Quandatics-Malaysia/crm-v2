/** @jsxImportSource hono/jsx */
import { OPERATOR_ROLES, type OperatorRole } from "../auth/rbac"
import type { OperatorUser } from "../repos/operators"
import { Card, DataList, EmptyState, Notice, PageHeader, StatusBadge, type NoticeTone, type StatusTone } from "./components"
import { OperatorLayout } from "./layout"

export interface OperatorNotice {
  tone: NoticeTone
  title: string
  message: string
}

function statusTone(status: string): StatusTone {
  if (status === "active") return "success"
  if (status === "disabled") return "error"
  return "neutral"
}

export function OperatorRosterPage(props: {
  operators: OperatorUser[]
  currentOperatorId: string
  operatorEmail: string
  notice?: OperatorNotice
}) {
  return (
    <OperatorLayout title="Operators" activeNav="operators" operatorEmail={props.operatorEmail}>
      <PageHeader
        eyebrow="Vendor access administration"
        title="Operators"
        description="Manage who can sign into the vendor console and which roles each account holds."
      />
      {props.notice ? <Notice tone={props.notice.tone} title={props.notice.title}>{props.notice.message}</Notice> : null}

      <section id="new-operator" class="form-section" aria-label="Add operator">
        <Card title="Add operator">
          <p>Invite a vendor team member by email. They sign in through Cloudflare Access once the account is active.</p>
          <form class="form-grid" method="post" action="/operator/operators">
            <div class="field">
              <label for="operator-email">Email</label>
              <input id="operator-email" name="email" type="email" required maxLength={254} placeholder="ops@quandatics.com" />
            </div>
            <fieldset class="module-fieldset">
              <legend>Roles</legend>
              <p class="field-hint">Select at least one role.</p>
              {OPERATOR_ROLES.map((role) => (
                <label><input type="checkbox" name="roles" value={role} /> {role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</label>
              ))}
            </fieldset>
            <div><button type="submit">Add operator</button></div>
          </form>
        </Card>
      </section>

      <section class="dashboard-section" aria-labelledby="operator-list-heading">
        <h2 id="operator-list-heading">Operator accounts</h2>
        {props.operators.length === 0 ? (
          <EmptyState title="No operators yet">Add an operator to begin granting vendor console access.</EmptyState>
        ) : (
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th scope="col">Email</th><th scope="col">Roles</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {props.operators.map((operator) => {
                  const isSelf = operator.id === props.currentOperatorId
                  return (
                    <tr>
                      <th scope="row">{operator.email}{isSelf ? <span class="field-hint"> (you)</span> : null}</th>
                      <td>{operator.roles.length === 0 ? <span class="field-hint">No roles</span> : operator.roles.map((role) => <StatusBadge tone="neutral">{role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</StatusBadge>)}</td>
                      <td><StatusBadge tone={statusTone(operator.status)}>{operator.status}</StatusBadge></td>
                      <td>
                        {isSelf ? <span class="field-hint">Self-editing locked</span> : (
                          <form class="inline-actions" method="post" action={`/operator/operators/${operator.id}/status`}>
                            <input type="hidden" name="status" value={operator.status === "active" ? "disabled" : "active"} />
                            {operator.status === "active" ? <label class="field-hint"><input type="checkbox" name="confirmation" value="disable_operator" required /> Confirm disable</label> : null}
                            <button type="submit" class="button-link">{operator.status === "active" ? "Disable" : "Enable"}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p class="field-hint">You cannot disable or re-role the account you are signed in as, and the last active vendor owner cannot be removed.</p>
      </section>

      <section class="dashboard-section" aria-labelledby="operator-detail-heading">
        <h2 id="operator-detail-heading">Role assignment</h2>
        <p class="section-description">Update the role set for any account. Roles apply immediately to that account's next request.</p>
        <div class="attention-list">
          {props.operators.map((operator) => (
            <article class="attention-item">
              <div>
                <h3>{operator.email}</h3>
                <p>Account {operator.status}</p>
              </div>
              {operator.id === props.currentOperatorId ? <p class="field-hint">Self-editing locked</p> : (
                <form class="inline-actions" method="post" action={`/operator/operators/${operator.id}/roles`}>
                  <fieldset class="module-fieldset">
                    <legend class="sr-only">Roles for {operator.email}</legend>
                    {OPERATOR_ROLES.map((role) => (
                      <label><input type="checkbox" name="roles" value={role} checked={operator.roles.includes(role as OperatorRole)} /> {role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</label>
                    ))}
                  </fieldset>
                  <button type="submit">Save roles</button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
    </OperatorLayout>
  )
}
