/** @jsxImportSource hono/jsx */
import { OperatorLayout } from "./layout"

const OPERATOR_ERROR_GUIDANCE: Record<string, string> = {
  invalid_request: "Check the submitted values and try again.",
  unauthorized: "Sign in again, then retry.",
  forbidden: "You do not have permission to complete this action.",
  not_found: "The requested record is unavailable. Return to the dashboard and choose it again.",
  conflict: "This change conflicts with current data. Refresh the page and try again.",
  authentication_unavailable: "Access verification is temporarily unavailable. Try again shortly.",
  internal_error: "We could not complete this request. Try again. If it persists, contact support.",
}

export function OperatorErrorPage(props: { code: string; requestId: string }) {
  const guidance = OPERATOR_ERROR_GUIDANCE[props.code] ?? OPERATOR_ERROR_GUIDANCE.internal_error

  return (
    <OperatorLayout
      title="Request unavailable"
      breadcrumbs={[{ label: "Dashboard", href: "/operator" }, { label: "Request unavailable" }]}
    >
      <section class="notice notice-error" role="alert" aria-labelledby="operator-error-heading">
        <h1 id="operator-error-heading">Request unavailable</h1>
        <p>{guidance}</p>
        <p>Request ID: <code>{props.requestId}</code></p>
        <p><a class="button-link" href="/operator">Back to dashboard</a></p>
      </section>
    </OperatorLayout>
  )
}
