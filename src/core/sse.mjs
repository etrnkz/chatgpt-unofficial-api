export function parseSSELine(line) {
  const trimmed = line.replace(/\r$/, "").trim();
  if (!trimmed.startsWith("data:") || trimmed.includes("[DONE]")) return null;
  try {
    return JSON.parse(trimmed.slice(5));
  } catch {
    return null;
  }
}

export function processSSEEvent(d, state) {
  if (!d) return null;

  const result = {};

  if (d.conversation_id) state.conversationId = d.conversation_id;
  if (d.message?.id) state.messageId = d.message.id;
  if (d.v?.message?.id) state.messageId = d.v.message.id;

  // resume_conversation_token with conversation_id
  if (d.type === "resume_conversation_token" && d.conversation_id) state.conversationId = d.conversation_id;

  // Full batched message (non-streaming mode)
  if (d.o === "add" && d.v?.message?.content?.content_type === "text" && d.v?.message?.author?.role === "assistant") {
    const parts = d.v.message.content.parts;
    if (Array.isArray(parts)) {
      result.text = parts.filter(p => typeof p === "string").join("");
      result.done = true;
    }
    return result;
  }

  // Incremental append (streaming mode)
  if (!state.contentDone && d.o === "append" && d.p === "/message/content/parts/0" && typeof d.v === "string") {
    result.text = d.v;
    return result;
  }

  // Full batched assistant message (buffered encoding: no `o`/`p` fields).
  // The assistant turn arrives as { v: { message: { author:{role:"assistant"},
  // content:{parts:[...]} } } } — the parts array holds the complete text.
  if (!state.contentDone && !d.o && !d.p && d.v?.message?.author?.role === "assistant") {
    const parts = d.v.message.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts.filter(p => typeof p === "string").join("");
      if (text) {
        result.text = text;
        state.contentDone = true;
        return result;
      }
    }
  }

  // Raw text delta (streaming mode, no 'o' field)
  if (!state.contentDone && typeof d.v === "string" && d.v.length > 0 && !d.o && !d.type) {
    result.text = d.v;
    return result;
  }

  // Patch operations (batched array)
  if (d.o === "patch" && Array.isArray(d.v)) {
    for (const op of d.v) {
      if (op.p === "/message/content/parts/0" && op.o === "append" && typeof op.v === "string") {
        result.text = (result.text || "") + op.v;
      }
      if (op.p === "/message/status" && op.o === "replace" && op.v === "finished_successfully") {
        result.done = true;
      }
    }
    if (result.text || result.done) return result;
  }

  // Finished status
  if (d.o === "replace" && d.p === "/message/status" && d.v === "finished_successfully") {
    result.done = true;
    return result;
  }

  return result;
}

export function parseSSEBuffer(text) {
  const state = { conversationId: null, messageId: null, contentDone: false };
  let content = "";

  for (const line of text.split("\n")) {
    const d = parseSSELine(line);
    const evt = processSSEEvent(d, state);
    if (!evt) continue;
    if (evt.text) content += evt.text;
    if (evt.done) state.contentDone = true;
  }

  return {
    content: content.trim(),
    conversationId: state.conversationId,
    messageId: state.messageId,
  };
}

export async function* streamSSEResponse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { conversationId: null, messageId: null, contentDone: false };
  let buffer = "";
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const d = parseSSELine(line);
      const evt = processSSEEvent(d, state);
      if (!evt) continue;

      if (evt.text) {
        accumulated += evt.text;
        yield { text: evt.text, accumulated, done: false, conversationId: state.conversationId, messageId: state.messageId };
      }
      if (evt.done) {
        state.contentDone = true;
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const d = parseSSELine(buffer.trim());
    const evt = processSSEEvent(d, state);
    if (evt?.text) {
      accumulated += evt.text;
      yield { text: evt.text, accumulated, done: true, conversationId: state.conversationId, messageId: state.messageId };
    }
  }

  yield { text: "", accumulated, done: true, conversationId: state.conversationId, messageId: state.messageId };
}

export async function parseStreamToText(response) {
  let content = "";
  for await (const chunk of streamSSEResponse(response)) {
    if (chunk.text) content += chunk.text;
  }
  return content.trim();
}

