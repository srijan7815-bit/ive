'use strict';
/**
 * IVE — model providers.
 * Canonical conversation format mirrors OpenAI's (assistant.tool_calls / role:"tool").
 * Anthropic is adapted at the edge. Ollama speaks the OpenAI dialect.
 */

const PRESETS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    keyHint: 'sk-…',
    docs: 'https://platform.openai.com/api-keys'
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    keyHint: 'sk-ant-…',
    docs: 'https://console.anthropic.com/settings/keys'
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    keyHint: 'not needed',
    docs: 'https://ollama.com'
  }
};

class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

async function postJSON(url, headers, body, { timeout = 120_000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (e.name === 'AbortError') throw new ProviderError(signal && signal.aborted ? 'Cancelled.' : 'The model took too long to answer.', 0);
    throw new ProviderError(`Could not reach ${new URL(url).host}. ${e.message}`, 0);
  }
  clearTimeout(timer);
  if (signal) signal.removeEventListener('abort', onAbort);

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error?.type || json?.message || text.slice(0, 400) || res.statusText;
    throw new ProviderError(msg, res.status);
  }
  return json;
}

/* ------------------------------- OpenAI ------------------------------- */

function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null };
      if (m.tool_calls?.length) msg.tool_calls = m.tool_calls;
      out.push(msg);
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

async function openaiChat({ baseUrl, apiKey, model, temperature, system, messages, tools, signal }) {
  const body = {
    model,
    messages: toOpenAIMessages(system, messages),
    max_tokens: 4096
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
    body.tool_choice = 'auto';
  }
  const json = await postJSON(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    authorization: `Bearer ${apiKey || 'ollama'}`
  }, body, { signal });

  const choice = json.choices?.[0];
  if (!choice) throw new ProviderError('The model returned an empty response.', 200);
  const msg = choice.message || {};
  const toolCalls = (msg.tool_calls || []).map((tc) => {
    let args = {};
    try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { args = {}; }
    return { id: tc.id, name: tc.function?.name, args };
  });
  return { text: msg.content || '', toolCalls, stop: choice.finish_reason, usage: json.usage };
}

/* ------------------------------ Anthropic ----------------------------- */

function contentForAnthropic(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((block) => {
    if (block.type === 'image') {
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(block.dataUrl || '');
      if (!m) return { type: 'text', text: '[image unavailable]' };
      return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    }
    return { type: 'text', text: block.text || '' };
  });
}

function toAnthropicMessages(messages) {
  const out = [];
  let pendingToolResults = [];
  const flush = () => {
    if (pendingToolResults.length) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content.slice(0, 40_000) : '(ok)'
      });
      continue;
    }
    flush();
    if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls || []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeJSON(tc.function.arguments) });
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({ role: 'user', content: contentForAnthropic(m.content) });
    }
  }
  flush();
  return out;
}

function safeJSON(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return {}; }
}

async function anthropicChat({ baseUrl, apiKey, model, temperature, system, messages, tools, signal }) {
  const body = {
    model,
    max_tokens: 4096,
    system,
    messages: toAnthropicMessages(messages)
  };
  if (typeof temperature === 'number') body.temperature = Math.min(temperature, 1);
  if (tools?.length) {
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  const json = await postJSON(`${(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  }, body, { signal });

  const blocks = json.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const toolCalls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
    id: b.id, name: b.name, args: b.input || {}
  }));
  return { text, toolCalls, stop: json.stop_reason, usage: json.usage };
}

function makeProvider(cfg) {
  const p = cfg.provider || 'openai';
  const preset = PRESETS[p] || PRESETS.openai;
  const baseUrl = (cfg.baseUrl || preset.baseUrl).replace(/\/$/, '');
  const model = cfg.model || preset.model;
  const apiKey = cfg.apiKey || '';
  const common = { baseUrl, apiKey, model, temperature: cfg.temperature };

  if (p === 'anthropic') {
    return { name: p, model, supportsVision: true, chat: (req) => anthropicChat({ ...common, ...req }) };
  }
  return {
    name: p,
    model,
    supportsVision: p !== 'ollama',
    chat: (req) => openaiChat({ ...common, ...req })
  };
}

async function testConnection(cfg) {
  const provider = makeProvider({ ...cfg, temperature: 0 });
  const started = Date.now();
  const res = await provider.chat({
    system: 'Reply with exactly: IVE-OK',
    messages: [{ role: 'user', content: 'ping' }],
    tools: [],
    signal: AbortSignal.timeout(45_000)
  });
  return { ok: true, ms: Date.now() - started, reply: (res.text || '').trim().slice(0, 60), model: provider.model };
}

module.exports = { makeProvider, testConnection, PRESETS, ProviderError };
