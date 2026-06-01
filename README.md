<p align="center">
  <img src="assets/banner.svg" alt="ChatGPT Unofficial API">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node 18+">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
  <img src="https://img.shields.io/badge/dependencies-0-lightgrey" alt="0 deps">
  <img src="https://img.shields.io/badge/status-active-success" alt="Active">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="docs/guide.md">Guide</a> •
  <a href="docs/api.md">API</a> •
  <a href="docs/protocol.md">Protocol</a>
</p>

---

<p align="center">
  <strong>Unofficial Node.js client for ChatGPT</strong>
  <br>
  No login required for chat. Cookies unlock files, voice, search, images & more.
  <br>
  Drop a <code>cookies.json</code> and go.
</p>

---

## Quick Start

### Install

```sh
npm install chatgpt-unofficial-api
```

```js
import { ChatGPT } from 'chatgpt-unofficial-api';

const client = new ChatGPT();
await client.init();

const answer = await client.ask('What is the capital of France?');
console.log(answer);
// The capital of France is Paris.
```

### Or clone the repo

```sh
git clone https://github.com/etrnkz/chatgpt-unofficial-api.git
cd chatgpt-unofficial-api/client
node index.mjs
```

## At a Glance

| Area | Methods | Auth |
|------|---------|------|
| Chat | `ask`, `streamAsk` | none |
| File upload | `ask` with `files` option | none |
| Web search | `searchWeb` | none |
| Conversations | `getConversations`, `getConversation` | cookie |
| Voice | `getVoices`, `generateSpeech` | cookie |
| Images | `generateImage` | cookie |
| Account | `getProfile`, `getSettings`, `getBillingInfo` | cookie |
| Projects | `getProjects` | cookie |
| Memory | `getMemory`, `deleteMemory` | cookie |
| Custom instructions | `getPersonalization`, `setPersonalization` | cookie |
| Apps / GPTs | `getGizmos`, `getGizmo`, `getApps` | cookie |

## Docs

| | |
|---|---|
| [Guide](docs/guide.md) | Setup, cookies, streaming, files, voice, images, CLI |
| [API Reference](docs/api.md) | Full docs for all methods — parameters, return types, examples |
| [Protocol](docs/protocol.md) | How the anti-abuse pipeline works under the hood |

## Pro

Need email/password login, auto signup, or 148tls-fetch Cloudflare bypass? Contact [@etrnkz](https://t.me/etrnkz) on Telegram.

```
node chatgpt-auth.mjs --email user@example.com --password mypass
```

## License

MIT &copy; [etrnkz](https://github.com/etrnkz)
