#!/usr/bin/env npx tsx
/**
 * Standalone Provider Certification Script (Phase 18)
 * Verifies live or mock behavior for all 10 Anvil model providers across 5 criteria:
 *   1. Streaming text (text_delta events)
 *   2. Tool call round-trip (tool_call_start -> tool_call_end -> tool_result)
 *   3. Multi-turn context memory (3 turns retaining initial context)
 *   4. Deterministic error path (clean error on invalid model, no crash)
 *   5. Rate-limit & circuit-breaker handling
 *
 * Usage:
 *   npx tsx scripts/certify-provider.ts --provider gemini
 *   npx tsx scripts/certify-provider.ts --all
 *   npx tsx scripts/certify-provider.ts --mock --all
 *   ANTHROPIC_API_KEY=... npx tsx scripts/certify-provider.ts --provider anthropic
 *   npx tsx scripts/certify-provider.ts --all --out ./cert-matrix.json
 */

import {
  createProviders,
  createMockCertificationProvider,
  certifyProvider,
  getErrorMessage,
  PROVIDER_CERT_MODELS,
  resolveCertificationCredentials,
  type ProviderId,
  type ModelProvider,
  type ProviderCertificationResult,
  type TestCriterion,
  type CriterionResult,
} from "../packages/core/src/index.js";

const ALL_PROVIDERS: ProviderId[] = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "orcarouter",
  "groq",
  "cerebras",
  "github",
  "mistral",
  "ollama",
];

function parseArgs(args: string[]) {
  let providerArg: string | undefined;
  let all = false;
  let mock = false;
  let json = false;
  let verbose = false;
  let model: string | undefined;
  let timeoutMs = 35_000;
  let out: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--all") all = true;
    else if (a === "--mock") mock = true;
    else if (a === "--json") json = true;
    else if (a === "--verbose") verbose = true;
    else if (a === "--provider" && i + 1 < args.length) {
      providerArg = args[++i];
    } else if (a === "--model" && i + 1 < args.length) {
      model = args[++i];
    } else if (a === "--timeout" && i + 1 < args.length) {
      timeoutMs = parseInt(args[++i], 10) || 35_000;
    } else if (a === "--out" && i + 1 < args.length) {
      out = args[++i];
    }
  }

  return { providerArg, all, mock, json, verbose, model, timeoutMs, out };
}

const CRITERION_LABELS: Record<TestCriterion, string> = {
  streaming: "1. Streaming Text",
  toolCalls: "2. Tool Calling Round-Trip",
  multiTurn: "3. Multi-Turn Context (3 turns)",
  errorPath: "4. Deterministic Error Path (404)",
  rateLimit: "5. Rate-Limit & Circuit-Breaker",
};

