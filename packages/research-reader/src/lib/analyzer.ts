import Anthropic from "@anthropic-ai/sdk";
import { ProofChain, hashText, deriveAgentIdentity, type ProofEvent, type AgentIdentity } from "@vorionsys/aurais-core";
import { RESEARCH_READER_IDENTITY } from "../identity.js";

export type KeyClaim = { claim: string; directQuote: string; confidence: "stated-as-fact" | "qualified" | "speculative" };
export type ReaderResult = {
  generatedAt: string;
  thesis: string; scope: string;
  keyClaims: KeyClaim[];
  counterpoints: string[];
  questionsSourceDoesNotAnswer: string[];
  methodologyNotes: string | null;
  readerNotes: string;
  proofChain: ProofEvent[]; tipHash: string; agent: AgentIdentity;
};

const SYSTEM = `You read a source text and extract a structured reading.

Output ONLY valid JSON:
{
  "thesis": "1-2 sentences on the source's main argument",
  "scope": "what the source covers and explicitly excludes (1-2 sentences)",
  "keyClaims": [{"claim": "short paraphrase", "directQuote": "verbatim passage from the source", "confidence": "stated-as-fact|qualified|speculative"}],
  "counterpoints": ["known counter-arguments or limitations (from general knowledge, marked as external)"],
  "questionsSourceDoesNotAnswer": ["things a critical reader wants to know the source doesn't address"],
  "methodologyNotes": "methods, sample size, limitations if research; else null",
  "readerNotes": "2-3 sentences on quality/rigor/clarity"
}

Strict rules:
- Every 'directQuote' MUST appear verbatim in the source. If you cannot find one, leave the claim out.
- 'counterpoints' are the ONLY field where you may use knowledge beyond the source. Mark each as external.
- Max 6 keyClaims, 5 counterpoints, 5 questions.`;

export async function readSource(params: {
  source: string; anthropicApiKey: string; model?: string;
  requestMeta?: { clientHint?: string; upstreamProof?: string; packageVersion?: string };
}): Promise<ReaderResult> {
  const model = params.model ?? "claude-sonnet-4-5";
  const client = new Anthropic({ apiKey: params.anthropicApiKey });
  const chain = new ProofChain();
  const agent = deriveAgentIdentity(RESEARCH_READER_IDENTITY);
  const sourceHash = hashText(params.source);

  chain.append("session_started", {
    bot: agent.agentId, car_id: agent.carId, operation_id: agent.operationId,
    org_id: agent.orgId, deployment_id: agent.deploymentId, context_hash: agent.contextHash,
    tier: agent.currentTier, trust_ceiling: agent.trustCeiling, registration_status: agent.registrationStatus,
    risk_level: "READ", model, runtime: "mcp-stdio", package_version: params.requestMeta?.packageVersion ?? null,
    client_hint: params.requestMeta?.clientHint ?? null, upstream_proof: params.requestMeta?.upstreamProof ?? null,
    source_length_chars: params.source.length, source_hash: sourceHash,
  });

  const before = Date.now();
  const resp = await client.messages.create({
    model, max_tokens: 2000, system: SYSTEM,
    messages: [{ role: "user", content: `Source:\n---\n${params.source}\n---\nRespond with JSON only.` }],
  });
  const elapsedMs = Date.now() - before;

  const first = resp.content[0];
  const text = first && first.type === "text" ? first.text : "";
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: Partial<ReaderResult> | null = null;
  try { parsed = JSON.parse(cleaned); } catch { /* fall through */ }

  let verifiedClaims: KeyClaim[] = [];
  let verifiedQuoteCount = 0;
  if (parsed && Array.isArray(parsed.keyClaims)) {
    verifiedClaims = (parsed.keyClaims as KeyClaim[]).slice(0, 6)
      .filter((c) => typeof c.claim === "string" && typeof c.directQuote === "string")
      .map((c) => {
        const verbatim = params.source.includes(c.directQuote);
        if (verbatim) verifiedQuoteCount++;
        return {
          claim: String(c.claim).slice(0, 300),
          directQuote: verbatim ? String(c.directQuote).slice(0, 600) : `(quote not found verbatim in source) ${String(c.directQuote).slice(0, 400)}`,
          confidence: c.confidence === "stated-as-fact" || c.confidence === "speculative" ? c.confidence : "qualified",
        };
      });
  }

  const result = parsed ? {
    thesis: String(parsed.thesis ?? "(could not parse)").slice(0, 500),
    scope: String(parsed.scope ?? "").slice(0, 400),
    keyClaims: verifiedClaims,
    counterpoints: Array.isArray(parsed.counterpoints) ? parsed.counterpoints.slice(0, 5).map((s: unknown) => String(s).slice(0, 300)) : [],
    questionsSourceDoesNotAnswer: Array.isArray(parsed.questionsSourceDoesNotAnswer) ? parsed.questionsSourceDoesNotAnswer.slice(0, 5).map((s: unknown) => String(s).slice(0, 300)) : [],
    methodologyNotes: typeof parsed.methodologyNotes === "string" ? parsed.methodologyNotes.slice(0, 800) : null,
    readerNotes: String(parsed.readerNotes ?? "").slice(0, 600),
  } : {
    thesis: "(could not parse reader JSON)", scope: "", keyClaims: [],
    counterpoints: [], questionsSourceDoesNotAnswer: [], methodologyNotes: null,
    readerNotes: "The model response did not match the expected JSON schema.",
  };

  chain.append("commentary_generated", {
    bot: agent.agentId, provider: "anthropic", model,
    source_hash: sourceHash, result_hash: hashText(JSON.stringify(result)),
    elapsed_ms: elapsedMs, claims_count: result.keyClaims.length,
    quotes_verbatim_verified: verifiedQuoteCount, parsed_json_ok: parsed !== null,
  });
  chain.append("briefing_assembled", {
    bot: agent.agentId, claims: result.keyClaims.length,
    counterpoints: result.counterpoints.length,
    unanswered_questions: result.questionsSourceDoesNotAnswer.length,
  });

  return {
    generatedAt: new Date().toISOString(), ...result,
    proofChain: chain.toJSON(), tipHash: chain.tipHash(), agent,
  };
}
