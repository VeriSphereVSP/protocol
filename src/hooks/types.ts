// protocol/src/hooks/types.ts

/** Response from the relay endpoint. */
export interface RelayResponse {
  ok: boolean;
  tx_hash: string | null;
  duplicate?: boolean;
  claim?: ClaimState;
}

/** On-chain claim state returned by the relay/backend. */
export interface ClaimState {
  post_id: number;
  text: string;
  creator: string;
  support_total: number;
  challenge_total: number;
  user_support: number;
  user_challenge: number;
}

/** Common state shape for write hooks. */
export interface WriteHookState {
  loading: boolean;
  error: string | null;
  txHash: string | null;
}
