import "server-only"

import {
  getDeploymentAccess,
  type DeploymentAccess,
} from "@/lib/deployment-control"
import { requireContext } from "@/lib/server-context"

export type SubscriptionEntitlementView = {
  mode: DeploymentAccess["mode"]
  reason: string
  writeAllowed: boolean
  subscriptionStatus: DeploymentAccess["subscriptionStatus"]
  planId: string | null
  seatLimit: number
  moduleIds: DeploymentAccess["moduleIds"]
  leaseExpiresAt: string | null
  graceUntil: string | null
  contractStartsAt: string | null
  contractEndsAt: string | null
  revision: number | null
  configurationVersion: string | null
}

type SubscriptionEntitlementReaderDependencies = {
  requireContext(): Promise<unknown>
  getAccess(): Promise<DeploymentAccess>
}

/**
 * Builds a minimal client-safe DTO from signed deployment state. Canonical
 * envelopes, signatures, trust keys, and key IDs never enter render props.
 */
export function createSubscriptionEntitlementReader(
  dependencies: SubscriptionEntitlementReaderDependencies
) {
  return async function readSubscriptionEntitlement(): Promise<SubscriptionEntitlementView> {
    await dependencies.requireContext()
    const access = await dependencies.getAccess()
    return {
      mode: access.mode,
      reason: access.reason,
      writeAllowed: access.writeAllowed,
      subscriptionStatus: access.subscriptionStatus,
      planId: access.planId,
      seatLimit: access.seatLimit,
      moduleIds: [...access.moduleIds],
      leaseExpiresAt: access.leaseExpiresAt,
      graceUntil: access.graceUntil,
      contractStartsAt: access.contractStartsAt,
      contractEndsAt: access.contractEndsAt,
      revision: access.revision,
      configurationVersion: access.configurationVersion,
    }
  }
}

export const getSubscriptionEntitlementData =
  createSubscriptionEntitlementReader({
    requireContext,
    getAccess: () => getDeploymentAccess(),
  })
