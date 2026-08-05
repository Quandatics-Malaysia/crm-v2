import { redirect } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { PageBody } from "@/components/page-header"
import { getServerContext } from "@/lib/server-context"
import { SettingsNav } from "./settings-nav"

/**
 * Chrome shared by every settings section: the site header plus the grouped
 * sub-nav beside the active section's content. Permissions come from
 * `getServerContext` and are handed to the client nav, which filters visible
 * items exactly like `app-sidebar.tsx`. Section pages keep their own gates.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await getServerContext()
  if (!ctx) redirect("/sign-in")

  return (
    <>
      <SiteHeader title="Settings" />
      <PageBody>
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <SettingsNav
            permissions={[...ctx.permissions]}
            isSuperadmin={ctx.isSuperadmin}
          />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </PageBody>
    </>
  )
}
