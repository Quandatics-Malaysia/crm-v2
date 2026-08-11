import { fromBase64Url } from "@crm/control-protocol/deployment-auth"
import { StrictSemverSchema } from "@crm/control-protocol"
import { z } from "zod"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const migrationVersionPattern = /^[0-9]{4}$/
const base64Url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine((value) => {
  try {
    fromBase64Url(value, 32)
    return true
  } catch {
    return false
  }
})

const rawConfigSchema = z.object({
  CONTROL_PLANE_URL: z.string(),
  DEPLOYMENT_ID: z.string().regex(uuidPattern),
  DEPLOYMENT_ENV: z.enum(["development", "staging", "production"]),
  INSTALLATION_TOKEN: base64Url32.optional(),
  WEB_INTERNAL_URL: z.string(),
  AGENT_WEB_SECRET: base64Url32,
  APPLICATION_VERSION: StrictSemverSchema,
  AGENT_VERSION: StrictSemverSchema,
  IMAGE_DIGEST: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  MIGRATION_VERSION: z.string().regex(migrationVersionPattern),
}).strict()

export type AgentConfig = {
  controlPlaneUrl: string
  deploymentId: string
  environment: "development" | "staging" | "production"
  installationToken?: string
  webInternalUrl: string
  webSecret: string
  applicationVersion: string
  agentVersion: string
  imageDigest: string
  migrationVersion: string
}

function parseBaseUrl(value: string, protocols: readonly string[]): string {
  const url = new URL(value)
  if (
    !protocols.includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/"
  ) {
    throw new TypeError("Invalid URL")
  }
  return url.origin
}

export function loadAgentConfig(environment: Record<string, string | undefined> = process.env): AgentConfig {
  try {
    const parsed = rawConfigSchema.parse({
      CONTROL_PLANE_URL: environment.CONTROL_PLANE_URL,
      DEPLOYMENT_ID: environment.DEPLOYMENT_ID,
      DEPLOYMENT_ENV: environment.DEPLOYMENT_ENV,
      INSTALLATION_TOKEN: environment.INSTALLATION_TOKEN || undefined,
      WEB_INTERNAL_URL: environment.WEB_INTERNAL_URL,
      AGENT_WEB_SECRET: environment.AGENT_WEB_SECRET,
      APPLICATION_VERSION: environment.APPLICATION_VERSION,
      AGENT_VERSION: environment.AGENT_VERSION,
      IMAGE_DIGEST: environment.IMAGE_DIGEST,
      MIGRATION_VERSION: environment.MIGRATION_VERSION,
    })
    const controlPlaneUrl = parseBaseUrl(
      parsed.CONTROL_PLANE_URL,
      parsed.DEPLOYMENT_ENV === "development" ? ["http:", "https:"] : ["https:"],
    )
    const webInternalUrl = parseBaseUrl(parsed.WEB_INTERNAL_URL, ["http:", "https:"])
    return {
      controlPlaneUrl,
      deploymentId: parsed.DEPLOYMENT_ID,
      environment: parsed.DEPLOYMENT_ENV,
      installationToken: parsed.INSTALLATION_TOKEN,
      webInternalUrl,
      webSecret: parsed.AGENT_WEB_SECRET,
      applicationVersion: parsed.APPLICATION_VERSION,
      agentVersion: parsed.AGENT_VERSION,
      imageDigest: parsed.IMAGE_DIGEST,
      migrationVersion: parsed.MIGRATION_VERSION,
    }
  } catch {
    throw new TypeError("Invalid deployment agent configuration")
  }
}
