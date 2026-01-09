import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { LinkGraphABI, PostRegistryABI, ProtocolViewsABI, StakeEngineABI } from "./abis.js";

export type Addresses = {
  postRegistry: string;
  stakeEngine: string;
  linkGraph: string;
  protocolViews?: string;
};

export type ProtocolClientOpts = {
  rpcUrl: string;
  privateKey?: string;
  addresses: Addresses;
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
    this.signer = opts.privateKey ? new Wallet(opts.privateKey, this.provider) : undefined;
    const runner = this.signer ?? this.provider;

    this.postRegistry = new Contract(opts.addresses.postRegistry, PostRegistryABI, runner);
    this.stakeEngine = new Contract(opts.addresses.stakeEngine, StakeEngineABI, runner);
    this.linkGraph = new Contract(opts.addresses.linkGraph, LinkGraphABI, runner);

    if (opts.addresses.protocolViews) {
      this.protocolViews = new Contract(opts.addresses.protocolViews, ProtocolViewsABI, runner);
    }
  }

  async createClaim(content: string): Promise<{ txHash: string }> {
    if (!this.signer) throw new Error("createClaim requires privateKey");
    const tx = await this.postRegistry.createPost(content);
    await tx.wait();
    return { txHash: tx.hash };
  }

  async stakeSupport(postId: bigint, amount: bigint): Promise<{ txHash: string }> {
    if (!this.signer) throw new Error("stakeSupport requires privateKey");
    const tx = await this.stakeEngine.stake(postId, 0, amount);
    await tx.wait();
    return { txHash: tx.hash };
  }

  async stakeChallenge(postId: bigint, amount: bigint): Promise<{ txHash: string }> {
    if (!this.signer) throw new Error("stakeChallenge requires privateKey");
    const tx = await this.stakeEngine.stake(postId, 1, amount);
    await tx.wait();
    return { txHash: tx.hash };
  }

  async linkSupport(fromId: bigint, toId: bigint): Promise<{ txHash: string }> {
    if (!this.signer) throw new Error("linkSupport requires privateKey");
    const tx = await this.linkGraph.link(fromId, toId, true);
    await tx.wait();
    return { txHash: tx.hash };
  }

  async linkChallenge(fromId: bigint, toId: bigint): Promise<{ txHash: string }> {
    if (!this.signer) throw new Error("linkChallenge requires privateKey");
    const tx = await this.linkGraph.link(fromId, toId, false);
    await tx.wait();
    return { txHash: tx.hash };
  }
}
