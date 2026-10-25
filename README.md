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
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#web-vs-app">Web vs App</a> •
  <a href="#cli">CLI</a> •
  <a href="docs/api.md">API Reference</a> •
  <a href="docs/guide.md">Guide</a>
</p>

---

Zero-dependency Node.js client for ChatGPT with dual Web (`chatgpt.com`) and Mobile App (`android.chat.openai.com`) backends.

---

## Web vs App

Choose the backend that fits your use case:

| Feature | 🌐 Web (`ChatGPTWeb`) | 📱 App (`ChatGPTApp`) |
|---|---|---|
| **Host** | `https://chatgpt.com` | `https://android.chat.openai.com` |
| **Auth** | Anonymous (no login) or cookies / token | OAuth Bearer token or anonymous |
| **Cloudflare** | Handled automatically | Direct edge (no Cloudflare) |
| **Client headers** | Desktop Chrome | Official Android app headers |
| **Models** | Web presets (`auto`, `gpt-4o`, `o1`) | Mobile catalog (`gpt-6`, `gpt-5.6`, etc.) |
| **Files** | Images & documents | Supported with token |
| **Web search** | Yes | Yes |
| **Conversations** | Thread management & memories | Thread CRUD & user settings |

---

## Quick Start

```sh
npm install chatgpt-unofficial-api
```

### 1. Web (anonymous, no account needed)

```javascript
import { ChatGPTWeb } from "chatgpt-unofficial-api/web";

const client = new ChatGPTWeb();
await client.init();

// Single prompt
const answer = await client.ask("Explain quantum computing in one sentence.");
console.log(answer);

// Real-time stream
for await (const chunk of client.streamAsk("Write a haiku.")) {
  process.stdout.write(chunk.text);
}

// Attach files
const summary = await client.ask("Summarize this document", {
  files: ["./report.pdf"]
});

// Search web
const news = await client.searchWeb("Latest James Webb telescope discoveries");
```

### 2. With cookies (unlocks history, profile, and advanced models)

Export cookies from your browser into a `cookies.json` file:

```javascript
const client = new ChatGPTWeb({ cookiesFile: "./cookies.json" });
await client.init();

const chats = await client.getConversations();
console.log(chats.items.map(c => c.title));
```

### 3. Mobile App (direct edge backend)

```javascript
import { ChatGPTApp } from "chatgpt-unofficial-api/app";

const app = new ChatGPTApp({
  accessToken: process.env.CHATGPT_TOKEN
});
await app.init();

// Fetch mobile model catalog
const catalog = await app.getModels();
console.log("Models:", catalog.models.map(m => m.title));

// Chat
const reply = await app.ask("Hello");
console.log(reply);

// Manage threads
const chats = await app.getConversations(0, 20);
```

> **Note on Mobile Anonymous Mode:** The mobile conversation endpoint enforces Google Play Integrity hardware attestation. For unauthenticated chat, `ChatGPTWeb` is recommended since it requires no device attestation.

### 4. Dynamic Factory

```javascript
import { createChatGPT } from "chatgpt-unofficial-api";

const web = createChatGPT({ type: "web" });
const app = createChatGPT({ type: "app", accessToken: "..." });
```

---

## CLI

Run directly with `npx`:

```sh
# Ask via web backend
npx chatgpt "Why is the sky blue?"

# Stream response
npx chatgpt web "Tell me a story" --stream

# View models
npx chatgpt models

# View voices
npx chatgpt voices

# Pass cookies
npx chatgpt web "Hello" --cookies ./cookies.json

# Pass proxy
npx chatgpt "Hello" --proxy "http://user:pass@proxy.com:8080"
```

---

## TypeScript

Types are included:

```typescript
import { ChatGPTWeb, ChatGPTApp, StreamChunk } from "chatgpt-unofficial-api";

const client = new ChatGPTWeb();
await client.init();

const stream: AsyncGenerator<StreamChunk> = client.streamAsk("Explain gravity");
for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}
```

---

## Backwards Compatibility

Legacy v1 imports continue to work:

```javascript
import { ChatGPT } from "chatgpt-unofficial-api";
// or
import { ChatGPT } from "./client/index.mjs";
```

Both resolve to `ChatGPTWeb`.

---

## License

MIT © [etrnkz](https://github.com/etrnkz)
