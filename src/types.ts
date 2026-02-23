// protocol/src/types.ts
// Shared types for the VeriSphere protocol SDK.
// These are pure data types — no framework dependencies.

export type Address = `0x${string}`;

export type Post = {
  creator: Address;
  timestamp: bigint;
  contentType: number; // 0 = Claim, 1 = Link
  contentId: bigint;
  creationFee: bigint;
};

export type Link = {
  independentPostId: bigint;
  dependentPostId: bigint;
  isChallenge: boolean;
};

export type StakeSide = 0 | 1; // 0 = Support, 1 = Challenge

export type ContractAddresses = {
  Authority: Address;
  Forwarder: Address;
  VSPToken: Address;
  PostRegistry: Address;
  LinkGraph: Address;
  StakeEngine: Address;
  ScoreEngine: Address;
  ProtocolViews: Address;
};
