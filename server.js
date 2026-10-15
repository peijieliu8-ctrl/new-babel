import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { calculateBoardAgent, generateSimulatedPreview } from './agents.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const storageDir = process.env.DATA_DIR || path.join(root, 'data', 'boards');
const port = Number(process.env.PORT ?? 3000);
const lockMs = 120_000;
const previewMs = 10 * 60_000;
const statuses = new Set(['todo', 'doing', 'review', 'blocked', 'done']);
const completionInvalidators = new Set([
  'card_created', 'card_updated', 'edge_created', 'edge_deleted',
  'comment_promoted', 'goal_updated', 'suggestion_confirmed',
  'agent_revision_published', 'agent_card_published', 'matter_updated',
  'decision_recorded', 'task_submitted', 'task_accepted', 'task_rejected',
]);
const boards = new Map();
const presence = new Map(); // boardId -> Map<socketId, nickname>
const locks = new Map(); // boardId -> Map<cardId, {clientId,nickname,expiresAt}>
const previews = new Map(); // socketId -> Map<previewId, privatePreview>

mkdirSync(storageDir, { recursive: true });

class InputError extends Error {
  constructor(message, code = 'BAD_REQUEST') {
    super(message);
    this.code = code;
  }
}

function ensure(condition, message, code) {
  if (!condition) throw new InputError(message, code);
}

function object(value) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), '请求参数格式不正确');
  return value;
}

function string(value, name, max, { optional = false, empty = false } = {}) {
  if (value === undefined && optional) return undefined;
  ensure(typeof value === 'string', `${name}必须是文字`);
  const trimmed = value.trim();
  ensure((empty || trimmed.length > 0) && trimmed.length <= max, `${name}长度应为${empty ? '0' : '1'}到${max}字`);
  return trimmed;
}

function number(value, name) {
  ensure(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000, `${name}必须是有效坐标`);
  return Math.round(value);
}

function version(value) {
  ensure(Number.isInteger(value) && value >= 1, '版本号不正确');
  return value;
}

function id(value, name = 'ID') {
  ensure(typeof value === 'string' && /^[A-Za-z0-9_-]{8,50}$/.test(value), `${name}不正确`);
  return value;
}

function criteria(value) {
  ensure(Array.isArray(value) && value.length <= 12, '验收标准最多12条');
  return value.map((item, index) => string(item, `验收标准${index + 1}`, 160));
}

function optionalPerson(value, name) {
  return value === undefined ? undefined : string(value, name, 30, { empty: true });
}

function sourceDetails(value) {
  if (value === null) return null;
  const data = object(value);
  ensure(Object.keys(data).every((key) => ['title', 'reference', 'version'].includes(key)), '证据来源字段不正确');
  return {
    title: string(data.title, '证据来源名称', 120),
    reference: string(data.reference, '证据来源编号或位置', 300),
    version: string(data.version, '证据来源版本', 80),
  };
}

function dueDate(value) {
  if (value === '' || value === null) return null;
  const date = string(value, '截止日期', 10);
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date), '截止日期应为有效的 YYYY-MM-DD 日期');
  return date;
}

function now() {
  return new Date().toISOString();
}

function makeId() {
  return randomUUID();
}

function makeBoardId() {
  return randomBytes(15).toString('base64url');
}

function boardFile(boardId) {
  return path.join(storageDir, `${id(boardId, '画布 ID')}.json`);
}

function persist(board) {
  const filename = boardFile(board.id);
  const temporary = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporary, JSON.stringify(board, null, 2), { mode: 0o600 });
  renameSync(temporary, filename);
}

function readBoard(boardId) {
  const validId = id(boardId, '画布 ID');
  const board = boards.get(validId);
  ensure(board, '画布不存在', 'NOT_FOUND');
  return board;
}

function findCard(board, cardId) {
  const card = board.cards.find((item) => item.id === id(cardId, '卡片 ID'));
  ensure(card, '卡片不存在', 'NOT_FOUND');
  return card;
}

function findComment(board, commentId) {
  const comment = board.comments.find((item) => item.id === id(commentId, '评论 ID'));
  ensure(comment, '评论不存在', 'NOT_FOUND');
  return comment;
}

function currentDecision(board) {
  return board.decisions?.find((item) => item.id === board.matter?.currentDecisionId) || null;
}

function refreshDecisionState(board) {
  if (board.workflow !== 'matter') return;
  const decision = currentDecision(board);
  if (!decision) return;
  const reasons = [];
  if (decision.goalVersion !== board.goal.contentVersion) reasons.push('目标内容已变化');
  if (decision.matterOwner !== board.matter.owner) reasons.push('事项负责人已变化');
  for (const ref of decision.evidenceRefs) {
    const card = board.cards.find((item) => item.id === ref.cardId);
    if (!card || card.type !== 'evidence' || card.contentVersion !== ref.contentVersion || card.source?.version !== ref.sourceVersion) reasons.push(`证据卡 ${ref.cardId} 已变化`);
  }
  const objections = board.cards.filter((card) => card.type === 'objection' && !card.text.startsWith('示例：'));
  for (const ref of decision.objectionResolutions) {
    const card = board.cards.find((item) => item.id === ref.cardId);
    if (!card || card.type !== 'objection' || card.contentVersion !== ref.contentVersion) reasons.push(`已回应的异议卡 ${ref.cardId} 已变化`);
  }
  for (const card of objections) {
    if (!decision.objectionResolutions.some((ref) => ref.cardId === card.id && ref.contentVersion === card.contentVersion)) reasons.push(`异议卡 ${card.id} 尚未按当前版本回应`);
  }
  decision.status = reasons.length ? 'stale' : 'confirmed';
  decision.staleReasons = reasons;
}

