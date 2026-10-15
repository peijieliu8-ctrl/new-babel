// These pure adapters form the boundary for later model or MCP-backed agents.
// The demo deliberately uses deterministic rules and never sends data outside
// the local server. A caller decides whether a preview becomes public.

function cardLabel(card) {
  return card.text.replace(/\s+/g, ' ').slice(0, 32);
}

export function calculateBoardAgent(board, timestamp = new Date().toISOString()) {
  if (board.workflow === 'matter') return calculateMatterAgent(board, timestamp);
  if (board.template === 'debate') return calculateDebateAgent(board, timestamp);

  const tasks = board.cards.filter((card) => card.type === 'task');
  const done = tasks.filter((card) => card.status === 'done').length;
  const evidence = [];
  const blockers = [];
  const suggestions = [];

  if (board.goal.confirmed) {
    evidence.push({ id: 'goal-confirmed', text: `目标已由${board.goal.updatedBy || '成员'}确认`, sourceCardId: null });
  } else {
    blockers.push({ id: 'goal-unconfirmed', text: '画布目标尚未经过人工确认', sourceCardId: null });
  }

  for (const card of tasks) {
    if (card.status === 'done') {
      evidence.push({ id: `done:${card.id}`, text: `任务「${cardLabel(card)}」已被标记完成`, sourceCardId: card.id });
    }
    if (card.status === 'blocked') {
      blockers.push({ id: `blocked:${card.id}`, text: `任务「${cardLabel(card)}」被标记为卡点`, sourceCardId: card.id });
      suggestions.push({ id: `task:unblock:${card.id}`, kind: 'task', text: `梳理「${cardLabel(card)}」的解阻步骤`, sourceCardId: card.id });
    }
    if (card.status === 'review') {
      blockers.push({ id: `awaiting-review:${card.id}`, text: `任务「${cardLabel(card)}」待${card.reviewer || '审核人'}人工确认`, sourceCardId: card.id });
      if (card.reviewer) suggestions.push({ id: `review:${card.id}`, kind: 'review', text: `由${card.reviewer}审核「${cardLabel(card)}」并确认完成`, sourceCardId: card.id });
    }
    if (!card.owner) {
      blockers.push({ id: `owner-missing:${card.id}`, text: `任务「${cardLabel(card)}」未指定责任人`, sourceCardId: card.id });
      suggestions.push({ id: `assign:${card.id}`, kind: 'assign', field: 'owner', text: `为「${cardLabel(card)}」指定责任人`, sourceCardId: card.id });
    }
    if (!card.reviewer) {
      blockers.push({ id: `reviewer-missing:${card.id}`, text: `任务「${cardLabel(card)}」未指定审核人`, sourceCardId: card.id });
      suggestions.push({ id: `reviewer:${card.id}`, kind: 'assign', field: 'reviewer', text: `为「${cardLabel(card)}」指定审核人`, sourceCardId: card.id });
    } else if (card.owner && card.owner === card.reviewer) {
      blockers.push({ id: `reviewer-same:${card.id}`, text: `任务「${cardLabel(card)}」的责任人与审核人相同`, sourceCardId: card.id });
      suggestions.push({ id: `reviewer-change:${card.id}`, kind: 'assign', field: 'reviewer', text: `为「${cardLabel(card)}」指定不同的审核人`, sourceCardId: card.id });
    }
  }

  if (tasks.length === 0 && !board.goal.completed) {
    suggestions.push({ id: 'task:goal', kind: 'task', text: '将画布目标拆解为可执行任务', sourceCardId: null });
  }

  return {
    summary: tasks.length === 0 ? '尚无任务卡片' : `${done}/${tasks.length} 项任务已标记完成`,
    progress: { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 },
    evidence,
    blockers,
    suggestions,
    nextSteps: planNextSteps(board, tasks),
    updatedAt: timestamp,
  };
}

