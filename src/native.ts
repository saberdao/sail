import type { Network } from "@saberhq/solana-contrib";
import { mapN } from "@saberhq/solana-contrib";
import { RAW_SOL, TokenAmount } from "@saberhq/token-utils";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import type { AccountInfo, PublicKey } from "@solana/web3.js";
import { useCallback, useMemo } from "react";

import type { AccountParser } from "./parsers/useParsedAccountsData";
import { useParsedAccountData } from "./parsers/useParsedAccountsData";

/**
 * Fetches the SOL balance of an account.
 * @returns
 */
export const useSOLBalance = (
  accountId?: PublicKey | null | undefined,
  network: Network = "mainnet-beta",
): TokenAmount | null | undefined => {
  const sol = RAW_SOL[network];
  const parser: AccountParser<TokenAmount> = useCallback(
    (data) => {
      return new TokenAmount(sol, data.accountInfo.lamports);
    },
    [sol],
  );
  const { data } = useParsedAccountData(accountId, parser);
  return useMemo(
    () => mapN((data) => new TokenAmount(sol, data.accountInfo.lamports), data),
    [data, sol],
  );
};

/**
 * Uses the data of the raw SOL account.
 * @deprecated use {@link useSOLBalance} instead
 * @returns
 */
export function useNativeAccount(network: Network = "mainnet-beta"): {
  account?: AccountInfo<TokenAmount> | null;
  nativeBalance?: TokenAmount | undefined;
  network?: Network;
} {
  const wallet = useAnchorWallet();
  const sol = RAW_SOL[network];
  const parser: AccountParser<TokenAmount> = useCallback(
    (data) => {
      return new TokenAmount(sol, data.accountInfo.lamports);
    },
    [sol],
  );
  const { data } = useParsedAccountData(wallet?.publicKey, parser);
  const balance = data?.accountInfo.lamports;

  return useMemo(() => {
    if (data === null) {
      return {
        account: null,
        nativeBalance: new TokenAmount(sol, 0),
      };
    }

    if (!data || wallet === null || balance === undefined) {
      return {
        account: data?.accountInfo,
        nativeBalance: undefined,
      };
    }

    return {
      account: data.accountInfo,
      nativeBalance: data.accountInfo.data,
    };
  }, [balance, data, sol, wallet]);
}
