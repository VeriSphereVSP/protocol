// protocol/src/hooks/useMetaTx.ts
// Core meta-transaction hook. Signs EIP-712 typed data in the user's wallet,
// then submits via the app relay. No direct chain access.
import { useCallback } from "react";
import { useWalletClient } from "wagmi";
import type { Hex, Address } from "viem";
import { FUJI_ADDRESSES } from "../addresses/index.js";
import { fetchNonce, submitRelay } from "./relay.js";
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

  const sendMetaTx = useCallback(
    async (
      targetContract: Address,
      calldata: Hex,
      options?: { gasLimit?: number; value?: number; permit?: PermitData },
    ): Promise<RelayResponse> => {
      if (!walletClient) throw new Error("Wallet not connected");

      const userAddress = walletClient.account.address;
      const nonce = await fetchNonce(API_BASE, userAddress);
      const deadline = Math.floor(Date.now() / 1000) + 300;

      const forwardRequest = {
        from: userAddress,
        to: targetContract,
        value: BigInt(options?.value ?? 0),
        gas: BigInt(options?.gasLimit ?? 500_000),
        nonce: BigInt(nonce),
        deadline,
        data: calldata,
      };

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
      return submitRelay(API_BASE, relayRequest, signature, options?.permit);
    },
    [walletClient],
  );

  return { sendMetaTx };
}
