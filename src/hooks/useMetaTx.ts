// protocol/src/hooks/useMetaTx.ts
// Core meta-transaction hook (bundle 4b-1 — async-by-default).
//
// Flow:
//   1. Sign EIP-712 ForwardRequest in user's wallet.
//   2. POST /api/relay/async  → returns { tx_hash, tx_log_id } immediately.
//   3. Await tx resolution via the verisphere:tx-resolved window event,
//      which is dispatched by NotificationsProvider when it sees a
//      tx_log row flip out of 'pending'.
//   4. On confirmed: return synthetic RelayResponse shaped like the old
//      synchronous endpoint's response (sans `claim`, which callers
//      reconstruct via checkClaimOnChain if they need it).
//   5. On reverted/dropped: throw with the error message.
//
// Callers see no API change. The `RelayResponse` interface remains the
// same; `result.claim` is now usually undefined, and callers already
// have fallback paths that fetch claim state if missing.
import { useCallback } from "react";
import { useWalletClient, usePublicClient, useAccount } from "wagmi";
import type { Hex, Address } from "viem";
import { getAddresses } from "../addresses/index.js";
import { VSPTokenABI } from "../abis.js";
import { fetchNonce, signPermit, submitRelayAsync } from "./relay.js";
import type { RelayResponse, PermitData } from "./types.js";

const API_BASE =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) || "/api";

// Window-event-based wait. Inverse of NotificationsProvider's dispatch.
// Timeout default is generous: chain confirmation + indexer poll interval
// can take 20-30s on Fuji. The user sees a notifications-panel entry
// throughout, so a longer wait doesn't feel broken.
const TX_RESOLVE_TIMEOUT_MS = 90_000;

type TxResolvedDetail = {
  tx_log_id: number;
  tx_hash: string;
  status: "confirmed" | "reverted" | "dropped";
  block_number?: number;
  gas_used?: number;
  post_id?: number;
  error_message?: string;
};

async function waitForTxResolution(tx_log_id: number): Promise<TxResolvedDetail> {
  return new Promise<TxResolvedDetail>((resolve, reject) => {
    let done = false;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as TxResolvedDetail | undefined;
      if (!detail || detail.tx_log_id !== tx_log_id) return;
      done = true;
      window.removeEventListener("verisphere:tx-resolved", handler);
      resolve(detail);
    };
    window.addEventListener("verisphere:tx-resolved", handler);
    // Ask the notifications poller to refresh immediately so latency
    // isn't bounded by the poll interval.
    window.dispatchEvent(new CustomEvent("verisphere:notifications-refresh"));

    setTimeout(() => {
      if (done) return;
      window.removeEventListener("verisphere:tx-resolved", handler);
      reject(new Error("Transaction timed out — check notifications for status"));
    }, TX_RESOLVE_TIMEOUT_MS);
  });
}

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

export { type RelayResponse };

export function useMetaTx() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { chain } = useAccount();

  const sendMetaTx = useCallback(
    async (
      targetContract: Address,
      calldata: Hex,
      options?: { gasLimit?: number; value?: number; permit?: PermitData },
    ): Promise<RelayResponse> => {
      if (!walletClient || !publicClient || !chain)
        throw new Error("Wallet not connected");

      const userAddress = walletClient.account.address;
      const addresses = getAddresses(chain.id);
      const nonce = await fetchNonce(API_BASE, userAddress);
      const deadline = Math.floor(Date.now() / 1000) + 300;

      const forwardRequest = {
        from: userAddress,
        to: targetContract,
        value: BigInt(options?.value ?? 0),
        gas: BigInt(options?.gasLimit ?? 1_500_000),
        nonce: BigInt(nonce),
        deadline,
        data: calldata,
      };

      // One-time forwarder VSP allowance (ERC-2612 permit).
      if (addresses.Forwarder) {
        const currentAllowance = (await publicClient.readContract({
          address: addresses.VSPToken as Address,
          abi: VSPTokenABI,
          functionName: "allowance",
          args: [userAddress, addresses.Forwarder as Address],
        })) as bigint;

        const MIN_ALLOWANCE = BigInt("10000000000000000000"); // 10 VSP
        const APPROVAL_AMOUNT = BigInt("10000000000000000000000"); // 10,000 VSP
        if (currentAllowance < MIN_ALLOWANCE) {
          window.dispatchEvent(
            new CustomEvent("verisphere:toast", {
              detail: {
                message:
                  "One-time approval: sign a permit to allow relay fees (no gas needed)",
                type: "info",
              },
            }),
          );
          const permit = await signPermit({
            walletClient,
            publicClient,
            tokenAddress: addresses.VSPToken as Address,
            tokenName: "VeriSphere",
            tokenVersion: "1",
            spender: addresses.Forwarder as Address,
            value: APPROVAL_AMOUNT,
            chainId: chain.id,
          });
          const execRes = await fetch(`${API_BASE}/mm/execute-permit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: addresses.VSPToken,
              owner: userAddress,
              spender: addresses.Forwarder,
              value: APPROVAL_AMOUNT.toString(),
              deadline: permit.deadline,
              v: permit.v,
              r: permit.r,
              s: permit.s,
            }),
          });
          if (!execRes.ok) {
            const err = await execRes.text();
            throw new Error(`Permit execution failed: ${err}`);
          }
          await new Promise((r) => setTimeout(r, 3000));
        }
      }

      window.dispatchEvent(
        new CustomEvent("verisphere:toast", {
          detail: { message: "Confirm transaction in wallet", type: "info" },
        }),
      );
      const signature = await walletClient.signTypedData({
        domain: {
          name: "VerisphereForwarder",
          version: "1",
          chainId: chain.id,
          verifyingContract: addresses.Forwarder as Address,
        },
        types: FORWARD_REQUEST_TYPES,
        primaryType: "ForwardRequest",
        message: forwardRequest,
      });

      // Convert bigints to numbers for JSON serialization
      const relayRequest = {
        ...forwardRequest,
        value: Number(forwardRequest.value),
        gas: Number(forwardRequest.gas),
        nonce: Number(forwardRequest.nonce),
      };

      const submitResp = await submitRelayAsync(
        API_BASE,
        relayRequest,
        signature,
        options?.permit,
      );

      // Server pre-flight may detect a duplicate claim before submission.
      if (submitResp.status === "duplicate_claim") {
        return {
          ok: false,
          tx_hash: null,
          duplicate: true,
          claim: submitResp.claim,
        };
      }

      // Submitted to chain; await the notifications watcher's resolution.
      const resolved = await waitForTxResolution(submitResp.tx_log_id);

      if (resolved.status === "confirmed") {
        // Synthesize RelayResponse shape. `claim` is intentionally
        // undefined here; callers that need ClaimState reconstruct it
        // via checkClaimOnChain in their own fallback paths
        // (useCreateClaim / useStake already do this).
        return {
          ok: true,
          tx_hash: submitResp.tx_hash,
        };
      }

      // reverted or dropped — throw so callers handle in their catch.
      const msg = resolved.error_message || (resolved.status === "dropped"
        ? "Transaction was dropped from the mempool — try again"
        : "Transaction reverted on-chain");
      throw new Error(msg);
    },
    [walletClient, publicClient, chain],
  );

  return { sendMetaTx };
}
