import { ChatGPTWeb } from "./index.mjs";

export class ChatGPTAuth extends ChatGPTWeb {
  /**
   * Extended ChatGPT web client with authentication & session recovery helpers.
   */
  constructor(opts = {}) {
    super(opts);
  }

  async loginWithSession(sessionToken) {
    if (sessionToken) this.sessionToken = sessionToken;
    await this._initAuth();
    if (!this.accessToken) {
      throw new Error("Failed to acquire access token from session token");
    }
    return this.accessToken;
  }
}

export default ChatGPTAuth;
