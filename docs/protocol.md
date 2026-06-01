# Protocol

## Anti-Abuse Pipeline

ChatGPT's web API is protected by multiple layers. This client implements them all natively — no browser, WASM, or third-party service required.

### 1. Cloudflare Bypass

Requests are routed through a `CFBypass` class that:

- Reuses `cf_clearance` cookies from a real browser session
- Rotates User-Agent on every retry (Chrome 120-130, Edge, Firefox)
- Retries with exponential backoff: 1s → 2s → 4s → 8s → 16s
- Wraps all fetch calls with automatic retry on 403/429/5xx

### 2. Proof of Work

The server sends a difficulty array:

```
[4880, dateString, 4294705152, nonce, userAgent, null, ...]
```

The client solves FNV-1a 32-bit PoW by brute-forcing the nonce until the hash has N leading zero bits. Higher request frequency = higher difficulty. The solver is pure JavaScript, no WASM.

### 3. Turnstile

Cloudflare Turnstile challenges are delivered as bytecode, not JavaScript. The client includes a full 13-opcode VM (mov, add, sub, xor, jmp, call, ret, push, pop, cmp, nop) that executes the bytecode directly and produces a valid Turnstile token.

### 4. Sentinel

Before every conversation, a fresh anti-abuse token is requested from `/backend-api/sentinel/req` (or `/backend-anon/sentinel/chat-requirements` for anonymous). This token is HMAC-signed to the session and included as a request header.

### 5. Conduit

A conduit token is fetched from `/backend-anon/conduit` or `/backend-api/conduit` for session routing and rate-limit partitioning.

## SSE Protocol

Conversation responses use server-sent events with two message types:

### Append

```json
{"o": "append", "d": {"message": {"id": "...", "content": {"parts": ["..."]}}}}
```

### Patch (delta encoding)

```json
{"o": "patch", "v": [
  ["d.message.content.parts.0", "replace", "Hello"],
  ["d.message.id", "replace", "msg_123"]
]}
```

Multiple SSE events can arrive in a single data packet separated by `\n\n`.

## Browser Mirroring

Every request mimics a real browser:

- `oai-device-id`: stable UUID
- `oai-client-version`: build number
- `oai-language`: en-US
- `user-agent`: Chrome 140 on Windows
- `oai-echo-logs`: randomized but plausible browser timestamps
- `x-oai-turn-trace-id`: random UUID

No `content-type` header is sent on GET/HEAD/DELETE requests.

## Endpoints

### Anonymous
| Endpoint | Method |
|----------|--------|
| `/backend-anon/f/conversation` | POST |
| `/backend-anon/sentinel/chat-requirements` | POST |
| `/backend-anon/conduit` | GET |
| `/backend-anon/files` | POST |
| `/backend-anon/files/{id}/uploaded` | POST |

### Authenticated
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/session` | GET | Get access token from cookies |
| `/backend-api/f/conversation` | POST | Send message |
| `/backend-api/models` | GET | List models |
| `/backend-api/me` | GET | Profile |
| `/backend-api/accounts` | GET | Account info |
| `/backend-api/settings` | GET | Settings |
| `/backend-api/billing/info` | GET | Billing info |
| `/backend-api/conversations` | GET | List conversations |
| `/backend-api/conversation/{id}` | GET/POST/DELETE | Conversation CRUD |
| `/backend-api/voices` | GET | Voices |
| `/backend-api/audio/speech` | POST | TTS |
| `/backend-api/images/generations` | POST | DALL-E |
| `/backend-api/gizmos` | GET | GPTs |
| `/backend-api/projects` | GET | Projects |
| `/backend-api/personalization` | GET | Custom instructions |
| `/backend-api/memory` | GET | Memory |
| `/backend-api/sentinel/req` | POST | Sentinel token |
| `/backend-api/conduit` | POST | Conduit token |
