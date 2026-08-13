/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx"

type Breadcrumb = { label: string; href?: string }

export function OperatorLayout(props: {
  title: string
  children: Child
  activeNav?: "dashboard" | "clients"
  breadcrumbs?: readonly Breadcrumb[]
  operatorEmail?: string
}) {
  const activeNav = props.activeNav ?? (props.title === "Dashboard" ? "dashboard" : "clients")
  const breadcrumbs = props.breadcrumbs ?? [
    { label: "Dashboard", href: "/operator" },
    { label: props.title },
  ]
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · CRM Control Plane</title>
        <link href="/operator/styles.css" rel="stylesheet" />
      </head>
      <body class="operator-shell">
        <a href="#operator-content" class="skip-link">Skip to content</a>
        <header class="operator-shell-header">
          <div class="operator-shell-bar">
            <a class="operator-brand" href="/operator">CRM Control Plane</a>
            <nav class="operator-navigation" aria-label="Operator navigation">
              <ul>
                <li><a href="/operator" aria-current={activeNav === "dashboard" ? "page" : undefined}>Dashboard</a></li>
                <li><a href="/operator/clients" aria-current={activeNav === "clients" ? "page" : undefined}>Clients</a></li>
              </ul>
            </nav>
            <p class="operator-identity">{props.operatorEmail ?? "Operator session"}</p>
          </div>
        </header>
        <nav class="operator-breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((breadcrumb, index) => (
              <li>
                {breadcrumb.href && index < breadcrumbs.length - 1
                  ? <a href={breadcrumb.href}>{breadcrumb.label}</a>
                  : <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{breadcrumb.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
        <main id="operator-content" class="operator-content">{props.children}</main>
      </body>
    </html>
  )
}
