/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx"

export function OperatorLayout(props: { title: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · CRM Control Plane</title>
      </head>
      <body>
        <header>
          <nav aria-label="Operator navigation">
            <a href="/operator">Dashboard</a> · <a href="/operator/clients">Clients</a>
          </nav>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  )
}
