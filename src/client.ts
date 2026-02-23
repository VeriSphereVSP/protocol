// protocol/src/client.ts
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import {
  PostRegistryABI,
  StakeEngineABI,
  LinkGraphABI,
  ProtocolViewsABI,
} from "./abis.js";
import type { ContractAddresses } from "./types.js"; // ← only new import

export type { ContractAddresses };

export type ProtocolClientOpts = {
  rpcUrl: string;
  privateKey?: string;
  addresses: ContractAddresses; // ← was `Addresses` (local type), now uses shared type
};

export class ProtocolClient {
  readonly provider: JsonRpcProvider;
  readonly signer?: Wallet;

  readonly postRegistry: Contract;
  readonly stakeEngine: Contract;
  readonly linkGraph: Contract;
  readonly protocolViews?: Contract;

  constructor(opts: ProtocolClientOpts) {
    this.provider = new JsonRpcProvider(opts.rpcUrl);

    if (opts.privateKey) {
      this.signer = new Wallet(opts.privateKey, this.provider);
    }

    const runner = this.signer ?? this.provider;

    // Field names match ContractAddresses keys
    this.postRegistry = new Contract(
      opts.addresses.PostRegistry,
      PostRegistryABI,
      runner,
    );
    this.stakeEngine = new Contract(
      opts.addresses.StakeEngine,
      StakeEngineABI,
      runner,
    );
    this.linkGraph = new Contract(
      opts.addresses.LinkGraph,
      LinkGraphABI,
      runner,
    );

    if (opts.addresses.ProtocolViews) {
      this.protocolViews = new Contract(
        opts.addresses.ProtocolViews,
        ProtocolViewsABI,
        runner,
      );
    }
  }

  // ─── Sponsored writes (require privateKey) ───────────────────────────────

  async createClaim(
    content: string,
  ): Promise<{ txHash: string; postId?: bigint }> {
    if (!this.signer) throw new Error("createClaim requires privateKey");

    const tx = await this.postRegistry.createClaim(content);
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((l: any) => {
        try {
          return this.postRegistry.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === "PostCreated");

    return { txHash: tx.hash, postId: event?.args?.postId };
  }

  async createLink(
    independentPostId: bigint,
    dependentPostId: bigint,
    isChallenge: boolean,
  ): Promise<{ txHash: string; postId?: bigint }> {
    if (!this.signer) throw new Error("createLink requires privateKey");

    const tx = await this.postRegistry.createLink(
      independentPostId,
      dependentPostId,
      isChallenge,
    );
    const receipt = await tx.wait();

    const event = receipt.logs
      .map((l: any) => {
        try {
          return this.postRegistry.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === "PostCreated");

    return { txHash: tx.hash, postId: event?.args?.postId };
  }

  async stake(
    postId: bigint,
    side: 0 | 1, // 0 = support, 1 = challenge
    amount: bigint, // in wei (18 decimals)
  ): Promise<{ txHash: string }> {
    if (!this.signer) throw new Error("stake requires privateKey");

    const tx = await this.stakeEngine.stake(postId, side, amount);
    await tx.wait();

    return { txHash: tx.hash };
  }

  // ─── Read methods ─────────────────────────────────────────────────────────

  async getPost(postId: bigint) {
    return this.postRegistry.getPost(postId);
  }

  async getClaim(claimId: bigint): Promise<string> {
    return this.postRegistry.getClaim(claimId);
  }

  async getNextPostId(): Promise<bigint> {
    return this.postRegistry.nextPostId();
  }
}
