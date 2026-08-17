import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose"
import type { Context, MiddlewareHandler } from "hono"

import { prepareOperatorAuditStatement } from "../audit"
import { requestId } from "../http/request-id"
import type { ControlPlaneEnvironment } from "../index"
import { authenticationUnavailable, forbidden, unauthorized } from "../http/errors"
import { isOperatorRole, type OperatorRole } from "./rbac"

export interface VerifiedAccessIdentity {
  subject: string
  email: string
}

export interface OperatorContext {
  operatorId: string
  email: string
  roles: ReadonlySet<OperatorRole>
}

export type AccessVerifier = (token: string) => Promise<VerifiedAccessIdentity>

export interface AccessVerifierOptions {
  teamDomain: string
  audience: string
  jwks?: JWTVerifyGetKey
  algorithms?: readonly string[]
}

export interface OperatorAuthDependencies {
  accessVerifier?: AccessVerifier
}

interface OperatorRow {
  id: string
  email: string
  status: string
  access_subject: string | null
  role: string | null
}

interface CachedVerifier {
  teamDomain: string
  audience: string
  verifier: AccessVerifier
}

export class AccessTokenInvalidError extends Error {
  constructor() {
    super("Access token is invalid")
    this.name = "AccessTokenInvalidError"
  }
}

export class AccessVerifierUnavailableError extends Error {
  constructor() {
    super("Access verifier is unavailable")
    this.name = "AccessVerifierUnavailableError"
  }
}

const verifierCache = new WeakMap<object, CachedVerifier>()

export function normalizeOperatorEmail(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)
  ) {
    throw new AccessTokenInvalidError()
  }

  return normalized
}

function exactIssuer(teamDomain: string): string {
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(teamDomain)) {
    throw new AccessVerifierUnavailableError()
  }

  return `https://${teamDomain}`
}

export function createAccessVerifier(options: AccessVerifierOptions): AccessVerifier {
  const issuer = exactIssuer(options.teamDomain)
  const audience = options.audience
  if (audience.trim().length === 0) {
    throw new AccessVerifierUnavailableError()
  }

  const jwks =
    options.jwks ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  const algorithms = options.algorithms ?? ["RS256"]

  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
        algorithms: [...algorithms],
      })

      if (
        typeof payload.sub !== "string" ||
        payload.sub.trim().length === 0 ||
        payload.sub.length > 512 ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        typeof payload.email !== "string"
      ) {
        throw new AccessTokenInvalidError()
      }

      return {
        subject: payload.sub,
        email: normalizeOperatorEmail(payload.email),
      }
    } catch (error) {
      if (error instanceof AccessTokenInvalidError) {
        throw error
      }
      if (
        error instanceof joseErrors.JWTClaimValidationFailed ||
        error instanceof joseErrors.JWTExpired ||
        error instanceof joseErrors.JOSEAlgNotAllowed ||
        error instanceof joseErrors.JOSENotSupported ||
        error instanceof joseErrors.JWSInvalid ||
        error instanceof joseErrors.JWTInvalid ||
        error instanceof joseErrors.JWSSignatureVerificationFailed ||
        error instanceof joseErrors.JWKSNoMatchingKey
      ) {
        throw new AccessTokenInvalidError()
      }
      throw new AccessVerifierUnavailableError()
    }
  }
}

function defaultAccessVerifier(bindings: CloudflareBindings): AccessVerifier {
  const cached = verifierCache.get(bindings)
  if (
    cached?.teamDomain === bindings.ACCESS_TEAM_DOMAIN &&
    cached.audience === bindings.ACCESS_AUD
  ) {
    return cached.verifier
  }

  const verifier = createAccessVerifier({
    teamDomain: bindings.ACCESS_TEAM_DOMAIN,
    audience: bindings.ACCESS_AUD,
  })
  verifierCache.set(bindings, {
    teamDomain: bindings.ACCESS_TEAM_DOMAIN,
    audience: bindings.ACCESS_AUD,
    verifier,
  })

  return verifier
}

async function resolveOperator(
  database: D1Database,
  identity: VerifiedAccessIdentity,
): Promise<OperatorRow[]> {
  const result = await database
    .prepare(
      "SELECT u.id, u.email, u.status, u.access_subject, r.role FROM operator_users u LEFT JOIN operator_roles r ON r.operator_id = u.id WHERE u.access_subject = ? OR (u.access_subject IS NULL AND lower(trim(u.email)) = ?) ORDER BY r.role",
    )
    .bind(identity.subject, identity.email)
    .all<OperatorRow>()

  return result.results
}

