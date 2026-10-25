import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CFBypass,
  solvePow,
  TurnstileVM,
  UploadManager,
  buildMultimodalMessage,
  parseSSEBuffer,
  streamSSEResponse,
} from "../core/index.mjs";

const BASE = "https://chatgpt.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export class ChatGPTWeb {
  /**
   * @param {Object} [opts={}]
   * @param {string|Array<{name:string,value:string}>} [opts.cookies] - Raw cookie string or array of cookie objects
   * @param {string} [opts.cookiesFile] - Path to a JSON cookie file
   * @param {string} [opts.accessToken] - OpenAI OAuth/session access token
   * @param {string} [opts.sessionToken] - NextAuth __Secure-next-auth.session-token
   * @param {string} [opts.proxyUrl] - Optional HTTP/SOCKS5 proxy URL
   * @param {number} [opts.maxRetries=3] - Maximum retry attempts on Cloudflare challenge/rate limits
   * @param {number} [opts.timeout=30000] - Request timeout in ms
   * @param {string} [opts.userAgent] - Custom browser User-Agent
   */
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
    this.accessToken = opts.accessToken || null;
    this.sessionToken = opts.sessionToken || null;
    this.csrfToken = null;
    this.timezoneOffset = -new Date().getTimezoneOffset();

    this.cookieStr = this._resolveCookies(opts);
    this._cf = new CFBypass({
      maxRetries: opts.maxRetries ?? 3,
      proxyUrl: opts.proxyUrl,
      cookies: this.cookieStr || undefined,
      userAgent: opts.userAgent || UA,
      fetchTimeout: opts.timeout ?? 30000,
    });
  }

  _resolveCookies(opts) {
    if (typeof opts.cookies === "string" && opts.cookies.trim()) return opts.cookies;
    if (Array.isArray(opts.cookies) && opts.cookies.length > 0) {
      return opts.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      opts.cookiesFile,
      path.join(process.cwd(), "cookies.json"),
      path.join(__dirname, "cookies.json"),
      path.join(__dirname, "../../client/cookies.json"),
    ].filter(Boolean);

    for (const file of candidates) {
      try {
        if (fs.existsSync(file)) {
          const raw = fs.readFileSync(file, "utf8");
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length > 0) {
            return arr.map((c) => `${c.name}=${c.value}`).join("; ");
          }
        }
      } catch {}
    }
    return null;
  }

  get isAuthenticated() {
    return !!this.accessToken;
  }

  async init() {
    const res = await this._fetch("/", { headers: { accept: "text/html" } });
    const html = await res.text();
    this.buildId = (html.match(/data-build="([^"]+)"/) || [])[1];

    // oai-did must come from the Set-Cookie header (not the HTML body)
    let deviceId = null;
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const m = raw.match(/^\s*oai-did=([^;]+)/);
      if (m) {
        deviceId = m[1];
        break;
      }
    }
    if (!deviceId) {
      const jarMatch = (this._cf.getCookies() || "").match(/oai-did=([^;]+)/);
      if (jarMatch) deviceId = jarMatch[1];
    }
    this.deviceId = deviceId || crypto.randomUUID();

    const now = new Date();
    this.timezoneOffset = -now.getTimezoneOffset();
    this.config = [
      4880,
      now.toDateString(),
      4294705152,
      Math.random(),
      this._cf.userAgent || UA,
      null,
      this.buildId || "",
      "en-US",
      "en-US,en",
      Math.random(),
      "webkitGetUserMedia",
      "location",
      "window",
      800 + Math.random() * 600,
      crypto.randomUUID(),
      "",
      20,
      Date.now(),
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
    const sessionToken = this.sessionToken || single || (chunk0 && chunk1 ? chunk0 + chunk1 : null);
    if (!sessionToken) return;

    try {
      const res = await fetch(BASE + "/api/auth/session", {
        headers: {
          "user-agent": this._cf.userAgent || UA,
          cookie: `__Secure-next-auth.session-token=${sessionToken}`,
        },
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
      if (data?.csrfToken) this.csrfToken = data.csrfToken;
    } catch {}
    return this.csrfToken;
  }

  async _fetch(pathStr, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.deviceId && pathStr !== "/") headers["oai-device-id"] = this.deviceId;
    if (this.buildId && pathStr !== "/") headers["oai-client-version"] = this.buildId;
    if (this.accessToken) headers["authorization"] = `Bearer ${this.accessToken}`;

    const url = pathStr.startsWith("http") ? pathStr : BASE + pathStr;
    const result = await this._cf.fetch(url, { ...opts, headers, retries: opts.retries ?? 2 });
    if (result.error && result.status === 403) {
      throw new Error("Blocked by Cloudflare - please try with a different IP/proxy or wait");
    }
    return {
      ok: !result.error,
      status: result.status,
      headers: result.headers,
      text: async () => result.data,
      json: async () => {
        try {
          return JSON.parse(result.data);
        } catch {
          return null;
        }
      },
    };
  }

  async getTokens() {
    const pValue = "gAAAAAC" + Buffer.from(JSON.stringify(this.config)).toString("base64");
    this.vmToken = pValue;

    if (this.accessToken) {
      const res = await this._fetch("/backend-api/sentinel/chat-requirements", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ p: pValue }),
    });
    const data = await res.json();
    this.token = data.token;
    this.proofOfWork = data.proofofwork;
    this.bytecode = data.turnstile?.dx || null;
  }

  async getConduit(next = false) {
    const body = {
      action: "next",
      fork_from_shared_post: false,
      parent_message_id: "client-created-root",
      model: "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: { kind: "primary_assistant" },
      system_hints: [],
      supports_buffering: true,
      supported_encodings: ["v1"],
    };
    if (next && this.conversationId) {
      body.conversation_id = this.conversationId;
      body.parent_message_id = this.parentMessageId;
    }
    const extra = {};
    if (this.accessToken) extra["x-openai-target-path"] = "/backend-api/f/conversation/prepare";
    const res = await this._fetch("/backend-anon/f/conversation/prepare", {
      method: "POST",
      headers: { "content-type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data?.status === "ok" && data.conduit_token) return data.conduit_token;
    throw new Error("Conduit handshake failed: " + JSON.stringify(data));
  }

  /**
   * Ask ChatGPT a prompt and receive the complete answer text.
   * @param {string} message - Prompt to send
   * @param {Object} [options={}] - Query options
   * @param {string} [options.model="auto"] - Model slug (e.g. "auto", "gpt-4o", "o1", "o3-mini")
   * @param {Array<string>} [options.files] - Local file paths to upload
   * @param {string} [options.image] - Base64 image payload
   * @param {boolean} [options.forceSearch=false] - Force live web search tool
   * @param {Array<string>} [options.systemHints=[]] - System guidance hints
   * @returns {Promise<string>} The assistant's text response
   */
  async ask(message, options = {}) {
    if (!this.buildId || !this.deviceId) await this.init();
    await this.getTokens();
    this.config[3] = Math.random();
    this.config[9] = Math.round(Math.random() * 600) + 1400;
    const conduitToken = await this.getConduit(!!this.conversationId);
    if (!this.proofOfWork?.seed || !this.proofOfWork?.difficulty) {
      throw new Error("PoW requirements missing from sentinel response");
    }
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
      convMessage = {
        id: crypto.randomUUID(),
        author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "multimodal_text", parts },
        metadata: {
          attachments,
          selected_github_repos: [],
          selected_all_github_repos: false,
          serialization_metadata: { custom_symbol_offsets: [] },
        },
      };
    } else {
      convMessage = {
        id: crypto.randomUUID(),
        author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "text", parts: [message] },
        metadata: {
          selected_github_repos: [],
          selected_all_github_repos: false,
          serialization_metadata: { custom_symbol_offsets: [] },
        },
      };
    }

    const convBody = {
      action: "next",
      messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: options.forceSearch ? { kind: "primary_assistant", tools: [{ type: "search" }] } : { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: options.systemHints || [],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: {
        is_dark_mode: true,
        time_since_loaded: 3,
        page_height: 1219,
        page_width: 3440,
        pixel_ratio: 1,
        screen_height: 1440,
        screen_width: 3440,
      },
    };
    if (this.conversationId) convBody.conversation_id = this.conversationId;

    const extraHeaders = {};
    if (this.accessToken) {
      const csrf = await this.getCSRFToken();
      if (csrf) extraHeaders["oai-csrf-token"] = csrf;
      extraHeaders["x-openai-target-path"] = "/backend-api/f/conversation";
    }

    const res = await this._fetch("/backend-anon/f/conversation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-echo-logs": `0,${t1},1,${t2}`,
        "openai-sentinel-chat-requirements-token": this.token,
        "openai-sentinel-proof-token": proofToken,
        ...(turnstileToken ? { "openai-sentinel-turnstile-token": turnstileToken } : {}),
        "x-conduit-token": conduitToken,
        ...extraHeaders,
      },
      body: JSON.stringify(convBody),
    });
    const text = await res.text();
    if (text.includes("Unusual activity")) {
      throw new Error("IP flagged by ChatGPT anti-abuse protection");
    }
    const parsed = parseSSEBuffer(text);
    if (parsed.conversationId) this.conversationId = parsed.conversationId;
    if (parsed.messageId) this.parentMessageId = parsed.messageId;
    return parsed.content;
  }

  /**
   * Stream ChatGPT answer chunks as an async generator.
   * @param {string} message - Prompt to send
   * @param {Object} [options={}] - Query options
   * @yields {{ text: string, accumulated: string, done: boolean, conversationId: string|null, messageId: string|null }}
   */
  async *streamAsk(message, options = {}) {
    if (!this.buildId || !this.deviceId) await this.init();
    await this.getTokens();
    this.config[3] = Math.random();
    this.config[9] = Math.round(Math.random() * 600) + 1400;
    const conduitToken = await this.getConduit(!!this.conversationId);
    if (!this.proofOfWork?.seed || !this.proofOfWork?.difficulty) {
      throw new Error("PoW requirements missing from sentinel response");
    }
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
      convMessage = {
        id: crypto.randomUUID(),
        author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "multimodal_text", parts },
        metadata: {
          attachments,
          selected_github_repos: [],
          selected_all_github_repos: false,
          serialization_metadata: { custom_symbol_offsets: [] },
        },
      };
    } else {
      convMessage = {
        id: crypto.randomUUID(),
        author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "text", parts: [message] },
        metadata: {
          selected_github_repos: [],
          selected_all_github_repos: false,
          serialization_metadata: { custom_symbol_offsets: [] },
        },
      };
    }

    const convBody = {
      action: "next",
      messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: options.forceSearch ? { kind: "primary_assistant", tools: [{ type: "search" }] } : { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: options.systemHints || [],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: {
        is_dark_mode: true,
        time_since_loaded: 3,
        page_height: 1219,
        page_width: 3440,
        pixel_ratio: 1,
        screen_height: 1440,
        screen_width: 3440,
      },
    };
    if (this.conversationId) convBody.conversation_id = this.conversationId;

    const extraHeaders = {};
    if (this.accessToken) {
      const csrf = await this.getCSRFToken();
      if (csrf) extraHeaders["oai-csrf-token"] = csrf;
      extraHeaders["x-openai-target-path"] = "/backend-api/f/conversation";
    }

    const headers = {
      "content-type": "application/json",
      "oai-echo-logs": `0,${t1},1,${t2}`,
      "oai-device-id": this.deviceId,
      "oai-client-version": this.buildId,
      "openai-sentinel-chat-requirements-token": this.token,
      "openai-sentinel-proof-token": proofToken,
      ...(turnstileToken ? { "openai-sentinel-turnstile-token": turnstileToken } : {}),
      "x-conduit-token": conduitToken,
      ...extraHeaders,
    };
    if (this.accessToken) headers["authorization"] = `Bearer ${this.accessToken}`;

    const res = await this._cf.fetchStream(BASE + "/backend-anon/f/conversation", {
      method: "POST",
      headers,
      body: JSON.stringify(convBody),
    });
    if (!res.ok) throw new Error(`Conversation stream failed: HTTP ${res.status}`);
    for await (const chunk of streamSSEResponse(res)) {
      if (chunk.conversationId) this.conversationId = chunk.conversationId;
      if (chunk.messageId) this.parentMessageId = chunk.messageId;
      yield chunk;
    }
  }

  // --- Public discovery endpoints ---

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

  async getVoiceSettings() {
    const ep = this.accessToken ? "/backend-api/settings/voice_settings" : "/backend-anon/settings/voice_settings";
    const res = await this._fetch(ep);
    return res.json();
  }

  async searchWeb(query) {
    return this.ask(query, { forceSearch: true });
  }

  async *streamSearchWeb(query) {
    for await (const c of this.streamAsk(query, { forceSearch: true })) yield c;
  }

  async askWithImage(message, imagePath) {
    return this.ask(message, { files: [imagePath] });
  }

  async askWithFiles(message, filePaths) {
    return this.ask(message, { files: filePaths });
  }

  // --- Authenticated features (cookies or accessToken required) ---

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

  async getBillingInfo() {
    if (!this.accessToken) return null;
    const res = await this._fetch("/backend-api/accounts/billing");
    return res.json();
  }

  async getConversations(offset = 0, limit = 28) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}`);
    return res.json();
  }

  async getConversation(convId) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`/backend-api/conversation/${convId}`);
    return res.json();
  }

  async renameConversation(convId, title) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`/backend-api/conversation/${convId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    return res.json();
  }

  async deleteConversation(convId) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`/backend-api/conversation/${convId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_visible: false }),
    });
    return res.json();
  }

  async getGizmos() {
    if (!this.accessToken) return null;
    const res = await this._fetch("/backend-api/gizmos/bootstrap");
    return res.json();
  }

  async getGizmo(gizmoId) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`/backend-api/gizmos/${gizmoId}`);
    return res.json();
  }

  async getMemory() {
    if (!this.accessToken) return null;
    const res = await this._fetch("/backend-api/memories");
    return res.json();
  }

  async deleteMemory(memoryId) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`/backend-api/memories/${memoryId}`, { method: "DELETE" });
    return res.json();
  }

  async clearMemory() {
    if (!this.accessToken) return null;
    const res = await this._fetch("/backend-api/memories", { method: "DELETE" });
    return res.json();
  }
}

// For seamless backwards compatibility
export const ChatGPT = ChatGPTWeb;
export default ChatGPTWeb;