function calculateMatterAgent(board, timestamp) {
  const evidence = [];
  const blockers = [];
  const nextSteps = [];
  const tasks = board.cards.filter((card) => card.type === 'task');
  const current = board.decisions?.find((item) => item.id === board.matter?.currentDecisionId);
  const acceptedOnCurrentDecision = (card) => current?.status === 'confirmed'
    && card.status === 'done'
    && card.acceptance?.submittedDecisionId === current.id
    && card.acceptance?.acceptedDecisionId === current.id
    && Boolean(card.acceptance?.acceptedBy);
  const done = tasks.filter(acceptedOnCurrentDecision).length;

  if (!board.goal.confirmed) {
    blockers.push({ id: 'goal-unconfirmed', text: '事项目标与完成条件尚未由人确认', sourceCardId: null });
    nextSteps.push({ id: 'confirm-goal', text: '确认事项目标与完成条件', sourceCardId: null });
  }
  if (!board.matter?.owner) {
    blockers.push({ id: 'matter-owner-missing', text: '事项尚无负责人', sourceCardId: null });
    nextSteps.push({ id: 'assign-matter-owner', text: '指定事项负责人', sourceCardId: null });
  }
  if (board.matter?.blocker) blockers.push({ id: 'matter-blocker', text: board.matter.blocker, sourceCardId: null });

  const cited = new Set(current?.evidenceRefs?.map((ref) => ref.cardId) || []);
  for (const card of board.cards.filter((item) => item.type === 'evidence')) {
    if (card.source?.title && card.source?.reference && card.source?.version) {
      evidence.push({ id: `source:${card.id}`, text: `${cardLabel(card)} · ${card.source.title}（${card.source.version}，${card.source.reference}）${cited.has(card.id) ? '；已被当前决策引用' : ''}`, sourceCardId: card.id });
    } else {
      blockers.push({ id: `source-missing:${card.id}`, text: `证据「${cardLabel(card)}」缺少来源名称、位置或版本`, sourceCardId: card.id });
    }
  }

  if (!current) {
    blockers.push({ id: 'decision-missing', text: '尚无人工作出并记录事项决策', sourceCardId: null });
    nextSteps.push({ id: 'record-decision', text: '基于版本化证据回应异议，并由事项负责人记录决策', sourceCardId: null });
  } else if (current.status !== 'confirmed') {
    blockers.push({ id: 'decision-stale', text: `当前决策需复核：${(current.staleReasons || []).join('；')}`, sourceCardId: null });
    nextSteps.push({ id: 'renew-decision', text: '依据最新证据和异议重新记录决策', sourceCardId: null });
  } else {
    evidence.push({ id: `decision:${current.id}`, text: `决策「${current.option.slice(0, 32)}」由${current.decidedBy}确认；其依据和异议回应已留痕`, sourceCardId: null });
  }

  for (const card of tasks) {
    const label = `「${cardLabel(card)}」`;
    if (!card.owner || !card.reviewer || card.owner === card.reviewer) {
      blockers.push({ id: `assignment:${card.id}`, text: `任务${label}缺少不同的负责人和复核人`, sourceCardId: card.id });
      nextSteps.push({ id: `assign:${card.id}`, text: `为任务${label}指定负责人及独立复核人`, sourceCardId: card.id });
    } else if (!card.acceptance?.criteria) {
      blockers.push({ id: `criteria:${card.id}`, text: `任务${label}缺少验收标准`, sourceCardId: card.id });
      nextSteps.push({ id: `criteria:${card.id}`, text: `补充任务${label}的验收标准`, sourceCardId: card.id });
    } else if (card.status === 'review') {
      blockers.push({ id: `review:${card.id}`, text: `任务${label}等待${card.reviewer}核对交付说明并验收`, sourceCardId: card.id });
      nextSteps.push({ id: `review:${card.id}`, text: `请${card.reviewer}验收任务${label}`, sourceCardId: card.id });
    } else if (acceptedOnCurrentDecision(card)) {
      evidence.push({ id: `accepted:${card.id}`, text: `任务${label}已由${card.acceptance.acceptedBy}基于当前决策验收，交付说明留在任务卡`, sourceCardId: card.id });
    } else {
      if (card.status === 'blocked') blockers.push({ id: `blocked:${card.id}`, text: `任务${label}受阻`, sourceCardId: card.id });
      nextSteps.push({ id: `submit:${card.id}`, text: `由${card.owner}提交任务${label}的交付说明`, sourceCardId: card.id });
    }
  }

  if (!tasks.length) nextSteps.push({ id: 'create-task', text: '把已确认决策拆成有验收标准的任务', sourceCardId: null });
  if (current?.status === 'confirmed' && tasks.length && tasks.every(acceptedOnCurrentDecision) && board.goal.confirmed && !board.goal.completed) {
    nextSteps.push({ id: 'complete-matter', text: '核对决策与任务验收后，由人宣布事项完成', sourceCardId: null });
  }

  return {
    summary: `事项决策${current?.status === 'confirmed' ? '已确认' : current ? '需复核' : '待确认'}；${done}/${tasks.length} 项任务已验收`,
    progress: { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 },
    evidence, blockers, suggestions: [], nextSteps: board.goal.completed ? [] : nextSteps.slice(0, 8), updatedAt: timestamp,
  };
}

