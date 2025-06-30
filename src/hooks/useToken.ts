import type { Network } from "@saberhq/solana-contrib";
import { mapSome } from "@saberhq/solana-contrib";
import type { TokenInfo } from "@saberhq/token-utils";
import { deserializeMint, networkToChainId, Token } from "@saberhq/token-utils";
import { useConnection } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import type { UseQueryOptions } from "@tanstack/react-query";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { FetchKeysFn } from "..";
import { fetchNullableWithSessionCache } from "..";
import { decodeMetadata, getMetadataAccount } from "../helpers/metadata";
import type { BatchedParsedAccountQueryKeys } from "../parsers";
import { useSail } from "../provider";
import { makeListMemoKey } from "../utils";
import { usePubkey } from "./usePubkey";

// const makeCertifiedTokenInfoURLCDN = (chainId: number, address: string) =>
//   `https://cdn.jsdelivr.net/gh/CLBExchange/certified-token-list/${chainId}/${address}.json`;

const makeCertifiedTokenInfoURL = (chainId: number, address: string) =>
  `https://raw.githubusercontent.com/CLBExchange/certified-token-list/master/${chainId}/${address}.json`;

const normalizeMint = (
  mint: PublicKey | null | undefined,
): PublicKey | null | undefined => {
  if (!mint) {
    return mint;
  }
  // default pubkey is treated as null
  if (mint.equals(PublicKey.default)) {
    return null;
  }
  return mint;
};

const makeCertifiedTokenQuery = (
  network: Network,
  address: string | null | undefined,
): UseQueryOptions<Token | null | undefined> => ({
  queryKey: ["sail/certifiedTokenInfo", network, address],
  queryFn: async ({ signal }): Promise<Token | null | undefined> => {
    if (address === null || address === undefined) {
      return address;
    }
    const chainId = networkToChainId(network);
    const info = await fetchNullableWithSessionCache<TokenInfo>(
      makeCertifiedTokenInfoURL(chainId, address),
      signal,
    );
    if (info === null) {
      return null;
    }
    return new Token(info);
  },
  // these should never be stale, since token mints are immutable (other than supply)
  staleTime: Infinity,
});

/**
 * Loads multiple tokens from the Certified Token List.
 * @param mint
 * @param network
 * @returns
 */
export const useCertifiedTokens = (
  mints: (string | null | undefined)[],
  network: Network = "mainnet-beta",
) => {
  return useQueries({
    queries: mints.map((mint) => makeCertifiedTokenQuery(network, mint)),
  });
};

/**
 * Loads a token from the Certified Token List.
 * @param mint
 * @param network
 * @returns
 */
export const useCertifiedToken = (
  mint: string | null | undefined,
  network: Network = "mainnet-beta",
) => {
  return useQuery(makeCertifiedTokenQuery(network, mint));
};

/**
 * Constructs a query to load a token from the Certified Token List, or from the blockchain if
 * it cannot be found.
 *
 * @returns Token query
 */
export const makeBatchedTokensQuery = ({
  network,
  addresses,
  fetchKeys,
}: {
  network: Network;
  addresses: BatchedParsedAccountQueryKeys;
  fetchKeys: FetchKeysFn;
}): UseQueryOptions<
  readonly (Token | null | undefined)[] | null | undefined
> => ({
  queryKey: [
    "sail/batchedTokens",
    network,
    ...(mapSome(addresses, (a) => a.map((address) => address?.toString())) ?? [
      addresses,
    ]),
  ],
  queryFn: async ({
    signal,
  }): Promise<readonly (Token | null | undefined)[] | null | undefined> => {
    const addressesToFetch: {
      key: PublicKey;
      index: number;
    }[] = [];

    if (!addresses) {
      return addresses;
    }

    const data = await Promise.all(
      addresses.map(async (address, i) => {
        if (address === null || address === undefined) {
          return address;
        }
        const chainId = networkToChainId(network);
        const info = await fetchNullableWithSessionCache<TokenInfo>(
          makeCertifiedTokenInfoURL(chainId, address.toString()),
          signal,
        );
        if (info !== null) {
          return new Token(info);
        }
        addressesToFetch.push({ key: address, index: i });
      }),
    );

    if (signal?.aborted) {
      throw new Error("Query aborted");
    }

    const tokenDatas = await fetchKeys(addressesToFetch.map((a) => a.key));
    tokenDatas.forEach((tokenData, i) => {
      const index = addressesToFetch[i]?.index;
      if (index === undefined) {
        return;
      }
      if (!tokenData || !tokenData.data) {
        data[index] = null;
        return;
      }
      const raw = tokenData.data.accountInfo.data;
      const parsed = deserializeMint(raw);
      const token = Token.fromMint(tokenData.data.accountId, parsed.decimals, {
        chainId: networkToChainId(network),
      });
      data[index] = token;
    });

    return data;
  },
  // these should never be stale, since token mints are immutable (other than supply)
  staleTime: Infinity,
});

