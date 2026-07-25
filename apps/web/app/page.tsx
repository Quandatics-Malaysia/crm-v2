import { redirect } from "next/navigation"
import { getServerContext } from "@/lib/server-context"

export default async function Home() {
  const ctx = await getServerContext()
  if (!ctx) redirect("/sign-in")
  redirect("/dashboard")
}
