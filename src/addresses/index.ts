// protocol/src/addresses/index.ts
// Canonical deployment addresses, loaded from JSON written by deploy.sh.
// Frontend consumes these via @verisphere/protocol.

import type { ContractAddresses } from "../types.js";
import fujiJson from "./fuji.json";

export const FUJI_ADDRESSES: ContractAddresses = fujiJson as ContractAddresses;
