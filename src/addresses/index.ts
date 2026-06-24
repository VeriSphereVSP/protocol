// protocol/src/addresses/index.ts
// Network-aware address loading. Addresses are written by deploy.sh.
//
// Usage:
//   import { getAddresses, FUJI_ADDRESSES } from "@verisphere/protocol";
//   const addrs = getAddresses(43113); // or getAddresses(43114) for mainnet

import type { ContractAddresses } from "../types.js";

// Import available network configs (deploy.sh writes these)
import fujiJson from "./fuji.json";

// Mainnet placeholder — uncomment when deployed:
// import mainnetJson from "./mainnet.json";

const NETWORKS: Record<number, ContractAddresses> = {
  43113: fujiJson as ContractAddresses,
  // 43114: mainnetJson as ContractAddresses,
};

// patch_runtime_address_hydration: addresses pushed in at runtime by the FE
// (from the backend /api/contracts). Lets a fresh deploy stay correct without
// rebuilding the baked fuji.json/dist. Empty until setRuntimeAddresses() runs.
const RUNTIME: Record<number, ContractAddresses> = {};

/**
 * Hydrate/override the addresses for a chain at runtime. The FE calls this once
 * with the backend's /api/contracts payload so getAddresses() returns the live
 * deployment even if the baked dist is stale. Merges onto the baked set.
 */
export function setRuntimeAddresses(
  chainId: number,
  addrs: Partial<ContractAddresses> & Record<string, unknown>
): void {
  const base = (NETWORKS[chainId] ?? {}) as ContractAddresses;
  RUNTIME[chainId] = { ...base, ...(RUNTIME[chainId] ?? {}), ...addrs } as ContractAddresses;
}

/**
 * Get contract addresses for a specific chain ID.
 * Prefers runtime-hydrated addresses (setRuntimeAddresses) over the baked set.
 * Throws if the chain is not configured.
 */
export function getAddresses(chainId: number): ContractAddresses {
  const addrs = RUNTIME[chainId] ?? NETWORKS[chainId];
  if (!addrs) {
    throw new Error(
      `No VeriSphere deployment for chain ${chainId}. ` +
      `Available: ${[...new Set([...Object.keys(NETWORKS), ...Object.keys(RUNTIME)])].join(", ")}`
    );
  }
  return addrs;
}

/** Convenience: Fuji testnet addresses (backward compatible). */
export const FUJI_ADDRESSES: ContractAddresses = NETWORKS[43113]!;

/** All configured chain IDs. */
export const SUPPORTED_CHAINS = Object.keys(NETWORKS).map(Number);
