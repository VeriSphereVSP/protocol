// protocol/src/hooks/types.ts

/** EIP-2612 permit data, sent alongside relay requests. */
export interface PermitData {
  token: string;
  owner: string;
  spender: string;
  value: string;
  deadline: number;
  v: number;
  r: string;
  s: string;
}

/** Response from the relay endpoint. */
export interface RelayResponse {
  ok: boolean;
  tx_hash: string | null;
  duplicate?: boolean;
  claim?: ClaimState;
}

/** On-chain claim state returned by the relay after mutations. */
export interface ClaimState {
  post_id: number;
  text: string;
  creator: string;
  support_total: number;
  challenge_total: number;
  user_support?: number;
  user_challenge?: number;
}

/** Common state shape for write hooks. */
export interface WriteHookState {
  loading: boolean;
  error: string | null;
  txHash: string | null;
}
