export type OHLC = { date: string; close: number; volume: number };

export function rsi(series: OHLC[], period = 14): number {
  if (series.length < period + 1) return NaN;
  let g = 0, l = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const d = series[i]!.close - series[i - 1]!.close;
    if (d > 0) g += d; else l += -d;
  }
  const avgG = g / period, avgL = l / period;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function emaSeries(values: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const out: number[] = new Array(values.length);
  out[0] = values[0]!;
  for (let i = 1; i < values.length; i++) out[i] = values[i]! * k + out[i - 1]! * (1 - k);
  return out;
}

export type MacdResult = { macd: number; signal: number; hist: number; crossedUpToday: boolean; crossedDownToday: boolean };

export function macd(series: OHLC[], fast = 12, slow = 26, signal = 9): MacdResult {
  const closes = series.map((s) => s.close);
  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const m = ef.map((v, i) => v - es[i]!);
  const sig = emaSeries(m, signal);
  const h = m.map((x, i) => x - sig[i]!);
  const n = series.length - 1;
  return { macd: m[n]!, signal: sig[n]!, hist: h[n]!, crossedUpToday: h[n]! > 0 && h[n - 1]! <= 0, crossedDownToday: h[n]! < 0 && h[n - 1]! >= 0 };
}

export function sma(series: OHLC[], period: number): number {
  if (series.length < period) return NaN;
  let s = 0;
  for (let i = series.length - period; i < series.length; i++) s += series[i]!.close;
  return s / period;
}

export function volumeAvg(series: OHLC[], period: number): number {
  if (series.length < period) return NaN;
  let s = 0;
  for (let i = series.length - period; i < series.length; i++) s += series[i]!.volume;
  return s / period;
}

export function pctChange(series: OHLC[], days: number): number {
  if (series.length <= days) return NaN;
  const then = series[series.length - days - 1]!.close;
  const now = series[series.length - 1]!.close;
  return ((now - then) / then) * 100;
}

export type Snapshot = {
  ticker: string; last: number; changePct: number; rsi14: number;
  macd: number; macdSignal: number; macdHist: number; sma20: number; sma50: number;
  return20d: number | null; volRatio: number | null; relStrength20d: number | null;
  signals: string[];
};

function round(n: number, d: number): number {
  if (!isFinite(n)) return n;
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

export function buildSnapshot(ticker: string, series: OHLC[], spyReturn20d: number | null): Snapshot {
  const last = series[series.length - 1]!.close;
  const prev = series[series.length - 2]!.close;
  const changePct = ((last - prev) / prev) * 100;
  const m = macd(series);
  const r = rsi(series);
  const s20 = sma(series, 20);
  const s50 = sma(series, 50);
  const return20d = pctChange(series, 20);
  const volToday = series[series.length - 1]!.volume;
  const volAvg20 = volumeAvg(series, 20);
  const volRatio = volAvg20 > 0 ? volToday / volAvg20 : null;
  const relStrength20d = spyReturn20d !== null && isFinite(return20d) && ticker !== "SPY" ? return20d - spyReturn20d : null;

  const signals: string[] = [];
  if (r >= 70) signals.push(`RSI ${r.toFixed(0)} overbought`);
  else if (r <= 30) signals.push(`RSI ${r.toFixed(0)} oversold`);
  if (m.crossedUpToday) signals.push("MACD crossed above signal today");
  if (m.crossedDownToday) signals.push("MACD crossed below signal today");
  if (last > s20 && s20 > s50) signals.push("price above 20SMA above 50SMA (uptrend structure)");
  else if (last < s20 && s20 < s50) signals.push("price below 20SMA below 50SMA (downtrend structure)");
  if (volRatio !== null) {
    if (volRatio >= 2) signals.push(`volume ${volRatio.toFixed(1)}x 20-day avg (unusual)`);
    else if (volRatio <= 0.5) signals.push(`volume ${volRatio.toFixed(1)}x 20-day avg (very light)`);
  }
  if (relStrength20d !== null) {
    if (relStrength20d >= 5) signals.push(`outperforming SPY by ${relStrength20d.toFixed(1)}pp over 20d`);
    else if (relStrength20d <= -5) signals.push(`underperforming SPY by ${relStrength20d.toFixed(1)}pp over 20d`);
  }

  return {
    ticker, last: round(last, 2), changePct: round(changePct, 2), rsi14: round(r, 1),
    macd: round(m.macd, 3), macdSignal: round(m.signal, 3), macdHist: round(m.hist, 3),
    sma20: round(s20, 2), sma50: round(s50, 2),
    return20d: isFinite(return20d) ? round(return20d, 2) : null,
    volRatio: volRatio !== null ? round(volRatio, 2) : null,
    relStrength20d: relStrength20d !== null ? round(relStrength20d, 2) : null,
    signals,
  };
}
