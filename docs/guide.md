# Guide

## Setup

### Install from npm

```sh
npm install chatgpt-unofficial-api
```

```js
import { ChatGPT } from 'chatgpt-unofficial-api';

const client = new ChatGPT();
await client.init();
```

### Or clone the repo

```sh
git clone https://github.com/etrnkz/chatgpt-unofficial-api.git
cd chatgpt-unofficial-api/client
node index.mjs
```

### With cookies

Export your ChatGPT cookies to `client/cookies.json`:

```json
[
  { "name": "__Secure-next-auth.session-token", "value": "..." },
  { "name": "cf_clearance", "value": "..." }
]
```

See `client/cookies.json.example` for the format. Once present, authenticated endpoints unlock automatically.

## Basic Chat

```js
import { ChatGPT } from './client/index.mjs';

const client = new ChatGPT();
await client.init();

const reply = await client.ask('Hello!');
console.log(reply);
```

## Streaming

```js
for await (const chunk of client.streamAsk('Tell me a story')) {
  if (chunk.text) process.stdout.write(chunk.text);
}
```

## Files

```js
const reply = await client.ask('What does this say?', {
  files: ['./report.pdf']
});
```

## Web Search

```js
const results = await client.searchWeb('Latest AI news');
```

## Voice

```js
const voices = await client.getVoices();
const audio = await client.generateSpeech('Hello', voices[0].id);
```

## Images

```js
const images = await client.generateImage('A cat in space');
```

## CLI

```sh
node client/index.mjs --help

# Anonymous
node client/index.mjs

# With custom cookies
node client/index.mjs --cookies ./my-cookies.json
```
