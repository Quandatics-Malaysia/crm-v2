import "dotenv/config"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import * as schema from "@/db/schema"
import { createInterface } from "node:readline"

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const stdin = process.stdin
    let answer = ""
    stdin.setRawMode?.(true)
    stdin.on("data", (char: Buffer) => {
      const text = char.toString()
      if (text === "\n" || text === "\r" || text === "\u0004") {
        stdin.setRawMode?.(false)
        rl.close()
        process.stdout.write("\n")
        resolve(answer)
      } else if (text === "\u0003") {
        process.exit(130)
      } else if (text === "\u007f") {
        answer = answer.slice(0, -1)
      } else {
        answer += text
      }
    })
    process.stdout.write(question)
  })
}

async function main() {
  const email = (process.env.PLATFORM_MASTER_EMAIL ?? "").trim().toLowerCase()
  if (!email) throw new Error("PLATFORM_MASTER_EMAIL must be set")
  const password = await promptHidden("New platform master password: ")
  if (password.length < 12) throw new Error("Password must be at least 12 characters")
  const confirmation = await promptHidden("Confirm new password: ")
  if (password !== confirmation) throw new Error("Passwords do not match")

  const [master] = await db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1)
  if (!master) throw new Error(`No user found for ${email}`)

  const [account] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(eq(schema.account.userId, master.id))
    .limit(1)
  if (!account) throw new Error(`No credential account found for ${email}`)

  const hashed = await (await auth.$context).password.hash(password)
  await db.update(schema.account).set({ password: hashed, updatedAt: new Date() }).where(eq(schema.account.id, account.id))
  console.log(`Platform master password updated for ${master.email}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
