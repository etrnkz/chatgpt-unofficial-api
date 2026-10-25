export interface StreamChunk {
  text: string;
  accumulated: string;
  done: boolean;
  conversationId: string | null;
  messageId: string | null;
}

export interface ModelInfo {
  models?: Array<{
    slug: string;
    max_tokens?: number;
    title?: string;
    description?: string;
    tags?: string[];
  }>;
  categories?: any[];
}

export interface VoiceInfo {
  selected?: string;
  voices?: Array<{
    voice: string;
    name: string;
    preview_url?: string;
    description?: string;
    accent?: string;
  }>;
}

export interface AskOptions {
  model?: string;
  files?: string[];
  image?: string;
  forceSearch?: boolean;
  systemHints?: string[];
}

export interface ChatGPTWebOptions {
  cookies?: string | Array<{ name: string; value: string }>;
  cookiesFile?: string;
  accessToken?: string;
  sessionToken?: string;
  proxyUrl?: string;
  maxRetries?: number;
  timeout?: number;
  userAgent?: string;
}

export class ChatGPTWeb {
  constructor(opts?: ChatGPTWebOptions);

  deviceId: string | null;
  buildId: string | null;
  conversationId: string | null;
  parentMessageId: string | null;
  accessToken: string | null;
  readonly isAuthenticated: boolean;

  init(): Promise<void>;
  ask(message: string, options?: AskOptions): Promise<string>;
  streamAsk(message: string, options?: AskOptions): AsyncGenerator<StreamChunk, void, unknown>;

  getModels(): Promise<ModelInfo>;
  getVoices(): Promise<VoiceInfo>;
  getVoiceSettings(): Promise<any>;
  searchWeb(query: string): Promise<string>;
  streamSearchWeb(query: string): AsyncGenerator<StreamChunk, void, unknown>;
  askWithImage(message: string, imagePath: string): Promise<string>;
  askWithFiles(message: string, filePaths: string[]): Promise<string>;

  // Authenticated methods
  getProfile(): Promise<any>;
  getAccount(): Promise<any>;
  getSettings(): Promise<any>;
  getBillingInfo(): Promise<any>;
  getConversations(offset?: number, limit?: number): Promise<any>;
  getConversation(convId: string): Promise<any>;
  renameConversation(convId: string, title: string): Promise<any>;
  deleteConversation(convId: string): Promise<any>;
  getGizmos(): Promise<any>;
  getGizmo(gizmoId: string): Promise<any>;
  getMemory(): Promise<any>;
  deleteMemory(memoryId: string): Promise<any>;
  clearMemory(): Promise<any>;
}

export class ChatGPTAuth extends ChatGPTWeb {
  loginWithSession(sessionToken?: string): Promise<string>;
}

export const ChatGPT: typeof ChatGPTWeb;
export default ChatGPTWeb;
