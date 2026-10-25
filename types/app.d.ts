import { StreamChunk } from "./web.js";

export interface MobileModelCatalog {
  title?: string;
  models?: Array<{
    slug: string;
    title: string;
    description: string;
    tags?: string[];
    capabilities?: Record<string, any>;
    reasoning_type?: string;
  }>;
  categories?: any[];
  versions?: any[];
  default_model_slug?: string;
}

export interface ChatGPTAppOptions {
  accessToken?: string;
  deviceId?: string;
  clientType?: "android" | "ios";
  packageName?: string;
  userAgent?: string;
  playIntegrityToken?: string;
  proxyUrl?: string;
  timeout?: number;
}

export class ChatGPTApp {
  constructor(opts?: ChatGPTAppOptions);

  accessToken: string | null;
  deviceId: string;
  clientType: "android" | "ios";
  packageName: string;
  userAgent: string;
  conversationId: string | null;
  parentMessageId: string | null;
  readonly isAuthenticated: boolean;

  static readonly CODEX_REMOTE_URL: string;
  static readonly REALTIME_VOICE_URL: string;

  init(): Promise<void>;
  getChatRequirements(): Promise<any>;
  getConduit(next?: boolean): Promise<string>;

  ask(message: string, options?: { model?: string }): Promise<string>;
  streamAsk(message: string, options?: { model?: string }): AsyncGenerator<StreamChunk, void, unknown>;

  getModels(): Promise<MobileModelCatalog>;
  getConversations(offset?: number, limit?: number): Promise<any>;
  getConversation(convId: string): Promise<any>;
  renameConversation(convId: string, title: string): Promise<any>;
  deleteConversation(convId: string): Promise<any>;
  getSettings(): Promise<any>;
  getMemories(): Promise<any>;
}

export const ChatGPTMobile: typeof ChatGPTApp;
export default ChatGPTApp;
