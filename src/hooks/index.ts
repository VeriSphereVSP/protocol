// protocol/src/hooks/index.ts
// React hooks for interacting with the Verisphere protocol.
// All chain access goes through the app backend relay — no direct RPC calls.
// Only client-side operation: EIP-712 signing in the user's wallet.

export { useMetaTx } from "./useMetaTx.js";
export { useCreateClaim } from "./useCreateClaim.js";
export { useCreateLink } from "./useCreateLink.js";
export { useStake } from "./useStake.js";
export { fetchAllowance, fetchBalance, checkClaimOnChain } from "./relay.js";
export type { RelayResponse, ClaimState, WriteHookState } from "./types.js";
