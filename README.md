# VeriSphere Protocol (SDK)

TypeScript SDK for interacting with deployed VeriSphere core contracts.

## Build
```bash
npm install
npm run build
```

## Example
```ts
import { ProtocolClient } from "@verisphere/protocol";

const client = new ProtocolClient({
  rpcUrl: process.env.CORE_RPC_URL!,
  privateKey: process.env.CORE_PRIVATE_KEY!,
  addresses: {
    postRegistry: process.env.CORE_POST_REGISTRY!,
    stakeEngine: process.env.CORE_STAKE_ENGINE!,
    linkGraph: process.env.CORE_LINK_GRAPH!,
  }
});
await client.createClaim("This is a claim.");
```