function planNextSteps(board, tasks) {
  if (board.goal.completed) return [];
  const steps = [];
  if (!board.goal.confirmed) steps.push({ id: 'confirm-goal', text: '由成员确认目标与验收标准', sourceCardId: null });
  if (tasks.length === 0) steps.push({ id: 'add-first-task', text: '将目标拆解为首项任务', sourceCardId: null });

  for (const card of tasks) {
    const label = `「${cardLabel(card)}」`;
    const sourceCardId = card.id;
    if (card.status === 'blocked') steps.push({ id: `resolve:${card.id}`, text: `处理${label}的卡点`, sourceCardId });
    else if (!card.owner) steps.push({ id: `assign-owner:${card.id}`, text: `为${label}指定责任人`, sourceCardId });
    else if (!card.reviewer || card.owner === card.reviewer) steps.push({ id: `assign-reviewer:${card.id}`, text: `为${label}指定独立审核人`, sourceCardId });
    else if (card.status === 'review') steps.push({ id: `review:${card.id}`, text: `请${card.reviewer}审核${label}`, sourceCardId });
    else if (card.status === 'todo') steps.push({ id: `start:${card.id}`, text: `启动${label}`, sourceCardId });
    else if (card.status === 'doing') steps.push({ id: `submit-review:${card.id}`, text: `完成${label}后送审`, sourceCardId });
  }

  if (tasks.length > 0 && tasks.every((card) => card.status === 'done' && card.owner && card.reviewer && card.owner !== card.reviewer) && board.goal.confirmed) {
    steps.push({ id: 'confirm-completion', text: '由成员核对验收标准并宣布完成', sourceCardId: null });
  }
  return steps.slice(0, 6);
}

const debateStages = [
  { key: 'question', types: ['question', '议题'], title: '议题' },
  { key: 'idea', types: ['idea', 'claim', '观点'], title: '观点' },
  { key: 'evidence', types: ['evidence', '依据'], title: '依据' },
  { key: 'objection', types: ['objection', 'critique', '质疑'], title: '质疑' },
  { key: 'conclusion', types: ['conclusion', 'decision', '结论'], title: '结论' },
];

