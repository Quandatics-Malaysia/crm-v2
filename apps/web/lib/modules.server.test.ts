import { ModuleIdSchema } from "@crm/control-protocol"
import { describe, expect, it, vi } from "vitest"

import {
  COMPILED_MODULE_MAP,
  MODULE_IDS,
  createDisabledModuleMap,
  filterPermissionGroups,
  isDependencyClosed,
  validateModuleComposition,
  type ModuleMap,
} from "@/lib/module-registry"
import {
  ModuleAccessDeniedError,
  createEntitledModuleGate,
} from "@/lib/modules.server"
import type { DeploymentAccess } from "@/lib/deployment-control"
import { withApiResourceEntitlement } from "@/lib/api-module-guard"
import { requireAttachableEntitlement } from "@/lib/access-scope"
import { createModuleRouteGuard } from "@/lib/module-guard"

const allCompiled = Object.fromEntries(
  MODULE_IDS.map((id) => [id, true])
) as ModuleMap

function access(
  moduleIds: DeploymentAccess["moduleIds"],
  mode: DeploymentAccess["mode"] = "active"
): DeploymentAccess {
  return {
    mode,
    reason: "test",
    writeAllowed: mode !== "read_only",
    seatLimit: 25,
    moduleIds,
    leaseExpiresAt: null,
    graceUntil: null,
    contractStartsAt: null,
    contractEndsAt: null,
    revision: 1,
    configurationVersion: "test",
    subscriptionStatus: "active",
    planId: "test",
  }
}

describe("module registry", () => {
  it("matches the signed control-protocol catalog exactly", () => {
    expect(MODULE_IDS).toEqual(ModuleIdSchema.options)
  })

  it("creates a complete fail-closed map", () => {
    expect(createDisabledModuleMap()).toEqual({
      projects: false,
      salesOrders: false,
      finance: false,
      forecast: false,
      audit: false,
      advancedRoles: false,
      documentation: false,
    })
  })

  it.each([
    [["projects", "salesOrders", "finance"], true],
    [["salesOrders"], false],
    [["projects", "finance"], false],
  ] as const)("checks dependency closure for %j", (ids, expected) => {
    expect(isDependencyClosed([...ids])).toBe(expected)
  })

  it("filters module-owned permission groups from a serialisable map", () => {
    const groups = [
      { group: "Core" },
      { group: "Projects", module: "projects" as const },
      { group: "Finance", module: "finance" as const },
    ]
    const modules = { ...createDisabledModuleMap(), projects: true }

    expect(filterPermissionGroups(groups, modules)).toEqual([
      { group: "Core" },
      { group: "Projects", module: "projects" },
    ])
  })

  it("allows a dependency-closed reduced development image", () => {
    const original = COMPILED_MODULE_MAP.documentation
    COMPILED_MODULE_MAP.documentation = false
    try {
      expect(validateModuleComposition()).toEqual([])
    } finally {
      COMPILED_MODULE_MAP.documentation = original
    }
  })
})

describe("signed runtime module gate", () => {
  it.each(["active", "grace", "read_only"] as const)(
    "preserves signed ownership in %s mode",
    async (mode) => {
      const gate = createEntitledModuleGate(
        async () => access(["projects", "salesOrders"], mode),
        allCompiled
      )

      await expect(gate.getEntitledModuleMap()).resolves.toMatchObject({
        projects: true,
        salesOrders: true,
        finance: false,
      })
    }
  )

  it("fails closed when entitlement state is unavailable", async () => {
    const gate = createEntitledModuleGate(
      async () => {
        throw new Error("database unavailable")
      },
      allCompiled
    )

    await expect(gate.getEntitledModuleMap()).resolves.toEqual(
      createDisabledModuleMap()
    )
  })

  it("never lets build capability create commercial access", async () => {
    const gate = createEntitledModuleGate(async () => access([]), allCompiled)

    expect((await gate.getEntitledModuleMap()).documentation).toBe(false)
  })

  it("makes every signed module available in the standard image", async () => {
    const gate = createEntitledModuleGate(async () => access([...MODULE_IDS]))

    expect(await gate.getEntitledModuleMap()).toEqual(
      Object.fromEntries(MODULE_IDS.map((id) => [id, true]))
    )
  })

  it("rejects a paid lease whose module is missing from the image", async () => {
    const compiled = { ...allCompiled, projects: false }
    const gate = createEntitledModuleGate(
      async () => access(["projects"]),
      compiled
    )

    await expect(gate.getEntitledModuleMap()).rejects.toThrow(
      'Signed entitlement owns module "projects", but the image omits it.'
    )
  })

  it("rejects a dependency-breaking paid lease/image mismatch", async () => {
    const compiled = { ...allCompiled, projects: false }
    const gate = createEntitledModuleGate(
      async () => access(["projects", "salesOrders", "finance"]),
      compiled
    )

    await expect(gate.getEntitledModuleMap()).rejects.toThrow(
      'Signed entitlement owns module "projects", but the image omits it.'
    )
  })

  it("reads revised ownership again for a fresh entrypoint", async () => {
    let moduleIds: DeploymentAccess["moduleIds"] = ["projects"]
    const gate = createEntitledModuleGate(async () => access(moduleIds), allCompiled)

    expect((await gate.getEntitledModuleMap()).projects).toBe(true)
    moduleIds = []
    expect((await gate.getEntitledModuleMap()).projects).toBe(false)
  })

  it("denies before protected work begins", async () => {
    const work = vi.fn()
    const gate = createEntitledModuleGate(async () => access([]), allCompiled)

    await expect(gate.withEntitledModule("finance", work)).rejects.toEqual(
      new ModuleAccessDeniedError("finance")
    )
    expect(work).not.toHaveBeenCalled()
  })
})

describe("optional REST resources", () => {
  it("denies before tenant resource work starts", async () => {
    const work = vi.fn()
    const deny = vi.fn(async () => {
      throw new ModuleAccessDeniedError("projects")
    })

    await expect(
      withApiResourceEntitlement({ module: "projects" }, work, deny)
    ).rejects.toBeInstanceOf(ModuleAccessDeniedError)
    expect(work).not.toHaveBeenCalled()
  })

  it("does not gate core resources", async () => {
    const requireModule = vi.fn()

    await expect(
      withApiResourceEntitlement({}, async () => "core", requireModule)
    ).resolves.toBe("core")
    expect(requireModule).not.toHaveBeenCalled()
  })
})

describe("module-owned attachments", () => {
  it.each([
    ["project", "projects"],
    ["sales_order", "salesOrders"],
    ["finance_doc", "finance"],
  ] as const)("gates %s before file work", async (type, moduleId) => {
    const deny = vi.fn(async () => {
      throw new ModuleAccessDeniedError(moduleId)
    })

    await expect(requireAttachableEntitlement(type, deny)).rejects.toBeInstanceOf(
      ModuleAccessDeniedError
    )
    expect(deny).toHaveBeenCalledWith(moduleId)
  })
})

describe("optional page routes", () => {
  it("redirects before rendering a disabled route", async () => {
    const redirect = vi.fn()
    const guard = createModuleRouteGuard(
      async () => {
        throw new ModuleAccessDeniedError("documentation")
      },
      redirect
    )

    await guard("documentation")
    expect(redirect).toHaveBeenCalledWith("/dashboard")
  })
})
