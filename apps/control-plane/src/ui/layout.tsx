/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx"

export function OperatorLayout(props: { title: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · CRM Control Plane</title>
        <style>{`
:root{color-scheme:light;--ink:#172033;--muted:#687386;--line:#dfe4ec;--paper:#fff;--canvas:#f5f3ee;--nav:#13233f;--blue:#1769e0;--good:#147a4a;--warn:#a85d00;--bad:#b42318}*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:var(--nav);color:#fff;border-bottom:3px solid #4ca6ff}header nav{max-width:1180px;margin:auto;padding:16px 24px;display:flex;gap:20px;align-items:center}header a{color:#fff;text-decoration:none;font-weight:700}main{max-width:1180px;margin:28px auto;padding:0 24px 56px}h1{font-size:30px;margin:0 0 6px}h2{font-size:18px;margin:0 0 16px}p{color:var(--muted)}section,.panel{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:20px;margin:18px 0;box-shadow:0 2px 8px #1720330a}form{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:14px 0}label{display:grid;gap:5px;font-weight:600}input,select,textarea,button{font:inherit;border-radius:6px;border:1px solid #c8d0dc;padding:9px 10px;background:#fff;color:var(--ink)}input:focus,select:focus,textarea:focus{outline:3px solid #1769e033;border-color:var(--blue)}button{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:700;cursor:pointer}button:hover{background:#0f55bb}textarea{min-height:40px}fieldset{border:1px solid var(--line);border-radius:7px;padding:10px;display:flex;flex-wrap:wrap;gap:12px;width:100%}fieldset label{display:flex;align-items:center;gap:6px;font-weight:500}table{width:100%;border-collapse:collapse;margin:12px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}.badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9eef6;font-size:12px;font-weight:700}.badge.active,.badge.healthy,.badge.success{background:#dcf4e8;color:var(--good)}.badge.suspended,.badge.cancelled,.badge.disabled,.badge.error{background:#fee4e2;color:var(--bad)}.badge.past_due{background:#fff0d5;color:var(--warn)}.mono{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;word-break:break-all}.muted{color:var(--muted)}.actions{border-top:1px solid var(--line);padding-top:14px}.danger{border-left:4px solid var(--bad)}ul{padding-left:20px}@media(max-width:700px){main{padding:0 14px 36px;margin-top:18px}header nav{padding:14px}section,.panel{padding:15px;overflow-x:auto}form>*{width:100%}fieldset label{width:auto}table{min-width:620px}h1{font-size:25px}}
        `}</style>
      </head>
      <body>
        <header>
          <nav aria-label="Operator navigation">
            <a href="/operator">License Control</a><a href="/operator/clients">Clients</a>
          </nav>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  )
}
