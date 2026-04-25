/**
 * Meeting Distiller analyzer — same logic as apps/aurais/src/lib/meeting-distiller.ts,
 * stripped of Next.js specifics for this standalone MCP server.
 *
 * Note: the source file in the local monorepo clone (branch
 * pre-split-capture-20260418) was truncated mid-payload. The truncated tail of
 * this file (the closing `chain.append("briefing_assembled", { ... })` and the
 * `return { generatedAt, distilled, proofChain, tipHash, agent }`) was
 * reconstructed from the package's compiled `dist/lib/distiller.js` (which was
 * built before the corruption).
 */

import Anthropic from "@anthropic-ai/sdk";
import { ProofChain, hashText, deriveAgentIdentity, type ProofEvent, type AgentIdentity } from "@vorionsys/aurais-core";
import { MEETING_DISTILLER_IDENTITY } from "../identity.js";

export type ActionItem = {
  what: string;
  owner: string | null;
  due: string | null;
};

export type MeetingDistilled = {
  title: string;
  decisions: string[];
  actionItems: ActionItem[];
  followUps: string[];
  openQuestions: string[];
  risks: string[];
  participantsMentioned: string[];
};

export type MeetingResult = {
  generatedAt: string;
  distilled: MeetingDistilled;
  proofChain: ProofEvent[];
  tipHash: string;
  agent: AgentIdentity;
};

const SYSTEM = `You extract structured meeting outcomes from transcripts or notes.

Output ONLY valid JSON matching this schema:
{
  "title": "short inferred meeting title (max 80 chars)",
  "decisions": ["explicit decisions actually made in the meeting (max 10)"],
  "actionItems": [{"what": "the task", "owner": "person name or null", "due": "date/timeframe or null"}],
  "followUps": ["things someone said they'd follow up on (distinct from action items)"],
  "openQuestions": ["unresolved questions explicitly raised but not answered"],
  "risks": ["risks, concerns, or blockers mentioned (max 6)"],
  "participantsMentioned": ["unique participant names referenced"]
}

Strict rules:
- Only include items that are EXPLICITLY in the input. Do not infer or invent.
- If a field has no items, return an empty array (never null).
- Keep each string short — one sentence max.
- Do not editorialize. Do not summarize what wasn't said.`;

function safeParse(text: string): MeetingDistilled | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const p = JSON.parse(cleaned);
    if (
      typeof p.title === "string" &&
      Array.isArray(p.decisions) &&
      Array.isArray(p.actionItems) &&
      Array.isArray(p.followUps) &&
      Array.isArray(p.openQuestions) &&
      Array.isArray(p.risks) &&
      Array.isArray(p.participantsMentioned)
    ) {
      return {
        title: p.title.slice(0, 80),
        decisions: p.decisions.slice(0, 10).map((s: unknown) => String(s).slice(0, 300)),
        actionItems: p.actionItems.slice(0, 20).map((a: { what?: unknown; owner?: unknown; due?: unknown }) => ({
          what: String(a.what ?? "").slice(0, 300),
          owner: a.owner ? String(a.owner).slice(0, 80) : null,
          due: a.due ? String(a.due).slice(0, 80) : null,
        })),
        followUps: p.followUps.slice(0, 10).map((s: unknown) => String(s).slice(0, 300)),
        openQuestions: p.openQuestions.slice(0, 10).map((s: unknown) => String(s).slice(0, 300)),
        risks: p.risks.slice(0, 6).map((s: unknown) => String(s).slice(0, 300)),
        participantsMentioned: p.participantsMentioned.slice(0, 30).map((s: unknown) => String(s).slice(0, 80)),
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function distillMeeting(params: {
  transcript: string;
  anthropicApiKey: string;
  model?: string;
  requestMeta?: { clientHint?: string };
}): Promise<MeetingResult> {
  const model = params.model ?? "claude-sonnet-4-5";
  const client = new Anthropic({ apiKey: params.anthropicApiKey });
  const chain = new ProofChain();
  const agent = deriveAgentIdentity(MEETING_DISTILLER_IDENTITY);

  const transcriptHash = hashText(params.transcript);

  chain.append("session_started", {
    bot: agent.agentId,
    car_id: agent.carId,
    operation_id: agent.operationId,
    org_id: agent.orgId,
    deployment_id: agent.deploymentId,
    context_hash: agent.contextHash,
    tier: agent.currentTier,
    trust_ceiling: agent.trustCeiling,
    registration_status: agent.registrationStatus,
    risk_level: "READ",
    model,
    runtime: "mcp-stdio",
    client_hint: params.requestMeta?.clientHint ?? null,
    transcript_length_chars: params.transcript.length,
    transcript_hash: transcriptHash,
  });

  const before = Date.now();
  const resp = await client.messages.create({
    model,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [
      { role: "user", content: `Meeting transcript or notes:\n---\n${params.transcript}\n---\nRespond with JSON only.` },
    ],
  });
  const elapsedMs = Date.now() - before;

  const firstBlock = resp.content[0];
  const text = firstBlock && firstBlock.type === "text" ? firstBlock.text : "";
  let distilled = safeParse(text);
  if (!distilled) {
    distilled = {
      title: "(analysis could not be parsed)",
      decisions: [],
      actionItems: [],
      followUps: [],
      openQuestions: [],
      risks: [],
      participantsMentioned: [],
    };
  }

  chain.append("commentary_generated", {
    bot: agent.agentId,
    provider: "anthropic",
    model,
    transcript_hash: transcriptHash,
    result_hash: hashText(JSON.stringify(distilled)),
    elapsed_ms: elapsedMs,
    parsed_json_ok: safeParse(text) !== null,
  });

  chain.append("briefing_assembled", {
    bot: agent.agentId,
    decision_count: distilled.decisions.length,
    action_count: distilled.actionItems.length,
    risk_count: distilled.risks.length,
  });

  return {
    generatedAt: new Date().toISOString(),
    distilled,
    proofChain: chain.toJSON(),
    tipHash: chain.tipHash(),
    agent,
  };
}