function calculateDebateAgent(board, timestamp) {
  const evidence = [];
  const blockers = [];
  const suggestions = [];
  const nextSteps = [];
  let done = 0;

  if (board.goal.confirmed) {
    evidence.push({ id: 'goal-confirmed', text: `目标已由${board.goal.updatedBy || '成员'}确认`, sourceCardId: null });
  } else {
    blockers.push({ id: 'goal-unconfirmed', text: '讨论目标尚未经过人工确认', sourceCardId: null });
    nextSteps.push({ id: 'confirm-goal', text: '由成员确认讨论目标与验收标准', sourceCardId: null });
  }

  const formalCards = board.cards.filter((card) => !card.text.startsWith('示例：'));
  const firstIdea = formalCards.find((card) => ['idea', 'claim', '观点'].includes(card.type));
  const firstQuestion = formalCards.find((card) => ['question', '议题'].includes(card.type));
  let conclusionCard = null;
  for (const stage of debateStages) {
    const card = formalCards.find((item) => stage.types.includes(item.type));
    if (card) {
      done += 1;
      if (stage.key === 'conclusion') conclusionCard = card;
      evidence.push({ id: `stage:${stage.key}`, text: `已记录${stage.title}卡片「${cardLabel(card)}」；内容仍需人工核验`, sourceCardId: card.id });
    } else {
      blockers.push({ id: `missing:${stage.key}`, text: `缺少正式${stage.title}卡片`, sourceCardId: null });
      suggestions.push({ id: `task:debate:${stage.key}`, kind: 'task', text: `整理${stage.title}并补充到画布`, sourceCardId: null });
      const sourceCardId = ['evidence', 'objection'].includes(stage.key) ? firstIdea?.id ?? null : stage.key === 'conclusion' ? firstQuestion?.id ?? firstIdea?.id ?? null : null;
      nextSteps.push({ id: `add:${stage.key}`, text: `补充正式${stage.title}卡片`, sourceCardId });
    }
  }

  const tasks = board.cards.filter((card) => card.type === 'task');
  for (const card of tasks) {
    const label = `「${cardLabel(card)}」`;
    if (card.status === 'done') {
      evidence.push({ id: `done:${card.id}`, text: `任务${label}已由审核人确认完成`, sourceCardId: card.id });
    } else if (card.status === 'blocked') {
      blockers.push({ id: `blocked:${card.id}`, text: `任务${label}处于受阻状态`, sourceCardId: card.id });
      suggestions.push({ id: `task:unblock:${card.id}`, kind: 'task', text: `梳理${label}的解阻步骤`, sourceCardId: card.id });
      nextSteps.push({ id: `resolve:${card.id}`, text: `处理${label}的卡点`, sourceCardId: card.id });
    } else if (card.status === 'review') {
      blockers.push({ id: `awaiting-review:${card.id}`, text: `任务${label}等待${card.reviewer || '审核人'}确认`, sourceCardId: card.id });
      if (card.reviewer) suggestions.push({ id: `review:${card.id}`, kind: 'review', text: `由${card.reviewer}审核${label}并确认完成`, sourceCardId: card.id });
      nextSteps.push({ id: `review:${card.id}`, text: `请${card.reviewer || '审核人'}审核${label}`, sourceCardId: card.id });
    } else {
      nextSteps.push({ id: `progress:${card.id}`, text: `${card.status === 'doing' ? '推进' : '启动'}任务${label}`, sourceCardId: card.id });
    }
    if (!card.owner) {
      blockers.push({ id: `owner-missing:${card.id}`, text: `任务${label}未指定责任人`, sourceCardId: card.id });
      suggestions.push({ id: `assign:${card.id}`, kind: 'assign', field: 'owner', text: `为${label}指定责任人`, sourceCardId: card.id });
    }
    if (!card.reviewer || (card.owner && card.owner === card.reviewer)) {
      blockers.push({ id: `reviewer-missing:${card.id}`, text: `任务${label}缺少独立审核人`, sourceCardId: card.id });
      suggestions.push({ id: `reviewer:${card.id}`, kind: 'assign', field: 'reviewer', text: `为${label}指定独立审核人`, sourceCardId: card.id });
    }
  }

  if (done === debateStages.length && board.goal.confirmed && !board.goal.completed && tasks.every((card) => card.status === 'done' && card.owner && card.reviewer && card.owner !== card.reviewer)) {
    nextSteps.push({ id: 'confirm-completion', text: '由成员核对依据和结论后宣布完成', sourceCardId: conclusionCard?.id ?? null });
  }

  return {
    summary: `讨论结构已覆盖 ${done}/${debateStages.length} 项；仅统计非示例卡片，不代表内容已核实`,
    progress: { done, total: debateStages.length, percent: Math.round((done / debateStages.length) * 100) },
    evidence,
    blockers,
    suggestions,
    nextSteps: board.goal.completed ? [] : nextSteps.slice(0, 6),
    updatedAt: timestamp,
  };
}

export function generateSimulatedPreview({ mode, sourceText = null, instruction }) {
  const prefix = '【模拟 Agent 建议】';
  const text = mode === 'revise'
    ? `${prefix}\n原卡片：${sourceText}\n按以下要求改写：${instruction}\n建议先由成员核对事实与措辞，再发布。`
    : `${prefix}\n${sourceText ? `参考所选卡片：${sourceText}\n` : ''}新卡片草稿：${instruction}\n请补充可核验的内容后发布。`;
  return { text: text.slice(0, 2_000), simulated: true };
}
