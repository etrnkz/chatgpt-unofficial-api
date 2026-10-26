# Guide

## Setup

```sh
npm install @etrnkz/chatgpt
```

Or clone the repo:

```sh
git clone https://github.com/etrnkz/chatgpt-unofficial-api.git
cd chatgpt-unofficial-api
```

---

## 1. Web Version (`ChatGPTWeb`)

Works out of the box with zero login required:

```javascript
import { ChatGPTWeb } from "@etrnkz/chatgpt/web";

const client = new ChatGPTWeb();
await client.init();

// Single prompt
const reply = await client.ask("Hello!");
console.log(reply);

// Streaming
for await (const chunk of client.streamAsk("Tell me a story")) {
  process.stdout.write(chunk.text);
}

// File attachments
const summary = await client.ask("Summarize this file", {
  files: ["./notes.txt"]
});

// Web search
const results = await client.searchWeb("Latest news");
```

### With cookies

Export cookies from your browser to `cookies.json`:

```json
[
  { "name": "__Secure-next-auth.session-token", "value": "..." },
  { "name": "cf_clearance", "value": "..." }
]
```

Pass the file path or raw string:

```javascript
const client = new ChatGPTWeb({
  cookiesFile: "./cookies.json"
});
await client.init();

const profile = await client.getProfile();
const conversations = await client.getConversations();
```

---

## 2. Mobile App Version (`ChatGPTApp`)

Connects directly to `https://android.chat.openai.com`:

```javascript
import { ChatGPTApp } from "@etrnkz/chatgpt/app";

const app = new ChatGPTApp({
  accessToken: process.env.CHATGPT_TOKEN
});
await app.init();

// Fetch mobile model catalog
const catalog = await app.getModels();
console.log(catalog.models.map(m => m.title));

// Chat over mobile edge
const reply = await app.ask("Hello");
console.log(reply);
```

---

## 3. CLI

```sh
# Ask via web backend
npx @etrnkz/chatgpt "What is 2+2?"

# Stream response
npx @etrnkz/chatgpt web "Tell me a story" --stream

# View models
npx @etrnkz/chatgpt models

# View voices
npx @etrnkz/chatgpt voices
```