const getTokenMetadataFromChain = async (
  connection: Connection,
  mint: PublicKey,
) => {
  try {
    const metadataAccount = await getMetadataAccount(mint.toString());
    const metadataAccountInfo = await connection.getAccountInfo(
      new PublicKey(metadataAccount),
    );
    console.log("metadata", metadataAccountInfo);

    // finally, decode metadata
    const data = decodeMetadata(metadataAccountInfo!.data);
    const info = await connection.getParsedAccountInfo(mint);

    const meta = (await (await fetch(data.data.uri)).json()) as {
      image: string;
    };
    const result = {
      ...data,
      ...meta,
      // @ts-expect-error ignore
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      decimals: info.value?.data.parsed.info.decimals, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    };
    console.log(result);
    return result;
  } catch (e) {
    console.error(e);
    return null;
  }
};

/**
 * Constructs a query to load a token from the Certified Token List, or from the blockchain if
 * it cannot be found.
 *
 * @returns Token query
 */
export const makeTokenQuery = ({
  network,
  address,
  fetchKeys,
  connection,
}: {
  network: Network;
  address: PublicKey | null | undefined;
  fetchKeys: FetchKeysFn;
  connection: Connection;
}): UseQueryOptions<Token | null | undefined> => ({
  queryKey: ["sail/tokenInfo", network, address?.toString()],
  queryFn: async ({ signal }): Promise<Token | null | undefined> => {
    if (address === null || address === undefined) {
      return address;
    }
    const chainId = networkToChainId(network);
    const info = await fetchNullableWithSessionCache<TokenInfo>(
      makeCertifiedTokenInfoURL(chainId, address.toString()),
      signal,
    );
    console.log('local working3')
    if (info !== null && info.logoURI) {
      return new Token(info);
    }
    const [tokenData] = await fetchKeys([address]);
    if (!tokenData) {
      return null;
    }

    if (!tokenData.data) {
      return tokenData.data;
    }

    // Try Saber LP Token list
    const lpTokenInfo = await fetchNullableWithSessionCache<
      Record<string, TokenInfo>
    >(
      "https://raw.githubusercontent.com/saberdao/lp-token-list-v2/refs/heads/main/token-list.json",
      signal,
    );
    console.log(lpTokenInfo);
    if (lpTokenInfo !== null && lpTokenInfo[address.toString()] !== undefined) {
      console.log("From JSON");
      return new Token(lpTokenInfo[address.toString()]!);
    }

    const metadata = await getTokenMetadataFromChain(connection, address);

    // Explicit override for BLZE because it's not in the token list and has no metadata
    if (address.toString() === "BLZE") {
      return new Token({
        address: address.toString(),
        name: "BLZE",
        symbol: "BLZE",
        decimals: 9,
        chainId: networkToChainId(network),
        logoURI: "https://solblaze.org/assets/blze.png",
      });
    }

    if (metadata) {
      return new Token({
        address: address.toString(),
        name: metadata.data.name,
        symbol: metadata.data.symbol,
        decimals: metadata.decimals as number,
        chainId: networkToChainId(network),
        logoURI: metadata.image,
      });
    }

    const raw = tokenData.data.accountInfo.data;
    const parsed = deserializeMint(raw);
    const token = Token.fromMint(address, parsed.decimals, {
      chainId: networkToChainId(network),
    });

    return token;
  },
  // these should never be stale, since token mints are immutable (other than supply)
  staleTime: Infinity,
});

const useNormalizedMints = (
  mints?: readonly (PublicKey | null | undefined)[] | null | undefined,
): (PublicKey | null | undefined)[] => {
  return useMemo(() => {
    return mints?.map(normalizeMint) ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [makeListMemoKey(mints)]);
};

/**
 * Uses and loads a series of mints as {@link Token}s.
 * @param mints
 * @returns
 */
export const useTokens = (
  mints?: (PublicKey | null | undefined)[],
  network: Network = "mainnet-beta",
) => {
  const { connection } = useConnection();
  const { fetchKeys } = useSail();
  const normalizedMints = useNormalizedMints(mints);
  return useQueries({
    queries: normalizedMints.map((mint) => {
      return makeTokenQuery({
        network,
        address: mint,
        fetchKeys,
        connection,
      });
    }),
  });
};

/**
 * Uses and loads a series of mints as {@link Token}s using a batched call.
 * @param mints
 * @returns
 */
export const useBatchedTokens = (
  mints: BatchedParsedAccountQueryKeys,
  network: Network = "mainnet-beta",
) => {
  const { fetchKeys } = useSail();
  const normalizedMints = useNormalizedMints(mints);
  return useQuery(
    makeBatchedTokensQuery({
      network,
      addresses: normalizedMints,
      fetchKeys,
    }),
  );
};

/**
 * Uses and loads a single token.
 *
 * @param mint
 * @returns
 */
export const useToken = (
  mintRaw?: PublicKey | string | null,
  network: Network = "mainnet-beta",
) => {
  const mint = usePubkey(mintRaw);
  const { fetchKeys } = useSail();
  const { connection } = useConnection();
  const normalizedMint = useMemo(() => mapSome(mint, normalizeMint), [mint]);
  return useQuery(
    makeTokenQuery({
      network,
      address: normalizedMint,
      fetchKeys,
      connection,
    }),
  );
};
