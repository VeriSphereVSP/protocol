// protocol/src/hooks/useMetaTx.ts
// Core meta-transaction hook. Signs EIP-712 typed data in the user's wallet,
// then submits via the app relay. No direct chain access.
import { useCallback } from "react";
import { useWalletClient } from "wagmi";
import type { Hex, Address } from "viem";
import { FUJI_ADDRESSES } from "../addresses/index.js";
import { fetchNonce, submitRelay } from "./relay.js";
import type { RelayResponse } from "./types.js";

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

export function useMetaTx(apiBase: string = "/api") {
  const { data: walletClient } = useWalletClient();

  const sendMetaTx = useCallback(
    async (
      targetContract: Address,
      calldata: Hex,
      options?: { gasLimit?: number; value?: number },
    ): Promise<RelayResponse> => {
      if (!walletClient) throw new Error("Wallet not connected");

      const userAddress = walletClient.account.address;
      const nonce = await fetchNonce(apiBase, userAddress);
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const value = options?.value ?? 0;
      const gas = options?.gasLimit ?? 500_000;

      // BigInt version for EIP-712 signing (viem requires bigint for uint256)
      const forwardRequest = {
        from: userAddress,
        to: targetContract,
        value: BigInt(value),
        gas: BigInt(gas),
        nonce: BigInt(nonce),
        deadline,
        data: calldata,
      };

      // Only client-side crypto: sign the EIP-712 typed data
      const signature = await walletClient.signTypedData({
        domain: FORWARDER_DOMAIN,
        types: FORWARD_REQUEST_TYPES,
        primaryType: "ForwardRequest",
        message: forwardRequest,
      });

      // Number version for JSON serialization (BigInt can't be stringified)
      const relayRequest = {
        from: userAddress,
        to: targetContract,
        value,
        gas,
        nonce,
        deadline,
        data: calldata,
      };

      return submitRelay(apiBase, relayRequest, signature);
    },
    [walletClient, apiBase],
  );

  return { sendMetaTx };
}
