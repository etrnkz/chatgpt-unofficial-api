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
