<div align="center">
<pre>
  ____ _           _    ____ ____ _____      _    ____ ___ 
 / ___| |__   __ _| |_ / ___|  _ \_   _|    / \  |  _ \_ _|
| |   | '_ \ / _` | __| |  _| |_) || |     / _ \ | |_) | | 
| |___| | | | (_| | |_| |_| |  __/ | |    / ___ \|  __/| | 
 \____|_| |_|\__,_|\__|\____|_|    |_|   /_/   \_\_|  |___|
       « U N O F F I C I A L   A P I   v 2 . 0 »
</pre>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node 18+">
  <img src="https://img.shields.io/badge/types-TypeScript-blue?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/dependencies-0-lightgrey" alt="0 deps">
  <img src="https://img.shields.io/badge/backend-Dual%20(Web%20%2B%20App)-9cf" alt="Dual Backend">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#two-backends-web-vs-app">Web vs App</a> •
  <a href="#cli-usage">CLI</a> •
  <a href="docs/api.md">API Reference</a> •
  <a href="docs/guide.md">Guide</a>
</p>

---

<p align="center">
  <strong>Zero-dependency Node.js client for ChatGPT featuring dual Web & Mobile App backends.</strong>
  <br>
  Instant anonymous text chat out of the box, with full support for cookies, OAuth, mobile edge endpoints, and streaming.
</p>

---

## Two Backends: Web vs App

This package provides two purpose-built clients reverse-engineered from OpenAI's production architecture:

| Feature | 🌐 Web Version (`ChatGPTWeb`) | 📱 App Version (`ChatGPTApp`) |
|---|---|---|
| **Target Host** | `https://chatgpt.com` | `https://android.chat.openai.com` |
| **Authentication** | **Anonymous** (zero auth) or **Cookies / Token** | **OAuth Bearer Token** or **Anonymous** |
| **Edge Gate** | Cloudflare Web Protection + Sentinel | Direct OpenAI Mobile Edge (no Cloudflare) |
| **Identity Headers** | Desktop Browser Chrome / Windows | `oai-client-type: android`, official APK package |
| **PoW Engine** | FNV-1a 32-bit Sentinel solver | FNV-1a 32-bit Mobile Sentinel solver |
| **Model Catalog** | Web presets (`auto`, `gpt-4o`, `o1`) | Official Android APK Catalog (`gpt-6`, `gpt-5.6 Luna`, etc.) |
| **File Uploads** | Multimodal images & documents | Yes (with token) |
| **Web Search** | Built-in via tool routing | Built-in via tool routing |
| **Threads & Memory** | Complete history, rename, delete, memory | Full thread CRUD & mobile user settings |
| **Special Features** | Voice preview audio, DALL-E, Turnstile VM | Codex Remote / Slingshot discovery & Realtime AVM hooks |

---

## Quick Start

### 1. Install

```sh
npm install chatgpt-unofficial-api
```

Or run via npx directly without installing:

```sh
npx chatgpt "What is the speed of light in vacuum?"
```

---

### 2. Type 1: Web Version (`ChatGPTWeb`)

Fastest way to get answers without an account or API key:

```javascript
import { ChatGPTWeb } from "chatgpt-unofficial-api/web";
// or: import { ChatGPT } from "chatgpt-unofficial-api";

const client = new ChatGPTWeb();
await client.init();

// Simple question
const answer = await client.ask("Explain quantum computing in one sentence.");
console.log(answer);

// Real-time streaming
for await (const chunk of client.streamAsk("Write a haiku about code.")) {
  process.stdout.write(chunk.text);
}

// Multimodal file attachment
const summary = await client.ask("Summarize this document", {
  files: ["./report.pdf"]
});

// Web search
const news = await client.searchWeb("Latest discoveries from James Webb telescope");
```

#### With Cookies (Unlocks User Profile, History & Advanced Models)
Export cookies from your browser into a `cookies.json` file or pass as a string:

```javascript
const client = new ChatGPTWeb({
  cookiesFile: "./cookies.json"
});
await client.init();

const conversations = await client.getConversations();
console.log("Your chats:", conversations.items.map(c => c.title));
```

---

### 3. Type 2: Mobile App Version (`ChatGPTApp`)

Directly talks to the official Android application edge backend (`https://android.chat.openai.com`):

```javascript
import { ChatGPTApp } from "chatgpt-unofficial-api/app";

const app = new ChatGPTApp({
  accessToken: process.env.CHATGPT_ACCESS_TOKEN // optional for catalog, required for conversation
});
await app.init();

// Fetch official mobile model catalog (includes newest GPT-6 & GPT-5.6 Luna presets)
const catalog = await app.getModels();
console.log("Available mobile models:", catalog.models.map(m => m.title));

// Chat over mobile edge
const response = await app.ask("Give me 3 productivity tips");
console.log(response);

// Mobile thread management
const chats = await app.getConversations(0, 20);
console.log("Mobile threads:", chats);
```

> **Note on Mobile Anonymous Mode**: The mobile conversation endpoint checks for Google Play Integrity hardware attestation. For unauthenticated chat, `ChatGPTWeb` is recommended as web anonymous mode requires no device attestation.

---

### 4. Universal Factory

You can also dynamically select the backend using `createChatGPT`:

```javascript
import { createChatGPT } from "chatgpt-unofficial-api";

const webClient = createChatGPT({ type: "web" });
const appClient = createChatGPT({ type: "app", accessToken: "..." });
```

---

## CLI Usage

The package includes a full-featured zero-dependency CLI binary:

```sh
# Ask ChatGPT using Web backend (default)
npx chatgpt "Why is the sky blue?"

# Real-time streaming output
npx chatgpt web "Tell me an epic sci-fi story" --stream

# Inspect official mobile models
npx chatgpt models

# Inspect available voice synthesizers
npx chatgpt voices

# Use with authenticated cookies
npx chatgpt web "What did we talk about yesterday?" --cookies ./cookies.json

# Use with proxy
npx chatgpt "Hello" --proxy "http://user:pass@proxy.com:8080"
```

---

## TypeScript Support

Full TypeScript definitions are bundled out of the box with autocomplete and inline JSDocs:

```typescript
import { ChatGPTWeb, ChatGPTApp, StreamChunk } from "chatgpt-unofficial-api";

const client: ChatGPTWeb = new ChatGPTWeb();
await client.init();

const stream: AsyncGenerator<StreamChunk> = client.streamAsk("Explain gravity");
for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}
```

---

## Backwards Compatibility

Upgrading from v1.x? All legacy imports and usage patterns are 100% backwards-compatible:
```javascript
import { ChatGPT } from "chatgpt-unofficial-api";
// or
import { ChatGPT } from "./client/index.mjs";
```
Both resolve seamlessly to `ChatGPTWeb`.

---

## License

MIT © [etrnkz](https://github.com/etrnkz)
