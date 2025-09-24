export async function fetchOrderBook(symbol: string) {
  const res = await fetch(
    `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=5`,
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to fetch order book: ${res.status} ${body}`);
  }
  const json = (await res.json()) as {
    bids: [string, string][];
    asks: [string, string][];
  };
  const [bestBidP, bestBidQ] = json.bids[0] || ["0", "0"];
  const [bestAskP, bestAskQ] = json.asks[0] || ["0", "0"];
  return {
    bid: [Number(bestBidP), Number(bestBidQ)] as [number, number],
    ask: [Number(bestAskP), Number(bestAskQ)] as [number, number],
  };
}