function invalidateTaskAcceptance(card) {
  if (card.type !== 'task' || !card.acceptance) return;
  if (card.status === 'review' || card.status === 'done') card.status = 'doing';
  card.acceptance.delivery = '';
  card.acceptance.submittedBy = null;
  card.acceptance.submittedAt = null;
  card.acceptance.submittedDecisionId = null;
  card.acceptance.acceptedBy = null;
  card.acceptance.acceptedAt = null;
  card.acceptance.acceptedDecisionId = null;
  card.acceptance.reviewNote = '';
}

function createCard({ type, text, x, y, owner = '', reviewer = '', status = 'todo', actor, sourceCommentId = null, source, acceptanceCriteria }) {
  const cardType = string(type, '卡片类型', 24);
  return {
    id: makeId(),
    type: cardType,
    text: string(text, '卡片内容', 2_000),
    x: number(x, '横坐标'),
    y: number(y, '纵坐标'),
    owner: string(owner, '责任人', 30, { empty: true }),
    reviewer: string(reviewer, '复核人', 30, { empty: true }),
    status: validStatus(status),
    version: 1,
    contentVersion: 1,
    source: source === undefined ? null : sourceDetails(source),
    acceptance: cardType === 'task' ? {
      criteria: acceptanceCriteria === undefined ? '' : string(acceptanceCriteria, '任务验收标准', 500, { empty: true }),
      delivery: '', submittedBy: null, submittedAt: null, submittedDecisionId: null,
      reviewNote: '', acceptedBy: null, acceptedAt: null, acceptedDecisionId: null,
    } : null,
    createdBy: actor,
    updatedBy: actor,
    createdAt: now(),
    updatedAt: now(),
    sourceCommentId,
  };
}

function validStatus(value) {
  ensure(statuses.has(value), '卡片状态应为 todo、doing、review、blocked 或 done');
  return value;
}

function createBoard(template, title, scenario, workflow = 'classic') {
  ensure(template === 'debate' || template === 'plan', '模板应为 debate 或 plan');
  ensure(workflow === 'classic' || workflow === 'matter', '协作模式不正确');
  ensure(scenario === undefined || scenario === 'autoplay', '演示场景不正确');
  ensure(scenario !== 'autoplay' || (workflow === 'classic' ? template === 'debate' : template === 'plan'), '自动演示模板与协作模式不匹配');
  const boardId = makeBoardId();
  const timestamp = now();
  const sample = workflow === 'matter'
    ? {
        title: scenario === 'autoplay' ? '模拟流程演示 · 字段口径确认' : '跨部门事项推进',
        goal: '形成有依据、可追责且可验收的事项结论',
        criteria: ['记录证据来源与版本', '回应异议并由事项负责人确认决策', '任务交付由独立复核人验收'],
        cards: [],
      }
    : scenario === 'autoplay'
    ? {
        title: '模拟流程演示 · 制度问答试点',
        goal: '用可追溯的制度问答试点形成一项可执行的产品结论',
        criteria: ['说明答案来源、版本与适用范围', '识别高风险问题的人工复核条件', '由参与者确认结论与任务'],
        cards: [],
      }
    : template === 'debate'
    ? {
        title: '观点讨论画布',
        goal: '围绕议题形成有依据的结论',
        criteria: ['记录关键观点与依据', '由成员确认讨论结论'],
        cards: [
          ['question', '示例：要讨论的核心问题是什么？', 80, 180],
          ['idea', '示例：观点 A 与理由', 420, 100],
          ['idea', '示例：观点 B 与理由', 420, 330],
          ['evidence', '示例：补充可核验的依据', 760, 220],
        ],
      }
    : {
        title: '项目计划画布',
        goal: '完成试点方案并形成可验收的结论',
        criteria: ['任务责任人明确', '全部任务由成员确认完成'],
        cards: [
          ['task', '明确试点目标和验收标准', 80, 160],
          ['task', '梳理权限与数据边界', 420, 160],
          ['task', '安排试点验收与复盘', 760, 160],
        ],
      };
  const requestedTitle = title === undefined ? sample.title : string(title, '画布标题', 80);
  const displayTitle = workflow === 'matter' && scenario === 'autoplay' && !requestedTitle.includes('模拟')
    ? string(`模拟流程演示 · ${requestedTitle}`, '画布标题', 80)
    : requestedTitle;
  const board = {
    id: boardId,
    title: displayTitle,
    template,
    workflow,
    demoScenario: scenario || null,
    version: 1,
    goal: {
      text: sample.goal,
      criteria: sample.criteria,
      confirmed: false,
      completed: false,
      version: 1,
      contentVersion: 1,
      updatedBy: '系统模板',
      updatedAt: timestamp,
    },
    cards: sample.cards.map(([type, text, x, y]) => createCard({ type, text, x, y, actor: '系统模板' })),
    matter: {
      title: displayTitle,
      owner: '', nextOwner: '', dueAt: null, blocker: '', currentDecisionId: null,
      version: 1, updatedBy: '系统模板', updatedAt: timestamp,
    },
    decisions: [],
    edges: [],
    comments: [],
    audit: [{ id: makeId(), action: 'board_created', actor: '系统模板', details: { template }, at: timestamp }],
    boardAgent: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  board.boardAgent = calculateBoardAgent(board);
  persist(board);
  boards.set(boardId, board);
  return board;
}

function normalizeBoard(board) {
  board.workflow = board.workflow === 'matter' ? 'matter' : 'classic';
  board.goal.contentVersion ??= board.goal.version;
  board.matter ||= { title: board.title || '协作事项', owner: '', nextOwner: '', dueAt: null, blocker: '', currentDecisionId: null, version: 1, updatedBy: '系统迁移', updatedAt: board.updatedAt || now() };
  board.decisions ||= [];
  for (const card of board.cards) {
    card.contentVersion ??= card.version;
    card.source ??= null;
    if (card.type === 'task') {
      card.acceptance ||= { criteria: '', delivery: '', submittedBy: null, submittedAt: null, reviewNote: '', acceptedBy: null, acceptedAt: null };
      card.acceptance.submittedDecisionId ??= null;
      card.acceptance.acceptedDecisionId ??= null;
    }
    else card.acceptance ??= null;
  }
  refreshDecisionState(board);
  return board;
}

for (const filename of readdirSync(storageDir)) {
  if (!/^[A-Za-z0-9_-]{8,50}\.json$/.test(filename)) continue;
  try {
    const board = JSON.parse(readFileSync(path.join(storageDir, filename), 'utf8'));
    if (board && board.id === filename.slice(0, -5) && Array.isArray(board.cards)) {
      normalizeBoard(board);
      board.boardAgent = calculateBoardAgent(board);
      boards.set(board.id, board);
    }
  } catch (error) {
    console.error(`跳过无法读取的画布文件 ${filename}: ${error.message}`);
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, boards: boards.size }));
app.get('/api/network-info', (_req, res) => {
  const lanUrls = lanAddresses().map((address) => `http://${address}:${httpServer.address()?.port || port}`);
  res.json({ lanUrl: lanUrls[0] || null, lanUrls });
});
app.post('/api/boards', (req, res) => {
  try {
    const data = object(req.body);
    const board = createBoard(data.template, data.title, data.scenario, data.workflow);
    res.status(201).json({ boardId: board.id, board });
  } catch (error) {
    httpError(res, error);
  }
});
app.get('/api/boards/:id', (req, res) => {
  try {
    res.json({ board: readBoard(req.params.id) });
  } catch (error) {
    httpError(res, error);
  }
});
app.use(express.static(path.join(root, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));
app.use((error, _req, res, _next) => httpError(res, error));

function httpError(res, error) {
  const code = error instanceof InputError ? error.code : 'SERVER_ERROR';
  const status = code === 'NOT_FOUND' ? 404 : code === 'SERVER_ERROR' ? 500 : 400;
  if (status === 500) console.error(error);
  res.status(status).json({ ok: false, error: status === 500 ? '服务端暂时不可用' : error.message, code });
}

const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 64 * 1024 });

