import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as createClient } from 'socket.io-client';

const tempDir = mkdtempSync(path.join(tmpdir(), 'canvas-test-'));
process.env.PORT = '0';
process.env.DATA_DIR = tempDir;
const { httpServer, io } = await import('../server.js');
if (!httpServer.listening) await once(httpServer, 'listening');
const base = `http://127.0.0.1:${httpServer.address().port}`;
const clients = [];

after(async () => {
  for (const client of clients) client.disconnect();
  await new Promise((resolve) => io.close(resolve));
  rmSync(tempDir, { recursive: true, force: true });
});

async function client() {
  const socket = createClient(base, { transports: ['websocket'], autoConnect: false });
  clients.push(socket);
  socket.connect();
  await once(socket, 'connect');
  return socket;
}

function emit(socket, event, payload) {
  return socket.timeout(3_000).emitWithAck(event, payload);
}

function waitForState(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('board:state', receive);
      reject(new Error('board:state timeout'));
    }, 3_000);
    function receive(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('board:state', receive);
      resolve(state);
    }
    socket.on('board:state', receive);
  });
}

test('two participants sync, lock conflicts, private Agent previews and version checks', async () => {
  const response = await fetch(`${base}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template: 'plan' }),
  });
  assert.equal(response.status, 201);
  const { boardId, board } = await response.json();
  assert.equal(board.template, 'plan');
  assert.equal(board.boardAgent.progress.total, 3);
  assert.equal(board.boardAgent.nextSteps[0].id, 'confirm-goal');

  const alice = await client();
  const bob = await client();
  assert.equal((await emit(alice, 'board:join', { boardId, nickname: 'Alice' })).ok, true);
  const joined = await emit(bob, 'board:join', { boardId, nickname: 'Bob' });
  assert.equal(joined.ok, true);
  assert.equal(joined.participants.length, 2);

  const received = waitForState(bob, (state) => state.board.cards.some((card) => card.text === '协作测试任务'));
  const created = await emit(alice, 'card:create', { boardId, type: 'task', text: '协作测试任务', x: 150, y: 250 });
  assert.equal(created.ok, true);
  const synced = await received;
  assert.equal(synced.board.cards.find((card) => card.id === created.card.id).version, 1);

  const cardId = created.card.id;
  assert.equal((await emit(alice, 'card:lock', { boardId, cardId })).ok, true);
  const denied = await emit(bob, 'card:lock', { boardId, cardId });
  assert.equal(denied.code, 'LOCKED');
  assert.equal((await emit(bob, 'card:update', { boardId, cardId, patch: { text: '不得覆盖' }, version: 1 })).code, 'LOCK_REQUIRED');

  const secret = `PRIVATE_${Date.now()}_ONLY_ALICE`;
  const draft = await emit(alice, 'agent:preview', { boardId, mode: 'revise', cardId, instruction: secret });
  assert.equal(draft.ok, true);
  assert.equal(draft.preview.simulated, true);
  assert.equal(draft.preview.sourceText, '协作测试任务');
  assert.match(draft.preview.text, /模拟 Agent 建议/);
  const publicBoard = await (await fetch(`${base}/api/boards/${boardId}`)).text();
  assert.equal(publicBoard.includes(secret), false);
  assert.equal((await emit(bob, 'agent:publish', { boardId, previewId: draft.preview.id })).code, 'PREVIEW_NOT_FOUND');

  const updated = await emit(alice, 'card:update', { boardId, cardId, patch: { status: 'review' }, version: 1 });
  assert.equal(updated.ok, true);
  assert.equal(updated.card.version, 2);
  assert.equal((await emit(alice, 'agent:publish', { boardId, previewId: draft.preview.id })).code, 'VERSION_CONFLICT');
  assert.equal((await emit(alice, 'card:update', { boardId, cardId, patch: { status: 'done' }, version: 2 })).code, 'REVIEW_REQUIRED');

  const fresh = await emit(alice, 'agent:preview', { boardId, mode: 'revise', cardId, instruction: '整理为公开版本' });
  const published = await emit(alice, 'agent:publish', { boardId, previewId: fresh.preview.id });
  assert.equal(published.ok, true);
  assert.equal(published.card.version, 3);
  assert.match(published.card.text, /模拟 Agent 建议/);
  const relatedDraft = await emit(alice, 'agent:preview', { boardId, mode: 'create', cardId, instruction: '补充一张关联思路' });
  const related = await emit(alice, 'agent:publish', { boardId, previewId: relatedDraft.preview.id });
  assert.equal(related.ok, true);
  assert.equal(related.edge.source, cardId);
  assert.equal(related.edge.target, related.card.id);
  assert.equal(related.edge.label, 'Agent 补充');
  assert.equal((await emit(alice, 'card:unlock', { boardId, cardId })).ok, true);

  assert.equal((await emit(alice, 'suggestion:confirm', { boardId, suggestionId: `assign:${cardId}`, owner: 'Alice' })).ok, true);
  assert.equal((await emit(alice, 'suggestion:confirm', { boardId, suggestionId: `reviewer:${cardId}`, reviewer: 'Bob' })).ok, true);
  const beforeReview = (await emit(alice, 'boardAgent:refresh', { boardId })).boardAgent;
  assert.ok(beforeReview.nextSteps.some((step) => step.id === `review:${cardId}` && step.sourceCardId === cardId));
  assert.equal((await emit(alice, 'suggestion:confirm', { boardId, suggestionId: `review:${cardId}` })).code, 'REVIEWER_MISMATCH');
  const reviewed = await emit(bob, 'suggestion:confirm', { boardId, suggestionId: `review:${cardId}` });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.card.status, 'done');

  const suggestion = (await emit(bob, 'boardAgent:refresh', { boardId })).boardAgent.suggestions.find((item) => item.id === `assign:${board.cards[0].id}`);
  assert.ok(suggestion);
  const assigned = await emit(bob, 'suggestion:confirm', { boardId, suggestionId: suggestion.id, owner: 'Alice' });
  assert.equal(assigned.ok, true);
  assert.equal(assigned.card.owner, 'Alice');

  const stored = (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  assert.ok(stored.audit.some((item) => item.action === 'suggestion_confirmed' && item.actor === 'Bob'));
  assert.ok(stored.audit.some((item) => item.action === 'review_confirmed' && item.actor === 'Bob'));
  assert.ok(stored.boardAgent.evidence.some((item) => item.sourceCardId === cardId));
  assert.equal(stored.boardAgent.nextSteps.some((step) => step.id === `review:${cardId}`), false);
  assert.ok(stored.edges.some((edge) => edge.id === related.edge.id && edge.source === cardId && edge.target === related.card.id));
  assert.ok(stored.audit.some((item) => item.action === 'agent_card_published' && item.details.sourceCardId === cardId && item.details.edgeId === related.edge.id));
});

test('debate requires a real conclusion before human completion', async () => {
  const response = await fetch(`${base}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template: 'debate' }),
  });
  const { boardId, board } = await response.json();
  assert.equal(board.boardAgent.progress.done, 0);
  assert.ok(board.boardAgent.nextSteps.some((step) => step.id === 'add:conclusion'));
  const alice = await client();
  await emit(alice, 'board:join', { boardId, nickname: 'Alice' });
  assert.equal((await emit(alice, 'goal:confirm', { boardId, version: 1 })).ok, true);
  assert.equal((await emit(alice, 'board:complete', { boardId })).code, 'CONCLUSION_REQUIRED');
  const conclusion = await emit(alice, 'card:create', { boardId, type: 'conclusion', text: '经讨论形成的正式结论', x: 500, y: 500 });
  assert.equal(conclusion.ok, true);
  const completed = await emit(alice, 'board:complete', { boardId });
  assert.equal(completed.ok, true);
  assert.equal(completed.goal.completed, true);
  assert.ok((await (await fetch(`${base}/api/boards/${boardId}`)).json()).board.audit.some((item) => item.action === 'board_completed' && item.actor === 'Alice'));
  const followUp = await emit(alice, 'card:create', { boardId, type: 'objection', text: '新增需回应的质疑', x: 850, y: 450 });
  assert.equal(followUp.ok, true);
  const reopened = (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  assert.equal(reopened.goal.completed, false);
  assert.equal(reopened.audit.at(-1).details.reopenedAfterChange, true);
});

