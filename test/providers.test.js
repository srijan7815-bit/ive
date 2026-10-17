'use strict';
const http = require('http');
const { resolve, check, done } = require('./harness');
const { makeProvider } = resolve('src/main/ai/providers.js');

(async () => {
  /* ---------- OpenAI-compatible ---------- */
  let openaiBody = null;
  const openai = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      openaiBody = JSON.parse(b);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"~/x"}' } }
      ] }, finish_reason: 'tool_calls' }] }));
    });
  });
  await new Promise((r) => openai.listen(0, '127.0.0.1', r));

  const p1 = makeProvider({ provider: 'openai', baseUrl: `http://127.0.0.1:${openai.address().port}/v1`, apiKey: 'k', model: 'gpt-test' });
  const r1 = await p1.chat({
    system: 'sys', messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'read_file', description: 'd', parameters: { type: 'object', properties: {} } }]
  });
  check('openai system message', openaiBody.messages[0].role === 'system');
  check('openai tools wrapped', openaiBody.tools[0].type === 'function');
  check('openai tool call parsed', r1.toolCalls[0].name === 'read_file' && r1.toolCalls[0].args.path === '~/x');
  openai.close();

  /* ---------- Anthropic ---------- */
  let antBody = null, step = 0;
  const ant = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b); step++;
      antBody = antBody || body;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(step === 1
        ? { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'tu_1', name: 'list_dir', input: { path: '~' } }], stop_reason: 'tool_use' }
        : { content: [{ type: 'text', text: 'All done.' }], stop_reason: 'end_turn' }));
    });
  });
  await new Promise((r) => ant.listen(0, '127.0.0.1', r));

  const p2 = makeProvider({ provider: 'anthropic', baseUrl: `http://127.0.0.1:${ant.address().port}`, apiKey: 'k2', model: 'claude-test' });
  const r2 = await p2.chat({
    system: 'sys',
    messages: [
      { role: 'user', content: 'look' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tu_0', type: 'function', function: { name: 'list_dir', arguments: '{"path":"/tmp"}' } }] },
      { role: 'tool', tool_call_id: 'tu_0', content: 'file a' }
    ],
    tools: [{ name: 'list_dir', description: 'd', parameters: { type: 'object', properties: {} } }]
  });
  check('anthropic system hoisted', antBody.system === 'sys');
  check('anthropic assistant tool_use', antBody.messages[1].content.some((x) => x.type === 'tool_use'));
  check('anthropic tool_result turn', antBody.messages[2].content[0].type === 'tool_result');
  check('anthropic input_schema', antBody.tools[0].input_schema !== undefined);
  check('anthropic tool call parsed', r2.toolCalls[0].name === 'list_dir');
  check('anthropic text parsed', r2.text === 'Looking.');
  ant.close();

  /* ---------- error surfaces ---------- */
  const bad = http.createServer((req, res) => { res.statusCode = 401; res.end(JSON.stringify({ error: { message: 'bad key' } })); });
  await new Promise((r) => bad.listen(0, '127.0.0.1', r));
  const p3 = makeProvider({ provider: 'openai', baseUrl: `http://127.0.0.1:${bad.address().port}/v1`, apiKey: 'x', model: 'm' });
  let err = null;
  try { await p3.chat({ messages: [{ role: 'user', content: 'x' }], tools: [] }); } catch (e) { err = e; }
  check('auth error surfaced', err && /bad key/.test(err.message) && err.status === 401);
  bad.close();
  done();
})();
