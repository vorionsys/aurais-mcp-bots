import type { OHLC } from "./indicators.js";

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";

export type FetchError = { ticker: string; error: string };
export function isFetchError(x: unknown): x is FetchError {
  return typeof x === "object" && x !== null && "error" in x && "ticker" in x;
}

type YahooChartResponse = {
  chart: {
    result: [{
      timestamp: number[];
      indicators: { quote: [{ close: (number | null)[]; volume: (number | null)[] }]; adjclose?: [{ adjclose: (number | null)[] }] };
    }] | null;
    error: { code: string; description: string } | null;
  };
};

export async function fetchDaily(ticker: string): Promise<OHLC[] | FetchError> {
  const url = `${YAHOO}/${encodeURIComponent(ticker)}?interval=1d&range=6mo`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AuraisBot/1.0; +https://aurais.net)" },
    });
  } catch (e) { return { ticker, error: `network: ${(e as Error).message}` }; }
  if (!res.ok) return { ticker, error: `http ${res.status}` };

  let data: YahooChartResponse;
  try { data = (await res.json()) as YahooChartResponse; }
  catch (e) { return { ticker, error: `json parse: ${(e as Error).message}` }; }
  if (data.chart.error) return { ticker, error: `yahoo: ${data.chart.error.description}` };

  const r = data.chart.result?.[0];
  if (!r) return { ticker, error: "no result" };
  const ts = r.timestamp ?? [];
  const q = r.indicators.quote[0]!;
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? q.close;
  const vols = q.volume;

  const series: OHLC[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i], v = vols[i];
    if (c == null || v == null) continue;
    series.push({ date: new Date(ts[i]! * 1000).toISOString().slice(0, 10), close: c, volume: v });
  }
  if (series.length < 50) return { ticker, error: `insufficient data (${series.length} bars)` };
  return series;
}