test('autoplay scenario keeps a debate task in the assignment and review flow', async () => {
  const response = await fetch(`${base}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template: 'debate', scenario: 'autoplay' }),
  });
  const { boardId, board } = await response.json();
  assert.equal(board.demoScenario, 'autoplay');
  assert.equal(board.cards.length, 0);

  const alice = await client();
  const bob = await client();
  await emit(alice, 'board:join', { boardId, nickname: 'Alice' });
  await emit(bob, 'board:join', { boardId, nickname: 'Bob' });
  assert.equal((await emit(alice, 'goal:confirm', { boardId, version: 1 })).ok, true);

  const task = (await emit(alice, 'suggestion:confirm', { boardId, suggestionId: 'task:debate:evidence', text: '核对来源版本', x: 500, y: 500 })).card;
  const agent = (await emit(alice, 'boardAgent:refresh', { boardId })).boardAgent;
  assert.ok(agent.suggestions.some((item) => item.id === `assign:${task.id}`));
  assert.ok(agent.suggestions.some((item) => item.id === `reviewer:${task.id}`));
  assert.equal((await emit(alice, 'board:complete', { boardId })).code, 'CONCLUSION_REQUIRED');

  await emit(alice, 'suggestion:confirm', { boardId, suggestionId: `assign:${task.id}`, owner: 'Alice' });
  const assigned = await emit(alice, 'suggestion:confirm', { boardId, suggestionId: `reviewer:${task.id}`, reviewer: 'Bob' });
  await emit(alice, 'card:lock', { boardId, cardId: task.id });
  assert.equal((await emit(alice, 'card:update', { boardId, cardId: task.id, version: assigned.card.version, patch: { status: 'review' } })).ok, true);
  await emit(alice, 'card:unlock', { boardId, cardId: task.id });
  assert.equal((await emit(alice, 'suggestion:confirm', { boardId, suggestionId: `review:${task.id}` })).code, 'REVIEWER_MISMATCH');
  assert.equal((await emit(bob, 'suggestion:confirm', { boardId, suggestionId: `review:${task.id}` })).card.status, 'done');

  for (const type of ['question', 'idea', 'evidence', 'objection', 'conclusion']) {
    assert.equal((await emit(alice, 'card:create', { boardId, type, text: `正式${type}卡`, x: 100, y: 100 })).ok, true);
  }
  assert.equal((await emit(alice, 'board:complete', { boardId })).ok, true);
  const completed = (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  assert.equal(completed.boardAgent.progress.percent, 100);
  assert.equal(completed.goal.completed, true);
});

test('matter workflow binds decisions to evidence versions and requires independent task acceptance', async () => {
  const response = await fetch(`${base}/api/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template: 'plan', workflow: 'matter', scenario: 'autoplay', title: '字段口径确认' }),
  });
  assert.equal(response.status, 201);
  const { boardId, board } = await response.json();
  assert.equal(board.workflow, 'matter');
  assert.equal(board.cards.length, 0);
  assert.equal(board.matter.title, '模拟流程演示 · 字段口径确认');

  const alice = await client();
  const bob = await client();
  await emit(alice, 'board:join', { boardId, nickname: 'Alice' });
  await emit(bob, 'board:join', { boardId, nickname: 'Bob' });
  assert.equal((await emit(alice, 'matter:update', { boardId, version: 1, patch: { owner: 'Alice', nextOwner: 'Bob', blocker: '字段定义有分歧' } })).ok, true);
  assert.equal((await emit(alice, 'goal:confirm', { boardId, version: 1 })).ok, true);

  const evidence = (await emit(bob, 'card:create', { boardId, type: 'evidence', text: '字段说明写明计算范围', x: 50, y: 50 })).card;
  const objection = (await emit(bob, 'card:create', { boardId, type: 'objection', text: '旧报表采用不同口径', x: 300, y: 50 })).card;
  const boardVersion = async () => (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board.version;
  const decisionPayload = () => ({ boardId, boardVersion: 0, option: '采用新字段定义', rationale: '与现行说明一致', scope: '演示范围', risk: '旧报表需说明差异', evidenceCardIds: [evidence.id], objectionResolutions: [{ cardId: objection.id, response: '保留旧口径映射说明' }] });
  assert.equal((await emit(alice, 'decision:record', { ...decisionPayload(), boardVersion: await boardVersion() })).code, 'SOURCE_REQUIRED');

  await emit(bob, 'card:lock', { boardId, cardId: evidence.id });
  const sourced = await emit(bob, 'card:update', { boardId, cardId: evidence.id, version: evidence.version, patch: { source: { title: '虚构字段说明', reference: 'DEMO-FIELD-01', version: 'v1' } } });
  assert.equal(sourced.ok, true);
  await emit(bob, 'card:unlock', { boardId, cardId: evidence.id });
  assert.equal((await emit(alice, 'decision:record', { ...decisionPayload(), boardVersion: await boardVersion(), objectionResolutions: [] })).code, 'OBJECTIONS_UNRESOLVED');
  const decision = await emit(alice, 'decision:record', { ...decisionPayload(), boardVersion: await boardVersion() });
  assert.equal(decision.ok, true);
  assert.equal(decision.decision.evidenceRefs[0].contentVersion, sourced.card.contentVersion);

  const task = (await emit(alice, 'card:create', { boardId, type: 'task', text: '更新字段说明', x: 50, y: 300, owner: 'Alice', reviewer: 'Bob', acceptanceCriteria: '交付新字段说明和口径差异' })).card;
  await emit(alice, 'card:lock', { boardId, cardId: task.id });
  assert.equal((await emit(alice, 'card:update', { boardId, cardId: task.id, version: task.version, patch: { status: 'review' } })).code, 'TASK_WORKFLOW_REQUIRED');
  await emit(alice, 'card:unlock', { boardId, cardId: task.id });
  assert.equal((await emit(bob, 'task:submit', { boardId, cardId: task.id, version: task.version, delivery: '新说明已存档' })).code, 'OWNER_MISMATCH');
  assert.equal((await emit(alice, 'task:submit', { boardId, cardId: task.id, version: task.version, delivery: '新说明已存档' })).ok, true);
  assert.equal((await emit(alice, 'task:accept', { boardId, cardId: task.id, version: task.version + 1, reviewNote: '符合标准' })).code, 'REVIEWER_MISMATCH');
  const rejected = await emit(bob, 'task:reject', { boardId, cardId: task.id, version: task.version + 1, reviewNote: '需补充旧口径差异' });
  assert.equal(rejected.card.status, 'doing');
  const resubmitted = await emit(alice, 'task:submit', { boardId, cardId: task.id, version: rejected.card.version, delivery: '新说明与旧口径差异均已存档' });
  const accepted = await emit(bob, 'task:accept', { boardId, cardId: task.id, version: resubmitted.card.version, reviewNote: '交付与验收标准一致' });
  assert.equal(accepted.card.status, 'done');
  assert.equal(accepted.card.acceptance.acceptedBy, 'Bob');

  await emit(bob, 'card:lock', { boardId, cardId: evidence.id });
  const moved = await emit(bob, 'card:move', { boardId, cardId: evidence.id, version: sourced.card.version, x: 100, y: 100 });
  assert.equal(moved.card.contentVersion, sourced.card.contentVersion);
  await emit(bob, 'card:unlock', { boardId, cardId: evidence.id });
  assert.equal((await emit(bob, 'board:complete', { boardId })).code, 'OWNER_MISMATCH');
  assert.equal((await emit(alice, 'board:complete', { boardId })).ok, true);

  await emit(bob, 'card:lock', { boardId, cardId: evidence.id });
  const changed = await emit(bob, 'card:update', { boardId, cardId: evidence.id, version: moved.card.version, patch: { text: '字段说明修订了计算范围' } });
  assert.equal(changed.card.contentVersion, sourced.card.contentVersion + 1);
  await emit(bob, 'card:unlock', { boardId, cardId: evidence.id });
  let stored = (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  assert.equal(stored.goal.completed, false);
  assert.equal(stored.decisions.at(-1).status, 'stale');
  assert.equal((await emit(alice, 'board:complete', { boardId })).code, 'DECISION_REQUIRED');
  const revised = await emit(alice, 'decision:record', { ...decisionPayload(), boardVersion: stored.version });
  assert.equal(revised.ok, true);
  assert.ok((await (await fetch(`${base}/api/boards/${boardId}`)).json()).board.audit.at(-1).details.reopenedTaskIds.includes(task.id));
  stored = (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  const reopenedTask = stored.cards.find((card) => card.id === task.id);
  assert.equal(reopenedTask.status, 'doing');
  assert.equal(reopenedTask.acceptance.delivery, '');
  assert.equal(reopenedTask.acceptance.submittedDecisionId, null);
  assert.equal(reopenedTask.acceptance.acceptedDecisionId, null);
  assert.equal((await emit(bob, 'task:accept', { boardId, cardId: task.id, version: reopenedTask.version, reviewNote: '沿用旧交付' })).code, 'SUBMISSION_REQUIRED');
  assert.equal((await emit(alice, 'board:complete', { boardId })).code, 'TASKS_UNFINISHED');
  const newSubmission = await emit(alice, 'task:submit', { boardId, cardId: task.id, version: reopenedTask.version, delivery: '已按修订证据重新核对字段说明' });
  assert.equal(newSubmission.card.acceptance.submittedDecisionId, revised.decision.id);
  const newAcceptance = await emit(bob, 'task:accept', { boardId, cardId: task.id, version: newSubmission.card.version, reviewNote: '按照新决策重新验收通过' });
  assert.equal(newAcceptance.card.acceptance.acceptedDecisionId, revised.decision.id);
  assert.equal((await emit(alice, 'board:complete', { boardId })).ok, true);

  await emit(bob, 'card:create', { boardId, type: 'objection', text: '新增边界异议', x: 300, y: 300 });
  stored = (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  assert.equal(stored.goal.completed, false);
  assert.equal(stored.decisions.at(-1).status, 'stale');
  assert.equal((await emit(alice, 'board:complete', { boardId })).code, 'DECISION_REQUIRED');
});

test('recording a new decision reopens both accepted and pending-review deliveries', async () => {
  const response = await fetch(`${base}/api/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template: 'plan', workflow: 'matter', scenario: 'autoplay' }),
  });
  const { boardId } = await response.json();
  const alice = await client();
  const bob = await client();
  await emit(alice, 'board:join', { boardId, nickname: 'Alice' });
  await emit(bob, 'board:join', { boardId, nickname: 'Bob' });
  await emit(alice, 'matter:update', { boardId, version: 1, patch: { owner: 'Alice' } });
  await emit(alice, 'goal:confirm', { boardId, version: 1 });
  const evidence = (await emit(bob, 'card:create', { boardId, type: 'evidence', text: '已确认字段口径', x: 50, y: 50, source: { title: '演示说明', reference: 'DEMO-02', version: 'v1' } })).card;
  const objection = (await emit(bob, 'card:create', { boardId, type: 'objection', text: '旧报表口径是否保留', x: 200, y: 50 })).card;
  const currentVersion = async () => (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board.version;
  const decisionPayload = async () => ({ boardId, boardVersion: await currentVersion(), option: '双口径说明', rationale: '保留可追溯的版本区别', scope: '模拟范围', risk: '旧报表需标明版本', evidenceCardIds: [evidence.id], objectionResolutions: [{ cardId: objection.id, response: '增加旧口径映射' }] });
  const firstDecision = await emit(alice, 'decision:record', await decisionPayload());
  assert.equal(firstDecision.ok, true);

  const acceptedTask = (await emit(alice, 'card:create', { boardId, type: 'task', text: '整理口径说明', x: 50, y: 300, owner: 'Alice', reviewer: 'Bob', acceptanceCriteria: '存档新旧口径' })).card;
  const reviewTask = (await emit(alice, 'card:create', { boardId, type: 'task', text: '核对报表', x: 300, y: 300, owner: 'Alice', reviewer: 'Bob', acceptanceCriteria: '提供核对结果' })).card;
  const submittedA = await emit(alice, 'task:submit', { boardId, cardId: acceptedTask.id, version: acceptedTask.version, delivery: '口径说明已存档' });
  await emit(bob, 'task:accept', { boardId, cardId: acceptedTask.id, version: submittedA.card.version, reviewNote: '旧决策下通过' });
  await emit(alice, 'task:submit', { boardId, cardId: reviewTask.id, version: reviewTask.version, delivery: '报表核对结果已提交' });

  const secondDecision = await emit(alice, 'decision:record', await decisionPayload());
  assert.equal(secondDecision.ok, true);
  const board = (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  assert.deepEqual(new Set(board.audit.at(-1).details.reopenedTaskIds), new Set([acceptedTask.id, reviewTask.id]));
  for (const cardId of [acceptedTask.id, reviewTask.id]) {
    const task = board.cards.find((card) => card.id === cardId);
    assert.equal(task.status, 'doing');
    assert.equal(task.acceptance.delivery, '');
    assert.equal(task.acceptance.submittedBy, null);
    assert.equal(task.acceptance.submittedDecisionId, null);
    assert.equal(task.acceptance.acceptedBy, null);
    assert.equal(task.acceptance.acceptedDecisionId, null);
    assert.equal((await emit(bob, 'task:accept', { boardId, cardId, version: task.version, reviewNote: '沿用旧交付' })).code, 'SUBMISSION_REQUIRED');
  }
  assert.equal(board.boardAgent.progress.done, 0);
  assert.equal(board.boardAgent.nextSteps.some((step) => step.id === 'complete-matter'), false);
  assert.equal((await emit(alice, 'board:complete', { boardId })).code, 'TASKS_UNFINISHED');

  await emit(bob, 'card:lock', { boardId, cardId: evidence.id });
  const sourceChanged = await emit(bob, 'card:update', { boardId, cardId: evidence.id, version: evidence.version, patch: { source: { title: '演示说明', reference: 'DEMO-02', version: 'v2' } } });
  assert.equal(sourceChanged.card.contentVersion, evidence.contentVersion + 1);
  await emit(bob, 'card:unlock', { boardId, cardId: evidence.id });
  await emit(bob, 'card:lock', { boardId, cardId: objection.id });
  await emit(bob, 'card:update', { boardId, cardId: objection.id, version: objection.version, patch: { type: 'idea' } });
  await emit(bob, 'card:unlock', { boardId, cardId: objection.id });
  const changed = (await (await fetch(`${base}/api/boards/${boardId}`)).json()).board;
  assert.equal(changed.decisions.at(-1).status, 'stale');
  assert.ok(changed.decisions.at(-1).staleReasons.some((reason) => reason.includes('证据卡')));
  assert.ok(changed.decisions.at(-1).staleReasons.some((reason) => reason.includes('已回应的异议卡')));
  assert.equal((await emit(alice, 'board:complete', { boardId })).code, 'DECISION_REQUIRED');
});
