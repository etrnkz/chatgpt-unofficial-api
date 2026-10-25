import assert from "assert";
import {
  ChatGPTWeb,
  ChatGPTApp,
  ChatGPTMobile,
  ChatGPT,
  createChatGPT,
  fnv1a,
  solvePow,
  buildConfig,
  encodeConfig,
  parseSSEBuffer,
  processSSEEvent,
  parseSSELine,
  MOBILE_BASE_URL,
  CODEX_REMOTE_WSS,
  REALTIME_VOICE_BASE,
} from "../src/index.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

console.log("\n=== 1. Core PoW & FNV-1a Tests ===");

test("fnv1a produces 8-char hex string", () => {
  const hash = fnv1a("test_seed_12345");
  assert.strictEqual(typeof hash, "string");
  assert.strictEqual(hash.length, 8);
  assert.match(hash, /^[0-9a-f]{8}$/);
});

test("fnv1a is deterministic", () => {
  const h1 = fnv1a("hello_openai_pow");
  const h2 = fnv1a("hello_openai_pow");
  assert.strictEqual(h1, h2);
});

test("buildConfig creates 18-element config array", () => {
  const cfg = buildConfig({ deviceId: "my-device-id" });
  assert.ok(Array.isArray(cfg));
  assert.strictEqual(cfg.length, 18);
  assert.strictEqual(cfg[0], 4880);
  assert.strictEqual(cfg[14], "my-device-id");
});

test("encodeConfig prefixes with gAAAAAC", () => {
  const cfg = buildConfig();
  const enc = encodeConfig(cfg);
  assert.ok(enc.startsWith("gAAAAAC"));
});

test("solvePow finds valid nonce under target difficulty", () => {
  const cfg = buildConfig();
  const solution = solvePow("0.123456789", "0fff", cfg, 100000);
  assert.ok(solution);
  assert.ok(solution.startsWith("gAAAAAB"));
  assert.ok(solution.endsWith("~S"));
});

console.log("\n=== 2. SSE Parser Tests ===");

test("parseSSELine filters non-data and [DONE]", () => {
  assert.strictEqual(parseSSELine("data: [DONE]"), null);
  assert.strictEqual(parseSSELine("event: ping"), null);
  const parsed = parseSSELine('data: {"v": "hello"}');
  assert.deepStrictEqual(parsed, { v: "hello" });
});

test("processSSEEvent handles streaming delta", () => {
  const state = { conversationId: null, messageId: null, contentDone: false };
  const evt = processSSEEvent({ v: "chunk1" }, state);
  assert.strictEqual(evt.text, "chunk1");
});

test("processSSEEvent handles buffered assistant parts (bug fix verified)", () => {
  const state = { conversationId: null, messageId: null, contentDone: false };
  const d = {
    v: {
      message: {
        author: { role: "assistant" },
        content: { parts: ["Full ", "buffered ", "response."] },
      },
    },
  };
  const evt = processSSEEvent(d, state);
  assert.strictEqual(evt.text, "Full buffered response.");
  assert.strictEqual(state.contentDone, true);
});

test("parseSSEBuffer accumulates full text and captures conversationId", () => {
  const raw = [
    'data: {"conversation_id": "conv-123", "message": {"id": "msg-456"}}',
    'data: {"v": "Hello "}',
    'data: {"v": "world!"}',
    'data: {"o": "replace", "p": "/message/status", "v": "finished_successfully"}',
    "data: [DONE]",
  ].join("\n");

  const res = parseSSEBuffer(raw);
  assert.strictEqual(res.content, "Hello world!");
  assert.strictEqual(res.conversationId, "conv-123");
  assert.strictEqual(res.messageId, "msg-456");
});

console.log("\n=== 3. Dual Architecture & Exports Tests ===");

test("ChatGPTWeb is exported with all methods", () => {
  const web = new ChatGPTWeb();
  assert.strictEqual(typeof web.init, "function");
  assert.strictEqual(typeof web.ask, "function");
  assert.strictEqual(typeof web.streamAsk, "function");
  assert.strictEqual(typeof web.getModels, "function");
  assert.strictEqual(typeof web.getVoices, "function");
  assert.strictEqual(typeof web.searchWeb, "function");
  assert.strictEqual(typeof web.askWithFiles, "function");
  assert.strictEqual(typeof web.getConversations, "function");
});

test("ChatGPTApp is exported with all mobile methods", () => {
  const app = new ChatGPTApp();
  assert.strictEqual(typeof app.init, "function");
  assert.strictEqual(typeof app.ask, "function");
  assert.strictEqual(typeof app.streamAsk, "function");
  assert.strictEqual(typeof app.getModels, "function");
  assert.strictEqual(typeof app.getChatRequirements, "function");
  assert.strictEqual(typeof app.getConduit, "function");
  assert.strictEqual(typeof app.getConversations, "function");
  assert.strictEqual(typeof app.getSettings, "function");
  assert.strictEqual(typeof app.getMemories, "function");
});

test("Aliases and Constants match reverse-engineered specifications", () => {
  assert.strictEqual(ChatGPT, ChatGPTWeb);
  assert.strictEqual(ChatGPTMobile, ChatGPTApp);
  assert.strictEqual(MOBILE_BASE_URL, "https://android.chat.openai.com");
  assert.strictEqual(CODEX_REMOTE_WSS, "wss://codex-cloud-backend.chatgpt.com/");
  assert.strictEqual(REALTIME_VOICE_BASE, "https://android.chat.openai.com/realtime/");
  assert.strictEqual(ChatGPTApp.CODEX_REMOTE_URL, CODEX_REMOTE_WSS);
  assert.strictEqual(ChatGPTApp.REALTIME_VOICE_URL, REALTIME_VOICE_BASE);
});

test("createChatGPT factory instantiates correct backend", () => {
  const web = createChatGPT();
  assert.ok(web instanceof ChatGPTWeb);

  const webExplicit = createChatGPT({ type: "web" });
  assert.ok(webExplicit instanceof ChatGPTWeb);

  const app = createChatGPT({ type: "app" });
  assert.ok(app instanceof ChatGPTApp);

  const mobile = createChatGPT({ type: "mobile" });
  assert.ok(mobile instanceof ChatGPTApp);
});

console.log("\n=== 4. Live Smoke Integration Tests ===");

await asyncTest("ChatGPTWeb live getVoices()", async () => {
  const web = new ChatGPTWeb();
  await web.init();
  const voices = await web.getVoices();
  assert.ok(Array.isArray(voices.voices));
  assert.ok(voices.voices.length >= 5);
});

await asyncTest("ChatGPTApp live getModels() from android.chat.openai.com", async () => {
  const app = new ChatGPTApp({ timeout: 15000 });
  await app.init();
  const catalog = await app.getModels();
  assert.ok(Array.isArray(catalog.models));
  assert.ok(catalog.models.length >= 3);
});

await asyncTest("ChatGPTApp live getChatRequirements() from android.chat.openai.com", async () => {
  const app = new ChatGPTApp({ timeout: 15000 });
  await app.init();
  const reqs = await app.getChatRequirements();
  assert.ok(typeof reqs.token === "string");
  assert.ok(reqs.token.length > 10);
});

console.log(`\n========================================`);
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

process.exit(failed > 0 ? 1 : 0);
