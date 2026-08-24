// lib/clean.js — response cleaning helpers.
// Strips <think>...</think> reasoning blocks that some free models
// (qwen, nemotron) inject into answers — they pollute short content.

// Remove think blocks from a text string (case-insensitive, greedy-safe).
// trim=true also trims whitespace (safe for full messages, NOT streaming deltas
// — trimming each streamed chunk eats the spaces between words).
function stripThink(text, trim = true) {
  if (!text) return text;
  let out = text;
  // Handle <think> and <thinking> tags in any case, spanning newlines
  out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
  if (trim) {
    out = out.replace(/\n{3,}/g, '\n\n').trim();
  } else {
    // Collapse 3+ newlines into 2, but keep leading/trailing spaces intact
    out = out.replace(/\n{3,}/g, '\n\n');
  }
  return out;
}

// Strip think content from a non-streaming completion message (in place).
function cleanMessage(message) {
  if (!message) return;
  if (typeof message.content === 'string') {
    message.content = stripThink(message.content, true);
  }
  return message;
}

// Fix reasoning-model responses: some free models (gpt-oss-120b, nemotron)
// put the answer in `reasoning` and leave `content` empty. If content is
// empty but reasoning has text, surface reasoning as the answer.
function fixReasoningMessage(message) {
  if (!message) return;
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  const reasoning = typeof message.reasoning === 'string' ? message.reasoning.trim() : '';
  if (!content && reasoning) {
    message.content = stripThink(reasoning, true);
  }
  return message;
}

// Strip think content from a streaming delta (in place).
// Do NOT trim — streaming chunks must keep their boundary spaces so words
// don't merge when the client reassembles the stream.
function cleanDelta(delta) {
  if (!delta) return;
  if (typeof delta.content === 'string') {
    delta.content = stripThink(delta.content, false);
  }
  return delta;
}

module.exports = { stripThink, cleanMessage, cleanDelta, fixReasoningMessage };
