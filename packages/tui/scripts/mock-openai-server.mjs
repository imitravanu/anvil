// Mock OpenAI-compatible SSE server for capturing real Anvil UI frames.
// Listens on 127.0.0.1:8117, answers POST /v1/chat/completions with a
// scripted stream. Turn counter advances per request.
import http from "node:http";

const MD = `Here's what I found in \`src/index.ts\`:

## Summary
The module exports **three** functions:

1. \`boot()\` — starts the server
2. \`shutdown()\` — stops it gracefully
3. \`reload()\` — hot reloads config

\`\`\`ts
export function boot(port: number): Server {
  return createServer({ port, tls: true });
}
\`\`\`

> Note: \`reload()\` requires the config watcher to be enabled.

| Function | Async | Safe |
|---|---|---|
| boot | no | yes |
| shutdown | yes | yes |

Next I'll check the tests to be sure. `;

let turn = 0;

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    turn += 1;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    const id = "chatcmpl-mock";
    if (turn === 1) {
      // Rich markdown turn
      for (const chunk of MD.match(/[\s\S]{1,18}/g) ?? []) {
        sse(res, { id, choices: [{ delta: { content: chunk }, index: 0 }] });
      }
      sse(res, { id, choices: [{ delta: {}, index: 0, finish_reason: "stop" }], usage: { prompt_tokens: 1234, completion_tokens: 567 } });
    } else if (turn === 2) {
      // Tool-call turn (read-only tools — no permission prompt)
      sse(res, { id, choices: [{ delta: { content: "Let me look around first." }, index: 0 }] });
      sse(res, { id, choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "list_files", arguments: '{"path":"."}' } }] }, index: 0 }] });
      sse(res, { id, choices: [{ delta: { tool_calls: [{ index: 1, id: "t2", type: "function", function: { name: "grep", arguments: '{"pattern":"boot","path":"src"}' } }] }, index: 0 }] });
      sse(res, { id, choices: [{ delta: {}, index: 0, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2000, completion_tokens: 300 } });
    } else if (turn === 3) {
      // Answer after tool results (server never sees results; final turn)
      sse(res, { id, choices: [{ delta: { content: "All checks pass — the server boots cleanly with TLS enabled and every test is green." }, index: 0 }] });
      sse(res, { id, choices: [{ delta: {}, index: 0, finish_reason: "stop" }], usage: { prompt_tokens: 1500, completion_tokens: 80 } });
    } else {
      sse(res, { id, choices: [{ delta: { content: "(mock: no more scripted turns)" }, index: 0 }] });
      sse(res, { id, choices: [{ delta: {}, index: 0, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

server.listen(8117, "127.0.0.1", () => console.error("mock server on 127.0.0.1:8117"));
