import { ChatGPT } from "./index.mjs";
import fs from "fs";
import os from "os";

const client = new ChatGPT();
let pass = 0, fail = 0;

async function t(name, fn) {
  try {
    const r = await fn();
    if (r === false || r === null || r === undefined) { fail++; console.error(`FAIL ${name} → returned falsy`); }
    else { pass++; console.error(`PASS ${name}`); }
  } catch(e) { fail++; console.error(`FAIL ${name}: ${e.message}`); }
}

await client.init();
const mode = client.isAuthenticated ? "auth" : "anonymous";
console.error(`Mode: ${mode}`);

// Models & Voices
await t("getModels", async () => { const m = await client.getModels(); return m?.models?.length > 0; });
await t("getVoices", async () => { const v = await client.getVoices(); return v?.voices?.length > 0; });
await t("getVoiceSettings", async () => { const v = await client.getVoiceSettings(); return !!v; });

// Chat
await t("ask", async () => { const r = await client.ask("say just the word kiwi"); return r?.toLowerCase().includes("kiwi"); });

client.conversationId = null;
client.parentMessageId = null;

await t("streamAsk", async () => { let full = ""; for await (const c of client.streamAsk("say just the word lime")) { if (c.text) full += c.text; } return full.toLowerCase().includes("lime"); });

client.conversationId = null;
client.parentMessageId = null;

await t("searchWeb", async () => { const r = await client.searchWeb("what is 2+2?"); return r && r.length > 0; });

client.conversationId = null;
client.parentMessageId = null;

// File upload
await t("file upload", async () => {
  const fp = os.tmpdir() + "\\_chatgpt_test.txt";
  fs.writeFileSync(fp, "test content from chatgpt-unofficial-api");
  const r = await client.ask("what does the file say?", { files: [fp] });
  fs.unlinkSync(fp);
  return r?.length > 5;
});

// Auth-only
if (client.isAuthenticated) {
  await t("getProfile", async () => { const p = await client.getProfile(); return p?.name || p?.email; });
  await t("getConversations", async () => { const c = await client.getConversations(); return c?.items?.length >= 0; });
  await t("getBillingInfo", async () => { const b = await client.getBillingInfo(); return !!b; });
}

console.log(JSON.stringify({ pass, fail, total: pass + fail, mode }));
process.exit(fail > 0 ? 1 : 0);
