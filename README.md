<p align="center">
  <img src="assets/banner.svg?t=2" alt="ChatGPT Unofficial API">
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

Clone and run — zero dependencies, no install needed.

```sh
git clone https://github.com/etrnkz/chatgpt-unofficial-api.git
cd chatgpt-unofficial-api/client
```

```js
import { ChatGPT } from './index.mjs';

const client = new ChatGPT();
await client.init();

const answer = await client.ask('What is the capital of France?');
console.log(answer);
// The capital of France is Paris.
```

> npm package coming soon.

## Features

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


## Pro

Need email/password login, auto signup,dev support , robust antibot detaction and more Contact [etrnkz](https://t.me/etrnkz) on Telegram.



## License

MIT &copy; [etrnkz](https://github.com/etrnkz)
