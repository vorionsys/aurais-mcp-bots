import Anthropic from "@anthropic-ai/sdk";
import { ProofChain, hashText, deriveAgentIdentity, type ProofEvent, type AgentIdentity } from "@vorionsys/aurais-core";
import { JOURNAL_COMPANION_IDENTITY } from "../identity.js";

export type JournalAnalysis = {
  moodScore: number;
  moodLabel: string;
  themes: string[];
  gratitude: string[];
  observationsOnPattern: string;
  gentleQuestion: string;
};

export type JournalResult = {
  generatedAt: string;
  analysis: JournalAnalysis;
  proofChain: ProofEvent[];
  tipHash: string;
  agent: AgentIdentity;
};

const SYSTEM = `You are a compassionate journal companion for a single entry review.

Your job: read the user's entry and return a STRUCTURED analysis (strict JSON schema). Avoid diagnosing or advising beyond a single gentle question.

SAFETY: If the entry mentions self-harm, suicidal ideation, or immediate danger, do not analyze. Return JSON: {"moodScore": 0, "moodLabel": "please-reach-out", "themes": ["I noticed something in what you wrote"], "gratitude": [], "observationsOnPattern": "If you are in crisis or at risk of harming yourself, please contact a crisis line now. U.S./Canada: 988. UK: 111. Internationally: findahelpline.com. You are not alone.", "gentleQuestion": "Will you reach out to someone right now — a friend, a family member, or a crisis line?"}

Output ONLY valid JSON:
{
  "moodScore": number (-5 to +5),
  "moodLabel": "one-or-two-word mood descriptor",
  "themes": ["2-5 short theme phrases"],
  "gratitude": ["0-3 items the writer expressed gratitude for"],
  "observationsOnPattern": "2-3 sentences, gentle, non-diagnostic",
  "gentleQuestion": "a single open question for tomorrow"
}`;

function safeParse(text: string): JournalAnalysis | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const p = JSON.parse(cleaned);
    if (typeof p.moodScore === "number" && typeof p.moodLabel === "string" && Array.isArray(p.themes) &&
        Array.isArray(p.gratitude) && typeof p.observationsOnPattern === "string" && typeof p.gentleQuestion === "string") {
      return {
        moodScore: Math.max(-5, Math.min(5, p.moodScore)),
        moodLabel: p.moodLabel.slice(0, 60),
        themes: p.themes.slice(0, 5).map((t: unknown) => String(t).slice(0, 120)),
        gratitude: p.gratitude.slice(0, 3).map((t: unknown) => String(t).slice(0, 200)),
        observationsOnPattern: p.observationsOnPattern.slice(0, 600),
        gentleQuestion: p.gentleQuestion.slice(0, 300),
      };
    }
  } catch { /* fall through */ }
  return null;
}

export async function analyzeJournal(params: {
  entry: string; anthropicApiKey: string; model?: string;
  requestMeta?: { clientHint?: string; upstreamProof?: string; packageVersion?: string };
}): Promise<JournalResult> {
  const model = params.model ?? "claude-sonnet-4-5";
  const client = new Anthropic({ apiKey: params.anthropicApiKey });
  const chain = new ProofChain();
  const agent = deriveAgentIdentity(JOURNAL_COMPANION_IDENTITY);
  const entryHash = hashText(params.entry);

  chain.append("session_started", {
    bot: agent.agentId, car_id: agent.carId, operation_id: agent.operationId,
    org_id: agent.orgId, deployment_id: agent.deploymentId, context_hash: agent.contextHash,
    tier: agent.currentTier, trust_ceiling: agent.trustCeiling, registration_status: agent.registrationStatus,
    risk_level: "READ", model, runtime: "mcp-stdio", package_version: params.requestMeta?.packageVersion ?? null,
    client_hint: params.requestMeta?.clientHint ?? null, upstream_proof: params.requestMeta?.upstreamProof ?? null,
    entry_length_chars: params.entry.length, entry_hash: entryHash,
  });

  const before = Date.now();
  const resp = await client.messages.create({
    model, max_tokens: 800, system: SYSTEM,
    messages: [{ role: "user", content: `Journal entry:\n---\n${params.entry}\n---\nRespond with JSON only.` }],
  });
  const elapsedMs = Date.now() - before;

  const first = resp.content[0];
  const text = first && first.type === "text" ? first.text : "";
  let analysis = safeParse(text);
  if (!analysis) {
    analysis = {
      moodScore: 0, moodLabel: "unread",
      themes: ["(analysis could not be parsed)"], gratitude: [],
      observationsOnPattern: "The model response did not match the expected JSON schema.",
      gentleQuestion: "Would you like to try again?",
    };
  }

  chain.append("commentary_generated", {
    bot: agent.agentId, provider: "anthropic", model,
    entry_hash: entryHash, analysis_hash: hashText(JSON.stringify(analysis)),
    elapsed_ms: elapsedMs, parsed_json_ok: safeParse(text) !== null,
  });
  chain.append("briefing_assembled", {
    bot: agent.agentId, mood_score: analysis.moodScore, theme_count: analysis.themes.length,
  });

  return {
    generatedAt: new Date().toISOString(),
    analysis,
    proofChain: chain.toJSON(),
    tipHash: chain.tipHash(),
    agent,
  };
}
