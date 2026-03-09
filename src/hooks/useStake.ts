// protocol/src/hooks/useStake.ts
// Stake and withdraw VSP on claims via the relay.
// Approve is a direct wallet tx; stake/withdraw go through the relay.

import { useState, useCallback, useEffect } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import { FUJI_ADDRESSES } from "../addresses/index.js";
import { StakeEngineABI, VSPTokenABI } from "../abis.js";
import { useMetaTx } from "./useMetaTx.js";
import { fetchAllowance } from "./relay.js";
import type { ClaimState } from "./types.js";

const MAX_APPROVAL = BigInt("1000000000000000000000"); // 1000 VSP
const MIN_ALLOWANCE = BigInt("1000000000000000000"); // 1 VSP

function errorToString(err: any): string {
  if (typeof err === "string") return err;
  if (err?.shortMessage) return err.shortMessage;
  if (err?.message) return err.message;
  try { return JSON.stringify(err); } catch { return "Unknown error"; }
}

export function useStake(apiBase: string = "/api") {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { sendMetaTx } = useMetaTx(apiBase);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<ClaimState | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);

  const checkAllowance = useCallback(async () => {
    if (!userAddress) return;
    try {
      const allowance = await fetchAllowance(
        apiBase, userAddress, FUJI_ADDRESSES.StakeEngine,
      );
      setNeedsApproval(allowance < MIN_ALLOWANCE);
    } catch {
      setNeedsApproval(false);
    }
  }, [userAddress, apiBase]);

  useEffect(() => { checkAllowance(); }, [checkAllowance]);

  // Approve via DIRECT wallet tx
  const approveVSP = useCallback(async () => {
    if (!userAddress || !walletClient || !publicClient) return;
    setLoading(true);
    setError(null);
    try {
      const hash = await walletClient.writeContract({
        address: FUJI_ADDRESSES.VSPToken as Address,
        abi: VSPTokenABI,
        functionName: "approve",
        args: [FUJI_ADDRESSES.StakeEngine as Address, MAX_APPROVAL],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setNeedsApproval(false);
    } catch (err: any) {
      setError(errorToString(err));
    } finally {
      setLoading(false);
    }
  }, [userAddress, walletClient, publicClient]);

  // Ensure sufficient allowance, approve if needed
  const ensureAllowance = useCallback(
    async (amountWei: bigint) => {
      if (!userAddress || !walletClient || !publicClient) return;
      const allowance = await fetchAllowance(
        apiBase, userAddress, FUJI_ADDRESSES.StakeEngine,
      );
      if (allowance < amountWei) {
        const hash = await walletClient.writeContract({
          address: FUJI_ADDRESSES.VSPToken as Address,
          abi: VSPTokenABI,
          functionName: "approve",
          args: [FUJI_ADDRESSES.StakeEngine as Address, MAX_APPROVAL],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        setNeedsApproval(false);
      }
    },
    [userAddress, walletClient, publicClient, apiBase],
  );

  const stake = useCallback(
    async (postId: number, side: "support" | "challenge", amount: number): Promise<ClaimState | null> => {
      if (!userAddress) { setError("Wallet not connected"); return null; }
      setLoading(true); setError(null); setTxHash(null); setClaimState(null);
      try {
        const amountWei = parseUnits(amount.toString(), 18);
        if (amountWei <= 0n) { setError("Amount must be greater than 0"); return null; }
        await ensureAllowance(amountWei);
        const calldata = encodeFunctionData({
          abi: StakeEngineABI, functionName: "stake",
          args: [BigInt(postId), side === "support" ? 0 : 1, amountWei],
        });
        const result = await sendMetaTx(
          FUJI_ADDRESSES.StakeEngine as Address, calldata, { gasLimit: 600_000 },
        );
        setTxHash(result.tx_hash);
        if (result.claim) { setClaimState(result.claim); return result.claim; }
        return null;
      } catch (err: any) {
        setError(errorToString(err));
        console.error("stake error:", err);
        return null;
      } finally { setLoading(false); }
    },
    [userAddress, sendMetaTx, ensureAllowance],
  );

  const withdraw = useCallback(
    async (postId: number, side: "support" | "challenge", amount: number, lifo = true): Promise<ClaimState | null> => {
      if (!userAddress) { setError("Wallet not connected"); return null; }
      setLoading(true); setError(null); setTxHash(null); setClaimState(null);
      try {
        const amountWei = parseUnits(amount.toString(), 18);
        if (amountWei <= 0n) { setError("Amount must be greater than 0"); return null; }
        const calldata = encodeFunctionData({
          abi: StakeEngineABI, functionName: "withdraw",
          args: [BigInt(postId), side === "support" ? 0 : 1, amountWei, lifo],
        });
        const result = await sendMetaTx(
          FUJI_ADDRESSES.StakeEngine as Address, calldata, { gasLimit: 500_000 },
        );
        setTxHash(result.tx_hash);
        if (result.claim) { setClaimState(result.claim); return result.claim; }
        return null;
      } catch (err: any) {
        setError(errorToString(err));
        console.error("withdraw error:", err);
        return null;
      } finally { setLoading(false); }
    },
    [userAddress, sendMetaTx],
  );

  return {
    stake, withdraw, loading, error,
    txHash, claimState, needsApproval, approveVSP,
  };
}
