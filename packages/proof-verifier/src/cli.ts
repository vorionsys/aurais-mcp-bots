#!/usr/bin/env node
/**
 * aurais-verify — offline CLI for Aurais proof chains.
 *
 *   aurais-verify chain.json        # verify a file
 *   aurais-verify < chain.json      # verify from stdin
 *   some-bot | aurais-verify        # pipe a tool result straight in
 *   aurais-verify --json chain.json # machine-readable report, exit code = status
 *
 * Accepts either a bare proof-chain array or a full tool result object that
 * contains a `proofChain` field. Exit code 0 = verified, 1 = failed/invalid.
 */
import { readFileSync } from "node:fs";
import { verifyProofChainJSON, type VerifyReport } from "./index.js";

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function render(report: VerifyReport): string {
  const lines: string[] = [];
  const mark = (b: boolean) => (b ? "✓" : "✗");
  lines.push(report.ok ? "✓ PROOF CHAIN VERIFIED" : "✗ PROOF CHAIN FAILED");
  lines.push(`  events:  ${report.eventCount}`);
  lines.push(`  key:     ${report.keyId ?? "(none)"}`);
  if (report.keyId) {
    lines.push(
      report.ephemeralKey
        ? "           ⚠ ephemeral (session-scoped) key — proves integrity, NOT signer identity"
        : "           persistent key — integrity verified; confirm key ownership out of band",
    );
  }
  lines.push(`  tip:     ${report.tipHash || "(none)"}`);
  lines.push("");
  for (const e of report.events) {
    const flags = `sig ${mark(e.signatureValid)}  link ${mark(e.linkValid)}  seq ${mark(e.seqValid)}  key ${mark(e.keyConsistent)}`;
    lines.push(`  [${e.seq}] ${e.action.padEnd(22)} ${flags}`);
    for (const p of e.problems) lines.push(`        ↳ ${p}`);
  }
  if (report.problems.length) {
    lines.push("");
    for (const p of report.problems) lines.push(`  ! ${p}`);
  }
  return lines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const fileArg = args.find((a) => !a.startsWith("-"));

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(
      "aurais-verify — offline Aurais proof-chain verifier\n\n" +
        "Usage:\n" +
        "  aurais-verify <chain.json>     verify a file\n" +
        "  aurais-verify < chain.json     verify from stdin\n" +
        "  aurais-verify --json <file>    machine-readable report\n\n" +
        "Exit code: 0 = verified, 1 = failed or invalid input.\n",
    );
    process.exit(0);
  }

  const input = fileArg ? readFileSync(fileArg, "utf8") : readStdin();
  if (!input.trim()) {
    process.stderr.write("aurais-verify: no input (pass a file path or pipe JSON to stdin)\n");
    process.exit(1);
  }

  const report = verifyProofChainJSON(input);

  if (jsonOut) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(render(report) + "\n");
  }
  process.exit(report.ok ? 0 : 1);
}

main();
