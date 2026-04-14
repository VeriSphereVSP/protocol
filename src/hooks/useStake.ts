// protocol/src/hooks/useStake.ts
import { useState, useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import { useMetaTx } from "./useMetaTx.js";
import { signPermit, fetchAllowance } from "./relay.js";
import { StakeEngineABI, VSPTokenABI } from "../abis.js";
import { getAddresses } from "../addresses/index.js";
import type { ClaimState } from "./types.js";

const API_BASE =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) || "/api";

function errorToString(err: any): string {
  if (typeof err === "string") return err;
  if (err?.shortMessage) return err.shortMessage;
  if (err?.message) return err.message;
  try { return JSON.stringify(err); } catch { return "Unknown error"; }
}

export function useStake() {
  const { address: userAddress, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { sendMetaTx } = useMetaTx();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<ClaimState | null>(null);

  const getPermitIfNeeded = useCallback(
    async (amountWei: bigint) => {
      if (!userAddress || !publicClient || !walletClient || !chain) return undefined;
      const addresses = getAddresses(chain.id);
      const currentAllowance = await fetchAllowance(
        API_BASE, userAddress, addresses.StakeEngine,
      );
      if (currentAllowance >= amountWei) return undefined;
      window.dispatchEvent(new CustomEvent("verisphere:toast", { detail: { message: "Step 1: Approve token access (sign in wallet)", type: "info" } }));
      return signPermit({
        walletClient, publicClient,
        tokenAddress: addresses.VSPToken as Address,
        tokenName: "VeriSphere", tokenVersion: "1",
        spender: addresses.StakeEngine as Address,
        value: amountWei * 2n, chainId: chain.id,
      });
    },
    [userAddress, publicClient, walletClient, chain],
  );

  const stake = useCallback(
    async (postId: number, side: "support" | "challenge", amount: number): Promise<ClaimState | null> => {
      if (!userAddress) { setError("Wallet not connected"); return null; }
      setLoading(true); setError(null); setTxHash(null); setClaimState(null);
      try {
        const addresses = getAddresses(chain?.id ?? 43113);
        const amountWei = parseUnits(amount.toString(), 18);
        if (amountWei <= 0n) { setError("Amount must be greater than 0"); return null; }
        const permit = await getPermitIfNeeded(amountWei);
        const calldata = encodeFunctionData({
          abi: StakeEngineABI, functionName: "stake",
          args: [BigInt(postId), side === "support" ? 0 : 1, amountWei],
        });
        const result = await sendMetaTx(
          addresses.StakeEngine as Address, calldata,
          { gasLimit: 600_000, permit },
        );
        setTxHash(result.tx_hash);
        if (result.claim) { setClaimState(result.claim); return result.claim; }
        return null;
      } catch (err: any) {
        setError(errorToString(err));
        console.error("stake error:", err);
        throw err;
      } finally { setLoading(false); }
    },
    [userAddress, sendMetaTx, getPermitIfNeeded],
  );

  const withdraw = useCallback(
    async (postId: number, side: "support" | "challenge", amount: number, lifo = true): Promise<ClaimState | null> => {
      if (!userAddress) { setError("Wallet not connected"); return null; }
      setLoading(true); setError(null); setTxHash(null); setClaimState(null);
      try {
        const addresses = getAddresses(chain?.id ?? 43113);
        const amountWei = parseUnits(amount.toString(), 18);
        if (amountWei <= 0n) { setError("Amount must be greater than 0"); return null; }
        const calldata = encodeFunctionData({
          abi: StakeEngineABI, functionName: "withdraw",
          args: [BigInt(postId), side === "support" ? 0 : 1, amountWei, lifo],
        });
        const result = await sendMetaTx(
          addresses.StakeEngine as Address, calldata,
          { gasLimit: 500_000 },
        );
        setTxHash(result.tx_hash);
        if (result.claim) { setClaimState(result.claim); return result.claim; }
        return null;
      } catch (err: any) {
        setError(errorToString(err));
        console.error("withdraw error:", err);
        throw err;
      } finally { setLoading(false); }
    },
    [userAddress, sendMetaTx],
  );

  return { stake, withdraw, loading, error, txHash, claimState,
    needsApproval: false, approveVSP: async () => {} };
}