async function main() {
  const { providerArg, all, mock, json, verbose, model: modelOverride, timeoutMs, out } = parseArgs(
    process.argv.slice(2)
  );

  let targetProviders: ProviderId[] = [];
  if (providerArg) {
    if (!ALL_PROVIDERS.includes(providerArg as ProviderId)) {
      console.error(`Unknown provider: "${providerArg}". Valid providers: ${ALL_PROVIDERS.join(", ")}`);
      process.exit(1);
    }
    targetProviders = [providerArg as ProviderId];
  } else if (all) {
    targetProviders = [...ALL_PROVIDERS];
  } else {
    // Default to configured providers if not mock, or all providers if mock
    if (mock) {
      targetProviders = [...ALL_PROVIDERS];
    } else {
      const creds = resolveCertificationCredentials();
      const providers = createProviders(creds);
      targetProviders = ALL_PROVIDERS.filter((id) => providers[id]?.isConfigured());
      if (targetProviders.length === 0) {
        console.log("No configured providers found in ~/.anvil/credentials.json or environment.");
        console.log("Tip: Run with --mock to run full certification suite against mock adapters.");
        console.log("     Or set provider API keys via environment (e.g. GEMINI_API_KEY=...).");
        process.exit(0);
      }
    }
  }

  if (!json) {
    console.log("╔════════════════════════════════════════════════════════════════════╗");
    console.log("║               ANVIL PROVIDER CERTIFICATION SUITE                   ║");
    console.log("║                 Phase 18 Live / Mock Verification                  ║");
    console.log("╚════════════════════════════════════════════════════════════════════╝");
    console.log(`Mode: ${mock ? "Mock (Deterministic Offline)" : "Live (Real Provider Adapters)"}`);
    console.log(`Targets: ${targetProviders.join(", ")}\n`);
  }

  const creds = resolveCertificationCredentials();
  const realProviders = createProviders(creds);
  const results: Record<string, ProviderCertificationResult> = {};

  let totalPassed = 0;
  let totalTested = 0;

  for (const providerId of targetProviders) {
    const provider: ModelProvider = mock
      ? createMockCertificationProvider(providerId)
      : realProviders[providerId];

    const targetModel = modelOverride ?? PROVIDER_CERT_MODELS[providerId];

    if (!json) {
      console.log(`────────────────────────────────────────────────────────────────────`);
      console.log(`Provider: ${provider.displayName} (${providerId})`);
      console.log(`Model:    ${targetModel}`);
      console.log(`State:    ${provider.isConfigured() ? "Configured" : "Not Configured"}`);
    }

    if (!provider.isConfigured() && !mock) {
      if (!json) {
        console.log(`Result:   ⚠ UNTESTED (Missing API Key)`);
        console.log();
      }
      results[providerId] = {
        providerId,
        model: targetModel,
        status: "untested",
        passed: false,
        totalDurationMs: 0,
        criteria: {
          streaming: { passed: false, durationMs: 0 },
          toolCalls: { passed: false, durationMs: 0 },
          multiTurn: { passed: false, durationMs: 0 },
          errorPath: { passed: false, durationMs: 0 },
          rateLimit: { passed: false, durationMs: 0 },
        },
        error: "Missing API key",
      };
      continue;
    }

    totalTested++;

    const res = await certifyProvider(provider, {
      model: targetModel,
      timeoutMs,
      verbose,
      // Provenance: the registry records mock vs live so the badge can't claim
      // a real-provider pass that never happened.
      mock,
      onCriterionStart: (crit) => {
        if (!json && verbose) {
          process.stdout.write(`  • Running ${CRITERION_LABELS[crit]}... `);
        }
      },
      onCriterionComplete: (crit, cRes) => {
        if (!json) {
          const badge = cRes.passed ? "✓ PASS" : "✗ FAIL";
          const desc = cRes.details ?? cRes.error ?? "";
          console.log(`  [${badge}] ${CRITERION_LABELS[crit]} (${cRes.durationMs}ms) ${desc ? "- " + desc : ""}`);
        }
      },
    });

    results[providerId] = res;
    if (res.passed) totalPassed++;

    if (!json) {
      const statusBadge = res.passed ? (mock ? "✅ MOCK (Certified)" : "✅ LIVE (Certified)") : "❌ BROKEN";
      console.log(`Summary:  ${statusBadge} in ${res.totalDurationMs}ms\n`);
    }
  }

  // Persisted matrix: without this the certification result evaporated with
  // the process (only an in-memory registry mutation survived). The live-eval
  // lane uploads this file as its proof artifact.
  if (out) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const stamped = {
      certifiedAt: new Date().toISOString(),
      mode: mock ? "mock" : "live",
      totalPassed,
      totalTested,
      results,
    };
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(stamped, null, 2));
      if (!json) console.log(`Matrix written to ${out}`);
    } catch (err) {
      console.error(`Failed to write matrix to ${out}: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(totalPassed === totalTested ? 0 : 1);
  }

  // Summary Matrix
  console.log("════════════════════════════════════════════════════════════════════");
  console.log("                     CERTIFICATION MATRIX REPORT                    ");
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(
    "Provider".padEnd(14) +
    "Model".padEnd(28) +
    "Stream".padEnd(8) +
    "Tools".padEnd(8) +
    "Multi".padEnd(8) +
    "Err404".padEnd(8) +
    "RateLim".padEnd(8) +
    "Status"
  );
  console.log("─".repeat(90));

  for (const [id, r] of Object.entries(results)) {
    const stream = r.criteria.streaming.passed ? "✓" : "✗";
    const tools = r.criteria.toolCalls.passed ? "✓" : "✗";
    const multi = r.criteria.multiTurn.passed ? "✓" : "✗";
    const errPath = r.criteria.errorPath.passed ? "✓" : "✗";
    const rLim = r.criteria.rateLimit.passed ? "✓" : "✗";

    const badge =
      r.status === "live"
        ? "✅ live"
        : r.status === "broken"
        ? "❌ broken"
        : "⚠ untested";

    console.log(
      id.padEnd(14) +
      r.model.slice(0, 26).padEnd(28) +
      stream.padEnd(8) +
      tools.padEnd(8) +
      multi.padEnd(8) +
      errPath.padEnd(8) +
      rLim.padEnd(8) +
      badge
    );
  }

  console.log("─".repeat(90));
  console.log(`Passed: ${totalPassed}/${totalTested} configured providers certified live.`);
  console.log("════════════════════════════════════════════════════════════════════\n");

  if (totalTested > 0 && totalPassed < totalTested) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal certification error:", err);
  process.exit(1);
});
