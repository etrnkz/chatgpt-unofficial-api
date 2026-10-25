import { ChatGPTWeb } from "./web/index.mjs";
import { ChatGPTApp, ChatGPTMobile } from "./app/index.mjs";
import { ChatGPTAuth } from "./web/auth.mjs";
export * from "./core/index.mjs";
export * from "./app/constants.mjs";

export { ChatGPTWeb, ChatGPTApp, ChatGPTMobile, ChatGPTAuth };

// Default export is ChatGPTWeb for 100% backwards compatibility with v1
export const ChatGPT = ChatGPTWeb;
export default ChatGPT;

/**
 * Universal factory function to instantiate either Web or App client.
 *
 * @param {Object} [opts={}]
 * @param {"web"|"app"|"mobile"} [opts.type="web"] - Target backend type
 * @returns {ChatGPTWeb|ChatGPTApp}
 */
export function createChatGPT(opts = {}) {
  const type = (opts.type || "web").toLowerCase();
  if (type === "app" || type === "mobile") {
    return new ChatGPTApp(opts);
  }
  return new ChatGPTWeb(opts);
}
