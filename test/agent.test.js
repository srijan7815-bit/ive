'use strict';
const http = require('http');
const fs = require('fs');
const { resolve, check, done } = require('./harness');
const { Agent } = resolve('src/main/ai/agent.js');

fs.mkdirSync('/tmp/ive-test', { recursive: true });
try { fs.writeFileSync('/tmp/ive-test/report.txt', ''); } catch {}

let step = 0;
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = JSON.parse(b || '{}');
    step++;
    const tooled = body.messages.some((m) => m.role === 'tool');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(tooled
      ? { choices: [{ message: { role: 'assistant', content: 'Wrote the report and made the folder.' }, finish_reason: 'stop' }] }
      : { choices: [{ message: { role: 'assistant', content: null, tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: '/tmp/ive-test/report.txt', content: 'hello from IVE' }) } },
          { id: 'c2', type: 'function', function: { name: 'shell_run', arguments: JSON.stringify({ command: 'echo quiet' }) } },
          { id: 'c3', type: 'function', function: { name: 'shell_run', arguments: JSON.stringify({ command: 'mkdir -p /tmp/ive-test/sub' }) } }
        ] }, finish_reason: 'tool_calls' }] }));
  });
});

server.listen(0, '127.0.0.1', () => {
  const approvals = [];
  const config = {
    all: () => ({
      provider: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'k', model: 'mock',
      temperature: 0, maxSteps: 6, vision: true,
      autoApprove: { reads: true, writes: true, automation: true, shell: false, network: true }
    }),
    get: () => undefined, set: () => {}
  };
  const agent = new Agent({
    config,
    music: { control: async () => ({ ok: true }) },
    historyStore: { get: () => [], set: () => {} },
    authorize: async (p) => { approvals.push(p.tool); return { id: 'allow', label: 'Allow once' }; },
    requestChoice: async () => ({ id: 'allow', label: 'Allow once' }),
    notify: () => {}, getSystemSummary: async () => ({ os: 'test' }), musicState: () => ({})
  });
  const logs = [];
  agent.on('log', (l) => logs.push(l));
  agent.on('error', (e) => { console.log('agent error', e); done(); });
  agent.on('done', (d) => {
    check('file written by agent', fs.readFileSync('/tmp/ive-test/report.txt', 'utf8') === 'hello from IVE');
    check('safe shell auto-approved', !approvals.includes('shell_run') || approvals.length === 1);
    check('risky shell prompted once', approvals.length === 1);
    check('risky shell executed', fs.existsSync('/tmp/ive-test/sub'));
    check('final answer returned', /Wrote the report/.test(d.text));
    check('two model round-trips', step === 2);
    check('tool events emitted', logs.filter((l) => l.type === 'tool').length === 3);
    server.close();
    done();
  });
  agent.ask('write the report and make a folder');
});
