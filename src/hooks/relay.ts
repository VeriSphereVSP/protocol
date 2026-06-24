// protocol/src/hooks/relay.ts
// Pure HTTP relay client + EIP-2612 permit signing.
// All chain interaction goes through the app backend.
// Client-side crypto: EIP-712 signing via the wallet.

import type { RelayResponse, PermitData } from "./types.js";
import type { WalletClient, PublicClient, Address } from "viem";

/**
 * Fetch the current forwarder nonce for an address.
 */
export async function fetchNonce(
  apiBase: string,
  address: string,
): Promise<number> {
  const res = await fetch(`${apiBase}/relay/nonce/${address}`);
  if (!res.ok) throw new Error(`Failed to fetch nonce: ${res.statusText}`);
  return (await res.json()).nonce;
}

/**
 * Submit a signed meta-transaction to the relay.
 * If permit is provided, the relay executes token.permit() first (relay pays gas).
 */
export async function submitRelay(
  apiBase: string,
  request: Record<string, unknown>,
  signature: string,
  permit?: PermitData,
  feePermit?: PermitData,
): Promise<RelayResponse> {
  const body: Record<string, unknown> = { request, signature };
  if (permit) {
    body.permit = permit;
  }
  if (feePermit) {
    body.fee_permit = feePermit;
  }
  const res = await fetch(`${apiBase}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(extractErrorMessage(errBody));
  }
  return await res.json();
}

// patch_permit_domain_from_chain: read the EIP-712 domain (name, version)
// straight from the token's eip712Domain() (EIP-5267) so the signed domain can
// never drift from the deployed token. A wrong hardcoded name does not steal
// funds — it silently fails permit verification — so we read-or-throw and never
// sign a guessed domain. Cached per token address.
const EIP712_DOMAIN_ABI = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;
const eip712DomainCache = new Map<string, { name: string; version: string }>();

/**
 * Read a contract's EIP-712 domain (name, version) from eip712Domain()
 * (EIP-5267) on-chain. Read-or-throw: never returns a guessed domain. Cached
 * per contract address. Works for any EIP-712 signer — the token (permits) and
 * the trusted Forwarder (ForwardRequest) both expose eip712Domain().
 */
export async function readEip712Domain(
  publicClient: PublicClient,
  contract: Address,
): Promise<{ name: string; version: string }> {
  const key = contract.toLowerCase();
  const hit = eip712DomainCache.get(key);
  if (hit) return hit;
  if (!publicClient) throw new Error("No RPC client available to read EIP-712 domain");
  const d: any = await publicClient.readContract({
    address: contract,
    abi: EIP712_DOMAIN_ABI,
    functionName: "eip712Domain",
  });
  const name = d[1] as string;
  const version = d[2] as string;
  if (!name || !version) {
    throw new Error("eip712Domain() returned empty name/version; refusing to sign a guessed EIP-712 domain");
  }
  const val = { name, version };
  eip712DomainCache.set(key, val);
  return val;
}

/** @deprecated use readEip712Domain — kept for backward compatibility. */
export const readPermitDomain = readEip712Domain;

const PERMIT_NONCE_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "nonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Read a token's current EIP-2612 permit nonce for `owner`.
 */
export async function readPermitNonce(
  publicClient: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  const n = await publicClient.readContract({
    address: token,
    abi: PERMIT_NONCE_ABI,
    functionName: "nonces",
    args: [owner],
  });
  return n as bigint;
}

/**
 * Sign an EIP-2612 permit for a token. The EIP-712 domain name/version are read
 * from the token's eip712Domain() on-chain; tokenName/tokenVersion are accepted
 * for backward compatibility but IGNORED (read-or-throw guards against drift).
 * Pure client-side operation — reads the nonce and domain from chain.
 */
export async function signPermit({
  walletClient,
  publicClient,
  tokenAddress,
  spender,
  value,
  chainId,
  nonceOverride,
}: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  tokenAddress: Address;
  /** @deprecated ignored — domain name is read from eip712Domain() on-chain */
  tokenName?: string;
  /** @deprecated ignored — domain version is read from eip712Domain() on-chain */
  tokenVersion?: string;
  spender: Address;
  value: bigint;
  chainId: number;
  /** Explicit permit nonce; if omitted, read fresh from chain. Used to allocate
   *  sequential nonces when one flow signs multiple permits on the same token. */
  nonceOverride?: bigint;
}): Promise<PermitData> {
  const owner = walletClient.account!.address;
  const { name: domainName, version: domainVersion } = await readEip712Domain(
    publicClient,
    tokenAddress,
  );

  // Permit nonce: caller-provided (for sequential allocation when a flow signs
  // multiple permits on the same token) or read fresh from chain.
  const nonce = nonceOverride ?? (await readPermitNonce(publicClient, tokenAddress, owner));

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

  const signature = await walletClient.signTypedData({
      account: walletClient.account!,
    domain: {
      name: domainName,
      version: domainVersion,
      chainId,
      verifyingContract: tokenAddress,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner,
      spender,
      value,
      nonce: nonce as bigint,
      deadline,
    },
  });

  const r = "0x" + signature.slice(2, 66);
  const s = "0x" + signature.slice(66, 130);
  const v = parseInt(signature.slice(130, 132), 16);

  return {
    token: tokenAddress,
    owner,
    spender,
    value: value.toString(),
    deadline: Number(deadline),
    v,
    r,
    s,
  };
}

/**
 * Check VSP allowance via the backend.
 */
export async function fetchAllowance(
  apiBase: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const res = await fetch(
    `${apiBase}/token/allowance?owner=${owner}&spender=${spender}`,
  );
  if (!res.ok) return 0n;
  const data = await res.json();
  return BigInt(data.allowance ?? "0");
}

/**
 * Check VSP balance via the backend.
 */
export async function fetchBalance(
  apiBase: string,
  address: string,
): Promise<bigint> {
  const res = await fetch(`${apiBase}/token/balance?address=${address}`);
  if (!res.ok) return 0n;
  const data = await res.json();
  return BigInt(data.balance ?? "0");
}

/**
 * Check if a claim already exists on-chain.
 */
export async function checkClaimOnChain(
  apiBase: string,
  text: string,
): Promise<{ exists: boolean; post_id: number | null }> {
  const res = await fetch(
    `${apiBase}/claims/check-onchain?text=${encodeURIComponent(text)}`,
  );
  if (!res.ok) return { exists: false, post_id: null };
  return await res.json();
}

/**
 * Fetch the current posting fee from the backend.
 * Returns the fee in wei (e.g. 1000000000000000000 = 1 VSP).
 */
export async function fetchPostingFee(
  apiBase: string,
): Promise<bigint> {
  try {
    const res = await fetch(`${apiBase}/fees`);
    if (!res.ok) return BigInt("1000000000000000000"); // fallback: 1 VSP
    const data = await res.json();
    return BigInt(data.posting_fee_wei ?? "1000000000000000000");
  } catch {
    return BigInt("1000000000000000000"); // fallback: 1 VSP
  }
}

function extractErrorMessage(err: any): string {
  if (typeof err === "string") return err;
  if (Array.isArray(err))
    return err.map((e: any) => e.msg || JSON.stringify(e)).join("; ");
  if (err?.detail) return extractErrorMessage(err.detail);
  if (err?.message) return String(err.message);
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

// patch_bundle04b1_async — appended by bundle 4b-1 patch.
// New /api/relay/async submission path. Returns immediately with
// tx_hash + tx_log_id; downstream code awaits resolution via the
// notifications/waitForTx mechanism.

export interface AsyncRelayResponse {
  tx_hash: string;
  tx_log_id: number;
  action_type: string;
  action_value: number | null;
  status: "submitted" | "duplicate_claim";
  // For duplicate_claim case:
  claim?: {
    post_id: number;
    text: string;
    creator: string;
    support_total: number;
    challenge_total: number;
  };
}

/** Submit a signed meta-tx via the async endpoint. Does NOT wait for
 *  receipt — returns the moment the relay server has the tx_hash. */
export async function submitRelayAsync(
  apiBase: string,
  request: Record<string, unknown>,
  signature: string,
  permit?: PermitData,
  feePermit?: PermitData,
): Promise<AsyncRelayResponse> {
  const body: Record<string, unknown> = { request, signature };
  if (permit) body.permit = permit;
  if (feePermit) body.fee_permit = feePermit;

  const res = await fetch(`${apiBase}/relay/async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ detail: res.statusText }));
    const msg =
      typeof errBody === "string"
        ? errBody
        : errBody?.detail || errBody?.message || JSON.stringify(errBody);
    throw new Error(msg);
  }
  return await res.json();
}
