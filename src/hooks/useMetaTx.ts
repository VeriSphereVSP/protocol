// protocol/src/hooks/useMetaTx.ts
// Core meta-transaction hook. Signs EIP-712 typed data in the user's wallet,
// then submits via the app relay. No direct chain access.
import { useCallback } from "react";
import { useWalletClient, usePublicClient, useAccount } from "wagmi";
import type { Hex, Address } from "viem";
import { getAddresses } from "../addresses/index.js";
import { VSPTokenABI } from "../abis.js";
import { fetchNonce, submitRelay, signPermit } from "./relay.js";
import type { RelayResponse, PermitData } from "./types.js";

const API_BASE =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) || "/api";

// Domain is built dynamically in sendMetaTx using chain.id

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

      // Check forwarder VSP allowance — one-time approval if needed.
      // The forwarder deducts a relay fee on each meta-tx.
      // Users approve the forwarder once for a large amount (10K VSP).
      // This is safe: the forwarder is an audited contract that only
      // deducts the computed fee (0.5% of tx value, min 0.1 VSP).
      if (addresses.Forwarder) {
        const currentAllowance = await publicClient.readContract({
          address: addresses.VSPToken as Address,
          abi: VSPTokenABI,
          functionName: "allowance",
          args: [userAddress, addresses.Forwarder as Address],
        }) as bigint;

        // If allowance is below 10 VSP, prompt for one-time approval
        const MIN_ALLOWANCE = BigInt("10000000000000000000"); // 10 VSP
        const APPROVAL_AMOUNT = BigInt("10000000000000000000000"); // 10,000 VSP
        if (currentAllowance < MIN_ALLOWANCE) {
          window.dispatchEvent(new CustomEvent("verisphere:toast", {
            detail: { message: "One-time approval: allow Verisphere to collect relay fees", type: "info" }
          }));
          // Use approve() via direct contract call (not meta-tx, since we need
          // the forwarder allowance to USE the forwarder)
          const { request } = await publicClient.simulateContract({
            address: addresses.VSPToken as Address,
            abi: VSPTokenABI,
            functionName: "approve",
            args: [addresses.Forwarder as Address, APPROVAL_AMOUNT],
            account: userAddress,
          });
          await walletClient.writeContract(request);
          // Wait for approval to be mined
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      let feePermit: PermitData | undefined; // No longer used, kept for API compat


      window.dispatchEvent(new CustomEvent("verisphere:toast", { detail: { message: "Confirm transaction in wallet", type: "info" } }));
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
      return submitRelay(API_BASE, relayRequest, signature, options?.permit);
    },
    [walletClient, publicClient, chain],
  );

  return { sendMetaTx };
}
