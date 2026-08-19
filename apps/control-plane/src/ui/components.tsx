/** @jsxImportSource hono/jsx */
import { useId, type Child } from "hono/jsx"

export type StatusTone = "neutral" | "success" | "warning" | "error"
export type NoticeTone = "info" | "success" | "warning" | "error"
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost"

function identifier(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export function PageHeader(props: {
  title: string
  eyebrow?: string
  description?: string
  actions?: Child
}) {
  return (
    <header class="page-header">
      {props.eyebrow ? <p class="page-header-eyebrow">{props.eyebrow}</p> : null}
      <div class="page-header-content">
        <div>
          <h1>{props.title}</h1>
          {props.description ? <p class="page-header-description">{props.description}</p> : null}
        </div>
        {props.actions ? <div class="page-header-actions">{props.actions}</div> : null}
      </div>
    </header>
  )
}

export function StatusBadge(props: { tone: StatusTone; children: Child }) {
  return <span class={`status-badge status-badge-${props.tone}`}>{props.children}</span>
}

export function ProgressSteps(props: {
  label: string
  steps: readonly { label: string; state: "blocked" | "complete" | "current" | "upcoming"; href?: string }[]
}) {
  return (
    <nav class="progress-steps" aria-label={props.label}>
      <ol>
        {props.steps.map((step) => (
          <li class={`progress-step progress-step-${step.state}`}>
            {step.href ? (
              <a href={step.href} aria-current={step.state === "current" || step.state === "blocked" ? "step" : undefined}>{step.label}</a>
            ) : (
              <span aria-current={step.state === "current" || step.state === "blocked" ? "step" : undefined}>{step.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function Field(props: {
  label: string
  name: string
  type?: "date" | "email" | "number" | "password" | "search" | "text" | "url" | "datetime-local"
  value?: string | number
  required?: boolean
  hint?: Child
  error?: string
  placeholder?: string
  pattern?: string
  maxLength?: number
  min?: number
  max?: number
  step?: number
  options?: readonly { value: string; label: string }[]
  textarea?: boolean
  checkbox?: boolean
  checkboxValue?: string
  hidden?: boolean
  defaultValue?: string
  title?: string
  rows?: number
}) {
  const id = `field-${identifier(props.name)}-${identifier(useId())}`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(" ")
  const shared = {
    id,
    name: props.name,
    required: props.required,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": props.error ? "true" : undefined,
  }
  let control: Child
  if (props.hidden) {
    control = <input type="hidden" name={props.name} value={props.value ?? props.defaultValue} />
  } else if (props.checkbox) {
    control = (
      <label class="checkbox-field" for={id}>
        <input {...shared} type="checkbox" value={props.checkboxValue ?? "yes"} checked={props.value === "yes" || props.defaultValue === "yes"} />
        {props.label}
        {props.required ? <span aria-hidden="true"> *</span> : null}
      </label>
    )
  } else if (props.textarea) {
    control = <textarea {...shared} rows={props.rows} defaultValue={props.defaultValue}>{props.value}</textarea>
  } else if (props.options) {
    control = (
      <select {...shared}>
        {props.options.map((option) => <option value={option.value} selected={props.value === option.value}>{option.label}</option>)}
      </select>
    )
  } else {
    control = <input {...shared} type={props.type ?? "text"} value={props.value} placeholder={props.placeholder} pattern={props.pattern} maxLength={props.maxLength} min={props.min} max={props.max} step={props.step} title={props.title} />
  }
  return (
    <div class="field">
      {!props.checkbox && !props.hidden ? <label for={id}>{props.label}{props.required ? <span aria-hidden="true"> *</span> : null}</label> : null}
      {control}
      {props.hint ? <p id={hintId} class="field-hint">{props.hint}</p> : null}
      {props.error ? <p id={errorId} class="field-error" role="alert">{props.error}</p> : null}
    </div>
  )
}

export function Card(props: { title: string; children: Child; footer?: Child; headingLevel?: 2 | 3 | 4 }) {
  const headingId = `card-${identifier(props.title)}-${identifier(useId())}`
  const Heading = `h${props.headingLevel ?? 2}` as const
  return (
    <section class="card" aria-labelledby={headingId}>
      <Heading id={headingId}>{props.title}</Heading>
      <div class="card-content">{props.children}</div>
      {props.footer ? <footer class="card-footer">{props.footer}</footer> : null}
    </section>
  )
}

export function EmptyState(props: {
  title: string
  children: Child
  action?: { href: string; label: string }
}) {
  return (
    <section class="empty-state">
      <h2>{props.title}</h2>
      <p>{props.children}</p>
      {props.action ? <a class="button-link" href={props.action.href}>{props.action.label}</a> : null}
    </section>
  )
}

export function Notice(props: { tone: NoticeTone; title: string; children: Child }) {
  const headingId = `notice-${identifier(props.title)}-${identifier(useId())}`
  return (
    <section class={`notice notice-${props.tone}`} role={props.tone === "error" ? "alert" : "status"} aria-labelledby={headingId}>
      <h2 id={headingId}>{props.title}</h2>
      <p>{props.children}</p>
    </section>
  )
}

export interface OperatorNotice {
  tone: NoticeTone
  title: string
  message: string
}

export function NoticePanel(props: { notice?: OperatorNotice }) {
  return props.notice ? <Notice tone={props.notice.tone} title={props.notice.title}>{props.notice.message}</Notice> : null
}

export function Button(props: {
  variant?: ButtonVariant
  children: Child
  type?: "button" | "submit"
  id?: string
}) {
  const variant = props.variant ?? "primary"
  return (
    <button id={props.id} type={props.type ?? "submit"} class={`button button-${variant}`}>
      {props.children}
    </button>
  )
}

export function DataList(props: { items: readonly { term: string; details: Child }[] }) {
  return (
    <dl class="data-list">
      {props.items.map((item) => (
        <div class="data-list-row">
          <dt>{item.term}</dt>
          <dd>{item.details}</dd>
        </div>
      ))}
    </dl>
  )
}
