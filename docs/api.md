# API Reference — @etrnkz/chatgpt

The library exposes two client classes, a universal factory, and core utilities.

```javascript
import { ChatGPTWeb, ChatGPTApp, createChatGPT } from "@etrnkz/chatgpt";
```

---

## 1. `ChatGPTWeb` (Web Backend)

Targeting `https://chatgpt.com`.

### Constructor

```javascript
new ChatGPTWeb(options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `cookies` | `string \| Array<{name, value}>` | `null` | Cookie string or cookie objects |
| `cookiesFile` | `string` | `"./cookies.json"` | Path to cookie file |
| `accessToken` | `string` | `null` | OAuth/Session access token |
| `sessionToken` | `string` | `null` | `__Secure-next-auth.session-token` |
| `proxyUrl` | `string` | `null` | Proxy URL (`http://...`, `socks5://...`) |
| `maxRetries` | `number` | `3` | Retry attempts on Cloudflare challenge |
| `timeout` | `number` | `30000` | Request timeout in ms |
| `userAgent` | `string` | Chrome 140 UA | Custom desktop user agent |

### Methods

#### `init(): Promise<void>`
Initializes the session, reads dynamic buildId and deviceId from cookie, and configures PoW state.

#### `ask(message: string, options?: AskOptions): Promise<string>`
Sends a prompt and returns the full assistant text response.

*Options:*
- `model?: string` — Model slug (`"auto"`, `"gpt-4o"`, etc.)
- `files?: string[]` — Array of file paths to attach (multimodal)
- `image?: string` — Base64 image payload
- `forceSearch?: boolean` — Enable web search tool
- `systemHints?: string[]` — System guidance hints

#### `streamAsk(message: string, options?: AskOptions): AsyncGenerator<StreamChunk>`
Yields streaming response deltas:
```typescript
interface StreamChunk {
  text: string;
  accumulated: string;
  done: boolean;
  conversationId: string | null;
  messageId: string | null;
}
```

#### `searchWeb(query: string): Promise<string>`
Syntactic sugar for `ask(query, { forceSearch: true })`.

#### `askWithFiles(message: string, files: string[]): Promise<string>`
Uploads local files and passes them as multimodal attachments.

#### `getModels(): Promise<ModelInfo>`
Fetches web model options and tags.

#### `getVoices(): Promise<VoiceInfo>`
Returns available voice synthesizers (Maple, Cove, Breeze, Juniper, Ember, Sol, etc.) with preview URLs.

#### Authenticated Methods (Requires cookies or token)
- `getProfile(): Promise<UserProfile>` — Fetch current account email and name
- `getAccount(): Promise<AccountStatus>` — Check account subscription status
- `getSettings(): Promise<UserSettings>` — User preferences
- `getBillingInfo(): Promise<BillingInfo>` — Customer portal link
- `getConversations(offset?: number, limit?: number): Promise<ConversationList>` — History list
- `getConversation(convId: string): Promise<ConversationDetail>` — Thread messages
- `renameConversation(convId: string, title: string): Promise<any>` — Rename thread
- `deleteConversation(convId: string): Promise<any>` — Remove thread
- `getGizmos(): Promise<GizmoList>` — Custom GPTs
- `getGizmo(gizmoId: string): Promise<GizmoDetail>` — Specific GPT metadata
- `getMemory(): Promise<any>` — Custom user memory facts
- `deleteMemory(memoryId: string): Promise<any>` — Delete a specific memory fact
- `clearMemory(): Promise<any>` — Clear all memories

---

## 2. `ChatGPTApp` (Mobile Backend)

Targeting `https://android.chat.openai.com`.

### Constructor

```javascript
new ChatGPTApp(options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `accessToken` | `string` | `null` | Mobile OAuth Bearer token |
| `deviceId` | `string` | random UUID | Persistent Android device UUID |
| `clientType` | `"android" \| "ios"` | `"android"` | Identity client type header |
| `packageName` | `string` | `"com.openai.chatgpt"` | Official app package name |
| `userAgent` | `string` | Android 14 UA | Official mobile User-Agent |
| `playIntegrityToken` | `string` | `null` | Google Play Integrity token |
| `proxyUrl` | `string` | `null` | Proxy URL |
| `timeout` | `number` | `35000` | Timeout in ms |

### Methods

#### `init(): Promise<void>`
Initializes client deviceId and mobile config state.

#### `getChatRequirements(): Promise<SentinelRequirements>`
Fetches Sentinel PoW seed and challenge difficulty from `android.chat.openai.com`.

#### `getConduit(next?: boolean): Promise<string>`
Performs mobile conduit handshake (`/f/conversation/prepare`) and returns `conduit_token`.

#### `ask(message: string, options?: { model?: string }): Promise<string>`
Executes mobile conversation. If Play Integrity is missing on anonymous conversation, throws structured error with code `PLAY_INTEGRITY_REQUIRED`.

#### `streamAsk(message: string, options?: { model?: string }): AsyncGenerator<StreamChunk>`
Streams chunks directly from mobile SSE endpoint.

#### `getModels(): Promise<MobileModelCatalog>`
Returns the official Android APK model catalog, including GPT-6, GPT-5.6 Luna, thinking effort settings, and preset categories.

#### `getConversations(offset?: number, limit?: number): Promise<any>`
Retrieves mobile conversation threads.

#### `getConversation(convId: string): Promise<any>`
Retrieves messages for a mobile conversation thread.

#### `renameConversation(convId: string, title: string): Promise<any>`
Renames a mobile conversation.

#### `deleteConversation(convId: string): Promise<any>`
Deletes a mobile conversation.

#### `getSettings(): Promise<any>`
Fetches mobile user speech, language, and account settings.

#### `getMemories(): Promise<any>`
Fetches user mobile memories.

---

## 3. Universal Factory `createChatGPT`

```javascript
import { createChatGPT } from "chatgpt-unofficial-api";

// Returns ChatGPTWeb instance
const web = createChatGPT({ type: "web" });

// Returns ChatGPTApp instance
const app = createChatGPT({ type: "app", accessToken: "..." });
```
