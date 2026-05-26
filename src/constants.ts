// protocol/src/constants.ts
// Bundle 5 cap values, kept in sync with the Fuji-deployed contracts as of
// core@7772262. These are HARDCODED in this file; future cap changes require
// updating BOTH the contract (via UUPS upgrade) AND this constant.
//
// Why not auto-extract from the ABI?
//   The ABI JSON exposes the getter signature but not the constant's value.
//   Extracting the value requires either (a) an RPC call (build-time network
//   dependency) or (b) AST parsing of the Solidity source. Both are heavier
//   than the manual sync cost for caps that change rarely.
//
// Source-of-truth pairs:
//   POST_REGISTRY_MAX_CLAIM_LENGTH        ← core/src/PostRegistry.sol
//   LINKGRAPH_MAX_OUTGOING_LINKS_PER_CLAIM ← core/src/LinkGraph.sol
//   LINKGRAPH_MAX_INCOMING_LINKS_PER_CLAIM ← core/src/LinkGraph.sol
//   STAKE_ENGINE_MAX_STAKE_AMOUNT         ← core/src/StakeEngine.sol

export const POST_REGISTRY_MAX_CLAIM_LENGTH = 1000n;          // bytes (UTF-8)
export const LINKGRAPH_MAX_OUTGOING_LINKS_PER_CLAIM = 1000n;  // links per claim
export const LINKGRAPH_MAX_INCOMING_LINKS_PER_CLAIM = 1000n;  // links per claim
export const STAKE_ENGINE_MAX_STAKE_AMOUNT = 10_000_000n * 10n ** 18n;  // wei (10M VSP)
