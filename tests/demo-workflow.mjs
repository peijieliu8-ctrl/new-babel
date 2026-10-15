import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { io as createClient } from 'socket.io-client';

const tempDir = mkdtempSync(path.join(tmpdir(), 'canvas-demo-story-'));
process.env.PORT = '0';
process.env.DATA_DIR = tempDir;
const { httpServer, io } = await import('../server.js');
if (!httpServer.listening) await once(httpServer, 'listening');
const base = `http://127.0.0.1:${httpServer.address().port}`;
const sockets = [];

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await new Promise((resolve) => io.close(resolve));
  rmSync(tempDir, { recursive: true, force: true });
});

async function connect() {
  const socket = createClient(base, { transports: ['websocket'], autoConnect: false });
  sockets.push(socket);
  socket.connect();
  await once(socket, 'connect');
  return socket;
}

async function command(socket, event, payload) {
  const result = await socket.timeout(3_000).emitWithAck(event, payload);
  if (!result?.ok) throw new Error(`${event}: ${result?.error || '未返回成功结果'}`);
  return result;
}

async function board(boardId) {
  const response = await fetch(`${base}/api/boards/${boardId}`);
  assert.equal(response.ok, true);
  return (await response.json()).board;
}

test('13-step guided story creates cited decision, independent acceptance and completed matter', async () => {
  const window = {};
  const source = readFileSync(new URL('../public/demo-workflow.js', import.meta.url), 'utf8');
  runInNewContext(source, {
    window,
    fetch: (url, options) => fetch(new URL(url, base), options),
  });
  const story = window.demoWorkflow;
  assert.ok(story);
  const steps = story.createSteps({
    demoHost: (run, event, payload) => command(run.host, event, { boardId: run.boardId, ...payload }),
    demoPeer: (run, event, payload) => command(run.peer, event, { boardId: run.boardId, ...payload }),
    waitForDemoCard: async (run, cardId, version) => {
      const saved = (await board(run.boardId)).cards.find((card) => card.id === cardId);
      assert.equal(saved?.version, version);
    },
    fitCanvas: () => {}, focusCard: () => {}, switchPanel: () => {},
    showDemoAgent: () => {}, renderAgentPreview: () => {}, showWorkspaceView: () => {},
    state: { preview: null },
  });
  assert.equal(steps.length, 13);
  assert.ok(steps.every((step) => step.title && step.detail && step.actor && typeof step.run === 'function'));
  assert.ok(steps.every((step) => !/节省\s*\d+|提效\s*\d+/.test(step.detail)));

  const response = await fetch(`${base}/api/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(story.boardRequest),
  });
  assert.equal(response.status, 201);
  const { boardId } = await response.json();
  const run = { boardId, host: await connect(), peer: await connect() };
  await command(run.host, 'board:join', { boardId, nickname: story.hostNickname });
  await command(run.peer, 'board:join', { boardId, nickname: story.peerNickname });

  for (const [index, step] of steps.entries()) {
    await step.run(run);
    if (index === 5) {
      const beforePublish = await board(boardId);
      assert.equal(beforePublish.audit.some((item) => item.action === 'agent_card_published'), false);
      assert.equal(beforePublish.cards.some((card) => card.text.includes('【模拟 Agent 建议】')), false);
    }
  }

  const saved = await board(boardId);
  const decision = saved.decisions.at(-1);
  const task = saved.cards.find((card) => card.type === 'task');
  assert.equal(saved.workflow, 'matter');
  assert.equal(saved.goal.completed, true);
  assert.equal(decision.status, 'confirmed');
  assert.equal(decision.decidedBy, story.hostNickname);
  assert.equal(decision.evidenceRefs.length, 2);
  assert.equal(decision.objectionResolutions.length, 1);
  assert.ok(decision.evidenceRefs.every((ref) => {
    const evidence = saved.cards.find((card) => card.id === ref.cardId);
    return evidence?.source?.reference && evidence.source.version === ref.sourceVersion;
  }));
  assert.equal(task.owner, story.peerNickname);
  assert.equal(task.reviewer, story.hostNickname);
  assert.equal(task.status, 'done');
  assert.equal(task.acceptance.submittedBy, story.peerNickname);
  assert.equal(task.acceptance.acceptedBy, story.hostNickname);
  assert.equal(task.acceptance.acceptedDecisionId, decision.id);
  assert.ok(saved.audit.some((item) => item.action === 'board_completed'));
});
