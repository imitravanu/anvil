import {
  loadCustomProviders,
  saveCustomProvider,
  removeCustomProvider,
  testCustomProvider,
  type CustomProviderConfig,
  type CustomProviderProtocol,
  getErrorMessage,
} from "@anvil/core";

export function parseSubcommandFlags(args: string[]): {
  positionals: string[];
  flags: Record<string, string>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "1";
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags };
}

export function printProviderHelp(): void {
  console.log(`Anvil Provider Management

Usage:
  anvil provider list                     List configured custom providers
  anvil provider add <id> --url <url>     Add or update a custom provider
  anvil provider remove <id>              Remove a custom provider
  anvil provider test <id>                Probe connectivity and discover models

Options for 'add':
  --url <url>           Base URL of the provider endpoint (required)
  --name <name>         Display name for the provider
  --auth <bearer|none>  Authentication method (default: bearer if key provided, else none)
  --key <key>           API key (stored securely in ~/.anvil/provider-keys.json with mode 0600)
  --protocol <proto>    Wire protocol: openai-chat (default), openai-responses, anthropic
  --models <ids>        Comma-separated model IDs (optional; auto-discovered if omitted)
`);
}

export async function runProviderCommand(args: string[]): Promise<number> {
  const { positionals, flags } = parseSubcommandFlags(args);
  const action = positionals[0] || "list";

  if (action === "help" || flags.help) {
    printProviderHelp();
    return 0;
  }

  if (action === "list") {
    let providers: CustomProviderConfig[];
    try {
      providers = loadCustomProviders();
    } catch (err) {
      console.error(`Failed to load custom providers: ${getErrorMessage(err)}`);
      return 1;
    }

    if (providers.length === 0) {
      console.log("No custom providers configured.");
      console.log("Run `anvil provider add <id> --url <url>` or `anvil config` to configure one.");
      return 0;
    }

    console.log(`Custom Providers (${providers.length}):\n`);
    for (const p of providers) {
      const modelsDesc =
        p.models && p.models.length > 0
          ? `${p.models.map((m) => m.id).join(", ")} (${p.models.length} model${p.models.length > 1 ? "s" : ""})`
          : "dynamic / auto-discover";
      const authDesc =
        p.auth === "none"
          ? "none"
          : p.apiKeyEnv
            ? `env ($${p.apiKeyEnv})`
            : "bearer (stored key in provider-keys.json)";

      console.log(`  ${p.id}`);
      console.log(`    Name:     ${p.name}`);
      console.log(`    Base URL: ${p.baseUrl}`);
      console.log(`    Protocol: ${p.protocol ?? "openai-chat"}`);
      console.log(`    Auth:     ${authDesc}`);
      console.log(`    Models:   ${modelsDesc}\n`);
    }
    return 0;
  }

  if (action === "add") {
    const rawId = positionals[1];
    if (!rawId) {
      console.error("Missing provider ID. Usage: anvil provider add <id> --url <url> [options]");
      return 1;
    }

    const id: `custom:${string}` = rawId.startsWith("custom:")
      ? (rawId.toLowerCase() as `custom:${string}`)
      : (`custom:${rawId.toLowerCase()}` as `custom:${string}`);

    const url = flags.url ?? flags["base-url"];
    if (!url) {
      console.error("Missing required --url flag. Usage: anvil provider add <id> --url <url>");
      return 1;
    }

    const name = flags.name || rawId.replace(/^custom:/, "");
    const key = flags.key ?? flags["api-key"];
    const auth = (flags.auth as "bearer" | "none") ?? (key ? "bearer" : "none");
    const protocol = (flags.protocol as CustomProviderProtocol) || "openai-chat";

    let models: CustomProviderConfig["models"] | undefined = undefined;
    if (flags.models) {
      models = flags.models.split(",").map((m) => ({
        id: m.trim(),
        contextWindow: 128_000,
      }));
    }

    const config: CustomProviderConfig = {
      id,
      name,
      baseUrl: url,
      auth,
      protocol,
      ...(models ? { models } : {}),
    };

    try {
      saveCustomProvider(config, key);
      console.log(`✓ Configured custom provider "${id}" (${name})`);
    } catch (err) {
      console.error(`Failed to save custom provider: ${getErrorMessage(err)}`);
      return 1;
    }

    // Attempt model auto-discovery if models were not explicitly provided
    if (!models && (auth === "none" || key)) {
      try {
        const testRes = await testCustomProvider(config, key);
        if (testRes.ok && testRes.models.length > 0) {
          console.log(
            `  Auto-discovered ${testRes.models.length} model(s): ${testRes.models.slice(0, 5).join(", ")}${testRes.models.length > 5 ? ` (+${testRes.models.length - 5} more)` : ""}`
          );
        }
      } catch {
        // intentional: auto-discovery failure during provider add is advisory, not fatal
      }
    }

    return 0;
  }

  if (action === "remove") {
    const rawId = positionals[1];
    if (!rawId) {
      console.error("Missing provider ID. Usage: anvil provider remove <id>");
      return 1;
    }

    const id: `custom:${string}` = rawId.startsWith("custom:")
      ? (rawId.toLowerCase() as `custom:${string}`)
      : (`custom:${rawId.toLowerCase()}` as `custom:${string}`);

    try {
      removeCustomProvider(id);
      console.log(`✓ Removed custom provider "${id}"`);
      return 0;
    } catch (err) {
      console.error(`Failed to remove custom provider: ${getErrorMessage(err)}`);
      return 1;
    }
  }

  if (action === "test") {
    const rawId = positionals[1];
    if (!rawId) {
      console.error("Missing provider ID. Usage: anvil provider test <id>");
      return 1;
    }

    const id = rawId.startsWith("custom:") ? rawId.toLowerCase() : `custom:${rawId.toLowerCase()}`;
    const providers = loadCustomProviders();
    const config = providers.find((p) => p.id === id);

    if (!config) {
      console.error(`Provider "${id}" not found in ~/.anvil/providers.json.`);
      return 1;
    }

    const keyOverride = flags.key ?? flags["api-key"];
    console.log(`Testing custom provider "${config.id}" (${config.baseUrl})...`);

    const result = await testCustomProvider(config, keyOverride);
    if (result.ok) {
      console.log(`✓ Connectivity probe succeeded (${result.latencyMs}ms)`);
      console.log(`  Protocol: ${result.protocol}`);
      if (result.modelsCount > 0) {
        console.log(`  Discovered ${result.modelsCount} model(s):`);
        for (const m of result.models.slice(0, 10)) {
          console.log(`    - ${m}`);
        }
        if (result.modelsCount > 10) {
          console.log(`    ... and ${result.modelsCount - 10} more`);
        }
      } else {
        console.log("  No models returned from discovery endpoint (using fallback default).");
      }
      return 0;
    } else {
      console.error(`✗ Connectivity probe failed (${result.latencyMs}ms): ${result.error || "Unknown error"}`);
      return 1;
    }
  }

  console.error(`Unknown provider action: "${action}". See \`anvil provider --help\`.`);
  return 1;
}
