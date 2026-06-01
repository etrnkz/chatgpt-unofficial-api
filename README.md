# ChatGPT Unofficial API

Pure Node.js ChatGPT client with **zero dependencies**. Chat with GPT-4o, upload files, use voice, search the web, generate images — all without a browser, Playwright, or Puppeteer.

```bash
cd client && node index.mjs
```

---

## Quick Start

```bash
# Clone and run
git clone https://github.com/etrnkz/chatgpt-unofficial-api.git
cd chatgpt-unofficial-api/client
node index.mjs
```

That's it. No `npm install`, no environment variables, no API keys.

### With browser cookies (optional)

Drop your ChatGPT cookies into `client/cookies.json` to unlock authenticated features:

```json
[
  { "name": "__Secure-next-auth.session-token", "value": "..." },
  { "name": "cf_clearance", "value": "..." }
]
```

See `client/cookies.json.example` for the format. Once cookies are detected, the client automatically enables file uploads, conversation history, custom instructions, billing info, and all `/backend-api/*` endpoints.

---

## Guide

### Basic Chat

```javascript
import { ChatGPT } from "./client/index.mjs";

const client = new ChatGPT();
await client.init();

const reply = await client.ask("What is the meaning of life?");
console.log(reply);
```

### Streaming

```javascript
for await (const chunk of client.streamAsk("Tell me a story")) {
  if (chunk.text) process.stdout.write(chunk.text);
}
```

### File Upload

```javascript
const reply = await client.ask("What does this file say?", {
  files: ["./report.pdf"]
});
```

### Web Search

```javascript
const results = await client.searchWeb("Latest AI news 2026");
```

### Voice Generation

```javascript
const voices = await client.getVoices();
const audio = await client.generateSpeech("Hello world", voices[0].id);
```

### Image Generation

```javascript
const images = await client.generateImage("A cat in space");
```

### Authenticated Endpoints

With cookies configured:

```javascript
const profile   = await client.getProfile();
const history   = await client.getConversations();
const billing   = await client.getBillingInfo();
const models    = await client.getModels();
const settings  = await client.getSettings();
const memory    = await client.getMemory();
const projects  = await client.getProjects();
```

---

## CLI

```bash
node client/index.mjs --help

# Anonymous session
node client/index.mjs

# With custom cookies path
node client/index.mjs --cookies ./my-cookies.json
```

---

## How It Works

The ChatGPT web API is protected by multiple anti-abuse layers. This project implements them all natively:

| Layer | Approach |
|---|---|
| **Cloudflare** | Cookie reuse + exponential backoff + UA rotation |
| **Proof-of-Work** | FNV-1a 32-bit hash solver in pure JS |
| **Turnstile** | Bytecode decompiler + 13-opcode VM runner |
| **Sentinel** | Token handshake via `/backend-api/sentinel/req` |
| **Conduit** | Session routing token from `/backend-anon/conduit` |
| **SSE** | Streaming parser with patch-array delta encoding |

Every request mirrors what a real browser sends — same headers, same timing, same cookie flow.

---

## API

### `new ChatGPT(opts)`

| Option | Type | Default | Description |
|---|---|---|---|
| `cookies` | `string` or `string[]` | auto | Path to cookies.json, or array of cookie strings |
| `deviceId` | `string` | random UUID | Stable device identifier |
| `timezoneOffset` | `number` | `-180` | Minutes from UTC |
| `model` | `string` | `"auto"` | Model override |
| `historyDisabled` | `boolean` | `true` | Disable training on conversations |

### Methods

| Method | Returns | Description |
|---|---|---|
| `init()` | — | Initialize session (PoW, Turnstile, Conduit) |
| `ask(text, opts?)` | `string` | Send message, get reply |
| `streamAsk(text, opts?)` | `AsyncIterable` | Stream response chunk by chunk |
| `searchWeb(query)` | `array` | Web search results |
| `getModels()` | `object` | Available models |
| `getVoices()` | `object` | Available voices |
| `generateSpeech(text, voiceId)` | `Buffer` | Text-to-speech audio |
| `generateImage(prompt)` | `array` | DALL-E generated images |
| `getProfile()` | `object` | Account profile *(auth)* |
| `getConversations()` | `object` | Conversation history *(auth)* |
| `getBillingInfo()` | `object` | Subscription info *(auth)* |
| `getSettings()` | `object` | Account settings *(auth)* |
| `getMemory()` | `object` | Saved memories *(auth)* |
| `getProjects()` | `array` | Project list *(auth)* |

### `ask()` Options

```javascript
await client.ask("message", {
  files: ["./doc.pdf"],        // Attach files
  conversationId: "...",        // Continue conversation
  parentMessageId: "...",       // Branch from message
  model: "gpt-4o",             // Override model
  historyDisabled: true,        // Disable training
})
```

---

## Project Structure

```
chatgpt-unofficial-api/
├── src/                   # Core engine
│   ├── pow.mjs            # FNV-1a PoW solver
│   ├── turnstile.mjs      # Turnstile bytecode VM
│   ├── cloudflare.mjs     # CF bypass + retry
│   ├── sentinel.mjs       # Anti-abuse tokens
│   ├── sse.mjs            # SSE parser
│   └── upload.mjs         # File upload pipeline
├── client/                # Standalone client (zero deps)
│   ├── index.mjs          # Entry point
│   ├── cookies.json.example
│   ├── package.json
│   └── _test_quick.mjs    # Test suite
├── chatgpt.mjs            # Anonymous entry
├── chatgpt-auth.mjs       # Pro entry
├── package.json
├── README.md
├── LICENSE
└── .gitignore
```

---

## Pro Plan

Need email/password login, auto signup with OTP, or 148tls-fetch Cloudflare bypass for tougher environments? The Pro version provides:

- Full email/password authentication
- Automatic account signup with OTP handling
- 148tls-fetch TLS fingerprint bypass
- All `/backend-api/*` endpoints

**Contact [@etrnkz](https://t.me/etrnkz)** on Telegram for access.

```bash
# Pro CLI
node chatgpt-auth.mjs --email user@example.com --password mypass

# Pro signup
node chatgpt-auth.mjs --email user@example.com --signup --name "John Doe"
```

---

## License

MIT
