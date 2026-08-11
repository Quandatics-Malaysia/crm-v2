import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ModuleId } from "@/lib/module-registry"

const mocks = vi.hoisted(() => ({
  requireRoute: vi.fn(),
  requireContext: vi.fn(),
  projectList: vi.fn(),
  salesOrderList: vi.fn(),
  financeList: vi.fn(),
  forecastList: vi.fn(),
  auditList: vi.fn(),
  getSettings: vi.fn(),
  listTaxSettings: vi.fn(),
}))

vi.mock("@/lib/module-guard", () => ({
  requireEntitledRoute: mocks.requireRoute,
}))
vi.mock("@/lib/server-context", () => ({
  requireContext: mocks.requireContext,
}))
vi.mock("@/lib/lookups", () => ({ listAccountOptions: vi.fn() }))

vi.mock("@/app/(app)/projects/actions", () => ({
  listProjects: mocks.projectList,
  listOpportunityOptions: vi.fn(),
  listProjectCreateMeta: vi.fn(),
  prefillFromOpportunity: vi.fn(),
}))
vi.mock("@/app/(app)/sales-orders/actions", () => ({
  listSalesOrders: mocks.salesOrderList,
  listSubmittableProjects: vi.fn(),
}))
vi.mock("@/app/(app)/billing/actions", () => ({
  listFinanceDocs: mocks.financeList,
  listFinanceSources: vi.fn(),
  getReminderSchedule: vi.fn(),
  getBilledMargin: vi.fn(),
}))
vi.mock("@/app/(app)/forecast/actions", () => ({
  getForecast: mocks.forecastList,
  getPipelineSummary: vi.fn(),
  getForecastConfig: vi.fn(),
}))
vi.mock("@/app/(app)/audit/actions", () => ({ listAudit: mocks.auditList }))
vi.mock("@/app/(app)/settings/actions", () => ({
  getSettings: mocks.getSettings,
}))
vi.mock("@/app/(app)/settings/billing/tax/actions", () => ({
  listTaxSettings: mocks.listTaxSettings,
}))

vi.mock("@/components/site-header", () => ({ SiteHeader: vi.fn() }))
vi.mock("@/components/page-header", () => ({ PageBody: vi.fn() }))
vi.mock("@/components/ui/button", () => ({ Button: vi.fn() }))
vi.mock("@/components/ui/card", () => ({
  Card: vi.fn(),
  CardDescription: vi.fn(),
  CardHeader: vi.fn(),
  CardTitle: vi.fn(),
}))
vi.mock("@/app/(app)/projects/project-create-form", () => ({ ProjectCreateForm: vi.fn() }))
vi.mock("@/app/(app)/projects/projects-table", () => ({ ProjectsTable: vi.fn() }))
vi.mock("@/app/(app)/sales-orders/sales-orders-table", () => ({ SalesOrdersTable: vi.fn() }))
vi.mock("@/app/(app)/billing/finance-docs-table", () => ({ FinanceDocsTable: vi.fn() }))
vi.mock("@/app/(app)/forecast/forecast-client", () => ({ ForecastView: vi.fn() }))
vi.mock("@/app/(app)/audit/audit-table", () => ({ AuditTable: vi.fn() }))
vi.mock("@/app/(app)/settings/billing/numbering/numbering-client", () => ({ NumberingClient: vi.fn() }))
vi.mock("@/app/(app)/settings/billing/tax/tax-client", () => ({ TaxClient: vi.fn() }))
vi.mock("@/app/documentation/registry", () => ({ DOC_GROUPS: [] }))
vi.mock("@/app/documentation/extract-text", () => ({ extractText: vi.fn(() => "") }))
vi.mock("@/app/documentation/docs-header", () => ({ DocsHeader: vi.fn() }))

import ProjectsPage from "@/app/(app)/projects/page"
import SalesOrdersPage from "@/app/(app)/sales-orders/page"
import BillingPage from "@/app/(app)/billing/page"
import ForecastPage from "@/app/(app)/forecast/page"
import AuditPage from "@/app/(app)/audit/page"
import DocumentationLayout from "@/app/documentation/layout"
import NumberingSettingsPage from "@/app/(app)/settings/billing/numbering/page"
import TaxSettingsPage from "@/app/(app)/settings/billing/tax/page"

describe("real optional page denial matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRoute.mockImplementation(async (moduleId: ModuleId) => {
      throw Object.assign(new Error(`denied:${moduleId}`), { moduleId })
    })
  })

  it.each([
    ["projects", () => ProjectsPage({ searchParams: Promise.resolve({}) }), mocks.projectList],
    ["salesOrders", () => SalesOrdersPage(), mocks.salesOrderList],
    ["finance", () => BillingPage(), mocks.financeList],
    ["forecast", () => ForecastPage(), mocks.forecastList],
    ["audit", () => AuditPage(), mocks.auditList],
    ["documentation", () => DocumentationLayout({ children: null }), null],
  ] as const)("denies the real %s page before loader work", async (moduleId, invoke, loader) => {
    await expect(invoke()).rejects.toMatchObject({ moduleId })
    expect(mocks.requireRoute).toHaveBeenCalledWith(moduleId)
    if (loader) expect(loader).not.toHaveBeenCalled()
    expect(mocks.requireContext).not.toHaveBeenCalled()
  })
})

describe("core quotation configuration pages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRoute.mockImplementation(async (moduleId: ModuleId) => {
      throw Object.assign(new Error(`denied:${moduleId}`), { moduleId })
    })
    mocks.getSettings.mockResolvedValue({ financeEnabled: false })
    mocks.listTaxSettings.mockResolvedValue([])
  })

  it("keeps quotation numbering reachable without finance", async () => {
    await expect(NumberingSettingsPage()).resolves.toBeDefined()
    expect(mocks.getSettings).toHaveBeenCalledOnce()
    expect(mocks.requireRoute).not.toHaveBeenCalled()
  })

  it("keeps quotation tax configuration reachable without finance", async () => {
    await expect(TaxSettingsPage()).resolves.toBeDefined()
    expect(mocks.listTaxSettings).toHaveBeenCalledOnce()
    expect(mocks.requireRoute).not.toHaveBeenCalled()
  })
})
