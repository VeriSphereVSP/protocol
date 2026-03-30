// protocol/src/index.ts
// Public API of @verisphere/protocol.
// Single source of truth for frontend: ABIs, types, deployment addresses, and hooks.

// ABIs (for use with wagmi/viem in frontends)
export {
  PostRegistryABI,
  StakeEngineABI,
  LinkGraphABI,
  ProtocolViewsABI,
  VSPTokenABI,
} from "./abis.js";

// Types
export type {
  Address,
  Post,
  Link,
  StakeSide,
  ContractAddresses,
} from "./types.js";

// Deployment addresses (written by post-deploy.sh)
export { FUJI_ADDRESSES, getAddresses, SUPPORTED_CHAINS } from "./addresses/index.js";

// Server-side ethers client (Node.js / backend use)
export { ProtocolClient } from "./client.js";
export type { ProtocolClientOpts } from "./client.js";

// React hooks — relay-based, no direct chain access
// Frontend imports: import { useCreateClaim, useStake } from "@verisphere/protocol"
export {
  useMetaTx,
  useCreateClaim,
  useCreateLink,
  useStake,
  fetchAllowance,
  fetchBalance,
  checkClaimOnChain,
  fetchPostingFee,
} from "./hooks/index.js";
export type {
  RelayResponse,
  ClaimState,
  WriteHookState,
} from "./hooks/index.js";
