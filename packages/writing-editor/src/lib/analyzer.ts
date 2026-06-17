import Anthropic from "@anthropic-ai/sdk";
import { ProofChain, hashText, deriveAgentIdentity, type ProofEvent, type AgentIdentity } from "@vorionsys/aurais-core";
import { WRITING_EDITOR_IDENTITY } from "../identity.js";

export type EditorSuggestion = {
  kind: "structural" | "clarity" | "repetition" | "tone" | "tightening";
  issue: string;
  exampleFromDraft: string | null;
  suggestionForAuthor: string;
};
export type EditorResult = {
  generatedAt: string;
  audience: string; targetTone: string;
  overallReadabilityNotes: string;
  structuralIssues: EditorSuggestion[];
  sentenceLevel: EditorSuggestion[];
  toneAudit: EditorSuggestion[];
  strengths: string[];
  proofChain: ProofEvent[]; tipHash: string; agent: AgentIdentity;
};

const SYSTEM = `You are a critique-only editor. You identify issues but you DO NOT rewrite.

Output ONLY valid JSON:
{
  "overallReadabilityNotes": "2-3 sentences",
  "structuralIssues": [{"kind": "structural", "issue": "...", "exampleFromDraft": "verbatim or null", "suggestionForAuthor": "directional"}],
  "sentenceLevel": [{"kind": "clarity|repetition|tightening", ...}],
  "toneAudit": [{"kind": "tone", ...}],
  "strengths": ["2-4 things the draft does well"]
}

Strict rules:
- NEVER produce a rewritten sentence. Suggestions are directional.
- exampleFromDraft must be verbatim if present, else null.
- Max 6 structural, 8 sentenceLevel, 4 toneAudit. Empty arrays are fine; don't pad.`;

export async function editDraft(params: {
  draft: string; audience: string; tone: string;
  anthropicApiKey: string; model?: string;
  requestMeta?: { clientHint?: string; upstreamProof?: string; packageVersion?: string };
}): Promise<EditorResult> {
  const model = params.model ?? "claude-sonnet-4-5";
  const client = new Anthropic({ apiKey: params.anthropicApiKey });
  const chain = new ProofChain();
  const agent = deriveAgentIdentity(WRITING_EDITOR_IDENTITY);
  const draftHash = hashText(params.draft);

  chain.append("session_started", {
    bot: agent.agentId, car_id: agent.carId, operation_id: agent.operationId,
    org_id: agent.orgId, deployment_id: agent.deploymentId, context_hash: agent.contextHash,
    tier: agent.currentTier, trust_ceiling: agent.trustCeiling, registration_status: agent.registrationStatus,
    risk_level: "READ", model, runtime: "mcp-stdio", package_version: params.requestMeta?.packageVersion ?? null,
    client_hint: params.requestMeta?.clientHint ?? null, upstream_proof: params.requestMeta?.upstreamProof ?? null,
    draft_length_chars: params.draft.length, draft_hash: draftHash,
    declared_audience: params.audience.slice(0, 160), declared_tone: params.tone.slice(0, 80),
  });

  const userMsg = `Audience: ${params.audience}\nTarget tone: ${params.tone}\n\nDraft:\n---\n${params.draft}\n---\nRespond with JSON only. Critique only, never rewrite.`;

  const before = Date.now();
  const resp = await client.messages.create({ model, max_tokens: 2500, system: SYSTEM, messages: [{ role: "user", content: userMsg }] });
  const elapsedMs = Date.now() - before;

  const first = resp.content[0];
  const text = first && first.type === "text" ? first.text : "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: Partial<EditorResult> | null = null;
  try { parsed = JSON.parse(cleaned); } catch { /* fall through */ }

  const normalize = (arr: unknown, max: number, allowedKinds: EditorSuggestion["kind"][]): EditorSuggestion[] => {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, max).map((s: Partial<EditorSuggestion>) => {
      const kind = s.kind && allowedKinds.includes(s.kind) ? s.kind : allowedKinds[0]!;
      const excerpt = typeof s.exampleFromDraft === "string" ? s.exampleFromDraft : null;
      const verbatim = excerpt !== null && params.draft.includes(excerpt);
      return {
        kind,
        issue: String(s.issue ?? "").slice(0, 400),
        exampleFromDraft: excerpt === null ? null : verbatim ? excerpt.slice(0, 400) : `(paraphrased, not verbatim) ${excerpt.slice(0, 300)}`,
        suggestionForAuthor: String(s.suggestionForAuthor ?? "").slice(0, 500),
      };
    });
  };

  const result = parsed ? {
    overallReadabilityNotes: String(parsed.overallReadabilityNotes ?? "").slice(0, 600),
    structuralIssues: normalize(parsed.structuralIssues, 6, ["structural"]),
    sentenceLevel: normalize(parsed.sentenceLevel, 8, ["clarity", "repetition", "tightening"]),
    toneAudit: normalize(parsed.toneAudit, 4, ["tone"]),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 4).map((s: unknown) => String(s).slice(0, 300)) : [],
  } : {
    overallReadabilityNotes: "(response could not be parsed)",
    structuralIssues: [], sentenceLevel: [], toneAudit: [], strengths: [],
  };

  chain.append("commentary_generated", {
    bot: agent.agentId, provider: "anthropic", model,
    draft_hash: draftHash, result_hash: hashText(JSON.stringify(result)),
    elapsed_ms: elapsedMs, structural_count: result.structuralIssues.length,
    sentence_count: result.sentenceLevel.length, tone_count: result.toneAudit.length,
    parsed_json_ok: parsed !== null,
  });
  chain.append("briefing_assembled", {
    bot: agent.agentId,
    total_suggestions: result.structuralIssues.length + result.sentenceLevel.length + result.toneAudit.length,
    strengths_noted: result.strengths.length,
  });

  return {
    generatedAt: new Date().toISOString(),
    audience: params.audience, targetTone: params.tone, ...result,
    proofChain: chain.toJSON(), tipHash: chain.tipHash(), agent,
  };
}
