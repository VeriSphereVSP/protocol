// protocol/src/hooks/useCreateClaim.ts
// Create a claim on-chain via the relay.
// - Allowance & balance checks: via app API
// - VSP approve: DIRECT wallet tx (ERC-20 requires msg.sender = user)
// - createClaim: via relay meta-tx

import { useState, useCallback, useEffect } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { encodeFunctionData, type Address } from "viem";
import { FUJI_ADDRESSES } from "../addresses/index.js";
import { PostRegistryABI, VSPTokenABI } from "../abis.js";
import { useMetaTx } from "./useMetaTx.js";
import { fetchAllowance, fetchBalance } from "./relay.js";
import type { ClaimState } from "./types.js";

const POSTING_FEE = BigInt("1000000000000000000"); // 1 VSP
const MAX_APPROVAL = BigInt("1000000000000000000000"); // 1000 VSP

function errorToString(err: any): string {
  if (typeof err === "string") return err;
  if (err?.shortMessage) return err.shortMessage;
  if (err?.message) return err.message;
  try { return JSON.stringify(err); } catch { return "Unknown error"; }
}

export function useCreateClaim(apiBase: string = "/api") {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { sendMetaTx } = useMetaTx(apiBase);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<ClaimState | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);

  // Check allowance via backend API
  const checkAllowance = useCallback(async () => {
    if (!userAddress) return;
    try {
      const allowance = await fetchAllowance(
        apiBase, userAddress, FUJI_ADDRESSES.PostRegistry,
      );
      setNeedsApproval(allowance < POSTING_FEE);
    } catch {
      setNeedsApproval(false);
    }
  }, [userAddress, apiBase]);

  useEffect(() => { checkAllowance(); }, [checkAllowance]);

  // Approve via DIRECT wallet tx (ERC-20 approve requires msg.sender = user)
  const approveVSP = useCallback(async () => {
    if (!userAddress || !walletClient || !publicClient) return;
    setLoading(true);
    setError(null);
    try {
      const hash = await walletClient.writeContract({
        address: FUJI_ADDRESSES.VSPToken as Address,
        abi: VSPTokenABI,
        functionName: "approve",
        args: [FUJI_ADDRESSES.PostRegistry as Address, MAX_APPROVAL],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNeedsApproval(false);
    } catch (err: any) {
      setError(errorToString(err));
    } finally {
      setLoading(false);
    }
  }, [userAddress, walletClient, publicClient]);

  // Create claim via relay meta-tx
  const createClaim = useCallback(
    async (text: string): Promise<ClaimState | null> => {
      if (!userAddress) {
        setError("Wallet not connected");
        return null;
      }
      setLoading(true);
      setError(null);
      setTxHash(null);
      setClaimState(null);
      try {
        // Pre-flight: check allowance via backend
        const allowance = await fetchAllowance(
          apiBase, userAddress, FUJI_ADDRESSES.PostRegistry,
        );
        if (allowance < POSTING_FEE) {
          setNeedsApproval(true);
          setError("Please approve VSP first");
          return null;
        }

        // Pre-flight: check balance via backend
        const balance = await fetchBalance(apiBase, userAddress);
        if (balance < POSTING_FEE) {
          setError("Insufficient VSP balance (need 1 VSP to create a claim)");
          return null;
        }

        const calldata = encodeFunctionData({
          abi: PostRegistryABI,
          functionName: "createClaim",
          args: [text],
        });

        const result = await sendMetaTx(
          FUJI_ADDRESSES.PostRegistry as Address,
          calldata,
          { gasLimit: 600_000 },
        );

        setTxHash(result.tx_hash);
        if (result.claim) {
          setClaimState(result.claim);
          return result.claim;
        }
        return null;
      } catch (err: any) {
        setError(errorToString(err));
        console.error("createClaim error:", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [userAddress, sendMetaTx, apiBase],
  );

  return {
    createClaim, approveVSP, loading, error,
    txHash, claimState, needsApproval,
  };
}
