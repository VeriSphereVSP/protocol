// protocol/src/hooks/useCreateLink.ts
// Create an evidence link between two claims via the relay.
// createLink(from, to, isChallenge): "from" provides evidence for/against "to".
// Approve is a direct wallet tx; createLink goes through the relay.

import { useState, useCallback } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { encodeFunctionData, type Address } from "viem";
import { FUJI_ADDRESSES } from "../addresses/index.js";
import { PostRegistryABI, VSPTokenABI } from "../abis.js";
import { useMetaTx } from "./useMetaTx.js";
import { fetchAllowance } from "./relay.js";
import type { RelayResponse } from "./types.js";

const POSTING_FEE = BigInt("1000000000000000000");
const MAX_APPROVAL = BigInt("1000000000000000000000");

export function useCreateLink(apiBase: string = "/api") {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { sendMetaTx } = useMetaTx(apiBase);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createLink = useCallback(
    async (
      fromPostId: number,
      toPostId: number,
      isChallenge: boolean,
    ): Promise<RelayResponse | null> => {
      if (!userAddress) {
        setError("Wallet not connected");
        return null;
      }
      setIsLoading(true);
      setError(null);
      try {
        // Check allowance via backend
        const allowance = await fetchAllowance(
          apiBase, userAddress, FUJI_ADDRESSES.PostRegistry,
        );
        if (allowance < POSTING_FEE) {
          // Approve via direct wallet tx (ERC-20 requires msg.sender = user)
          if (!walletClient || !publicClient) throw new Error("Wallet not connected");
          const hash = await walletClient.writeContract({
            address: FUJI_ADDRESSES.VSPToken as Address,
            abi: VSPTokenABI,
            functionName: "approve",
            args: [FUJI_ADDRESSES.PostRegistry as Address, MAX_APPROVAL],
          });
          await publicClient.waitForTransactionReceipt({ hash });
          await new Promise((r) => setTimeout(r, 3000));
        }

        const calldata = encodeFunctionData({
          abi: PostRegistryABI,
          functionName: "createLink",
          args: [
            BigInt(fromPostId),
            BigInt(toPostId),
            isChallenge,
          ],
        });
        return await sendMetaTx(
          FUJI_ADDRESSES.PostRegistry as Address,
          calldata,
          { gasLimit: 800_000 },
        );
      } catch (err: any) {
        setError(err?.message || "Failed to create link");
        console.error("createLink error:", err);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [userAddress, walletClient, publicClient, sendMetaTx, apiBase],
  );

  return { createLink, isLoading, error };
}
