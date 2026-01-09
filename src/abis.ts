export const PostRegistryABI = [
  "function createPost(string content) returns (uint256 postId)",
  "function postCount() view returns (uint256)"
] as const;

export const StakeEngineABI = [
  "function stake(uint256 postId, uint8 side, uint256 amount)"
] as const;

export const LinkGraphABI = [
  "function link(uint256 fromId, uint256 toId, bool support) returns (bool)"
] as const;

export const ProtocolViewsABI = [
  "function registry() view returns (address)",
  "function stake() view returns (address)",
  "function graph() view returns (address)"
] as const;
