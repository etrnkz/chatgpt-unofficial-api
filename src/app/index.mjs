import crypto from "crypto";
import {
  MOBILE_BASE_URL,
  DEFAULT_ANDROID_UA,
  CLIENT_TYPES,
  PACKAGE_NAMES,
  MOBILE_ENDPOINTS,
  CODEX_REMOTE_WSS,
  REALTIME_VOICE_BASE,
} from "./constants.mjs";
import {
  solvePow,
  buildConfig,
  encodeConfig,
  parseSSEBuffer,
  streamSSEResponse,
} from "../core/index.mjs";

export class ChatGPTApp {
  /**
   * Official ChatGPT Mobile App (Android/iOS) API Client.
   * Directly interfaces with https://android.chat.openai.com.
   *
   * @param {Object} [opts={}]
   * @param {string} [opts.accessToken] - OAuth Bearer access token
   * @param {string} [opts.deviceId] - Device UUID (auto-generated if omitted)
   * @param {"android"|"ios"} [opts.clientType="android"] - Mobile client type
   * @param {string} [opts.packageName="com.openai.chatgpt"] - App package name
   * @param {string} [opts.userAgent] - Mobile User-Agent string
   * @param {string} [opts.playIntegrityToken] - Google Play Integrity attestation token
   * @param {string} [opts.proxyUrl] - Optional proxy URL
   * @param {number} [opts.timeout=35000] - Timeout in milliseconds
   */
  constructor(opts = {}) {
    this.accessToken = opts.accessToken || null;
    this.deviceId = opts.deviceId || crypto.randomUUID();
    this.clientType = opts.clientType || CLIENT_TYPES.ANDROID;
    this.packageName = opts.packageName || PACKAGE_NAMES.ANDROID;
    this.userAgent = opts.userAgent || DEFAULT_ANDROID_UA;
    this.playIntegrityToken = opts.playIntegrityToken || null;
    this.proxyUrl = opts.proxyUrl || process.env.PROXY_URL || null;
    this.timeout = opts.timeout ?? 35000;

    this.conversationId = null;
    this.parentMessageId = null;
    this.timezoneOffset = -new Date().getTimezoneOffset();
    this.config = null;
    this.sentinelToken = null;
    this.proofOfWork = null;
  }

  get isAuthenticated() {
    return !!this.accessToken;
  }

  /**
   * Static references to unreleased mobile sub-architectures
   */
  static get CODEX_REMOTE_URL() {
    return CODEX_REMOTE_WSS;
  }

  static get REALTIME_VOICE_URL() {
    return REALTIME_VOICE_BASE;
  }

  async init() {
    if (!this.deviceId) this.deviceId = crypto.randomUUID();
    this.timezoneOffset = -new Date().getTimezoneOffset();
    this.config = buildConfig({
      deviceId: this.deviceId,
      userAgent: this.userAgent,
    });
  }

  _buildHeaders(extra = {}) {
    const headers = {
      "user-agent": this.userAgent,
      accept: "application/json",
      "content-type": "application/json",
      "oai-client-type": this.clientType,
      "oai-package-name": this.packageName,
      "oai-device-id": this.deviceId,
      "oai-android-play-integrity-token-failed": this.playIntegrityToken ? "false" : "true",
      ...extra,
    };
    if (this.accessToken) {
      headers["authorization"] = `Bearer ${this.accessToken}`;
    }
    if (this.playIntegrityToken) {
      headers["oai-android-play-integrity-token"] = this.playIntegrityToken;
    }
    return headers;
  }