function room(boardId) {
  return `board:${boardId}`;
}

function members(boardId) {
  return [...(presence.get(boardId) || new Map())].map(([clientId, nickname]) => ({ clientId, nickname }));
}

function lockSnapshot(boardId) {
  const result = {};
  const boardLocks = locks.get(boardId);
  if (!boardLocks) return result;
  for (const [cardId, lock] of boardLocks) {
    if (lock.expiresAt > Date.now()) result[cardId] = lock;
  }
  return result;
}

function broadcast(boardId) {
  io.to(room(boardId)).emit('board:state', {
    board: readBoard(boardId),
    participants: members(boardId),
    locks: lockSnapshot(boardId),
  });
}

function releaseSocket(socket) {
  const boardId = socket.data.boardId;
  if (!boardId) return;
  presence.get(boardId)?.delete(socket.id);
  for (const [cardId, lock] of locks.get(boardId) || []) {
    if (lock.clientId === socket.id) locks.get(boardId).delete(cardId);
  }
  socket.leave(room(boardId));
  socket.data.boardId = undefined;
  broadcast(boardId);
}

function session(socket, payload) {
  const data = object(payload);
  const board = readBoard(data.boardId);
  ensure(socket.data.boardId === board.id && presence.get(board.id)?.has(socket.id), '请先加入画布', 'NOT_JOINED');
  return { data, board, actor: socket.data.nickname };
}

function requireLock(socket, boardId, cardId) {
  const lock = locks.get(boardId)?.get(cardId);
  ensure(lock && lock.expiresAt > Date.now() && lock.clientId === socket.id, '请先取得这张卡片的编辑锁', 'LOCK_REQUIRED');
  lock.expiresAt = Date.now() + lockMs;
}

function ensureVersion(current, provided) {
  ensure(current === version(provided), '版本已变化，请刷新后重试', 'VERSION_CONFLICT');
}

function commit(board, actor, action, details, mutate) {
  const next = structuredClone(board);
  mutate(next);
  next.version += 1;
  next.updatedAt = now();
  if (board.goal.completed && completionInvalidators.has(action)) {
    Object.assign(next.goal, {
      completed: false,
      version: Math.max(next.goal.version, board.goal.version + 1),
      updatedBy: actor,
      updatedAt: next.updatedAt,
    });
    details = { ...details, reopenedAfterChange: true };
  }
  next.audit.push({ id: makeId(), action, actor, details, at: next.updatedAt });
  refreshDecisionState(next);
  next.boardAgent = calculateBoardAgent(next);
  persist(next);
  boards.set(next.id, next);
  broadcast(next.id);
  return next;
}

function handler(socket, event, fn) {
  socket.on(event, (payload, acknowledge) => {
    const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
    try {
      ack({ ok: true, ...fn(payload) });
    } catch (error) {
      if (!(error instanceof InputError)) console.error(`${event}:`, error);
      ack({ ok: false, error: error instanceof InputError ? error.message : '服务端暂时不可用', code: error.code || 'SERVER_ERROR' });
    }
  });
}

