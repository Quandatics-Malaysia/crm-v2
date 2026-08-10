import { describe, expect, it, vi } from "vitest"

import {
  latestAppliedMigrationVersion,
  publishAfterSuccessfulMigration,
  resolveAppliedMigrationVersion,
} from "@/db/migration-version"

const journal = {
  entries: [
    { idx: 66, when: 1_786_368_000_000, tag: "0066_deployment_control" },
    { idx: 67, when: 1_786_381_200_000, tag: "0067_deployment_status" },
  ],
}

describe("applied migration version publication", () => {
  it("derives the latest version from the validated migrator journal", () => {
    expect(latestAppliedMigrationVersion({
      entries: [
        { idx: 66, when: 1_786_368_000_000, tag: "0066_deployment_control" },
        { idx: 67, when: 1_786_381_200_000, tag: "0067_deployment_status" },
        { idx: 68, when: 1_786_467_600_000, tag: "0068_future_seat_enforcement" },
      ],
    })).toBe("0068")
  })

  it("derives the published version from actual database history", () => {
    expect(resolveAppliedMigrationVersion(journal, 1_786_368_000_000)).toBe("0066")
    expect(resolveAppliedMigrationVersion(journal, 1_786_381_200_000)).toBe("0067")
  })

  it("preserves future database metadata when an older image performs a no-op migrate", () => {
    expect(resolveAppliedMigrationVersion(journal, 1_786_467_600_000)).toBeNull()
  })

  it("refuses unknown or missing actual history instead of guessing", () => {
    expect(() => resolveAppliedMigrationVersion(journal, null)).toThrow("Invalid applied migration history")
    expect(() => resolveAppliedMigrationVersion(journal, 1_786_370_000_000)).toThrow("Invalid applied migration history")
  })

  it("publishes only after migration succeeds and skips future history", async () => {
    const publish = vi.fn(async (_version: string) => undefined)
    await expect(publishAfterSuccessfulMigration(
      async () => { throw new Error("migration failed") },
      async () => "0067",
      publish,
    )).rejects.toThrow("migration failed")
    expect(publish).not.toHaveBeenCalled()

    await publishAfterSuccessfulMigration(async () => undefined, async () => null, publish)
    expect(publish).not.toHaveBeenCalled()

    await publishAfterSuccessfulMigration(async () => undefined, async () => "0067", publish)
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith("0067")
  })

  it.each([
    null,
    {},
    { entries: [] },
    { entries: [{ idx: 67, when: 1, tag: "bad tag" }] },
    { entries: [{ idx: 68, when: 2, tag: "0068_future" }, { idx: 67, when: 1, tag: "0067_stale" }] },
    { entries: [{ idx: 67, when: -1, tag: "0067_stale" }] },
  ])("rejects malformed or non-monotonic journals instead of publishing source guesses", (journal) => {
    expect(() => latestAppliedMigrationVersion(journal)).toThrow("Invalid migration journal")
  })
})
