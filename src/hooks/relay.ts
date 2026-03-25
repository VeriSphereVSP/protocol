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

/**
 * Sign an EIP-2612 permit for a token.
 * Pure client-side operation — no network calls except reading the nonce.
 */
export async function signPermit({
  walletClient,
  publicClient,
  tokenAddress,
  tokenName,
  tokenVersion,
  spender,
  value,
  chainId,
}: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  tokenAddress: Address;
  tokenName: string;
  tokenVersion: string;
  spender: Address;
  value: bigint;
  chainId: number;
}): Promise<PermitData> {
  const owner = walletClient.account!.address;

  // Read current permit nonce from chain
  const nonce = await publicClient.readContract({
    address: tokenAddress,
    abi: [
      {
        inputs: [{ name: "owner", type: "address" }],
        name: "nonces",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const,
    functionName: "nonces",
    args: [owner],
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

  const signature = await walletClient.signTypedData({
      account: walletClient.account!,
    domain: {
      name: tokenName,
      version: tokenVersion,
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
