// protocol/src/hooks/useCreateClaim.ts
import { useState, useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { encodeFunctionData, type Address } from "viem";
import { useMetaTx } from "./useMetaTx.js";
import { signPermit, fetchAllowance, fetchBalance, checkClaimOnChain } from "./relay.js";
import { PostRegistryABI } from "../abis.js";
import { getAddresses } from "../addresses/index.js";
import type { RelayResponse, ClaimState } from "./types.js";

const API_BASE =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) || "/api";

// Posting fee is fetched from backend (governance-configurable)
const DEFAULT_POSTING_FEE = BigInt("1000000000000000000"); // 1 VSP fallback
const PERMIT_BUFFER_MULTIPLIER = 10n; // permit for 10x the fee

function errorToString(err: any): string {
  if (typeof err === "string") return err;
  if (err?.shortMessage) return err.shortMessage;
  if (err?.message) return err.message;
  try { return JSON.stringify(err); } catch { return "Unknown error"; }
}

export function useCreateClaim() {
  const { address: userAddress, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { sendMetaTx } = useMetaTx();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<ClaimState | null>(null);

  const getPermitIfNeeded = useCallback(
    async () => {
      if (!userAddress || !publicClient || !walletClient || !chain) return undefined;
      const addresses = getAddresses(chain.id);
      const currentAllowance = await fetchAllowance(
        API_BASE, userAddress, addresses.PostRegistry,
      );
      if (currentAllowance >= DEFAULT_POSTING_FEE) return undefined;
      window.dispatchEvent(new CustomEvent("verisphere:toast", { detail: { message: "Step 1: Approve token access (sign in wallet)", type: "info" } }));
      return signPermit({
        walletClient, publicClient,
        tokenAddress: addresses.VSPToken as Address,
        tokenName: "VeriSphere", tokenVersion: "1",
        spender: addresses.PostRegistry as Address,
        value: DEFAULT_POSTING_FEE * 10n, chainId: chain.id,
      });
    },
    [userAddress, publicClient, walletClient, chain],
  );

  const createClaim = useCallback(
    async (text: string): Promise<ClaimState | null> => {
      if (!userAddress) { setError("Wallet not connected"); return null; }
      setLoading(true); setError(null); setTxHash(null); setClaimState(null);
      try {
        const addresses = getAddresses(chain?.id ?? 43113);
        const postingFee = DEFAULT_POSTING_FEE; // TODO: fetch from backend when /api/fees returns posting_fee_wei

        // Check balance
        const balance = await fetchBalance(API_BASE, userAddress);
        if (balance < postingFee) {
          setError("Insufficient VSP balance (need 1 VSP to create a claim)");
          return null;
        }

        // Check if already on-chain
        const existing = await checkClaimOnChain(API_BASE, text);
        if (existing.exists && existing.post_id != null) {
          const state: ClaimState = {
            post_id: existing.post_id, text, creator: userAddress,
            support_total: 0, challenge_total: 0,
          };
          setClaimState(state);
          return state;
        }

        // Get permit if needed
        const permit = await getPermitIfNeeded();

        // Encode createClaim calldata
        const calldata = encodeFunctionData({
          abi: PostRegistryABI,
          functionName: "createClaim",
          args: [text],
        });

        const result: RelayResponse = await sendMetaTx(
          addresses.PostRegistry as Address, calldata,
          { gasLimit: 2_000_000, permit },
        );

        setTxHash(result.tx_hash);
        if (result.claim) { setClaimState(result.claim); return result.claim; }
        return null;
      } catch (err: any) {
        setError(errorToString(err));
        console.error("createClaim error:", err);
        return null;
      } finally { setLoading(false); }
    },
    [userAddress, sendMetaTx, getPermitIfNeeded],
  );

  return { createClaim, loading, error, txHash, claimState,
    needsApproval: false, approveVSP: async () => {} };
}
