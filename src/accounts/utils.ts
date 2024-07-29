import type { PublicKey } from "@solana/web3.js";

/**
 * Gets the cache key associated with the given pubkey.
 * @param pubkey
 * @returns
 */
export const getCacheKeyOfPublicKey = (pubkey: PublicKey): string =>
  pubkey.toString();
