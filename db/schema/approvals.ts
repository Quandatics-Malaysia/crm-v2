import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/pg-core"
import { organization, member } from "./auth"
import { opportunities, funnelStages } from "./pipeline"
import { timestamps } from "./_helpers"

export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
])

export const attachableType = pgEnum("attachable_type", [
  "stage_approval_request",
  "quotation",
  "opportunity",
  "account",
  "lead",
  "person",
  "project",
  "sales_order",
])

/** A low-tier owner's request for upline sign-off to advance a gated stage. */
export const stageApprovalRequests = pgTable("stage_approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  requesterMemberId: text("requester_member_id")
    .notNull()
    .references(() => member.id, { onDelete: "cascade" }),
  fromStageId: uuid("from_stage_id").references(() => funnelStages.id, {
    onDelete: "set null",
  }),
  targetStageId: uuid("target_stage_id")
    .notNull()
    .references(() => funnelStages.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  status: approvalStatus("status").notNull().default("pending"),
  approverMemberId: text("approver_member_id").references(() => member.id, {
    onDelete: "set null",
  }),
  decisionNote: text("decision_note"),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...timestamps,
})

/** Polymorphic file metadata. Bytes live in object storage / a mounted volume. */
export const attachments = pgTable(
  "attachments",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  attachableType: attachableType("attachable_type").notNull(),
  attachableId: uuid("attachable_id").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  checksum: text("checksum"),
  uploadedByMemberId: text("uploaded_by_member_id").references(() => member.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attachments_tenant_attachable_idx").on(
      t.tenantId,
      t.attachableType,
      t.attachableId
    ),
  ]
)