const MARKDOWN_ESCAPES = /\\([!-\/:-@\[-`{-~])/g;

/**
 * Removes backslash escapes from a rendered snapshot.
 * CommonMark allows backslash-escaping any ASCII punctuation character.
 */
export function unescapeMarkdown(text) {
  if (!text) return "";
  return String(text).replace(MARKDOWN_ESCAPES, "$1");
}

/**
 * Reconciles a new text candidate against accumulated text.
 * Keeps the longer/newer candidate.
 */
export function mergeSnapshot(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  if (candidate === current) return current;
  if (candidate.startsWith(current)) return candidate;
  if (current.startsWith(candidate)) return current;
  return candidate.length >= current.length ? candidate : current;
}

/**
 * Parses the application/vnd.openai.conversation-source+ndjson stream.
 */
export function parseMwebNdjson(text) {
  if (!text) return { content: "", backendConversationId: null, parentMessageId: null, userMessageCount: null, failure: null, events: [] };
  let content = "";
  let backendConversationId = null;
  let contentMessageId = null;
  let stateParentMessageId = null;
  let userMessageCount = 0;
  let failure = null;
  const events = [];

  const lines = String(text || "").split("\n");
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let ev;
    try { ev = JSON.parse(raw); } catch { continue; }
    events.push(ev);

    if (ev.type === "control" && ev.detail) {
      if (ev.detail.kind === "conversation-id" && ev.detail.conversationId) {
        backendConversationId = ev.detail.conversationId;
      }
      if (ev.detail.kind === "failed") {
        failure = ev.detail.failureReason || ("upstream status " + ev.detail.failureStatus);
      }
    }

    if (ev.type === "content") {
      const candidates = [];
      if (typeof ev.markdown === "string" && ev.markdown) candidates.push(unescapeMarkdown(ev.markdown));
      if (ev.dil && typeof ev.dil.fallbackMarkdown === "string" && ev.dil.fallbackMarkdown) {
        candidates.push(unescapeMarkdown(ev.dil.fallbackMarkdown));
      }
      for (const cand of candidates) {
        content = mergeSnapshot(content, cand);
      }
      if (ev.messageId) contentMessageId = ev.messageId;
    }

    if (ev.type === "state" && ev.conversationState) {
      try {
        const cs = JSON.parse(ev.conversationState);
        if (cs.backendConversationId) backendConversationId = cs.backendConversationId;
        if (cs.parentMessageId) stateParentMessageId = cs.parentMessageId;
        if (typeof cs.userMessageCount === "number") userMessageCount = cs.userMessageCount;
      } catch { /* ignore malformed state */ }
    }
  }

  const parentMessageId = stateParentMessageId || contentMessageId;

  if (!content) {
    let lastConstants = null;
    for (const ev of events) {
      if (ev.type === "content" && ev.dil && ev.dil.constants) lastConstants = ev.dil.constants;
    }
    if (lastConstants) {
      content = Object.keys(lastConstants)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => String(lastConstants[k]))
        .join("");
    }
  }

  return { content, backendConversationId, parentMessageId, userMessageCount, failure, events };
}

export async function* streamMwebNdjsonLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let lastEmittedLength = 0;
  let backendConversationId = null;
  let parentMessageId = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "control" && ev.detail?.conversationId) {
        backendConversationId = ev.detail.conversationId;
      }
      if (ev.type === "state" && ev.conversationState) {
        try {
          const cs = JSON.parse(ev.conversationState);
          if (cs.backendConversationId) backendConversationId = cs.backendConversationId;
          if (cs.parentMessageId) parentMessageId = cs.parentMessageId;
        } catch {}
      }
      if (ev.type === "content") {
        let cand = "";
        if (ev.dil && typeof ev.dil.fallbackMarkdown === "string") {
          cand = unescapeMarkdown(ev.dil.fallbackMarkdown);
        } else if (typeof ev.markdown === "string") {
          cand = unescapeMarkdown(ev.markdown);
        }
        if (cand) {
          accumulated = mergeSnapshot(accumulated, cand);
          if (accumulated.length > lastEmittedLength) {
            const delta = accumulated.slice(lastEmittedLength);
            lastEmittedLength = accumulated.length;
            yield {
              text: delta,
              accumulated,
              done: false,
              conversationId: backendConversationId,
              messageId: ev.messageId || parentMessageId,
            };
          }
        }
      }
    }
  }

  yield {
    text: "",
    accumulated,
    done: true,
    conversationId: backendConversationId,
    messageId: parentMessageId,
  };
}
