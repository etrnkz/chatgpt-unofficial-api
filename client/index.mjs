import { solvePow } from "./pow.mjs";
import { TurnstileVM } from "./turnstile.mjs";
import { UploadManager, buildMultimodalMessage } from "./upload.mjs";
import { CFBypass } from "./cloudflare.mjs";
import { parseSSEBuffer, streamSSEResponse } from "./sse.mjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "https://chatgpt.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export class ChatGPT {
  constructor(opts = {}) {
    this.deviceId = null;
    this.buildId = null;
    this.config = null;
    this.conversationId = null;
    this.parentMessageId = null;
    this.token = null;
    this.proofOfWork = null;
    this.bytecode = null;
    this.vmToken = null;
    this.accessToken = null;
    this.csrfToken = null;

    this.cookieStr = this._resolveCookies(opts);
    this._cf = new CFBypass({
      maxRetries: opts.maxRetries ?? 3,
      proxyUrl: opts.proxyUrl,
      cookies: this.cookieStr || undefined,
    });
  }

  _resolveCookies(opts) {
    if (typeof opts.cookies === "string" && opts.cookies.trim()) return opts.cookies;
    if (Array.isArray(opts.cookies) && opts.cookies.length > 0) {
      return opts.cookies.map(c => `${c.name}=${c.value}`).join("; ");
    }
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cookiesFile = opts.cookiesFile || path.join(__dirname, "cookies.json");
    try {
      const raw = fs.readFileSync(cookiesFile, "utf8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map(c => `${c.name}=${c.value}`).join("; ");
      }
    } catch {}
    return null;
  }

  get isAuthenticated() {
    return !!this.accessToken;
  }

  async init() {
    const res = await this._fetch("/", { headers: { accept: "text/html" } });
    const html = await res.text();
    this.buildId = (html.match(/data-build="([^"]+)"/) || [])[1];
    const didMatch = html.match(/oai-did=([^;]+)/);
    this.deviceId = (didMatch && didMatch[1]) || crypto.randomUUID();

    const now = new Date();
    this.timezoneOffset = -now.getTimezoneOffset();
    this.config = [
      4880, now.toDateString(), 4294705152, Math.random(), UA, null,
      this.buildId || "", "en-US", "en-US,en", Math.random(),
      "webkitGetUserMedia", "location", "window", 800 + Math.random() * 600,
      crypto.randomUUID(), "", 20, Date.now(),
    ];

    if (this.cookieStr) await this._initAuth();
  }

  async _initAuth() {
    const cookies = {};
    for (const part of this.cookieStr.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) {
        const name = part.substring(0, eq).trim();
        const value = part.substring(eq + 1).trim();
        cookies[name] = value;
      }
    }
    const chunk0 = cookies["__Secure-next-auth.session-token.0"];
    const chunk1 = cookies["__Secure-next-auth.session-token.1"];
    const single = cookies["__Secure-next-auth.session-token"];
    const sessionToken = single || (chunk0 + (chunk1 || ""));
    if (!sessionToken) return;

    try {
      const res = await fetch(BASE + "/api/auth/session", {
        headers: { "user-agent": UA, cookie: `__Secure-next-auth.session-token=${sessionToken}` },
      });
      const data = await res.json();
      if (data.accessToken) this.accessToken = data.accessToken;
    } catch {}
  }

  async getCSRFToken() {
    if (this.csrfToken) return this.csrfToken;
    try {
      const res = await this._fetch("/api/auth/csrf");
      const data = await res.json();
      if (data.csrfToken) this.csrfToken = data.csrfToken;
    } catch {}
    return this.csrfToken;
  }

  async _fetch(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.deviceId && path !== "/") headers["oai-device-id"] = this.deviceId;
    if (this.buildId && path !== "/") headers["oai-client-version"] = this.buildId;
    if (this.accessToken) headers["authorization"] = `Bearer ${this.accessToken}`;

    const url = path.startsWith("http") ? path : BASE + path;
    const result = await this._cf.fetch(url, { ...opts, headers, retries: opts.retries ?? 2 });
    if (result.error && result.status === 403) throw new Error("Blocked by Cloudflare");
    return {
      ok: !result.error, status: result.status, headers: result.headers,
      text: async () => result.data,
      json: async () => { try { return JSON.parse(result.data); } catch { return null; } },
    };
  }

  async getTokens() {
    const pValue = "gAAAAAC" + Buffer.from(JSON.stringify(this.config)).toString("base64");
    this.vmToken = pValue;

    if (this.accessToken) {
      const res = await this._fetch("/backend-api/sentinel/chat-requirements", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ p: pValue }),
      });
      const data = await res.json();
      if (data && data.token) {
        this.token = data.token;
        this.proofOfWork = data.proofofwork;
        this.bytecode = data.turnstile?.dx || null;
        return;
      }
    }

    const res = await this._fetch("/backend-anon/sentinel/chat-requirements", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ p: pValue }),
    });
    const data = await res.json();
    this.token = data.token;
    this.proofOfWork = data.proofofwork;
    this.bytecode = data.turnstile?.dx || null;
  }

  async getConduit(next = false) {
    const body = {
      action: "next", fork_from_shared_post: false,
      parent_message_id: "client-created-root", model: "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: { kind: "primary_assistant" },
      system_hints: [], supports_buffering: true, supported_encodings: ["v1"],
    };
    if (next && this.conversationId) {
      body.conversation_id = this.conversationId;
      body.parent_message_id = this.parentMessageId;
    }
    const extra = {};
    if (this.accessToken) extra["x-openai-target-path"] = "/backend-api/f/conversation/prepare";
    const res = await this._fetch("/backend-anon/f/conversation/prepare", {
      method: "POST", headers: { "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.status === "ok" && data.conduit_token) return data.conduit_token;
    throw new Error("Conduit failed: " + JSON.stringify(data));
  }

  async ask(message, options = {}) {
    await this.init();
    await this.getTokens();
    this.config[3] = Math.random();
    this.config[9] = Math.round(Math.random() * 600) + 1400;
    const conduitToken = await this.getConduit(!!this.conversationId);
    if (!this.proofOfWork?.seed || !this.proofOfWork?.difficulty) throw new Error("PoW requirements missing");
    const proofToken = solvePow(this.proofOfWork.seed, this.proofOfWork.difficulty, this.config);
    if (!proofToken) throw new Error("PoW solve failed");
    let turnstileToken = null;
    if (this.bytecode) {
      turnstileToken = TurnstileVM.generateTurnstile(this.bytecode, this.vmToken, "[]");
    }

    let fileUploads = [];
    if (options.files?.length > 0) {
      const uploader = new UploadManager(this);
      for (const fp of options.files) fileUploads.push(await uploader.uploadFile(fp));
    }
    if (options.image) {
      const uploader = new UploadManager(this);
      const b64 = options.image.includes("base64,") ? options.image.split("base64,")[1] : options.image;
      fileUploads.push(await uploader.uploadFromBase64(b64));
    }

    const t1 = Math.round(Math.random() * 3000) + 6000;
    const t2 = t1 + Math.round(Math.random() * 1200);

    let convMessage;
    if (fileUploads.length > 0) {
      const { parts, attachments } = buildMultimodalMessage(message, fileUploads);
      convMessage = { id: crypto.randomUUID(), author: { role: "user" }, create_time: Math.round(Date.now() / 1000), content: { content_type: "multimodal_text", parts }, metadata: { attachments, selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } } };
    } else {
      convMessage = { id: crypto.randomUUID(), author: { role: "user" }, create_time: Math.round(Date.now() / 1000), content: { content_type: "text", parts: [message] }, metadata: { selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } } };
    }

    const convBody = {
      action: "next", messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto", timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: options.forceSearch ? { kind: "primary_assistant", tools: [{ type: "search" }] } : { kind: "primary_assistant" },
      enable_message_followups: true, system_hints: options.systemHints || [],
      supports_buffering: true, supported_encodings: ["v1"],
      client_contextual_info: { is_dark_mode: true, time_since_loaded: 3, page_height: 1219, page_width: 3440, pixel_ratio: 1, screen_height: 1440, screen_width: 3440 },
    };
    if (this.conversationId) convBody.conversation_id = this.conversationId;

    const extraHeaders = {};
    if (this.accessToken) {
      const csrf = await this.getCSRFToken();
      if (csrf) extraHeaders["oai-csrf-token"] = csrf;
      extraHeaders["x-openai-target-path"] = "/backend-api/f/conversation";
    }

    const res = await this._fetch("/backend-anon/f/conversation", {
      method: "POST", headers: {
        "content-type": "application/json", "oai-echo-logs": `0,${t1},1,${t2}`,
        "openai-sentinel-chat-requirements-token": this.token,
        "openai-sentinel-proof-token": proofToken,
        ...(turnstileToken ? { "openai-sentinel-turnstile-token": turnstileToken } : {}),
        "x-conduit-token": conduitToken,
        ...extraHeaders,
      },
      body: JSON.stringify(convBody),
    });
    const text = await res.text();
    if (text.includes("Unusual activity")) throw new Error("IP flagged by ChatGPT");
    const parsed = parseSSEBuffer(text);
    if (parsed.conversationId) this.conversationId = parsed.conversationId;
    if (parsed.messageId) this.parentMessageId = parsed.messageId;
    return parsed.content;
  }

  async *streamAsk(message, options = {}) {
    await this.init();
    await this.getTokens();
    this.config[3] = Math.random();
    this.config[9] = Math.round(Math.random() * 600) + 1400;
    const conduitToken = await this.getConduit(!!this.conversationId);
    if (!this.proofOfWork?.seed || !this.proofOfWork?.difficulty) throw new Error("PoW requirements missing");
    const proofToken = solvePow(this.proofOfWork.seed, this.proofOfWork.difficulty, this.config);
    if (!proofToken) throw new Error("PoW solve failed");
    let turnstileToken = null;
    if (this.bytecode) {
      turnstileToken = TurnstileVM.generateTurnstile(this.bytecode, this.vmToken, "[]");
    }

    let fileUploads = [];
    if (options.files?.length > 0) {
      const uploader = new UploadManager(this);
      for (const fp of options.files) fileUploads.push(await uploader.uploadFile(fp));
    }

    const t1 = Math.round(Math.random() * 3000) + 6000;
    const t2 = t1 + Math.round(Math.random() * 1200);

    let convMessage;
    if (fileUploads.length > 0) {
      const { parts, attachments } = buildMultimodalMessage(message, fileUploads);
      convMessage = { id: crypto.randomUUID(), author: { role: "user" }, create_time: Math.round(Date.now() / 1000), content: { content_type: "multimodal_text", parts }, metadata: { attachments, selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } } };
    } else {
      convMessage = { id: crypto.randomUUID(), author: { role: "user" }, create_time: Math.round(Date.now() / 1000), content: { content_type: "text", parts: [message] }, metadata: { selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } } };
    }

    const convBody = {
      action: "next", messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto", timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: options.forceSearch ? { kind: "primary_assistant", tools: [{ type: "search" }] } : { kind: "primary_assistant" },
      enable_message_followups: true, system_hints: options.systemHints || [],
      supports_buffering: true, supported_encodings: ["v1"],
      client_contextual_info: { is_dark_mode: true, time_since_loaded: 3, page_height: 1219, page_width: 3440, pixel_ratio: 1, screen_height: 1440, screen_width: 3440 },
    };
    if (this.conversationId) convBody.conversation_id = this.conversationId;

    const extraHeaders = {};
    if (this.accessToken) {
      const csrf = await this.getCSRFToken();
      if (csrf) extraHeaders["oai-csrf-token"] = csrf;
      extraHeaders["x-openai-target-path"] = "/backend-api/f/conversation";
    }

    const headers = {
      "content-type": "application/json", "oai-echo-logs": `0,${t1},1,${t2}`,
      "oai-device-id": this.deviceId, "oai-client-version": this.buildId,
      "openai-sentinel-chat-requirements-token": this.token,
      "openai-sentinel-proof-token": proofToken,
      ...(turnstileToken ? { "openai-sentinel-turnstile-token": turnstileToken } : {}),
      "x-conduit-token": conduitToken,
      ...extraHeaders,
    };
    if (this.accessToken) headers["authorization"] = `Bearer ${this.accessToken}`;

    const res = await this._cf.fetchStream(BASE + "/backend-anon/f/conversation", {
      method: "POST", headers, body: JSON.stringify(convBody),
    });
    if (!res.ok) throw new Error(`Conversation failed: ${res.status}`);
    for await (const chunk of streamSSEResponse(res)) {
      if (chunk.conversationId) this.conversationId = chunk.conversationId;
      if (chunk.messageId) this.parentMessageId = chunk.messageId;
      yield chunk;
    }
  }

  // --- Anonymous endpoints ---

  async getModels() {
    const ep = this.accessToken ? "/backend-api/models" : "/backend-anon/models";
    const res = await this._fetch(ep);
    return res.json();
  }

  async getVoices() {
    const ep = this.accessToken ? "/backend-api/settings/voices" : "/backend-anon/settings/voices";
    const res = await this._fetch(ep);
    return res.json();
  }

  async searchWeb(query) { return this.ask(query, { forceSearch: true }); }
  async *streamSearchWeb(query) { for await (const c of this.streamAsk(query, { forceSearch: true })) yield c; }
  async askWithImage(message, imagePath) { return this.ask(message, { files: [imagePath] }); }
  async askWithFiles(message, filePaths) { return this.ask(message, { files: filePaths }); }

  // --- Auth endpoints (requires cookies) ---

  async getProfile() {
    if (!this.accessToken) return null;
    const res = await this._fetch("/backend-api/me");
    return res.json();
  }

  async getAccount() {
    if (!this.accessToken) return null;
    const res = await this._fetch("/backend-api/accounts/check");
    return res.json();
  }

  async getSettings() {
    if (!this.accessToken) return null;
    const res = await this._fetch("/backend-api/settings");
    return res.json();
  }

  async getConversations(offset = 0, limit = 28) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}`);
    return res.json();
  }

  async getConversationMessages(convId) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`/backend-api/conversation/${convId}`);
    return res.json();
  }

  async getBillingInfo() {
    if (!this.accessToken) return null;
    const res = await this._fetch("/backend-api/accounts/billing");
    return res.json();
  }

  async getVoiceSettings() {
    const ep = this.accessToken ? "/backend-api/settings/voice_settings" : "/backend-anon/settings/voice_settings";
    const res = await this._fetch(ep);
    return res.json();
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`)) {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf("--file");
  const imageFlag = args.indexOf("--image");
  const cookiesFlag = args.indexOf("--cookies");
  const files = [];
  let cookiesFile = null;
  if (fileFlag !== -1 && args.length > fileFlag + 1) files.push(args[fileFlag + 1]);
  if (imageFlag !== -1 && args.length > imageFlag + 1) files.push(args[imageFlag + 1]);
  if (cookiesFlag !== -1 && args.length > cookiesFlag + 1) cookiesFile = args[cookiesFlag + 1];
  const excluded = new Set();
  if (fileFlag !== -1) { excluded.add(fileFlag); excluded.add(fileFlag + 1); }
  if (imageFlag !== -1) { excluded.add(imageFlag); excluded.add(imageFlag + 1); }
  if (cookiesFlag !== -1) { excluded.add(cookiesFlag); excluded.add(cookiesFlag + 1); }
  const msg = args.filter((_, i) => !excluded.has(i)).join(" ") || "say hello";

  const client = new ChatGPT({ cookiesFile });
  const start = Date.now();

  // Check mode and optionally show profile
  await client.init();
  if (client.isAuthenticated) {
    const profile = await client.getProfile();
    console.error(`Logged in as: ${profile?.name || "unknown"} (${profile?.email || "?"})`);
  } else {
    console.error("Mode: anonymous (no cookies.json found)");
  }

  const opts = files.length > 0 ? { files } : {};
  try {
    const res = await client.ask(msg, opts);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(res || "(empty response)");
    console.error(`\n(${elapsed}s)`);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}
