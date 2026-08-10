import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const operatorUsers = sqliteTable(
  "operator_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    accessSubject: text("access_subject"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("operator_users_email_idx").on(table.email),
    uniqueIndex("operator_users_access_subject_idx").on(table.accessSubject),
  ],
)

export const operatorRoles = sqliteTable(
  "operator_roles",
  {
    operatorId: text("operator_id")
      .notNull()
      .references(() => operatorUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.operatorId, table.role] })],
)

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    clientKey: text("client_key").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("clients_client_key_idx").on(table.clientKey)],
)

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    planKey: text("plan_key").notNull(),
    displayName: text("display_name").notNull(),
    active: integer("active", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("plans_plan_key_idx").on(table.planKey)],
)

export const moduleCatalog = sqliteTable(
  "module_catalog",
  {
    moduleId: text("module_id").primaryKey(),
    displayName: text("display_name").notNull(),
    dependencyIdsJson: text("dependency_ids_json").notNull(),
    active: integer("active", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
)

export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    deploymentKey: text("deployment_key").notNull(),
    environment: text("environment").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("deployments_deployment_key_idx").on(table.deploymentKey),
    index("deployments_client_id_idx").on(table.clientId),
  ],
)

export const deploymentKeys = sqliteTable(
  "deployment_keys",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    keyId: text("key_id").notNull(),
    publicJwkJson: text("public_jwk_json").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("deployment_keys_deployment_key_id_idx").on(table.deploymentId, table.keyId),
    index("deployment_keys_active_idx").on(table.deploymentId, table.revokedAt),
  ],
)

export const contracts = sqliteTable(
  "contracts",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    status: text("status").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    seatLimit: integer("seat_limit").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("contracts_client_status_idx").on(table.clientId, table.status),
    index("contracts_plan_id_idx").on(table.planId),
  ],
)

export const contractModules = sqliteTable(
  "contract_modules",
  {
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    moduleId: text("module_id")
      .notNull()
      .references(() => moduleCatalog.moduleId),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.contractId, table.moduleId] })],
)

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id),
    invoiceNumber: text("invoice_number").notNull(),
    status: text("status").notNull(),
    issuedAt: text("issued_at").notNull(),
    dueAt: text("due_at").notNull(),
    paidAt: text("paid_at"),
    currency: text("currency").notNull(),
    totalCents: integer("total_cents").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoices_invoice_number_idx").on(table.invoiceNumber),
    index("invoices_contract_status_idx").on(table.contractId, table.status),
  ],
)

export const entitlementVersions = sqliteTable(
  "entitlement_versions",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id),
    version: integer("version").notNull(),
    keyId: text("key_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    signature: text("signature").notNull(),
    issuedAt: text("issued_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("entitlement_versions_deployment_version_idx").on(table.deploymentId, table.version),
    index("entitlement_versions_contract_id_idx").on(table.contractId),
  ],
)

export const heartbeatRollups = sqliteTable(
  "heartbeat_rollups",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    observedAt: text("observed_at").notNull(),
    occupiedSeats: integer("occupied_seats").notNull(),
    applicationVersion: text("application_version").notNull(),
    healthStatus: text("health_status").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("heartbeat_rollups_deployment_observed_idx").on(table.deploymentId, table.observedAt),
  ],
)

export const installTokens = sqliteTable(
  "install_tokens",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    tokenDigest: text("token_digest").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("install_tokens_token_digest_idx").on(table.tokenDigest),
    index("install_tokens_deployment_expiry_idx").on(table.deploymentId, table.expiresAt),
  ],
)

export const operatorAuditLog = sqliteTable(
  "operator_audit_log",
  {
    id: text("id").primaryKey(),
    operatorId: text("operator_id").references(() => operatorUsers.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    outcome: text("outcome", { enum: ["success", "denied", "error"] })
      .notNull()
      .default("success"),
    requestIdHash: text("request_id_hash").notNull(),
    metadataJson: text("metadata_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("operator_audit_log_operator_created_idx").on(table.operatorId, table.createdAt),
    index("operator_audit_log_target_created_idx").on(table.targetType, table.targetId, table.createdAt),
    index("operator_audit_log_action_created_idx").on(table.action, table.createdAt),
  ],
)