io.on('connection', (socket) => {
  previews.set(socket.id, new Map());

  handler(socket, 'board:join', (payload) => {
    const data = object(payload);
    const board = readBoard(data.boardId);
    const nickname = string(data.nickname, '昵称', 30);
    const currentMembers = presence.get(board.id) || new Map();
    ensure(currentMembers.has(socket.id) || currentMembers.size < 2, '画布已有两位在线成员', 'ROOM_FULL');
    ensure(![...currentMembers].some(([clientId, name]) => clientId !== socket.id && name.toLocaleLowerCase() === nickname.toLocaleLowerCase()), '已有成员使用该昵称，请换一个', 'NICKNAME_TAKEN');
    if (socket.data.boardId && socket.data.boardId !== board.id) {
      releaseSocket(socket);
      previews.get(socket.id)?.clear();
    }
    if (!presence.has(board.id)) presence.set(board.id, new Map());
    presence.get(board.id).set(socket.id, nickname);
    socket.data.boardId = board.id;
    socket.data.nickname = nickname;
    socket.join(room(board.id));
    broadcast(board.id);
    return { clientId: socket.id, board, participants: members(board.id), locks: lockSnapshot(board.id) };
  });

  handler(socket, 'matter:update', (payload) => {
    const { data, board, actor } = session(socket, payload);
    ensure(board.workflow === 'matter', '此画布未启用事项工作流', 'WORKFLOW_REQUIRED');
    ensureVersion(board.matter.version, data.version);
    const patch = object(data.patch);
    const allowed = new Set(['title', 'owner', 'nextOwner', 'dueAt', 'blocker']);
    ensure(Object.keys(patch).length > 0 && Object.keys(patch).every((key) => allowed.has(key)), '事项修改字段不正确');
    const cleaned = {};
    if (patch.title !== undefined) cleaned.title = string(patch.title, '事项标题', 80);
    if (patch.owner !== undefined) cleaned.owner = string(patch.owner, '事项负责人', 30, { empty: true });
    if (patch.nextOwner !== undefined) cleaned.nextOwner = string(patch.nextOwner, '下一处理人', 30, { empty: true });
    if (patch.dueAt !== undefined) cleaned.dueAt = dueDate(patch.dueAt);
    if (patch.blocker !== undefined) cleaned.blocker = string(patch.blocker, '当前阻塞', 500, { empty: true });
    const next = commit(board, actor, 'matter_updated', { fields: Object.keys(cleaned), matterVersion: board.matter.version }, (draft) => {
      Object.assign(draft.matter, cleaned, { version: draft.matter.version + 1, updatedBy: actor, updatedAt: now() });
    });
    return { matter: next.matter };
  });

  handler(socket, 'decision:record', (payload) => {
    const { data, board, actor } = session(socket, payload);
    ensure(board.workflow === 'matter', '此画布未启用事项工作流', 'WORKFLOW_REQUIRED');
    ensureVersion(board.version, data.boardVersion);
    ensure(board.goal.confirmed, '请先确认事项目标', 'GOAL_UNCONFIRMED');
    ensure(board.matter.owner && board.matter.owner === actor, '仅事项负责人可代演决策确认；昵称并非真实身份认证', 'OWNER_MISMATCH');
    const option = string(data.option, '决策方案', 1_000);
    const rationale = string(data.rationale, '决策理由', 2_000);
    const scope = string(data.scope ?? '', '适用范围', 500, { empty: true });
    const risk = string(data.risk ?? '', '风险与限制', 500, { empty: true });
    ensure(Array.isArray(data.evidenceCardIds) && data.evidenceCardIds.length > 0 && data.evidenceCardIds.length <= 20, '请至少引用一张证据卡，最多20张', 'EVIDENCE_REQUIRED');
    const evidenceRefs = data.evidenceCardIds.map((rawId) => {
      const card = findCard(board, rawId);
      ensure(card.type === 'evidence' && card.source?.title && card.source?.reference && card.source?.version, '决策引用的证据卡需填写来源名称、位置和版本', 'SOURCE_REQUIRED');
      return { cardId: card.id, contentVersion: card.contentVersion, sourceVersion: card.source.version };
    });
    ensure(new Set(evidenceRefs.map((ref) => ref.cardId)).size === evidenceRefs.length, '证据卡不能重复引用');
    ensure(Array.isArray(data.objectionResolutions) && data.objectionResolutions.length <= 20, '异议回应格式不正确');
    const objectionResolutions = data.objectionResolutions.map((entry) => {
      const response = object(entry);
      const card = findCard(board, response.cardId);
      ensure(card.type === 'objection' && !card.text.startsWith('示例：'), '只能回应正式异议卡');
      return { cardId: card.id, contentVersion: card.contentVersion, response: string(response.response, '异议回应', 1_000) };
    });
    ensure(new Set(objectionResolutions.map((ref) => ref.cardId)).size === objectionResolutions.length, '异议卡不能重复回应');
    const objections = board.cards.filter((card) => card.type === 'objection' && !card.text.startsWith('示例：'));
    ensure(objections.length === objectionResolutions.length && objections.every((card) => objectionResolutions.some((ref) => ref.cardId === card.id)), '请回应当前所有异议后再记录决策', 'OBJECTIONS_UNRESOLVED');
    const decision = {
      id: makeId(), option, rationale, scope, risk, evidenceRefs, objectionResolutions,
      goalVersion: board.goal.contentVersion, matterOwner: board.matter.owner,
      status: 'confirmed', staleReasons: [], decidedBy: actor, decidedAt: now(),
    };
    const reopenedTaskIds = board.cards.filter((card) => card.type === 'task' && (
      card.status === 'review' || card.status === 'done' || card.acceptance?.submittedDecisionId || card.acceptance?.acceptedDecisionId
    )).map((card) => card.id);
    commit(board, actor, 'decision_recorded', { decisionId: decision.id, evidenceCardIds: evidenceRefs.map((ref) => ref.cardId), objectionCardIds: objectionResolutions.map((ref) => ref.cardId), reopenedTaskIds, confirmedBy: actor }, (draft) => {
      draft.decisions.push(decision);
      draft.matter.currentDecisionId = decision.id;
      for (const cardId of reopenedTaskIds) {
        const task = findCard(draft, cardId);
        invalidateTaskAcceptance(task);
        task.version += 1;
        task.updatedBy = '系统规则';
        task.updatedAt = now();
      }
    });
    return { decision };
  });

  handler(socket, 'card:create', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const card = createCard({ ...data, actor });
    ensure(card.type !== 'task' || card.status !== 'done', '任务需先送审并由审核人确认完成', 'REVIEW_REQUIRED');
    ensure(board.workflow !== 'matter' || card.type !== 'task' || !['review', 'done'].includes(card.status), '事项任务需通过交付和独立验收流转', 'TASK_WORKFLOW_REQUIRED');
    commit(board, actor, 'card_created', { cardId: card.id, type: card.type }, (next) => next.cards.push(card));
    return { card };
  });

  handler(socket, 'card:lock', (payload) => {
    const { data, board, actor } = session(socket, payload);
    findCard(board, data.cardId);
    if (!locks.has(board.id)) locks.set(board.id, new Map());
    const boardLocks = locks.get(board.id);
    const current = boardLocks.get(data.cardId);
    ensure(!current || current.expiresAt <= Date.now() || current.clientId === socket.id, `此卡片正由${current?.nickname || '其他成员'}编辑`, 'LOCKED');
    const lock = { clientId: socket.id, nickname: actor, expiresAt: Date.now() + lockMs };
    boardLocks.set(data.cardId, lock);
    broadcast(board.id);
    return { lock };
  });

  handler(socket, 'card:unlock', (payload) => {
    const { data, board } = session(socket, payload);
    const lock = locks.get(board.id)?.get(data.cardId);
    ensure(lock?.clientId === socket.id, '只有持锁成员可以释放编辑锁', 'LOCK_REQUIRED');
    locks.get(board.id).delete(data.cardId);
    broadcast(board.id);
    return {};
  });

  handler(socket, 'card:update', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const card = findCard(board, data.cardId);
    requireLock(socket, board.id, card.id);
    ensureVersion(card.version, data.version);
    const patch = object(data.patch);
    const allowed = new Set(['text', 'type', 'owner', 'reviewer', 'status', 'source', 'acceptanceCriteria']);
    ensure(Object.keys(patch).length > 0 && Object.keys(patch).every((key) => allowed.has(key)), '卡片修改字段不正确');
    const cleaned = {};
    if (patch.text !== undefined) cleaned.text = string(patch.text, '卡片内容', 2_000);
    if (patch.type !== undefined) cleaned.type = string(patch.type, '卡片类型', 24);
    if (patch.owner !== undefined) cleaned.owner = optionalPerson(patch.owner, '责任人');
    if (patch.reviewer !== undefined) cleaned.reviewer = optionalPerson(patch.reviewer, '复核人');
    if (patch.status !== undefined) cleaned.status = validStatus(patch.status);
    if (patch.source !== undefined) cleaned.source = sourceDetails(patch.source);
    if (patch.acceptanceCriteria !== undefined) cleaned.acceptanceCriteria = string(patch.acceptanceCriteria, '任务验收标准', 500, { empty: true });
    ensure(cleaned.acceptanceCriteria === undefined || (cleaned.type ?? card.type) === 'task', '仅任务卡可设置验收标准');
    if ((cleaned.type ?? card.type) === 'task' && (cleaned.status ?? card.status) === 'done') {
      ensure(cleaned.status === undefined && (cleaned.type === undefined || card.type === 'task'), '任务需先送审并由审核人确认完成', 'REVIEW_REQUIRED');
    }
    if (board.workflow === 'matter' && (cleaned.type ?? card.type) === 'task') {
      ensure(cleaned.status !== 'review' && cleaned.status !== 'done', '事项任务需通过交付和独立验收流转', 'TASK_WORKFLOW_REQUIRED');
    }
    const next = commit(board, actor, 'card_updated', { cardId: card.id, fields: Object.keys(cleaned) }, (draft) => {
      const target = findCard(draft, card.id);
      const { acceptanceCriteria, ...fields } = cleaned;
      const materialChange = Object.entries(fields).some(([key, value]) => key !== 'status' && key !== 'source' ? target[key] !== value : key === 'source' ? JSON.stringify(target.source) !== JSON.stringify(value) : false)
        || (acceptanceCriteria !== undefined && target.acceptance?.criteria !== acceptanceCriteria);
      if (board.workflow === 'matter' && target.type === 'task' && (materialChange || (cleaned.status !== undefined && cleaned.status !== target.status))) invalidateTaskAcceptance(target);
      Object.assign(target, fields, { version: target.version + 1, contentVersion: target.contentVersion + (materialChange ? 1 : 0), updatedBy: actor, updatedAt: now() });
      if (target.type === 'task' && !target.acceptance) target.acceptance = { criteria: '', delivery: '', submittedBy: null, submittedAt: null, submittedDecisionId: null, reviewNote: '', acceptedBy: null, acceptedAt: null, acceptedDecisionId: null };
      if (acceptanceCriteria !== undefined) target.acceptance.criteria = acceptanceCriteria;
    });
    return { card: findCard(next, card.id) };
  });

  handler(socket, 'task:submit', (payload) => {
    const { data, board, actor } = session(socket, payload);
    ensure(board.workflow === 'matter', '此画布未启用事项工作流', 'WORKFLOW_REQUIRED');
    const card = findCard(board, data.cardId);
    ensure(card.type === 'task', '仅任务卡可以提交验收');
    ensureVersion(card.version, data.version);
    ensure(card.owner && card.owner === actor, '仅任务负责人可提交交付；昵称并非真实身份认证', 'OWNER_MISMATCH');
    ensure(card.reviewer && card.reviewer !== card.owner, '请指定不同于负责人的复核人', 'REVIEWER_REQUIRED');
    ensure(card.acceptance?.criteria, '请先填写任务验收标准', 'CRITERIA_REQUIRED');
    ensure(card.status !== 'review' && card.status !== 'done', '此任务已送审或已验收', 'INVALID_STATUS');
    const decision = currentDecision(board);
    ensure(decision?.status === 'confirmed', '请先形成有效的人工作出决策', 'DECISION_REQUIRED');
    const delivery = string(data.delivery, '交付说明或证据', 2_000);
    const next = commit(board, actor, 'task_submitted', { cardId: card.id, decisionId: decision.id, criteria: card.acceptance.criteria, delivery, submittedBy: actor }, (draft) => {
      const target = findCard(draft, card.id);
      target.status = 'review';
      Object.assign(target.acceptance, { delivery, submittedBy: actor, submittedAt: now(), submittedDecisionId: decision.id, reviewNote: '', acceptedBy: null, acceptedAt: null, acceptedDecisionId: null });
      Object.assign(target, { version: target.version + 1, updatedBy: actor, updatedAt: now() });
    });
    return { card: findCard(next, card.id) };
  });

  handler(socket, 'task:accept', (payload) => {
    const { data, board, actor } = session(socket, payload);
    ensure(board.workflow === 'matter', '此画布未启用事项工作流', 'WORKFLOW_REQUIRED');
    const card = findCard(board, data.cardId);
    ensure(card.type === 'task', '仅任务卡可以验收');
    ensureVersion(card.version, data.version);
    ensure(card.status === 'review' && card.acceptance?.submittedBy && card.acceptance?.delivery, '任务尚未提交可追溯交付说明', 'SUBMISSION_REQUIRED');
    ensure(card.reviewer && card.reviewer === actor && card.owner !== actor, '仅独立复核人可验收；昵称并非真实身份认证', 'REVIEWER_MISMATCH');
    const decision = currentDecision(board);
    ensure(decision?.status === 'confirmed', '请先形成有效的事项决策', 'DECISION_REQUIRED');
    ensure(card.acceptance.submittedDecisionId === decision.id, '旧决策下的交付需由负责人重新提交', 'SUBMISSION_STALE');
    const reviewNote = string(data.reviewNote, '验收结论', 1_000);
    const next = commit(board, actor, 'task_accepted', { cardId: card.id, decisionId: decision.id, reviewNote, acceptedBy: actor }, (draft) => {
      const target = findCard(draft, card.id);
      target.status = 'done';
      Object.assign(target.acceptance, { reviewNote, acceptedBy: actor, acceptedAt: now(), acceptedDecisionId: decision.id });
      Object.assign(target, { version: target.version + 1, updatedBy: actor, updatedAt: now() });
    });
    return { card: findCard(next, card.id) };
  });

  handler(socket, 'task:reject', (payload) => {
    const { data, board, actor } = session(socket, payload);
    ensure(board.workflow === 'matter', '此画布未启用事项工作流', 'WORKFLOW_REQUIRED');
    const card = findCard(board, data.cardId);
    ensure(card.type === 'task', '仅任务卡可以退回');
    ensureVersion(card.version, data.version);
    ensure(card.status === 'review' && card.acceptance?.submittedBy, '任务尚未提交验收', 'SUBMISSION_REQUIRED');
    ensure(card.reviewer && card.reviewer === actor && card.owner !== actor, '仅独立复核人可退回；昵称并非真实身份认证', 'REVIEWER_MISMATCH');
    const reviewNote = string(data.reviewNote, '退回原因', 1_000);
    const next = commit(board, actor, 'task_rejected', { cardId: card.id, reviewNote, rejectedBy: actor }, (draft) => {
      const target = findCard(draft, card.id);
      target.status = 'doing';
      Object.assign(target.acceptance, { reviewNote, acceptedBy: null, acceptedAt: null, acceptedDecisionId: null });
      Object.assign(target, { version: target.version + 1, updatedBy: actor, updatedAt: now() });
    });
    return { card: findCard(next, card.id) };
  });

  handler(socket, 'card:move', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const card = findCard(board, data.cardId);
    requireLock(socket, board.id, card.id);
    ensureVersion(card.version, data.version);
    const x = number(data.x, '横坐标');
    const y = number(data.y, '纵坐标');
    const next = commit(board, actor, 'card_moved', { cardId: card.id, x, y }, (draft) => {
      Object.assign(findCard(draft, card.id), { x, y, version: card.version + 1, updatedBy: actor, updatedAt: now() });
    });
    return { card: findCard(next, card.id) };
  });

  handler(socket, 'edge:create', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const source = findCard(board, data.source).id;
    const target = findCard(board, data.target).id;
    ensure(source !== target, '连线不能指向自身');
    const label = string(data.label, '关系名称', 40);
    ensure(!board.edges.some((edge) => edge.source === source && edge.target === target && edge.label === label), '相同关系已存在', 'ALREADY_EXISTS');
    const edge = { id: makeId(), source, target, label, createdBy: actor, createdAt: now() };
    commit(board, actor, 'edge_created', { edgeId: edge.id, source, target, label }, (next) => next.edges.push(edge));
    return { edge };
  });

  handler(socket, 'edge:delete', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const edgeId = id(data.edgeId, '连线 ID');
    ensure(board.edges.some((edge) => edge.id === edgeId), '连线不存在', 'NOT_FOUND');
    commit(board, actor, 'edge_deleted', { edgeId }, (next) => {
      next.edges = next.edges.filter((edge) => edge.id !== edgeId);
    });
    return {};
  });

  handler(socket, 'comment:add', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const card = findCard(board, data.cardId);
    const comment = { id: makeId(), cardId: card.id, text: string(data.text, '评论', 1_000), author: actor, createdAt: now(), promotedCardId: null };
    commit(board, actor, 'comment_added', { cardId: card.id, commentId: comment.id }, (next) => next.comments.push(comment));
    return { comment };
  });

  handler(socket, 'comment:promote', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const comment = findComment(board, data.commentId);
    ensure(!comment.promotedCardId, '这条评论已经转成卡片', 'ALREADY_EXISTS');
    const source = findCard(board, comment.cardId);
    const text = data.text === undefined ? comment.text : string(data.text, '卡片内容', 2_000);
    const card = createCard({ type: 'idea', text, x: data.x === undefined ? source.x + 300 : data.x, y: data.y === undefined ? source.y + 180 : data.y, actor, sourceCommentId: comment.id });
    const edge = { id: makeId(), source: source.id, target: card.id, label: '补充', createdBy: actor, createdAt: now() };
    commit(board, actor, 'comment_promoted', { commentId: comment.id, cardId: card.id, edgeId: edge.id }, (next) => {
      next.cards.push(card);
      next.edges.push(edge);
      findComment(next, comment.id).promotedCardId = card.id;
    });
    return { card, edge };
  });

  handler(socket, 'goal:update', (payload) => {
    const { data, board, actor } = session(socket, payload);
    ensureVersion(board.goal.version, data.version);
    ensure(data.text !== undefined || data.criteria !== undefined, '请提供目标或验收标准');
    const text = data.text === undefined ? board.goal.text : string(data.text, '目标', 500);
    const goalCriteria = data.criteria === undefined ? board.goal.criteria : criteria(data.criteria);
    const next = commit(board, actor, 'goal_updated', { version: board.goal.version + 1 }, (draft) => {
      Object.assign(draft.goal, { text, criteria: goalCriteria, confirmed: false, completed: false, version: draft.goal.version + 1, contentVersion: draft.goal.contentVersion + 1, updatedBy: actor, updatedAt: now() });
    });
    return { goal: next.goal };
  });

  handler(socket, 'goal:confirm', (payload) => {
    const { data, board, actor } = session(socket, payload);
    ensureVersion(board.goal.version, data.version);
    ensure(!board.goal.confirmed, '目标已确认', 'ALREADY_EXISTS');
    ensure(board.goal.criteria.length > 0, '请先填写至少一条验收标准');
    const next = commit(board, actor, 'goal_confirmed', { goalVersion: board.goal.version }, (draft) => {
      Object.assign(draft.goal, { confirmed: true, version: draft.goal.version + 1, updatedBy: actor, updatedAt: now() });
    });
    return { goal: next.goal };
  });

  handler(socket, 'board:complete', (payload) => {
    const { board, actor } = session(socket, payload);
    ensure(board.goal.confirmed, '请先确认画布目标', 'GOAL_UNCONFIRMED');
    ensure(!board.goal.completed, '画布已经宣布完成', 'ALREADY_EXISTS');
    const tasks = board.cards.filter((card) => card.type === 'task');
    if (board.workflow === 'matter') {
      ensure(board.matter.owner, '请先指定事项负责人', 'OWNER_REQUIRED');
      ensure(board.matter.owner === actor, '仅事项负责人可代演完成确认；昵称并非真实身份认证', 'OWNER_MISMATCH');
      const decision = currentDecision(board);
      ensure(decision && decision.status === 'confirmed', '请先由事项负责人确认有效决策；依据或异议变化时需重新决策', 'DECISION_REQUIRED');
      ensure(tasks.length > 0, '请先添加任务卡片', 'TASKS_REQUIRED');
      ensure(tasks.every((card) => card.status === 'done' && card.acceptance?.delivery && card.acceptance?.submittedBy && card.acceptance?.submittedDecisionId === decision.id && card.acceptance?.acceptedBy && card.acceptance?.acceptedAt && card.acceptance?.acceptedDecisionId === decision.id), '仍有任务未基于当前决策通过独立验收', 'TASKS_UNFINISHED');
    }
    if (board.template === 'debate') {
      ensure(board.cards.some((card) => ['conclusion', 'decision', '结论'].includes(card.type) && !card.text.startsWith('示例：')), '请先添加正式结论卡片', 'CONCLUSION_REQUIRED');
    } else {
      ensure(tasks.length > 0, '请先添加任务卡片', 'TASKS_REQUIRED');
    }
    const unfinished = tasks.filter((card) => card.status !== 'done');
    ensure(unfinished.length === 0, '仍有未完成任务，请先处理', 'TASKS_UNFINISHED');
    ensure(tasks.every((card) => card.owner && card.reviewer && card.owner !== card.reviewer), '任务责任人或审核人未指定，或两者为同一人，请先处理', 'REVIEWER_REQUIRED');
    const next = commit(board, actor, 'board_completed', { goalVersion: board.goal.version, taskCount: board.boardAgent.progress.total }, (draft) => {
      Object.assign(draft.goal, { completed: true, version: draft.goal.version + 1, updatedBy: actor, updatedAt: now() });
    });
    return { goal: next.goal };
  });

  handler(socket, 'boardAgent:refresh', (payload) => {
    const { board } = session(socket, payload);
    // Public advice is deterministic and recalculated after every published change.
    return { boardAgent: board.boardAgent };
  });

  handler(socket, 'suggestion:confirm', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const suggestionId = string(data.suggestionId, '建议 ID', 120);
    const suggestion = board.boardAgent.suggestions.find((item) => item.id === suggestionId);
    ensure(suggestion, '建议已变化，请刷新后重试', 'SUGGESTION_STALE');
    if (suggestion.kind === 'assign') {
      const card = findCard(board, suggestion.sourceCardId);
      const conflictingLock = locks.get(board.id)?.get(card.id);
      ensure(!conflictingLock || conflictingLock.expiresAt <= Date.now() || conflictingLock.clientId === socket.id, '此卡片正在由其他成员编辑', 'LOCKED');
      const field = suggestion.field === 'reviewer' ? 'reviewer' : 'owner';
      const person = string(data[field], field === 'reviewer' ? '审核人' : '责任人', 30);
      ensure(field !== 'reviewer' || !card.owner || card.owner !== person, '审核人应与责任人不同', 'SAME_REVIEWER');
      ensure(field !== 'owner' || !card.reviewer || card.reviewer !== person, '责任人应与审核人不同', 'SAME_REVIEWER');
      const next = commit(board, actor, 'suggestion_confirmed', { suggestionId, kind: 'assign', field, cardId: card.id, person, confirmedBy: actor }, (draft) => {
        Object.assign(findCard(draft, card.id), { [field]: person, version: card.version + 1, updatedBy: actor, updatedAt: now() });
      });
      return { card: findCard(next, card.id) };
    }
    if (suggestion.kind === 'review') {
      ensure(board.workflow !== 'matter', '事项任务请使用交付与独立验收流程', 'TASK_WORKFLOW_REQUIRED');
      const card = findCard(board, suggestion.sourceCardId);
      ensure(card.reviewer === actor, '仅指定的审核人可确认此任务；昵称仅用于 Demo 流程', 'REVIEWER_MISMATCH');
      const conflictingLock = locks.get(board.id)?.get(card.id);
      ensure(!conflictingLock || conflictingLock.expiresAt <= Date.now() || conflictingLock.clientId === socket.id, '此卡片正在由其他成员编辑', 'LOCKED');
      const next = commit(board, actor, 'review_confirmed', { suggestionId, cardId: card.id, reviewer: actor }, (draft) => {
        Object.assign(findCard(draft, card.id), { status: 'done', version: card.version + 1, updatedBy: actor, updatedAt: now() });
      });
      return { card: findCard(next, card.id) };
    }
    const source = suggestion.sourceCardId ? findCard(board, suggestion.sourceCardId) : null;
    const taskText = data.text === undefined ? suggestion.text : string(data.text, '任务内容', 2_000);
    const card = createCard({ type: 'task', text: taskText, x: data.x === undefined ? (source?.x ?? 120) + 320 : data.x, y: data.y === undefined ? (source?.y ?? 160) + 220 : data.y, actor });
    commit(board, actor, 'suggestion_confirmed', { suggestionId, kind: 'task', cardId: card.id, confirmedBy: actor }, (draft) => draft.cards.push(card));
    return { card };
  });

  handler(socket, 'agent:preview', (payload) => {
    const { data, board } = session(socket, payload);
    ensure(data.mode === 'create' || data.mode === 'revise', 'Agent 模式应为 create 或 revise');
    const instruction = string(data.instruction, 'Agent 指令', 600);
    const source = data.cardId === undefined ? null : findCard(board, data.cardId);
    ensure(data.mode !== 'revise' || source, '改写时请选择一张卡片');
    // This clearly labelled simulation uses only the selected published card and
    // the private instruction. It never calls a model or reads other board cards.
    const generated = generateSimulatedPreview({ mode: data.mode, sourceText: source?.text ?? null, instruction });
    const timestamp = now();
    const preview = {
      id: makeId(),
      mode: data.mode,
      cardId: source?.id ?? null,
      sourceVersion: source?.version ?? null,
      sourceText: source?.text ?? null,
      text: generated.text,
      simulated: generated.simulated,
      createdAt: timestamp,
      expiresAt: new Date(Date.now() + previewMs).toISOString(),
    };
    const socketPreviews = previews.get(socket.id);
    if (socketPreviews.size >= 10) socketPreviews.delete(socketPreviews.keys().next().value);
    socketPreviews.set(preview.id, { boardId: board.id, preview });
    return { preview };
  });

  handler(socket, 'agent:publish', (payload) => {
    const { data, board, actor } = session(socket, payload);
    const previewId = id(data.previewId, '预览 ID');
    const privateItem = previews.get(socket.id)?.get(previewId);
    ensure(privateItem && privateItem.boardId === board.id, '预览不存在或不属于当前成员', 'PREVIEW_NOT_FOUND');
    const preview = privateItem.preview;
    ensure(new Date(preview.expiresAt).getTime() > Date.now(), '预览已过期，请重新生成', 'PREVIEW_EXPIRED');
    if (preview.mode === 'revise') {
      const card = findCard(board, preview.cardId);
      ensureVersion(card.version, preview.sourceVersion);
      requireLock(socket, board.id, card.id);
      const next = commit(board, actor, 'agent_revision_published', { cardId: card.id, sourceVersion: preview.sourceVersion, publishedBy: actor, simulated: true }, (draft) => {
        const target = findCard(draft, card.id);
        if (board.workflow === 'matter' && target.type === 'task') invalidateTaskAcceptance(target);
        Object.assign(target, { text: preview.text, version: card.version + 1, contentVersion: card.contentVersion + 1, updatedBy: actor, updatedAt: now() });
      });
      previews.get(socket.id).delete(previewId);
      return { card: findCard(next, card.id) };
    }
    const source = preview.cardId ? findCard(board, preview.cardId) : null;
    if (source) ensureVersion(source.version, preview.sourceVersion);
    const card = createCard({ type: 'idea', text: preview.text, x: data.x === undefined ? (source?.x ?? 160) + 320 : data.x, y: data.y === undefined ? (source?.y ?? 160) + 160 : data.y, actor });
    const edge = source ? { id: makeId(), source: source.id, target: card.id, label: 'Agent 补充', createdBy: actor, createdAt: now() } : null;
    commit(board, actor, 'agent_card_published', { cardId: card.id, sourceCardId: source?.id ?? null, edgeId: edge?.id ?? null, publishedBy: actor, simulated: true }, (draft) => {
      draft.cards.push(card);
      if (edge) draft.edges.push(edge);
    });
    previews.get(socket.id).delete(previewId);
    return { card, edge };
  });

  socket.on('disconnect', () => {
    previews.delete(socket.id);
    releaseSocket(socket);
  });
});

const expiryTimer = setInterval(() => {
  for (const [boardId, boardLocks] of locks) {
    let changed = false;
    for (const [cardId, lock] of boardLocks) {
      if (lock.expiresAt <= Date.now()) {
        boardLocks.delete(cardId);
        changed = true;
      }
    }
    if (changed) broadcast(boardId);
  }
  for (const socketPreviews of previews.values()) {
    for (const [previewId, item] of socketPreviews) {
      if (new Date(item.preview.expiresAt).getTime() <= Date.now()) socketPreviews.delete(previewId);
    }
  }
}, 10_000);
expiryTimer.unref();

function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter((item) => item?.family === 'IPv4' && !item.internal).map((item) => item.address);
}

httpServer.listen(port, '0.0.0.0', () => {
  const listeningPort = httpServer.address().port;
  console.log(`画布服务已启动：http://localhost:${listeningPort}`);
  for (const address of lanAddresses()) console.log(`局域网访问：http://${address}:${listeningPort}`);
});

export { app, httpServer, io };
