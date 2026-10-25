import { ChatGPTWeb, ChatGPTWebOptions, StreamChunk, ModelInfo, VoiceInfo } from "./web.js";
import { ChatGPTApp, ChatGPTAppOptions, MobileModelCatalog } from "./app.js";
import { ChatGPTAuth } from "./web.js";

export { ChatGPTWeb, ChatGPTApp, ChatGPTAuth };
export { ChatGPTApp as ChatGPTMobile };

/**
 * Default export is ChatGPTWeb for backwards compatibility with v1
 */
export const ChatGPT: typeof ChatGPTWeb;
export default ChatGPT;

export interface CreateChatGPTOptions extends ChatGPTWebOptions, ChatGPTAppOptions {
  /**
   * Target backend type:
   * - "web": chatgpt.com backend (anonymous or authenticated)
   * - "app" | "mobile": android.chat.openai.com mobile backend
   */
  type?: "web" | "app" | "mobile";
}

/**
 * Factory function to create either a Web or App client.
 */
export function createChatGPT(opts?: CreateChatGPTOptions): ChatGPTWeb | ChatGPTApp;

export * from "./web.js";
export * from "./app.js";
export * from "./core.js";