  async _fetch(path, opts = {}) {
    const url = path.startsWith("http") ? path : `${MOBILE_BASE_URL}${path}`;
    const headers = this._buildHeaders(opts.headers);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), opts.timeout ?? this.timeout);

    const fetchOpts = {
      method: opts.method || "GET",
      headers,
      signal: controller.signal,
      ...(opts.body ? { body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body) } : {}),
    };

    if (this.proxyUrl) {
      try {
        const { ProxyAgent } = await import("undici");
        fetchOpts.dispatcher = new ProxyAgent(this.proxyUrl);
      } catch {}
    }

    try {
      const res = await fetch(url, fetchOpts);
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        headers: res.headers,
        text: async () => text,
        json: async () => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetches Sentinel chat requirements (PoW challenge) from mobile backend.
   */
  async getChatRequirements() {
    if (!this.config) await this.init();
    const pValue = encodeConfig(this.config);
    const ep = this.accessToken
      ? MOBILE_ENDPOINTS.SENTINEL_AUTH
      : MOBILE_ENDPOINTS.SENTINEL_ANON;

    const res = await this._fetch(ep, {
      method: "POST",
      body: { p: pValue },
    });
    const data = await res.json();
    if (!res.ok || !data?.token) {
      throw new Error(`Mobile Sentinel failed: HTTP ${res.status} — ${JSON.stringify(data)}`);
    }
    this.sentinelToken = data.token;
    this.proofOfWork = data.proofofwork || null;
    return data;
  }

  /**
   * Prepares mobile conversation and retrieves conduit token.
   */
  async getConduit(next = false) {
    const ep = this.accessToken
      ? MOBILE_ENDPOINTS.CONDUIT_PREPARE_AUTH
      : MOBILE_ENDPOINTS.CONDUIT_PREPARE_ANON;

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

    const res = await this._fetch(ep, {
      method: "POST",
      body,
    });
    const data = await res.json();
    if (data?.status === "ok" && data.conduit_token) {
      return data.conduit_token;
    }
    throw new Error(`Mobile Conduit prepare failed: HTTP ${res.status} — ${JSON.stringify(data)}`);
  }

  /**
   * Send a prompt to the official mobile backend and return the assistant response.
   *
   * Note on Anonymous mode: The mobile endpoint enforces Google Play Integrity attestation.
   * If rejected with 403 Unusual activity, provide a real `accessToken` (authenticated)
   * or use `ChatGPTWeb` (which runs without device attestation).
   *
   * @param {string} message - Prompt text
   * @param {Object} [options={}] - Options
   * @param {string} [options.model="auto"] - Model slug
   * @returns {Promise<string>}
   */
  async ask(message, options = {}) {
    if (!this.config) await this.init();
    await this.getChatRequirements();

    let proofToken = null;
    if (this.proofOfWork?.seed && this.proofOfWork?.difficulty) {
      this.config[3] = Math.random();
      this.config[9] = Math.round(Math.random() * 600) + 1400;
      proofToken = solvePow(this.proofOfWork.seed, this.proofOfWork.difficulty, this.config);
    }

    let conduitToken = null;
    try {
      conduitToken = await this.getConduit(!!this.conversationId);
    } catch {}

    const t1 = Math.round(Math.random() * 3000) + 6000;
    const t2 = t1 + Math.round(Math.random() * 1200);

    const convMessage = {
      id: crypto.randomUUID(),
      author: { role: "user" },
      create_time: Math.round(Date.now() / 1000),
      content: { content_type: "text", parts: [message] },
      metadata: {},
    };

    const convBody = {
      action: "next",
      messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: { kind: "primary_assistant" },
      system_hints: [],
      supports_buffering: true,
      supported_encodings: ["v1"],
    };
    if (this.conversationId) convBody.conversation_id = this.conversationId;

    const ep = this.accessToken
      ? MOBILE_ENDPOINTS.CONVERSATION_AUTH
      : MOBILE_ENDPOINTS.CONVERSATION_ANON;

    const headers = {
      accept: "text/event-stream",
      "oai-echo-logs": `0,${t1},1,${t2}`,
      "OpenAI-Sentinel-Chat-Requirements-Token": this.sentinelToken || "",
    };
    if (proofToken) {
      headers["x-sentinel-payload"] = `proofofwork.so.transport.GET.method&/backend-api/conversation{"nonce": "${proofToken}"}`;
    }
    if (conduitToken) {
      headers["x-conduit-token"] = conduitToken;
    }

    const res = await this._fetch(ep, {
      method: "POST",
      headers,
      body: convBody,
    });

    const text = await res.text();
    if (res.status === 403 && text.includes("Unusual activity")) {
      const err = new Error(
        "Mobile API rejected request with 'Unusual activity has been detected from your device' " +
        "(Google Play Integrity / device attestation required on mobile endpoint). " +
        "Tip: Pass an authenticated `accessToken`, supply `playIntegrityToken`, or use `ChatGPTWeb`."
      );
      err.code = "PLAY_INTEGRITY_REQUIRED";
      err.status = 403;
      throw err;
    }

    if (!res.ok) {
      throw new Error(`Mobile conversation failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
    }

    const parsed = parseSSEBuffer(text);
    if (parsed.conversationId) this.conversationId = parsed.conversationId;
    if (parsed.messageId) this.parentMessageId = parsed.messageId;
    return parsed.content;
  }

  /**
   * Stream response from mobile backend.
   * @param {string} message
   * @param {Object} [options={}]
   * @yields {{ text: string, accumulated: string, done: boolean, conversationId: string|null, messageId: string|null }}
   */
  async *streamAsk(message, options = {}) {
    if (!this.config) await this.init();
    await this.getChatRequirements();

    let proofToken = null;
    if (this.proofOfWork?.seed && this.proofOfWork?.difficulty) {
      this.config[3] = Math.random();
      this.config[9] = Math.round(Math.random() * 600) + 1400;
      proofToken = solvePow(this.proofOfWork.seed, this.proofOfWork.difficulty, this.config);
    }

    let conduitToken = null;
    try {
      conduitToken = await this.getConduit(!!this.conversationId);
    } catch {}

    const t1 = Math.round(Math.random() * 3000) + 6000;
    const t2 = t1 + Math.round(Math.random() * 1200);

    const convMessage = {
      id: crypto.randomUUID(),
      author: { role: "user" },
      create_time: Math.round(Date.now() / 1000),
      content: { content_type: "text", parts: [message] },
      metadata: {},
    };

    const convBody = {
      action: "next",
      messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: { kind: "primary_assistant" },
      system_hints: [],
      supports_buffering: true,
      supported_encodings: ["v1"],
    };
    if (this.conversationId) convBody.conversation_id = this.conversationId;

    const ep = this.accessToken
      ? MOBILE_ENDPOINTS.CONVERSATION_AUTH
      : MOBILE_ENDPOINTS.CONVERSATION_ANON;

    const headers = {
      accept: "text/event-stream",
      "oai-echo-logs": `0,${t1},1,${t2}`,
      "OpenAI-Sentinel-Chat-Requirements-Token": this.sentinelToken || "",
    };
    if (proofToken) {
      headers["x-sentinel-payload"] = `proofofwork.so.transport.GET.method&/backend-api/conversation{"nonce": "${proofToken}"}`;
    }
    if (conduitToken) {
      headers["x-conduit-token"] = conduitToken;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const fetchOpts = {
      method: "POST",
      headers: this._buildHeaders(headers),
      body: JSON.stringify(convBody),
      signal: controller.signal,
    };

    if (this.proxyUrl) {
      try {
        const { ProxyAgent } = await import("undici");
        fetchOpts.dispatcher = new ProxyAgent(this.proxyUrl);
      } catch {}
    }

    let res;
    try {
      res = await fetch(`${MOBILE_BASE_URL}${ep}`, fetchOpts);
    } finally {
      clearTimeout(timeoutId);
    }

    if (res.status === 403) {
      const body = await res.text();
      if (body.includes("Unusual activity")) {
        const err = new Error(
          "Mobile API rejected request with 'Unusual activity has been detected from your device' " +
          "(Google Play Integrity required). Use an authenticated token or switch to `ChatGPTWeb`."
        );
        err.code = "PLAY_INTEGRITY_REQUIRED";
        throw err;
      }
      throw new Error(`Mobile conversation failed: HTTP 403 — ${body}`);
    }

    if (!res.ok) throw new Error(`Mobile stream failed: HTTP ${res.status}`);

    for await (const chunk of streamSSEResponse(res)) {
      if (chunk.conversationId) this.conversationId = chunk.conversationId;
      if (chunk.messageId) this.parentMessageId = chunk.messageId;
      yield chunk;
    }
  }

  // --- Mobile Resource & Management Endpoints ---

  /**
   * Fetch mobile models list and presets.
   */
  async getModels() {
    const ep = this.accessToken ? MOBILE_ENDPOINTS.MODELS : MOBILE_ENDPOINTS.MODELS_ANON;
    const res = await this._fetch(ep);
    return res.json();
  }

  /**
   * Fetch authenticated mobile conversation list.
   */
  async getConversations(offset = 0, limit = 28) {
    if (!this.accessToken) return null;
    const res = await this._fetch(`${MOBILE_ENDPOINTS.CONVERSATIONS}?offset=${offset}&limit=${limit}&order=updated`);
    return res.json();
  }

  /**
   * Fetch full conversation thread messages.
   */
  async getConversation(convId) {
    if (!this.accessToken) return null;
    const res = await this._fetch(MOBILE_ENDPOINTS.CONVERSATION_ITEM(convId));
    return res.json();
  }

  /**
   * Rename a conversation title.
   */
  async renameConversation(convId, title) {
    if (!this.accessToken) return null;
    const res = await this._fetch(MOBILE_ENDPOINTS.CONVERSATION_ITEM(convId), {
      method: "PATCH",
      body: { title },
    });
    return res.json();
  }

  /**
   * Delete a conversation thread.
   */
  async deleteConversation(convId) {
    if (!this.accessToken) return null;
    const res = await this._fetch(MOBILE_ENDPOINTS.CONVERSATION_ITEM(convId), {
      method: "DELETE",
    });
    return res.json();
  }

  /**
   * Get user mobile settings & speech preferences.
   */
  async getSettings() {
    if (!this.accessToken) return null;
    const res = await this._fetch(MOBILE_ENDPOINTS.USER_SETTINGS);
    return res.json();
  }

  /**
   * Get custom user memories.
   */
  async getMemories() {
    if (!this.accessToken) return null;
    const res = await this._fetch(MOBILE_ENDPOINTS.MEMORIES);
    return res.json();
  }
}

// Aliases
export const ChatGPTMobile = ChatGPTApp;
export default ChatGPTApp;
