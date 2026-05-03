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
      // Uses ERC-2612 permit (no AVAX required) instead of direct approve().
      if (addresses.Forwarder) {
        const currentAllowance = await publicClient.readContract({
          address: addresses.VSPToken as Address,
          abi: VSPTokenABI,
          functionName: "allowance",
          args: [userAddress, addresses.Forwarder as Address],
        }) as bigint;

        const MIN_ALLOWANCE = BigInt("10000000000000000000"); // 10 VSP
        const APPROVAL_AMOUNT = BigInt("10000000000000000000000"); // 10,000 VSP
        if (currentAllowance < MIN_ALLOWANCE) {
          window.dispatchEvent(new CustomEvent("verisphere:toast", {
            detail: { message: "One-time approval: sign a permit to allow relay fees (no gas needed)", type: "info" }
          }));
          // Sign ERC-2612 permit granting forwarder allowance
          const permit = await signPermit({
            walletClient, publicClient,
            tokenAddress: addresses.VSPToken as Address,
            tokenName: "VeriSphere", tokenVersion: "1",
            spender: addresses.Forwarder as Address,
            value: APPROVAL_AMOUNT, chainId: chain.id,
          });
          // Execute permit via MM (no AVAX needed — MM pays gas)
          const execRes = await fetch(`${API_BASE}/mm/execute-permit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: addresses.VSPToken,
              owner: userAddress,
              spender: addresses.Forwarder,
              value: APPROVAL_AMOUNT.toString(),
              deadline: permit.deadline,
              v: permit.v,
              r: permit.r,
              s: permit.s,
            }),
          });
          if (!execRes.ok) {
            const err = await execRes.text();
            throw new Error(`Permit execution failed: ${err}`);
          }
          // Wait for permit to be mined
          await new Promise(r => setTimeout(r, 3000));
        }
      }


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
