import Anthropic from "@anthropic-ai/sdk";
import { ProofChain, hashJSON, hashText, deriveAgentIdentity, type ProofEvent, type AgentIdentity } from "@vorionsys/aurais-core";
import { buildSnapshot, type OHLC, type Snapshot } from "./indicators.js";
import { fetchDaily, isFetchError } from "./market-data.js";
import { MARKET_SCOUT_IDENTITY } from "../identity.js";

export type BriefingItem =
  | { ticker: string; ok: true; snapshot: Snapshot; commentary: string }
  | { ticker: string; ok: false; error: string };

export type BriefingResult = {
  generatedAt: string;
  spyReturn20d: number | null;
  items: BriefingItem[];
  aggregate: { overbought: number; oversold: number; uptrend: number; downtrend: number };
  proofChain: ProofEvent[];
  tipHash: string;
  agent: AgentIdentity;
};

const COMMENTARY_PROMPT = `You are a markets analyst. Given computed indicators, write ONE paragraph (3-5 sentences) for a retail investor.

Strict rules:
- State only what the numbers indicate. Do not forecast. Do not recommend buy/sell.
- Cite specific indicator values.
- If signals conflict, say so.
- End with one risk to watch.
- No exclamation marks. No hype words.

Ticker: {ticker}
Last: \${last} ({changePct}% today)
RSI(14): {rsi14}
MACD: {macd} / signal {macdSignal} / hist {macdHist}
SMA20: {sma20}  SMA50: {sma50}
20-day return: {return20d}%
Volume ratio (today/20d avg): {volRatio}x
Relative strength vs SPY 20d: {relStrength20d}pp
Signals: {signalsStr}
`;

function fillPrompt(snap: Snapshot): string {
  const map: Record<string, string> = {
    ticker: snap.ticker, last: snap.last.toString(), changePct: snap.changePct.toFixed(2),
    rsi14: snap.rsi14.toString(), macd: snap.macd.toString(), macdSignal: snap.macdSignal.toString(), macdHist: snap.macdHist.toString(),
    sma20: snap.sma20.toString(), sma50: snap.sma50.toString(),
    return20d: snap.return20d?.toString() ?? "(n/a)",
    volRatio: snap.volRatio?.toString() ?? "(n/a)",
    relStrength20d: snap.relStrength20d?.toString() ?? "(n/a)",
    signalsStr: snap.signals.join(", ") || "none",
  };
  return COMMENTARY_PROMPT.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? "");
}

async function commentary(client: Anthropic, snap: Snapshot, model: string): Promise<string> {
  const resp = await client.messages.create({ model, max_tokens: 600, messages: [{ role: "user", content: fillPrompt(snap) }] });
  const b = resp.content[0];
  return b && b.type === "text" ? b.text.trim() : "(no commentary generated)";
}

export async function generateBriefing(params: {
  tickers: string[]; anthropicApiKey: string; model?: string;
  requestMeta?: { clientHint?: string };
}): Promise<BriefingResult> {
  const model = params.model ?? "claude-sonnet-4-5";
  const client = new Anthropic({ apiKey: params.anthropicApiKey });
  const chain = new ProofChain();
  const agent = deriveAgentIdentity(MARKET_SCOUT_IDENTITY);

  chain.append("session_started", {
    bot: agent.agentId, car_id: agent.carId, operation_id: agent.operationId,
    org_id: agent.orgId, deployment_id: agent.deploymentId, context_hash: agent.contextHash,
    tier: agent.currentTier, trust_ceiling: agent.trustCeiling, registration_status: agent.registrationStatus,
    risk_level: "READ", model, runtime: "mcp-stdio", client_hint: params.requestMeta?.clientHint ?? null,
    tickers: params.tickers, ticker_count: params.tickers.length,
  });

  let spyReturn20d: number | null = null;
  const spy = await fetchDaily("SPY");
  if (!isFetchError(spy)) {
    const last = spy[spy.length - 1]!.close;
    const then = spy[spy.length - 21]?.close ?? last;
    spyReturn20d = ((last - then) / then) * 100;
    chain.append("market_data_fetched", {
      ticker: "SPY", source: "finance.yahoo.com", bars: spy.length,
      last_bar_date: spy[spy.length - 1]!.date, data_hash: hashJSON(spy),
      benchmark_return_20d_pct: Math.round(spyReturn20d * 100) / 100,
    });
  }

  const fetched = await Promise.all(
    params.tickers.map(async (t) => ({ ticker: t, data: await fetchDaily(t) })),
  );

  const items: BriefingItem[] = [];
  const agg = { overbought: 0, oversold: 0, uptrend: 0, downtrend: 0 };

  for (const { ticker, data } of fetched) {
    if (isFetchError(data)) {
      chain.append("market_data_fetched", { ticker, source: "finance.yahoo.com", error: data.error });
      items.push({ ticker, ok: false, error: data.error });
      continue;
    }
    chain.append("market_data_fetched", {
      ticker, source: "finance.yahoo.com", bars: data.length,
      last_bar_date: data[data.length - 1]!.date, data_hash: hashJSON(data),
    });
    const snap = buildSnapshot(ticker, data as OHLC[], spyReturn20d);
    if (snap.rsi14 >= 70) agg.overbought++;
    if (snap.rsi14 <= 30) agg.oversold++;
    if (snap.signals.some((s) => s.includes("uptrend structure"))) agg.uptrend++;
    if (snap.signals.some((s) => s.includes("downtrend structure"))) agg.downtrend++;

    chain.append("indicators_computed", {
      ticker, input_hash: hashJSON(data), snapshot_hash: hashJSON(snap),
      signals: snap.signals, rsi14: snap.rsi14, macd_hist: snap.macdHist,
    });
    try {
      const before = Date.now();
      const text = await commentary(client, snap, model);
      chain.append("commentary_generated", {
        ticker, provider: "anthropic", model,
        snapshot_hash: hashJSON(snap), commentary_hash: hashText(text),
        elapsed_ms: Date.now() - before,
      });
      items.push({ ticker, ok: true, snapshot: snap, commentary: text });
    } catch (e) {
      const err = (e as Error).message.slice(0, 120);
      chain.append("commentary_generated", { ticker, model, error: err });
      items.push({ ticker, ok: false, error: `LLM: ${err}` });
    }
  }

  chain.append("briefing_assembled", {
    total: items.length,
    successful: items.filter((i) => i.ok).length,
    failed: items.filter((i) => !i.ok).length,
    aggregate: agg,
  });

  return {
    generatedAt: new Date().toISOString(),
    spyReturn20d: spyReturn20d !== null ? Math.round(spyReturn20d * 100) / 100 : null,
    items, aggregate: agg,
    proofChain: chain.toJSON(), tipHash: chain.tipHash(), agent,
  };
}
