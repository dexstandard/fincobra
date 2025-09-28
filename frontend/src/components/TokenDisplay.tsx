const ICONS: Record<string, string> = {
  BTC: '/tokens/bitcoin-btc-logo.svg',
  BNB: '/tokens/bnb-bnb-logo.svg',
  DOGE: '/tokens/dogecoin-doge-logo.svg',
  ETH: '/tokens/ethereum-eth-logo.svg',
  HBAR: '/tokens/hedera-hbar-logo.svg',
  PEPE: '/tokens/pepe-pepe-logo.svg',
  SHIB: '/tokens/shiba-inu-shib-logo.svg',
  SOL: '/tokens/solana-sol-logo.svg',
  TON: '/tokens/toncoin-ton-logo.svg',
  TRX: '/tokens/tron-trx-logo.svg',
  USDT: '/tokens/tether-usdt-logo.svg',
  USDC: '/tokens/usd-coin-usdc-logo.svg',
  XRP: '/tokens/xrp-xrp-logo.svg',
};

export default function TokenDisplay({
  token,
  className = '',
}: {
  token: string;
  className?: string;
}) {
  const symbol = token.toUpperCase();
  const src = ICONS[symbol];
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {src && <img src={src} alt={`${symbol} logo`} className="w-4 h-4" />}
      <span className="uppercase">{symbol}</span>
    </span>
  );
}
