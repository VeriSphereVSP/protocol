// protocol/src/hooks/useCreateLink.ts
import { useState, useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { encodeFunctionData, type Address } from "viem";
import { useMetaTx } from "./useMetaTx.js";
import { signPermit, fetchAllowance } from "./relay.js";
import { PostRegistryABI } from "../abis.js";
import { FUJI_ADDRESSES } from "../addresses/index.js";

const API_BASE =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) || "/api";

const POSTING_FEE = BigInt("1000000000000000000"); // 1 VSP
const PERMIT_VALUE = BigInt("10000000000000000000"); // 10 VSP buffer

export function useCreateLink() {
  const { address: userAddress, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { sendMetaTx } = useMetaTx();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getPermitIfNeeded = useCallback(
    async () => {
      if (!userAddress || !publicClient || !walletClient || !chain) return undefined;
      const currentAllowance = await fetchAllowance(
        API_BASE, userAddress, FUJI_ADDRESSES.PostRegistry,
      );
      if (currentAllowance >= POSTING_FEE) return undefined;
      return signPermit({
        walletClient, publicClient,
        tokenAddress: FUJI_ADDRESSES.VSPToken as Address,
        tokenName: "VeriSphere", tokenVersion: "1",
        spender: FUJI_ADDRESSES.PostRegistry as Address,
        value: PERMIT_VALUE, chainId: chain.id,
      });
    },
    [userAddress, publicClient, walletClient, chain],
  );

  const createLink = useCallback(
    async (fromPostId: number, toPostId: number, isChallenge: boolean): Promise<string | null> => {
      if (!userAddress || !publicClient) { setError("Wallet not connected"); return null; }
      setIsLoading(true); setError(null);
      try {
        const permit = await getPermitIfNeeded();
        const calldata = encodeFunctionData({
          abi: PostRegistryABI,
          functionName: "createLink",
          args: [BigInt(fromPostId), BigInt(toPostId), isChallenge],
        });
        const result = await sendMetaTx(
          FUJI_ADDRESSES.PostRegistry as Address, calldata,
          { gasLimit: 1_000_000, permit },
        );
        return result.tx_hash;
      } catch (err: any) {
        setError(err?.message || "Failed to create link");
        console.error("createLink error:", err);
        return null;
      } finally { setIsLoading(false); }
    },
    [userAddress, publicClient, sendMetaTx, getPermitIfNeeded],
  );

  return { createLink, isLoading, error };
}
