// protocol/src/hooks/useMetaTx.ts
// Core meta-transaction hook. Signs EIP-712 typed data in the user's wallet,
// then submits via the app relay. No direct chain access.
import { useCallback } from "react";
import { useWalletClient, usePublicClient, useAccount } from "wagmi";
import type { Hex, Address } from "viem";
import { FUJI_ADDRESSES } from "../addresses/index.js";
import { VSPTokenABI } from "../abis.js";
import { fetchNonce, submitRelay, signPermit } from "./relay.js";
import type { RelayResponse, PermitData } from "./types.js";

const API_BASE =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) || "/api";

const FORWARDER_DOMAIN = {
  name: "VerisphereForwarder",
  version: "1",
  chainId: 43113,
  verifyingContract: FUJI_ADDRESSES.Forwarder as Address,
} as const;

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

      // Sign fee permit for the forwarder (relay fee allowance)
      // This is a small permit (e.g. 0.1 VSP) granting the forwarder
      // the ability to collect the relay fee via transferFrom.
      let feePermit: PermitData | undefined;
      if (FUJI_ADDRESSES.Forwarder) {
        try {
          // Check current allowance to forwarder
          const currentAllowance = await publicClient.readContract({
            address: FUJI_ADDRESSES.VSPToken as Address,
            abi: VSPTokenABI,
            functionName: "allowance",
            args: [userAddress, FUJI_ADDRESSES.Forwarder as Address],
          }) as bigint;

          // If allowance is low, sign a permit for a generous buffer
          const FEE_PERMIT_VALUE = BigInt("1000000000000000000"); // 1 VSP buffer for many txs
          if (currentAllowance < FEE_PERMIT_VALUE / 10n) {
            feePermit = await signPermit({
              walletClient,
              publicClient,
              tokenAddress: FUJI_ADDRESSES.VSPToken as Address,
              tokenName: "VeriSphere",
              tokenVersion: "1",
              spender: FUJI_ADDRESSES.Forwarder as Address,
              value: FEE_PERMIT_VALUE,
              chainId: chain.id,
            });
          }
        } catch (e) {
          // Fee permit failure is non-fatal — forwarder will try but may skip fee
          console.debug("Fee permit skipped:", e);
        }
      }

      window.dispatchEvent(new CustomEvent("verisphere:toast", { detail: { message: "Confirm transaction in wallet", type: "info" } }));
      const signature = await walletClient.signTypedData({
        domain: FORWARDER_DOMAIN,
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
      return submitRelay(API_BASE, relayRequest, signature, options?.permit, feePermit);
    },
    [walletClient, publicClient, chain],
  );

  return { sendMetaTx };
}
