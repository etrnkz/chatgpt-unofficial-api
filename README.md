# ChatGPT Free & Pro

Pure Node.js ChatGPT client with **zero dependencies**. Chat with GPT-4o, upload files, use voice, search the web — all without a browser, Playwright, or Puppeteer.

```bash
cd client && node index.mjs
```

## Features

| | Free | Pro (paid) |
|---|---|---|
| Anonymous chat | Yes | Yes |
| Cookie-based auth | Yes | Yes |
| Full email/password login | — | Yes |
| Auto signup with OTP | — | Yes |
| File upload | Yes (auth) | Yes |
| Voice / Audio | Yes | Yes |
| Web search | Yes | Yes |
| Image generation (DALL·E) | Yes | Yes |
| Apps / GPTs | Yes | Yes |
| Projects | Yes | Yes |
| Conversation CRUD | Yes | Yes |
| Custom instructions / Memory | Yes | Yes |
| Billing info | Yes | Yes |
| Cloudflare bypass | Cookie-based | 148tls-fetch |
| Anti-abuse (PoW, Turnstile) | Full native | Full native |

## Quick Start

### Free client (no login)

```bash
cd client
node index.mjs
```

Or use it as a local CLI:

```bash
cd client
npm link
chatgpt-free
```

### With browser cookies (optional)

Export your ChatGPT cookies to `client/cookies.json` for authenticated features:

```json
[
  {
    "name": "__Secure-next-auth.session-token",
    "value": "your-session-token-here"
  },
  {
    "name": "cf_clearance",
    "value": "your-cf-clearance-token"
  }
]
```

Copy `client/cookies.json.example` and fill in your values. When cookies are present, the client authenticates automatically and unlocks:
- File uploads
- Conversation history
- Custom instructions
- Billing info
- All `/backend-api/*` endpoints

### Pro client (contact [@etrnkz](https://t.me/etrnkz))

```bash
npm install 148tls-fetch  # private package
node chatgpt-auth.mjs
```

Full email/password login, auto signup, 148tls-fetch Cloudflare bypass.

## Usage

### Basic chat

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

### With files

```javascript
const reply = await client.ask("What does this file contain?", {
  files: ["./document.pdf"]
});
```

### Web search

```javascript
const results = await client.searchWeb("Latest AI news");
```

### Voice

```javascript
const voices = await client.getVoices();
const audio = await client.generateSpeech("Hello world", voices[0].id);
```

### Image generation

```javascript
const images = await client.generateImage("A cat in space");
```

### Auth-only endpoints (with cookies)

```javascript
const profile = await client.getProfile();
const conversations = await client.getConversations();
const billing = await client.getBillingInfo();
const models = await client.getModels();
```

## How it Works

This project reverse-engineers the ChatGPT web API to work entirely without a browser:

- **Proof-of-Work**: Native FNV-1a 32-bit PoW solver (`pow.mjs`), no WASM required
- **Turnstile**: Full bytecode decompiler and VM for Cloudflare Turnstile challenges (`turnstile.mjs`)
- **Sentinel**: Anti-abuse token generation matching browser behavior (`sentinel.mjs`)
- **SSE**: Server-sent events parser handling streaming, batched ops, and patch-array delta encoding (`sse.mjs`)
- **Cloudflare**: Cookie-based bypass with exponential backoff and UA rotation (`cloudflare.mjs`)
- **File Upload**: 3-step pipeline with automatic MIME and dimension detection (`upload.mjs`)

## Project Structure

```
chatgpt/
├── src/                   # Core modules
│   ├── pow.mjs            # FNV-1a PoW solver
│   ├── turnstile.mjs      # Turnstile bytecode VM
│   ├── cloudflare.mjs     # CF bypass with retry
│   ├── sentinel.mjs       # Anti-abuse tokens
│   ├── sse.mjs            # SSE streaming parser
│   └── upload.mjs         # File upload pipeline
├── client/                # Standalone client (zero deps)
│   ├── index.mjs          # Entry: dual-mode (anon / auth)
│   ├── cookies.json.example
│   ├── package.json       # npm-ready: chatgpt-free
│   └── ... (module copies)
├── chatgpt.mjs            # Anonymous client entry
├── chatgpt-auth.mjs       # Auth client entry (Pro)
├── package.json
├── README.md
├── LICENSE
└── .gitignore
```

## CLI

```bash
node client/index.mjs --help

# Anonymous session
node client/index.mjs

# With cookies
node client/index.mjs --cookies ./my-cookies.json

# Pro login
node chatgpt-auth.mjs --email user@example.com --password mypass

# Pro signup
node chatgpt-auth.mjs --email user@example.com --signup --name "John Doe"
```

## License

MIT
