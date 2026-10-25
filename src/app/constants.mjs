/**
 * Official ChatGPT Mobile (Android/iOS) API Constants & Endpoints
 * Reverse-engineered from official com.openai.chatgpt base.apk
 */

export const MOBILE_BASE_URL = "https://android.chat.openai.com";
export const CODEX_REMOTE_WSS = "wss://codex-cloud-backend.chatgpt.com/";
export const REALTIME_VOICE_BASE = "https://android.chat.openai.com/realtime/";

export const DEFAULT_ANDROID_UA = "ChatGPT/1.2026.265 (Android 14; Mobile; 2626541)";
export const DEFAULT_IOS_UA = "ChatGPT/1.2026.265 (iOS 17.5; Mobile)";

export const CLIENT_TYPES = {
  ANDROID: "android",
  IOS: "ios",
};

export const PACKAGE_NAMES = {
  ANDROID: "com.openai.chatgpt",
  IOS: "com.openai.chat",
};

export const OAUTH_REDIRECT_URIS = {
  ANDROID: "com.openai.chat://auth0.openai.com/android/com.openai.chatgpt/callback",
  CUSTOM: "com.openai.chatgpt://auth_redirect",
};

export const MOBILE_ENDPOINTS = {
  SENTINEL_ANON: "/backend-anon/sentinel/chat-requirements",
  SENTINEL_AUTH: "/backend-api/sentinel/chat-requirements",
  CONDUIT_PREPARE_ANON: "/backend-anon/f/conversation/prepare",
  CONDUIT_PREPARE_AUTH: "/backend-api/f/conversation/prepare",
  CONVERSATION_ANON: "/backend-anon/f/conversation",
  CONVERSATION_AUTH: "/backend-api/f/conversation",
  MODELS: "/backend-api/models",
  MODELS_ANON: "/backend-anon/models",
  CONVERSATIONS: "/backend-api/conversations",
  CONVERSATION_ITEM: (id) => `/backend-api/conversation/${id}`,
  USER_SETTINGS: "/backend-api/settings/user",
  MEMORIES: "/backend-api/memories",
};
