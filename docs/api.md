# API Reference

## Constructor

### `new ChatGPT(opts)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cookies` | `string \| string[]` | auto | Path to cookies.json or array of cookie strings |
| `deviceId` | `string` | random UUID | Stable device identifier |
| `timezoneOffset` | `number` | `-180` | Minutes from UTC |
| `model` | `string` | `"auto"` | Model override |
| `historyDisabled` | `boolean` | `true` | Disable training on conversations |

## Methods

### `init()`

Initialize session — solves PoW, runs Turnstile VM, gets Conduit token.

```js
await client.init();
```

### `ask(text, opts?)`

Send a message and get the reply text.

```js
const reply = await client.ask('What is 2+2?');
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `files` | `string[]` | File paths to attach |
| `conversationId` | `string` | Continue existing conversation |
| `parentMessageId` | `string` | Branch from specific message |
| `model` | `string` | Override model |
| `historyDisabled` | `boolean` | Disable training |

### `streamAsk(text, opts?)`

Same as `ask` but returns an async iterable of chunks.

```js
for await (const chunk of client.streamAsk('Tell me a story')) {
  if (chunk.text) process.stdout.write(chunk.text);
}
```

### `searchWeb(query)`

Search the web through ChatGPT.

```js
const results = await client.searchWeb('weather today');
```

### `getModels()`

Returns available models.

```js
const models = await client.getModels();
```

### `getVoices()`

Returns available voices for TTS.

```js
const voices = await client.getVoices();
```

### `generateSpeech(text, voiceId)`

Generate speech audio. Returns a Buffer.

```js
const audio = await client.generateSpeech('Hello', voiceId);
```

### `generateImage(prompt)`

Generate images with DALL-E. Returns an array of image objects.

```js
const images = await client.generateImage('A cat in space');
```

## Auth Methods (require cookies)

### `getProfile()`

```js
const profile = await client.getProfile();
```

### `getConversations(offset?, limit?)`

```js
const history = await client.getConversations();
```

### `getConversation(id)`

```js
const conv = await client.getConversation(convId);
```

### `getBillingInfo()`

```js
const billing = await client.getBillingInfo();
```

### `getSettings()`

```js
const settings = await client.getSettings();
```

### `getMemory()`

```js
const memory = await client.getMemory();
```

### `getProjects()`

```js
const projects = await client.getProjects();
```

### `getGizmos()`

List available GPTs.

```js
const gizmos = await client.getGizmos();
```

### `getPersonalization()`

Get custom instructions.

```js
const instructions = await client.getPersonalization();
```
