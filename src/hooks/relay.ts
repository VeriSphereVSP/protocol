// protocol/src/hooks/relay.ts
// Pure HTTP relay client. All chain interaction goes through the app backend.
// The only client-side crypto operation is EIP-712 signing via the wallet.

import type { RelayResponse } from "./types.js";

/**
 * Fetch the current forwarder nonce for an address.
 * This calls the app backend, which reads from the Forwarder contract.
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
 * The relay submits it on-chain and returns the result.
 */
export async function submitRelay(
  apiBase: string,
  request: Record<string, unknown>,
  signature: string,
): Promise<RelayResponse> {
  const res = await fetch(`${apiBase}/relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request, signature }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(extractErrorMessage(body));
  }
  return await res.json();
}

/**
 * Check VSP allowance via the backend (no direct chain read).
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
 * Check VSP balance via the backend (no direct chain read).
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
 * Returns { exists: true, post_id: N } or { exists: false }.
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
