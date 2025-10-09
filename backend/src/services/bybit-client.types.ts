export interface BybitUserCreds {
  key: string;
  secret: string;
}

export interface BybitWalletCoinBalance {
  coin: string;
  equity?: string;
  walletBalance?: string;
  availableToWithdraw?: string;
  availableToTransfer?: string;
  availableToTrade?: string;
  unrealisedPnl?: string;
}

export interface BybitWalletBalance {
  accountType: string;
  totalEquity?: string;
  totalWalletBalance?: string;
  totalAvailableBalance?: string;
  totalMarginBalance?: string;
  coin: BybitWalletCoinBalance[];
}
