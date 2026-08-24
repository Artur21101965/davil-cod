// lib/clean.js — response cleaning helpers.
// Strips <think>...</think> reasoning blocks that some free models
// (qwen, nemotron) inject into answers — they pollute short content.

// Remove think blocks from a text string (case-insensitive, greedy-safe).
function stripThink(text) {
  if (!text) return text;
  let out = text;
  // Handle <think> and <thinking> tags in any case, spanning newlines
  out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
  // Collapse 3+ newlines into 2, then trim
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

// Strip think content from a non-streaming completion message (in place).
function cleanMessage(message) {
  if (!message) return;
  if (typeof message.content === 'string') {
    message.content = stripThink(message.content);
  }
  return message;
}

// Strip think content from a streaming delta (in place).
function cleanDelta(delta) {
  if (!delta) return;
  if (typeof delta.content === 'string') {
    delta.content = stripThink(delta.content);
  }
  return delta;
}

module.exports = { stripThink, cleanMessage, cleanDelta };
