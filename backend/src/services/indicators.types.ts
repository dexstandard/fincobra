export interface TokenIndicators {
  ret1h: number;
  ret4h: number;
  ret24h: number;
  ret7d: number;
  ret30d: number;
  smaDist20: number;
  smaDist50: number;
  smaDist200: number;
  macdHist: number;
  volRv7d: number;
  volRv30d: number;
  volAtrPct: number;
  rangeBbBw: number;
  rangeDonchian20: number;
  volumeZ1h: number;
  volumeZ24h: number;
  corrBtc30d: number;
  regimeBtc: 'range' | 'trend';
  oscRsi14: number;
  oscStochK: number;
  oscStochD: number;
}

