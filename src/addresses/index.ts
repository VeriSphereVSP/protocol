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

/**
 * Get contract addresses for a specific chain ID.
 * Throws if the chain is not configured.
 */
export function getAddresses(chainId: number): ContractAddresses {
  const addrs = NETWORKS[chainId];
  if (!addrs) {
    throw new Error(
      `No VeriSphere deployment for chain ${chainId}. ` +
      `Available: ${Object.keys(NETWORKS).join(", ")}`
    );
  }
  return addrs;
}

/** Convenience: Fuji testnet addresses (backward compatible). */
export const FUJI_ADDRESSES: ContractAddresses = NETWORKS[43113]!;

/** All configured chain IDs. */
export const SUPPORTED_CHAINS = Object.keys(NETWORKS).map(Number);
