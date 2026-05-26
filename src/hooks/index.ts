// protocol/src/hooks/index.ts
// React hooks for interacting with the Verisphere protocol.
// All chain access goes through the app backend relay — no direct RPC calls.
// Only client-side operations: EIP-712 signing and EIP-2612 permit signing.

export { useMetaTx } from "./useMetaTx.js";
// patch_bundle04_5_p4_index_export
export { useTxConfirmation, waitForTxConfirmation } from "./useTxConfirmation.js";
export type { TxConfirmationDetail, TxConfirmationStatus, WaitForTxConfirmationOptions } from "./useTxConfirmation.js";
export { useCreateClaim } from "./useCreateClaim.js";
export { useCreateLink } from "./useCreateLink.js";
export { useStake } from "./useStake.js";
export { fetchAllowance, fetchBalance, checkClaimOnChain, signPermit, fetchPostingFee } from "./relay.js";
export type { RelayResponse, ClaimState, WriteHookState, PermitData } from "./types.js";