async function provisionBootstrapOwner(
  context: Context<ControlPlaneEnvironment>,
  identity: VerifiedAccessIdentity,
  existing: OperatorRow | undefined,
): Promise<void> {
  const now = new Date().toISOString()
  const operatorId = existing?.id ?? crypto.randomUUID()
  const statements: D1PreparedStatement[] = []

  if (!existing) {
    statements.push(
      context.env.CONTROL_DB.prepare(
        "INSERT INTO operator_users (id, email, status, access_subject, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
      ).bind(operatorId, identity.email, identity.subject, now, now),
    )
  } else if (existing.access_subject === null) {
    statements.push(
      context.env.CONTROL_DB.prepare(
        "UPDATE operator_users SET access_subject = ?, updated_at = ? WHERE id = ? AND access_subject IS NULL",
      ).bind(identity.subject, now, operatorId),
    )
  }

  statements.push(
    context.env.CONTROL_DB.prepare(
      "INSERT OR IGNORE INTO operator_roles (operator_id, role, created_at) VALUES (?, 'vendor_owner', ?)",
    ).bind(operatorId, now),
  )

  const audit = await prepareOperatorAuditStatement(context.env.CONTROL_DB, {
    operatorId,
    action: "operator.bootstrap_owner",
    targetType: "operator_user",
    targetId: operatorId,
    outcome: "success",
    requestId: requestId(context),
    metadata: { after: { role: "vendor_owner" }, before: null },
    createdAt: now,
  })
  statements.push(audit.statement)

  await context.env.CONTROL_DB.batch(statements)
}

async function bindAccessSubject(
  context: Context<ControlPlaneEnvironment>,
  identity: VerifiedAccessIdentity,
  operator: OperatorRow,
): Promise<void> {
  const now = new Date().toISOString()
  const audit = await prepareOperatorAuditStatement(context.env.CONTROL_DB, {
    operatorId: operator.id,
    action: "operator.access_subject.bind",
    targetType: "operator_user",
    targetId: operator.id,
    outcome: "success",
    requestId: requestId(context),
    metadata: { after: { accessSubjectBound: true }, before: { accessSubjectBound: false } },
    createdAt: now,
  })

  await context.env.CONTROL_DB.batch([
    context.env.CONTROL_DB.prepare(
      "UPDATE operator_users SET access_subject = ?, updated_at = ? WHERE id = ? AND access_subject IS NULL",
    ).bind(identity.subject, now, operator.id),
    audit.statement,
  ])
}

function operatorContext(rows: OperatorRow[], verifiedEmail: string): OperatorContext {
  const primary = rows[0]
  if (!primary || primary.status !== "active") {
    throw forbidden("operator_account_inactive")
  }

  const roles = new Set<OperatorRole>()
  for (const row of rows) {
    if (row.id !== primary.id || row.status !== "active" || !row.role || !isOperatorRole(row.role)) {
      throw forbidden("operator_role_invalid")
    }
    roles.add(row.role)
  }
  if (roles.size === 0) {
    throw forbidden("operator_role_missing")
  }

  return {
    operatorId: primary.id,
    email: verifiedEmail,
    roles,
  }
}

export async function requireOperator(
  context: Context<ControlPlaneEnvironment>,
  verifierOverride?: AccessVerifier,
): Promise<OperatorContext> {
  const assertion = context.req.header("Cf-Access-Jwt-Assertion")
  if (!assertion) {
    throw unauthorized()
  }
  if (verifierOverride && String(context.env.ENVIRONMENT) !== "test") {
    throw authenticationUnavailable()
  }

  let identity: VerifiedAccessIdentity
  try {
    const verifier = verifierOverride ?? defaultAccessVerifier(context.env)
    const verified = await verifier(assertion)
    identity = {
      subject: verified.subject.trim(),
      email: normalizeOperatorEmail(verified.email),
    }
    if (identity.subject.length === 0 || identity.subject.length > 512) {
      throw new AccessTokenInvalidError()
    }
  } catch (error) {
    if (error instanceof AccessTokenInvalidError) {
      throw unauthorized()
    }
    throw authenticationUnavailable()
  }

  let rows: OperatorRow[]
  try {
    rows = await resolveOperator(context.env.CONTROL_DB, identity)
    const bootstrapEmail = normalizeOperatorEmail(context.env.BOOTSTRAP_OWNER_EMAIL)
    const existing = rows[0]

    if (!existing) {
      if (identity.email !== bootstrapEmail) {
        throw forbidden("operator_not_registered")
      }
      await provisionBootstrapOwner(context, identity, undefined)
      rows = await resolveOperator(context.env.CONTROL_DB, identity)
    } else if (
      existing.status === "active" &&
      existing.access_subject === null &&
      identity.email !== bootstrapEmail &&
      rows.every((row) => row.role !== null && isOperatorRole(row.role))
    ) {
      await bindAccessSubject(context, identity, existing)
      rows = await resolveOperator(context.env.CONTROL_DB, identity)
    } else if (
      existing.status === "active" &&
      identity.email === bootstrapEmail &&
      !rows.some((row) => row.role === "vendor_owner")
    ) {
      if (rows.some((row) => row.role !== null && !isOperatorRole(row.role))) {
        throw forbidden("operator_role_invalid")
      }
      await provisionBootstrapOwner(context, identity, existing)
      rows = await resolveOperator(context.env.CONTROL_DB, identity)
    }
  } catch (error) {
    if (error instanceof Error && error.name === "SafeHttpError") {
      throw error
    }
    throw authenticationUnavailable()
  }

  return operatorContext(rows, identity.email)
}

export function createOperatorAuthMiddleware(
  dependencies: OperatorAuthDependencies = {},
): MiddlewareHandler<ControlPlaneEnvironment> {
  return async (context, next) => {
    const operator = await requireOperator(context, dependencies.accessVerifier)
    context.set("operator", operator)
    await next()
  }
}
