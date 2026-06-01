import { solvePow, generateToken, fnv1a } from "./src/pow.mjs";
import { TurnstileVM } from "./src/turnstile.mjs";
import { UploadManager, buildMultimodalMessage } from "./src/upload.mjs";
import { CFBypass } from "./src/cloudflare.mjs";
import { parseSSEBuffer, streamSSEResponse } from "./src/sse.mjs";
import crypto from "crypto";

const BASE = "https://chatgpt.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export class ChatGPT {
  constructor(opts = {}) {
    this.deviceId = null;
    this.buildId = null;
    this.config = null;
    this.conversationId = null;
    this.parentMessageId = null;
    this._cf = new CFBypass({
      maxRetries: opts.maxRetries ?? 3,
      proxyUrl: opts.proxyUrl,
    });
  }

  async _fetch(path, opts = {}) {
    const headers = {
      ...(opts.headers || {}),
    };
    if (this.deviceId && path !== "/" && !path.startsWith(BASE + "/")) {
      headers["oai-device-id"] = this.deviceId;
    }
    if (this.buildId && path !== "/" && !path.startsWith(BASE + "/")) {
      headers["oai-client-version"] = this.buildId;
    }
    const url = path.startsWith("http") ? path : BASE + path;
    const result = await this._cf.fetch(url, { ...opts, headers, retries: opts.retries ?? 2 });
    if (result.error && result.status === 403) {
      throw new Error("Blocked by Cloudflare - try different IP or wait");
    }
    return {
      ok: !result.error,
      status: result.status,
      headers: result.headers,
      text: async () => result.data,
      json: async () => { try { return JSON.parse(result.data); } catch { return null; } },
    };
  }

  async init(message) {
    const res = await this._fetch("/", { headers: { accept: "text/html" } });
    const html = await res.text();
    this.buildId = (html.match(/data-build="([^"]+)"/) || [])[1];
    const didMatch = html.match(/oai-did=([^;]+)/);
    this.deviceId = (didMatch && didMatch[1]) || crypto.randomUUID();

    const now = new Date();
    this.timezoneOffset = -now.getTimezoneOffset();
    this.config = [
      4880,
      now.toDateString(),
      4294705152,
      Math.random(),
      UA,
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
  }

  async getTokens() {
    const pValue = "gAAAAAC" + Buffer.from(JSON.stringify(this.config)).toString("base64");
    this.vmToken = pValue;

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
    if (next) {
      body.conversation_id = this.conversationId;
      body.parent_message_id = this.parentMessageId;
    }

    const res = await this._fetch("/backend-anon/f/conversation/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.status === "ok" && data.conduit_token) {
      return data.conduit_token;
    }
    throw new Error("Conduit failed: " + JSON.stringify(data));
  }

  async ask(message, options = {}) {
    await this.init(message);

    // Step 1: Get sentinel requirements (token, proofofwork, bytecode)
    await this.getTokens();

    // Step 2: Update config for PoW
    this.config[3] = Math.random();
    this.config[9] = Math.round(Math.random() * 600) + 1400;

    // Step 3: Get conduit token
    const conduitToken = await this.getConduit(!!this.conversationId);

    // Step 4: Solve PoW
    if (!this.proofOfWork?.seed || !this.proofOfWork?.difficulty) throw new Error("PoW requirements missing");
    const proofToken = solvePow(
      this.proofOfWork.seed,
      this.proofOfWork.difficulty,
      this.config
    );
    if (!proofToken) throw new Error("PoW solve failed");

    // Step 5: Generate turnstile token (if required)
    let turnstileToken = null;
    if (this.bytecode) {
      turnstileToken = TurnstileVM.generateTurnstile(
        this.bytecode,
        this.vmToken,
        "[]"
      );
    }

    // Step 5b: Upload files if provided
    let fileUploads = [];
    if (options.files && options.files.length > 0) {
      const uploader = new UploadManager(this);
      for (const fp of options.files) {
        const info = await uploader.uploadFile(fp);
        fileUploads.push(info);
      }
    }
    if (options.image) {
      const uploader = new UploadManager(this);
      const b64 = options.image.includes("base64,") ? options.image.split("base64,")[1] : options.image;
      const info = await uploader.uploadFromBase64(b64);
      fileUploads.push(info);
    }

    // Step 6: Build conversation body
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
      conversation_mode: options.forceSearch
        ? { kind: "primary_assistant", tools: [{ type: "search" }] }
        : { kind: "primary_assistant" },
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

    const res = await this._fetch("/backend-anon/f/conversation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-echo-logs": `0,${t1},1,${t2}`,
        "openai-sentinel-chat-requirements-token": this.token,
        "openai-sentinel-proof-token": proofToken,
        ...(turnstileToken ? { "openai-sentinel-turnstile-token": turnstileToken } : {}),
        "x-conduit-token": conduitToken,
      },
      body: JSON.stringify(convBody),
    });

    const text = await res.text();

    if (text.includes("Unusual activity")) {
      throw new Error("IP flagged by ChatGPT");
    }

    const parsed = parseSSEBuffer(text);
    if (parsed.conversationId) this.conversationId = parsed.conversationId;
    if (parsed.messageId) this.parentMessageId = parsed.messageId;
    return parsed.content;
  }

  async *streamAsk(message, options = {}) {
    await this.init(message);
    await this.getTokens();

    this.config[3] = Math.random();
    this.config[9] = Math.round(Math.random() * 600) + 1400;

    const conduitToken = await this.getConduit(!!this.conversationId);

    if (!this.proofOfWork?.seed || !this.proofOfWork?.difficulty) throw new Error("PoW requirements missing");
    const proofToken = solvePow(
      this.proofOfWork.seed,
      this.proofOfWork.difficulty,
      this.config
    );
    if (!proofToken) throw new Error("PoW solve failed");

    let turnstileToken = null;
    if (this.bytecode) {
      turnstileToken = TurnstileVM.generateTurnstile(
        this.bytecode,
        this.vmToken,
        "[]"
      );
    }

    let fileUploads = [];
    if (options.files && options.files.length > 0) {
      const uploader = new UploadManager(this);
      for (const fp of options.files) {
        const info = await uploader.uploadFile(fp);
        fileUploads.push(info);
      }
    }
    if (options.image) {
      const uploader = new UploadManager(this);
      const b64 = options.image.includes("base64,") ? options.image.split("base64,")[1] : options.image;
      const info = await uploader.uploadFromBase64(b64);
      fileUploads.push(info);
    }

    const t1 = Math.round(Math.random() * 3000) + 6000;
    const t2 = t1 + Math.round(Math.random() * 1200);

    let convMessage;
    if (fileUploads.length > 0) {
      const { parts, attachments } = buildMultimodalMessage(message, fileUploads);
      convMessage = {
        id: crypto.randomUUID(), author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "multimodal_text", parts },
        metadata: { attachments, selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } },
      };
    } else {
      convMessage = {
        id: crypto.randomUUID(), author: { role: "user" },
        create_time: Math.round(Date.now() / 1000),
        content: { content_type: "text", parts: [message] },
        metadata: { selected_github_repos: [], selected_all_github_repos: false, serialization_metadata: { custom_symbol_offsets: [] } },
      };
    }

    const convBody = {
      action: "next",
      messages: [convMessage],
      parent_message_id: this.parentMessageId || "client-created-root",
      model: options.model || "auto",
      timezone_offset_min: this.timezoneOffset,
      history_and_training_disabled: true,
      conversation_mode: options.forceSearch
        ? { kind: "primary_assistant", tools: [{ type: "search" }] }
        : { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: options.systemHints || [],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: { is_dark_mode: true, time_since_loaded: 3, page_height: 1219, page_width: 3440, pixel_ratio: 1, screen_height: 1440, screen_width: 3440 },
    };
    if (this.conversationId) convBody.conversation_id = this.conversationId;

    const res = await this._cf.fetchStream(BASE + "/backend-anon/f/conversation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-device-id": this.deviceId,
        "oai-client-version": this.buildId,
        "oai-echo-logs": `0,${t1},1,${t2}`,
        "openai-sentinel-chat-requirements-token": this.token,
        "openai-sentinel-proof-token": proofToken,
        ...(turnstileToken ? { "openai-sentinel-turnstile-token": turnstileToken } : {}),
        "x-conduit-token": conduitToken,
      },
      body: JSON.stringify(convBody),
    });

    if (!res.ok) throw new Error(`Conversation request failed: ${res.status}`);

    for await (const chunk of streamSSEResponse(res)) {
      if (chunk.conversationId) this.conversationId = chunk.conversationId;
      if (chunk.messageId) this.parentMessageId = chunk.messageId;
      yield chunk;
    }
  }

  // --- Utility methods ---

  async getModels() {
    const res = await this._fetch("/backend-anon/models");
    return res.json();
  }

  async getVoices() {
    const res = await this._fetch("/backend-anon/settings/voices");
    return res.json();
  }

  async searchWeb(query) {
    return this.ask(query, { forceSearch: true });
  }

  async askWithImage(message, imagePath) {
    return this.ask(message, { files: [imagePath] });
  }

  async askWithFiles(message, filePaths) {
    return this.ask(message, { files: filePaths });
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`)) {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf("--file");
  const imageFlag = args.indexOf("--image");
  const files = [];
  if (fileFlag !== -1 && args.length > fileFlag + 1) files.push(args[fileFlag + 1]);
  if (imageFlag !== -1 && args.length > imageFlag + 1) files.push(args[imageFlag + 1]);
  const excluded = new Set();
  if (fileFlag !== -1) { excluded.add(fileFlag); excluded.add(fileFlag + 1); }
  if (imageFlag !== -1) { excluded.add(imageFlag); excluded.add(imageFlag + 1); }
  const msg = args.filter((_, i) => !excluded.has(i)).join(" ") || "say hello";
  const client = new ChatGPT();
  const opts = files.length > 0 ? { files } : {};
  client.ask(msg, opts).then(res => console.log(res || "(empty response)")).catch(e => { console.error("Error:", e.message); process.exit(1); });
}
