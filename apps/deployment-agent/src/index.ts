import { pathToFileURL } from "node:url"

import { loadAgentConfig } from "./config.js"
import { AGENT_STATE_DIRECTORY, createStateStore } from "./identity.js"
import { createDeploymentAgent, readHealth } from "./runner.js"

export async function main(arguments_: string[] = process.argv.slice(2)): Promise<number> {
  const store = await createStateStore(AGENT_STATE_DIRECTORY)
  if (arguments_[0] === "health") return await readHealth(store) ? 0 : 1

  const agent = createDeploymentAgent({ config: loadAgentConfig(), store })
  await agent.initialize()
  agent.start()
  await new Promise<void>((resolve) => {
    let stopping = false
    const shutdown = async () => {
      if (stopping) return
      stopping = true
      await agent.stop()
      resolve()
    }
    process.once("SIGTERM", shutdown)
    process.once("SIGINT", shutdown)
  })
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => { process.exitCode = code },
    () => { process.exitCode = 1 },
  )
}
