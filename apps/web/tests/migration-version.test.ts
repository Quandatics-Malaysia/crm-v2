import { describe, expect, it } from "vitest"

import { latestAppliedMigrationVersion } from "@/db/migration-version"

describe("applied migration version publication", () => {
  it("derives the latest version from the validated migrator journal", () => {
    expect(latestAppliedMigrationVersion({
      entries: [
        { idx: 66, tag: "0066_deployment_control" },
        { idx: 67, tag: "0067_deployment_status" },
        { idx: 68, tag: "0068_future_seat_enforcement" },
      ],
    })).toBe("0068")
  })

  it.each([
    null,
    {},
    { entries: [] },
    { entries: [{ idx: 67, tag: "bad tag" }] },
    { entries: [{ idx: 68, tag: "0068_future" }, { idx: 67, tag: "0067_stale" }] },
  ])("rejects malformed or non-monotonic journals instead of publishing source guesses", (journal) => {
    expect(() => latestAppliedMigrationVersion(journal)).toThrow("Invalid migration journal")
  })
})
