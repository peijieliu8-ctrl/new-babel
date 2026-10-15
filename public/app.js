(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TYPE_LABELS = { question: "议题", idea: "观点", evidence: "依据", objection: "质疑", conclusion: "结论", task: "任务", risk: "风险", decision: "决策", resource: "资源" };
  const TYPE_TONES = { question: "purple", idea: "blue", evidence: "teal", objection: "rose", conclusion: "teal", task: "blue", risk: "rose", decision: "teal", resource: "amber" };
  const STATUS_LABELS = { todo: "待开始", doing: "进行中", review: "待审核", blocked: "受阻", done: "已完成" };
  const ACTION_LABELS = {
    board_created: "创建了画布", board_completed: "确认完成协作", goal_updated: "更新了协作目标", goal_confirmed: "确认了协作目标",
    card_created: "新增了卡片", card_updated: "修改了卡片", card_moved: "移动了卡片", edge_created: "建立了卡片关系", edge_deleted: "删除了卡片关系",
    comment_added: "添加了评论", comment_promoted: "将评论转为关联卡", agent_revision_published: "发布了 Agent 改写", agent_card_published: "发布了 Agent 新卡", suggestion_confirmed: "确认了画布 Agent 建议", review_confirmed: "审核通过了任务",
    matter_updated: "更新了事项主卡", decision_recorded: "记录了人工决策", decision_stale: "触发了决策复核", task_submitted: "提交了任务交付", task_accepted: "验收通过了任务", task_rejected: "退回了任务交付"
  };
  const state = {
    socket: null, boardId: null, board: null, clientId: null, nickname: "", participants: [], locks: {},
    selectedCardId: null, selectedEdgeId: null, editingCardId: null, draft: null, commentDraft: "", activePanel: "card",
    connectSource: null, agentMode: "create", agentTargetId: null, preview: null, previewError: "", entryMode: "create", template: "matter",
    view: { x: 0, y: 0, scale: 1 }, workspaceView: "canvas", pointer: null, joined: false, modal: null
  };

  function el(tag, className, value) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (value !== undefined && value !== null) item.textContent = String(value);
    return item;
  }
  function append(parent, ...children) { children.forEach((child) => child && parent.appendChild(child)); return parent; }
  function replace(parent, ...children) { parent.replaceChildren(...children.filter(Boolean)); return parent; }
  function button(label, className, handler) { const b = el("button", className, label); b.type = "button"; if (handler) b.addEventListener("click", handler); return b; }
  function paragraph(text, className) { return el("p", className, text); }
  function safeText(value, fallback = "") { return value === undefined || value === null || value === "" ? fallback : String(value); }
  function setToast(message, kind) {
    const t = el("div", `toast ${kind || ""}`, message); $("toast-region").appendChild(t);
    window.setTimeout(() => t.remove(), 3500);
  }
  function setEntryError(message) { $("entry-error").textContent = message || ""; $("entry-error").hidden = !message; }
  function formatTime(value) {
    if (!value) return "刚刚";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "刚刚";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  }
  function firstChar(name) { return Array.from(String(name || "我"))[0] || "我"; }
  function errorMessage(error, fallback = "操作未完成，请稍后重试") { return safeText(error && error.message, fallback); }
  function showError(error, fallback) { setToast(errorMessage(error, fallback), "error"); }
  function currentCard() { return state.board && state.board.cards.find((card) => card.id === state.selectedCardId); }
  function cardById(id) { return state.board && state.board.cards.find((card) => card.id === id); }
  function lockOf(cardId) { return state.locks && state.locks[cardId]; }
  function ownLock(cardId) { const lock = lockOf(cardId); return !!lock && lock.clientId === state.clientId; }

  function initSocket() {
    if (!window.io) throw new Error("实时协作组件未加载，请刷新页面");
    const socket = window.io({ reconnection: true });
    state.socket = socket;
    socket.on("board:state", (payload) => {
      if (!payload || !payload.board || payload.board.id !== state.boardId) return;
      applyBoardState(payload);
    });
    socket.on("disconnect", () => {
      const note = $("save-status"); note.textContent = "连接中断 · 正在重连";
      document.querySelector(".note-dot").classList.add("offline");
    });
    socket.on("connect", async () => {
      if (state.joined && state.boardId) {
        try {
          const result = await emit("board:join", { boardId: state.boardId, nickname: state.nickname });
          state.clientId = result.clientId;
          state.editingCardId = null; state.draft = null;
          applyBoardState(result);
          setToast("已重新连接画布", "success");
        } catch (error) { showError(error, "重连画布失败"); }
      }
      $("save-status").textContent = "已连接 · 实时协作";
      document.querySelector(".note-dot").classList.remove("offline");
    });
    return socket;
  }
  function waitConnected() {
    if (!state.socket) initSocket();
    if (state.socket.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { cleanup(); reject(new Error("连接服务超时，请检查服务是否已启动")); }, 9000);
      const onConnect = () => { cleanup(); resolve(); };
      function cleanup() { window.clearTimeout(timer); state.socket.off("connect", onConnect); }
      state.socket.on("connect", onConnect);
    });
  }
  async function emit(name, payload) {
    await waitConnected();
    return new Promise((resolve, reject) => {
      state.socket.timeout(10000).emit(name, payload, (timeout, result) => {
        if (timeout) return reject(new Error("服务响应超时，请重试"));
        if (!result || result.ok === false) {
          const e = new Error(safeText(result && result.error, "操作失败"));
          e.code = result && result.code;
          return reject(e);
        }
        resolve(result);
      });
    });
  }
  async function createBoard() {
    const request = state.template === "matter" ? { template: "plan", workflow: "matter" } : { template: state.template };
    const response = await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, title: $("new-title").value.trim() || undefined }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.boardId) throw new Error(safeText(body.error, "创建画布失败"));
    return body.boardId;
  }
  function extractBoardId(input) {
    const trimmed = input.trim();
    if (!trimmed) return "";
    try {
      const url = new URL(trimmed, window.location.href);
      const q = url.searchParams.get("board") || url.searchParams.get("boardId");
      if (q) return q;
      const pathMatch = url.pathname.match(/\/board\/([^/?#]+)/);
      if (pathMatch) return decodeURIComponent(pathMatch[1]);
    } catch (_) { /* Raw board ID. */ }
    return trimmed;
  }
  async function joinBoard(boardId, nickname, rememberNickname = true) {
    await waitConnected();
    const result = await emit("board:join", { boardId, nickname });
    state.boardId = boardId; state.nickname = nickname; state.clientId = result.clientId; state.joined = true;
    state.selectedCardId = null; state.agentTargetId = null; state.editingCardId = null; state.draft = null; state.preview = null;
    if (rememberNickname) {
      try { window.localStorage.setItem("canvasNickname", nickname); } catch (_) { /* Browser storage may be disabled. */ }
    }
    const url = new URL(window.location.href); url.searchParams.set("board", boardId);
    window.history.replaceState({}, "", url.toString());
    $("landing").hidden = true; $("app").hidden = false;
    applyBoardState(result);
    showWorkspaceView(result.board.workflow === "matter" ? "inbox" : "canvas");
    if (result.board.workflow !== "matter") window.requestAnimationFrame(fitCanvas);
  }
  async function submitEntry() {
    const nickname = $("nickname").value.trim();
    if (!nickname) { setEntryError("请填写昵称"); $("nickname").focus(); return; }
    const submit = $("entry-submit"); submit.disabled = true; setEntryError("");
    try {
      const boardId = state.entryMode === "create" ? await createBoard() : extractBoardId($("join-link").value);
      if (!boardId) throw new Error("请填写画布链接或 ID");
      await joinBoard(boardId, nickname);
    } catch (error) { setEntryError(errorMessage(error, "进入画布失败")); }
    finally { submit.disabled = false; }
  }
  function applyBoardState(payload) {
    state.board = payload.board;
    state.participants = Array.isArray(payload.participants) ? payload.participants : [];
    state.locks = payload.locks || {};
    if (state.selectedCardId && !cardById(state.selectedCardId)) { state.selectedCardId = null; state.editingCardId = null; state.draft = null; }
    renderAll();
  }

  function renderAll() {
    if (!state.board) return;
    renderBoardMeta(); renderGoal(); renderParticipants(); renderAudit(); renderCanvas(); renderDetail(); renderOverview(); renderAgentTargets(); renderAgentContext(); renderAgentPreview(); renderMatterSide(); renderWorkflowCounts(); renderWorkflowView();
  }
  function renderBoardMeta() {
    const board = state.board;
    $("board-title").textContent = board.title || "未命名画布";
    $("side-board-title").textContent = board.title || "未命名画布";
    $("side-template").textContent = board.workflow === "matter" ? "事项推进 · 原型" : board.template === "plan" ? "方案细化" : "想法辩论";
    $("matter-side-edit").hidden = board.workflow !== "matter";
    document.querySelector(".matter-side-section").hidden = board.workflow !== "matter";
    $("workflow-edit-matter").hidden = board.workflow !== "matter";
    document.querySelector(".workspace-views").hidden = board.workflow !== "matter";
    const complete = !!(board.goal && board.goal.completed);
    $("board-status").textContent = complete ? "已完成" : "进行中";
    $("board-status").classList.toggle("completed", complete);
    $("complete-button").textContent = complete ? "已完成" : "完成协作";
    $("complete-button").disabled = complete;
    $("self-name").textContent = state.nickname;
    $("self-avatar").textContent = firstChar(state.nickname);
  }
  function renderGoal() {
    const goal = state.board.goal || { text: "", criteria: [], confirmed: false, completed: false };
    const display = $("goal-display"); display.classList.toggle("confirmed", !!goal.confirmed);
    replace(display, el("span", goal.text ? "" : "empty-muted", goal.text || "尚未设置协作目标"));
    if (goal.text) append(display, el("span", "goal-state", goal.completed ? "✓ 已完成" : goal.confirmed ? "✓ 已确认" : "● 待确认 / 目标变更后需重新确认"));
    $("goal-confirm").hidden = !goal.text || !!goal.confirmed || !!goal.completed;
    const container = $("canvas-goal"); container.classList.toggle("confirmed", !!goal.confirmed);
    const head = el("div", "canvas-goal-head");
    append(head, el("strong", "", goal.completed ? "✓ 协作目标已完成" : goal.confirmed ? "✓ 协作目标已确认" : "◇ 协作目标 · 待确认"), button("编辑", "", openGoalModal));
    const text = el("div", "canvas-goal-text", goal.text || "写下这次协作要解决的问题");
    const criteria = el("div", "canvas-goal-criteria");
    const values = Array.isArray(goal.criteria) ? goal.criteria : [];
    if (values.length) { append(criteria, el("b", "", "完成条件")); values.forEach((item) => append(criteria, el("span", "", `· ${item}`))); }
    else append(criteria, el("span", "", "完成条件待补充"));
    replace(container, head, text, criteria);
  }
  function renderParticipants() {
    const list = $("participants"), stack = $("top-participants"); list.replaceChildren(); stack.replaceChildren();
    const people = state.participants;
    $("participant-count").textContent = String(people.length);
    people.forEach((person, index) => {
      const name = safeText(person.nickname, "未命名");
      const avatar = el("span", `avatar tone-${index % 5}`, firstChar(name));
      const row = el("div", "participant"); append(row, avatar, el("span", "name", name));
      if (person.clientId === state.clientId) append(row, el("span", "self-tag", "我"));
      append(list, row);
      const top = el("span", `avatar tone-${index % 5}`, firstChar(name)); top.title = name; append(stack, top);
    });
    if (!people.length) append(list, el("div", "overview-empty", "暂无在线成员"));
  }
  function renderAudit() {
    const list = $("activity-list"); list.replaceChildren();
    const items = Array.isArray(state.board.audit) ? state.board.audit.slice(-12).reverse() : [];
    if (!items.length) { append(list, el("div", "overview-empty", "协作记录会显示在这里")); return; }
    items.forEach((item) => {
      const row = el("div", "activity-item"); const body = el("div");
      append(body, el("strong", "", safeText(item.actor, "成员")), document.createTextNode(` ${ACTION_LABELS[item.action] || safeText(item.action, "进行了操作")}`), el("span", "activity-time", formatTime(item.at)));
      append(row, el("span", "activity-marker"), body); append(list, row);
    });
  }

  function isMatterBoard() { return state.board && state.board.workflow === "matter"; }
  function matterNextText() {
    const matter = state.board.matter || {};
    const latest = (state.board.decisions || []).at(-1);
    if (!matter.owner) return "下一步：填写事项主卡并明确负责人";
    if (!state.board.goal?.confirmed) return "下一步：确认协作目标与完成条件";
    if (!latest) return "下一步：补齐来源证据和异议回应，记录人工决策";
    if (latest.status === "stale") return "下一步：依据或异议已变化，请重新作出决策";
    if (matter.blocker) return `当前阻塞：${matter.blocker}`;
    const tasks = (state.board.cards || []).filter((card) => card.type === "task");
    if (!tasks.length) return "下一步：把决策拆成有负责人和验收标准的任务";
    const unfinished = tasks.filter((card) => !card.acceptance?.acceptedAt || card.acceptance?.acceptedDecisionId !== latest.id);
    return unfinished.length ? `下一步：推进 ${unfinished.length} 项交付与独立验收${matter.nextOwner ? `，由 ${matter.nextOwner} 接续处理` : ""}` : "下一步：确认事项结果与后续安排";
  }
  function matterState() {
    const matter = state.board.matter || {};
    const latest = (state.board.decisions || []).at(-1);
    if (state.board.goal?.completed) return ["已完成", "completed"];
    if (latest?.status === "stale") return ["待重新决策", "awaiting_decision"];
    if (matter.blocker) return ["受阻", "blocked"];
    if (latest?.status === "confirmed") return ["执行与验收中", "decided"];
    return ["待决策", "awaiting_decision"];
  }
  function renderMatterSide() {
    const root = $("matter-side-card"); root.replaceChildren();
    if (!isMatterBoard()) return;
    const matter = state.board.matter || {};
    if (!matter.title) {
      append(root, el("div", "matter-side-empty", "还没有明确当前事项。先写下要解决的问题和谁来负责。"), button("＋ 填写事项主卡", "matter-side-cta", openWorkItem));
      return;
    }
    append(root, el("div", "matter-side-title", matter.title));
    const meta = el("div", "matter-side-meta");
    append(meta, el("span", "", `负责人：${matter.owner || "待分配"}`), el("span", "", `下一处理人：${matter.nextOwner || "待明确"}`));
    if (matter.dueAt) append(meta, el("span", "", `计划日期：${formatDate(matter.dueAt)}`));
    append(root, meta, el("div", "matter-side-next", matterNextText()), button("查看事项与待办 →", "matter-side-cta", () => showWorkspaceView("inbox")));
  }
  function formatDate(value) {
    if (!value) return "未设置";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
  function showWorkspaceView(view) {
    const valid = ["canvas", "inbox", "decisions", "timeline"].includes(view) ? view : "canvas";
    state.workspaceView = isMatterBoard() ? valid : "canvas";
    const canvas = state.workspaceView === "canvas";
    $("app").classList.toggle("workflow-mode", !canvas);
    $("canvas-viewport").hidden = !canvas;
    document.querySelector(".canvas-subbar").hidden = !canvas;
    $("workflow-viewport").hidden = canvas;
    document.querySelectorAll(".workspace-view").forEach((tab) => {
      const active = tab.dataset.view === state.workspaceView;
      tab.classList.toggle("active", active);
      if (active) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
    });
    const headings = {
      inbox: ["待我处理", "把目标、当前阻塞和下一步放在同一条事项记录中。"],
      decisions: ["决策清单", "查看人工决策、所用依据及尚未回应的异议。"],
      timeline: ["时间线", "按时间追溯事项、决策、交付与验收的操作。"]
    };
    if (!canvas) {
      const [title, subtitle] = headings[state.workspaceView];
      $("workflow-view-title").textContent = title; $("workflow-view-subtitle").textContent = subtitle;
      renderWorkflowView();
    } else window.requestAnimationFrame(() => { if (state.board?.cards?.length) fitCanvas(); });
  }
  function workSection(title, count) {
    const root = el("section", "work-card"); const head = el("div", "work-card-head");
    append(head, el("h3", "", title), count === undefined ? null : el("span", "micro-note", `${count} 项`)); append(root, head);
    return root;
  }
  function workMeta(parent, label, value) { const cell = el("div"); append(cell, el("b", "", label), el("span", "", safeText(value, "待明确"))); append(parent, cell); }
  function renderMatterHero(root) {
    const matter = state.board.matter || {}, hero = el("section", "work-card work-hero");
    const top = el("div", "work-hero-top"), [status, tone] = matterState();
    append(top, el("span", "work-kicker", "事项主卡"), el("span", `work-state ${tone}`, status));
    append(hero, top, el("h3", "", matter.title || "先定义需要解决的事项"), paragraph(state.board.goal?.text || "补充协作目标，说明这件事要达到什么结果。"));
    const meta = el("div", "work-meta");
    workMeta(meta, "事项负责人", matter.owner || "待分配"); workMeta(meta, "下一处理人", matter.nextOwner || "待明确");
    workMeta(meta, "计划日期", matter.dueAt ? formatDate(matter.dueAt) : "未设置");
    workMeta(meta, "目标状态", state.board.goal?.confirmed ? "已人工确认" : "待人工确认");
    append(hero, meta);
    if (state.board.demoScenario === "autoplay" && matter.owner?.startsWith("模拟") && state.nickname !== matter.owner) append(hero, el("div", "share-hint", "你已接管演示画布。若继续记录决策，请先把事项负责人改为你的昵称；已有决策随后需要重新确认。"));
    const next = el("div", "work-next"); append(next, el("strong", "", "当前下一步"), el("span", "", matterNextText())); append(hero, next);
    const actions = el("div", "work-actions");
    append(actions, button(matter.title ? "编辑事项主卡" : "填写事项主卡", "small-primary", openWorkItem));
    if (!state.board.goal?.confirmed) append(actions, button("确认协作目标", "secondary-button", state.board.goal?.text ? confirmGoal : openGoalModal));
    append(hero, actions); append(root, hero);
  }
  function workRow(title, description, tag, tone, actionLabel, action, metadata) {
    const row = el("div", "work-row"), main = el("div", "work-row-main"), top = el("div", "work-row-top");
    append(top, el("span", `work-label ${tone || ""}`, tag), el("strong", "", title));
    append(main, top, paragraph(description || ""));
    if (metadata) append(main, el("div", "work-row-meta", metadata));
    append(row, main, actionLabel ? button(actionLabel, "", action) : null); return row;
  }
  function renderInbox(root) {
    const matter = state.board.matter || {}, latest = (state.board.decisions || []).at(-1), cards = state.board.cards || [];
    const jobs = [];
    if (!matter.title || !matter.owner) jobs.push(workRow("明确事项及责任人", "写清要解决的问题、责任人、下一处理人和计划日期。", "待建立", "warn", "填写事项", openWorkItem));
    if (!state.board.goal?.confirmed) jobs.push(workRow("确认目标和完成条件", state.board.goal?.text || "先写下本次事项希望达成的结果。", "待确认", "warn", "查看目标", state.board.goal?.text ? confirmGoal : openGoalModal));
    if (matter.owner === state.nickname && (!latest || latest.status === "stale")) jobs.push(workRow(latest?.status === "stale" ? "重新记录决策" : "形成第一项决策", "核对来源证据，逐一回应正式异议，由事项负责人记录取舍。", "待决策", "warn", "记录决策", () => openDecisionPackage()));
    if (matter.owner === state.nickname && latest?.status === "confirmed" && !cards.some((card) => card.type === "task")) jobs.push(workRow("建立可验收任务", "把已确认决策拆为有负责人、独立复核人和验收标准的交付任务。", "待分工", "warn", "新增任务", () => { showWorkspaceView("canvas"); openCardModal("task"); }));
    if (matter.nextOwner === state.nickname && matter.owner !== state.nickname) jobs.push(workRow("接续处理当前事项", matterNextText(), "轮到我", "", "查看画布", () => showWorkspaceView("canvas")));
    cards.filter((card) => card.type === "task").forEach((card) => {
      if (card.owner === state.nickname && card.status !== "done" && card.status !== "review") jobs.push(workRow(card.text, card.acceptance?.criteria ? `验收条件：${card.acceptance.criteria}` : "尚未设置验收条件", "待交付", "", "打开任务", () => openTaskAction(card), `负责人：${card.owner} · 审核人：${card.reviewer || "待指定"}`));
      if (card.reviewer === state.nickname && card.status === "review") jobs.push(workRow(card.text, card.acceptance?.delivery || "负责人已提交，请核对交付内容。", "待验收", "warn", "验收任务", () => openTaskAction(card), `负责人：${card.owner} · 审核人：${card.reviewer}`));
    });
    const section = workSection("与我相关的下一步", jobs.length), list = el("div", "work-list");
    if (jobs.length) jobs.forEach((job) => append(list, job));
    else append(list, el("div", "work-empty", "当前没有分配给这个昵称的待办。可查看画布与决策清单，或与事项负责人核对下一处理人。"));
    append(section, list); append(root, section);
    const pair = el("div", "work-pair"), evidence = cards.filter((card) => card.type === "evidence"), objections = cards.filter((card) => card.type === "objection");
    const evidenceSection = workSection("来源证据", evidence.length), evidenceList = el("div", "work-list");
    if (!evidence.length) { const empty = el("div", "work-empty", "尚无依据卡。先在画布上记录可核验的资料来源和版本。"); append(empty, button("新增依据卡", "small-primary", () => { showWorkspaceView("canvas"); openCardModal("evidence"); })); append(evidenceList, empty); }
    evidence.slice(-5).forEach((card) => append(evidenceList, workRow(card.text, card.source ? `${card.source.title || "未命名资料"} · ${card.source.version || "版本待补"}` : "来源信息待补，不能用于正式决策", card.source ? "有来源" : "待补来源", card.source ? "ok" : "warn", "查看卡片", () => { showWorkspaceView("canvas"); focusCard(card.id); })));
    append(evidenceSection, evidenceList);
    const objectionsSection = workSection("待回应异议", objections.length), objectionsList = el("div", "work-list");
    if (!objections.length) { const empty = el("div", "work-empty", "尚无正式异议卡。"); append(empty, button("新增异议卡", "small-primary", () => { showWorkspaceView("canvas"); openCardModal("objection"); })); append(objectionsList, empty); }
    objections.slice(-5).forEach((card) => append(objectionsList, workRow(card.text, "决策记录需要对每条正式异议给出回应。", "异议", "warn", "查看卡片", () => { showWorkspaceView("canvas"); focusCard(card.id); })));
    append(objectionsSection, objectionsList); append(pair, evidenceSection, objectionsSection); append(root, pair);
  }
  function renderDecisions(root) {
    const decisions = (state.board.decisions || []).slice().reverse(), section = workSection("人工决策记录", decisions.length);
    const actions = el("div", "work-actions"); append(actions, button("＋ 记录新决策", "small-primary", () => openDecisionPackage())); append(section, actions);
    const list = el("div", "work-list");
    if (!decisions.length) append(list, el("div", "work-empty", "还没有人工决策。确认目标、补齐有来源的依据，并回应正式异议后，由事项负责人记录。"));
    decisions.forEach((decision) => {
      const refs = Array.isArray(decision.evidenceRefs) ? decision.evidenceRefs.length : 0;
      const stale = decision.status === "stale";
      const current = decision.id === state.board.matter?.currentDecisionId;
      append(list, workRow(decision.option || "未命名决策", decision.rationale || "未填写理由", !current ? "历史决策" : stale ? "待复核" : "当前有效", !current || stale ? "warn" : "ok", "查看记录", () => openDecisionPackage(decision.id), `${safeText(decision.decidedBy, "事项负责人")} · ${formatTime(decision.decidedAt)} · ${refs} 条引用依据`));
    });
    append(section, list); append(root, section);
  }
  function renderTimeline(root) {
    const items = (state.board.audit || []).slice().reverse(), section = workSection("操作时间线", items.length), timeline = el("div", "work-timeline");
    if (!items.length) append(timeline, el("div", "work-empty", "尚无操作记录。"));
    items.forEach((item) => {
      const row = el("div", "timeline-item");
      append(row, el("strong", "", `${safeText(item.actor, "成员")} ${ACTION_LABELS[item.action] || safeText(item.action, "进行了操作")}`));
      if (item.details?.title) append(row, paragraph(item.details.title));
      if (item.details?.option) append(row, paragraph(item.details.option));
      append(row, el("time", "", formatTime(item.at))); append(timeline, row);
    });
    append(section, timeline); append(root, section);
  }
  function renderReviewSummary(root) {
    const board = state.board, matter = board.matter || {}, latest = (board.decisions || []).at(-1);
    const evidence = (board.cards || []).filter((card) => card.type === "evidence" && card.source);
    const tasks = (board.cards || []).filter((card) => card.type === "task");
    const current = (board.decisions || []).find((item) => item.id === matter.currentDecisionId);
    const accepted = tasks.filter((card) => current?.status === "confirmed" && card.status === "done" && card.acceptance?.submittedDecisionId === current.id && card.acceptance?.acceptedDecisionId === current.id && !!card.acceptance?.acceptedAt);
    const section = workSection("复盘摘要 · 当前过程事实"), grid = el("div", "review-grid");
    const stats = [
      [matterState()[0], "事项状态"],
      [latest ? `${safeText(latest.decidedBy, "待确认")} · ${formatTime(latest.decidedAt)}` : "尚无", "最近决策人 / 时间"],
      [`${evidence.length} 条 · ${latest?.status === "stale" ? "决策待复核" : "无决策复核提示"}`, "有来源依据 / 复核"],
      [`${accepted.length} / ${tasks.length}`, "当前决策下有效验收的任务"]
    ];
    stats.forEach(([value, label]) => { const cell = el("div", "review-stat"); append(cell, el("b", "", value), el("span", "", label)); append(grid, cell); });
    append(section, grid, el("div", "review-foot", `当前阻塞：${matter.blocker || "未登记"}。以上是原型中的过程记录，不代表内容真实性、实际提效或正式审批。昵称仅作演示标识。`));
    append(root, section);
  }
  function renderWorkflowView() {
    const root = $("workflow-content"); root.replaceChildren();
    if (!isMatterBoard() || state.workspaceView === "canvas") return;
    renderMatterHero(root);
    if (state.workspaceView === "inbox") renderInbox(root);
    if (state.workspaceView === "decisions") renderDecisions(root);
    if (state.workspaceView === "timeline") renderTimeline(root);
    renderReviewSummary(root);
  }
  function renderWorkflowCounts() {
    if (!isMatterBoard()) return;
    const board = state.board, matter = board.matter || {}, current = (board.decisions || []).find((item) => item.id === matter.currentDecisionId);
    const tasks = board.cards || [];
    let count = (!matter.title || !matter.owner ? 1 : 0) + (!board.goal?.confirmed ? 1 : 0);
    if (matter.owner === state.nickname && (!current || current.status === "stale")) count++;
    if (matter.owner === state.nickname && current?.status === "confirmed" && !tasks.some((card) => card.type === "task")) count++;
    if (matter.nextOwner === state.nickname && matter.owner !== state.nickname) count++;
    count += tasks.filter((card) => card.type === "task" && ((card.owner === state.nickname && !["done", "review"].includes(card.status)) || (card.reviewer === state.nickname && card.status === "review"))).length;
    $("inbox-count").textContent = String(count);
    $("decision-count").textContent = String((board.decisions || []).length);
  }
  function statusLabel(status) { return STATUS_LABELS[status] || safeText(status, "待开始"); }
  function typeLabel(type) { return TYPE_LABELS[type] || safeText(type, "卡片"); }
  function cardTone(type) { return TYPE_TONES[type] || "blue"; }
  function renderCanvas() {
    const layer = $("cards-layer"); layer.replaceChildren();
    (state.board.cards || []).forEach((card) => {
      const outer = el("div", "canvas-card"); outer.dataset.id = card.id; outer.dataset.tone = cardTone(card.type);
      outer.style.left = `${Number(card.x) || 0}px`; outer.style.top = `${Number(card.y) || 0}px`;
      outer.classList.toggle("selected", card.id === state.selectedCardId);
      outer.classList.toggle("connect-source", card.id === state.connectSource);
      outer.classList.toggle("locked-other", !!lockOf(card.id) && !ownLock(card.id));
      const inner = el("div", "card-inner"), top = el("div", "card-top");
      append(top, el("span", "card-type", typeLabel(card.type)));
      if (safeText(card.text).startsWith("【模拟 Agent 建议】")) append(top, el("span", "card-agent-badge", "模拟 Agent"));
      if (lockOf(card.id)) append(top, el("span", "card-lock-icon", "▣"));
      append(top, el("span", "card-version", `v${card.version || 1}`));
      const footer = el("div", "card-footer"); const owner = el("span", "card-person");
      append(owner, document.createTextNode("负责人 "), el("strong", "", card.owner || "待分配"));
      append(footer, owner, el("span", `card-status ${card.status || "todo"}`, statusLabel(card.status)));
      append(inner, top, el("div", "card-text", card.text || "空白卡片"), footer);
      append(outer, el("div", "card-accent"), inner); append(layer, outer);
    });
    renderEdges(); updateWorldTransform();
    $("empty-canvas").hidden = !!(state.board.cards && state.board.cards.length);
  }
  function renderEdges() {
    const svg = $("edges-layer"); svg.replaceChildren();
    (state.board.edges || []).forEach((edge) => {
      const source = cardById(edge.source), target = cardById(edge.target);
      if (!source || !target) return;
      const sourceEl = layerCard(source.id), targetEl = layerCard(target.id);
      const sh = sourceEl ? sourceEl.offsetHeight : 150, th = targetEl ? targetEl.offsetHeight : 150;
      const sx = sourceEl ? parseFloat(sourceEl.style.left) : Number(source.x) || 0;
      const sy = sourceEl ? parseFloat(sourceEl.style.top) : Number(source.y) || 0;
      const tx = targetEl ? parseFloat(targetEl.style.left) : Number(target.x) || 0;
      const ty = targetEl ? parseFloat(targetEl.style.top) : Number(target.y) || 0;
      const scx = sx + 122, scy = sy + sh / 2, tcx = tx + 122, tcy = ty + th / 2;
      const horizontal = Math.abs(tcx - scx) > Math.abs(tcy - scy) * 1.15;
      let p1, p2;
      if (horizontal) { const right = tcx > scx; p1 = { x: scx + (right ? 122 : -122), y: scy }; p2 = { x: tcx + (right ? -122 : 122), y: tcy }; }
      else { const down = tcy > scy; p1 = { x: scx, y: scy + (down ? sh / 2 : -sh / 2) }; p2 = { x: tcx, y: tcy + (down ? -th / 2 : th / 2) }; }
      const bend = horizontal ? Math.min(80, Math.abs(p2.x - p1.x) / 2) : Math.min(70, Math.abs(p2.y - p1.y) / 2);
      const d = horizontal ? `M ${p1.x} ${p1.y} C ${p1.x + Math.sign(p2.x - p1.x) * bend} ${p1.y}, ${p2.x - Math.sign(p2.x - p1.x) * bend} ${p2.y}, ${p2.x} ${p2.y}` : `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + Math.sign(p2.y - p1.y) * bend}, ${p2.x} ${p2.y - Math.sign(p2.y - p1.y) * bend}, ${p2.x} ${p2.y}`;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.setAttribute("class", `edge-group ${state.selectedEdgeId === edge.id ? "selected" : ""}`);
      const visible = document.createElementNS("http://www.w3.org/2000/svg", "path"); visible.setAttribute("class", "edge-line"); visible.setAttribute("d", d);
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path"); hit.setAttribute("class", "edge-hit"); hit.setAttribute("d", d);
      g.append(visible, hit);
      if (edge.label) {
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, width = Math.max(37, Array.from(edge.label).length * 13 + 16);
        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect"); bg.setAttribute("class", "edge-label-bg"); bg.setAttribute("x", String(mx - width / 2)); bg.setAttribute("y", String(my - 12)); bg.setAttribute("width", String(width)); bg.setAttribute("height", "24"); bg.setAttribute("rx", "12");
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text"); label.setAttribute("class", "edge-label"); label.setAttribute("x", String(mx)); label.setAttribute("y", String(my)); label.textContent = edge.label;
        g.append(bg, label);
      }
      g.addEventListener("pointerdown", (event) => event.stopPropagation());
      g.addEventListener("click", (event) => { event.stopPropagation(); state.selectedEdgeId = edge.id; openEdgeModal(edge); });
      svg.appendChild(g);
    });
  }
  function layerCard(id) { return Array.from($("cards-layer").children).find((item) => item.dataset.id === id); }
  function updateWorldTransform() { $("canvas-world").style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})`; $("zoom-level").textContent = `${Math.round(state.view.scale * 100)}%`; }
  function fitCanvas() {
    if (!state.board) return;
    const viewport = $("canvas-viewport"); const width = viewport.clientWidth, height = viewport.clientHeight;
    const cards = state.board.cards || [];
    if (!cards.length) { state.view = { x: width / 2 - 122, y: height / 2 - 70, scale: 1 }; updateWorldTransform(); return; }
    const xs = cards.map((card) => Number(card.x) || 0), ys = cards.map((card) => Number(card.y) || 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + 244, minY = Math.min(...ys), maxY = Math.max(...ys) + 185;
    const availableW = Math.max(100, width - 100), availableH = Math.max(100, height - 120);
    const scale = Math.max(.55, Math.min(1, availableW / (maxX - minX), availableH / (maxY - minY)));
    state.view = { scale, x: (width - (maxX - minX) * scale) / 2 - minX * scale, y: (height - (maxY - minY) * scale) / 2 - minY * scale };
    updateWorldTransform();
  }
  function zoomAt(factor, clientX, clientY) {
    const rect = $("canvas-viewport").getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top, old = state.view.scale;
    const next = Math.max(.35, Math.min(2, old * factor));
    const wx = (px - state.view.x) / old, wy = (py - state.view.y) / old;
    state.view.scale = next; state.view.x = px - wx * next; state.view.y = py - wy * next; updateWorldTransform();
  }
  function worldCenter() {
    const rect = $("canvas-viewport").getBoundingClientRect();
    return { x: Math.round((rect.width / 2 - state.view.x) / state.view.scale - 122), y: Math.round((rect.height / 2 - state.view.y) / state.view.scale - 75) };
  }
  function switchPanel(panel) {
    state.activePanel = panel;
    document.querySelectorAll(".inspector-tab").forEach((tab) => { const active = tab.dataset.panel === panel; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); });
    ["card", "agent", "overview"].forEach((name) => { $("panel-" + name).hidden = name !== panel; $("panel-" + name).classList.toggle("active", name === panel); });
  }
  function selectCard(id) {
    if (state.editingCardId && state.editingCardId !== id) { setToast("请先保存或取消当前编辑", "error"); return; }
    state.selectedCardId = id; state.agentTargetId = id; state.selectedEdgeId = null; state.commentDraft = "";
    renderCanvas(); renderDetail(); renderAgentContext(); switchPanel("card");
  }
  function focusCard(id) {
    const card = cardById(id); if (!card) return;
    selectCard(id);
    const rect = $("canvas-viewport").getBoundingClientRect();
    state.view.x = rect.width / 2 - (Number(card.x) + 122) * state.view.scale;
    state.view.y = rect.height / 2 - (Number(card.y) + 75) * state.view.scale;
    updateWorldTransform();
  }

  function detailField(label, value) { const row = el("div", "detail-field"); append(row, el("label", "", label), el("strong", "", safeText(value, "未设置"))); return row; }
  function inputField(label, value, onInput, maxLength = 40) {
    const row = el("div", "detail-field"); const input = el("input", "text-input"); input.value = value || ""; input.maxLength = maxLength; input.addEventListener("input", () => onInput(input.value)); append(row, el("label", "", label), input); return row;
  }
  function selectField(label, value, options, onChange) {
    const row = el("div", "detail-field"); const select = el("select", "text-input");
    options.forEach(([key, text]) => { const option = el("option", "", text); option.value = key; select.appendChild(option); });
    if (![...select.options].some((option) => option.value === value)) { const custom = el("option", "", value); custom.value = value; select.appendChild(custom); }
    select.value = value; select.addEventListener("change", () => onChange(select.value)); append(row, el("label", "", label), select); return row;
  }
  function onlineMemberOptions(includeEmpty = true) {
    const names = [...new Set(state.participants.map((person) => safeText(person.nickname).trim()).filter(Boolean))];
    return [...(includeEmpty ? [["", "请选择在线成员"]] : []), ...names.map((name) => [name, name])];
  }
  function renderDetail() {
    const root = $("card-detail"), card = currentCard();
    if (!card) { root.dataset.renderCardId = ""; root.dataset.editing = "false"; root.className = "card-detail-empty"; replace(root, el("div", "detail-empty-icon", "▤"), el("h3", "", "选择一张卡片"), paragraph("查看内容、编辑锁、负责人和讨论记录。")); return; }
    const editing = state.editingCardId === card.id && ownLock(card.id); const lock = lockOf(card.id);
    if (editing && root.dataset.renderCardId === card.id && root.dataset.editing === "true") return;
    if (state.editingCardId === card.id && !ownLock(card.id)) { state.editingCardId = null; state.draft = null; setToast("编辑锁已失效，请重新申请", "error"); }
    root.dataset.renderCardId = card.id; root.dataset.editing = String(editing); root.className = ""; root.replaceChildren();
    const heading = el("div", "detail-heading"); append(heading, el("span", "detail-kicker", "卡片详情"), button("×", "detail-close", () => selectCard(null))); append(root, heading);
    const typeRow = el("div", "detail-type-row");
    append(typeRow, el("span", "card-type", typeLabel(card.type)), el("span", "detail-version", `版本 v${card.version || 1}`)); append(root, typeRow);
    if (editing) {
      const textarea = el("textarea", "detail-textarea"); textarea.value = state.draft.text; textarea.maxLength = 2000; textarea.rows = 5;
      textarea.addEventListener("input", () => { state.draft.text = textarea.value; }); append(root, textarea);
    } else append(root, el("div", "detail-content", card.text || "空白卡片"));
    const lockBox = el("div", `lock-banner ${lock ? ownLock(card.id) ? "owned" : "other" : ""}`);
    append(lockBox, el("span", "lock-icon", lock ? "▣" : "▢"), el("span", "", lock ? ownLock(card.id) ? "你正在编辑这张卡片。保存或取消后释放编辑锁。" : `${lock.nickname || "其他成员"} 正在编辑，暂时无法修改或拖动。` : "当前无人编辑。申请编辑后可修改字段；每次保存会记录新版本。"));
    append(root, lockBox);
    const actions = el("div", "lock-actions");
    if (editing) append(actions, button("取消并释放", "secondary-button", cancelEdit), button("保存修改", "small-primary", saveCard));
    else if (!lock) append(actions, button("申请编辑", "secondary-button", startEdit));
    append(root, actions);
    const section = el("section", "detail-section"), fields = el("div", "detail-fields"); append(section, el("h4", "", "责任与状态"));
    if (editing) {
      append(fields,
        selectField("卡片类型", state.draft.type, [["question", "议题"], ["idea", "观点"], ["evidence", "依据"], ["objection", "质疑"], ["conclusion", "结论"], ["task", "任务"], ["risk", "风险"], ["decision", "决策"], ["resource", "资源"]], (value) => { state.draft.type = value; }),
        inputField("负责人", state.draft.owner, (value) => { state.draft.owner = value; }),
        selectField("审核人", state.draft.reviewer, onlineMemberOptions(), (value) => { state.draft.reviewer = value; }),
        selectField("状态", state.draft.status, card.type === "task" ? isMatterBoard() ? [["todo", "待开始"], ["doing", "进行中"], ["blocked", "受阻"]] : [["todo", "待开始"], ["doing", "进行中"], ["review", "送审 / 待审核"], ["blocked", "受阻"]] : [["todo", "待开始"], ["doing", "进行中"], ["review", "待审核"], ["blocked", "受阻"], ["done", "已完成"]], (value) => { state.draft.status = value; })
      );
      if (isMatterBoard() && card.type === "evidence") {
        append(fields,
          inputField("来源名称", state.draft.source.title, (value) => { state.draft.source.title = value; }, 120),
          inputField("来源编号或位置", state.draft.source.reference, (value) => { state.draft.source.reference = value; }, 300),
          inputField("来源版本", state.draft.source.version, (value) => { state.draft.source.version = value; }, 80)
        );
      }
      if (isMatterBoard() && card.type === "task") append(fields, inputField("验收标准", state.draft.acceptanceCriteria, (value) => { state.draft.acceptanceCriteria = value; }, 500));
    } else append(fields, detailField("负责人", card.owner), detailField("审核人", card.reviewer), detailField("状态", statusLabel(card.status)));
    append(section, fields); append(root, section);
    if (!editing && isMatterBoard() && card.type === "evidence") {
      const source = card.source || {};
      append(root, paragraph(`来源：${source.title || "待补"} · ${source.reference || "位置待补"} · ${source.version || "版本待补"}`, "micro-note"));
    }
    if (!editing && isMatterBoard() && card.type === "task") {
      append(root, paragraph(`验收标准：${card.acceptance?.criteria || "待补"}`, "micro-note"));
      append(root, button(card.status === "review" ? "核对交付并验收" : card.status === "done" ? "查看验收记录" : "提交交付", "small-primary detail-task-action", () => openTaskAction(card)));
    } else if (card.type === "task") append(root, paragraph("任务流程：负责人处理 → 送审 → 指定审核人确认完成。审核人从在线成员昵称中选择；昵称仅为 Demo 流程标识，不构成权限校验。", "micro-note"));
    const related = (state.board.edges || []).filter((edge) => edge.source === card.id || edge.target === card.id);
    if (related.length) {
      const links = el("section", "detail-section"); append(links, el("h4", "", `关联关系 · ${related.length}`));
      related.forEach((edge) => { const other = cardById(edge.source === card.id ? edge.target : edge.source); if (!other) return; append(links, button(`${edge.label || "关联"} · ${safeText(other.text).slice(0, 22)}`, "related-link", () => focusCard(other.id))); });
      append(root, links);
    }
    const comments = (state.board.comments || []).filter((item) => item.cardId === card.id);
    const commentSection = el("section", "detail-section"); append(commentSection, el("h4", "", `讨论记录 · ${comments.length}`));
    if (!comments.length) append(commentSection, el("div", "overview-empty", "还没有评论。可补充证据、疑问或下一步。"));
    comments.forEach((item) => {
      const wrap = el("div", "comment-item"), top = el("div", "comment-top");
      append(top, el("span", "comment-author", item.author || "成员"), el("span", "comment-time", formatTime(item.createdAt)));
      append(wrap, top, el("div", "comment-text", item.text));
      append(wrap, item.promotedCardId ? el("span", "promoted-label", "✓ 已转为关联卡片") : button("↗ 转为关联卡片", "promote-button", () => promoteComment(item)));
      append(commentSection, wrap);
    });
    const compose = el("div", "comment-compose"); const input = el("textarea"); input.placeholder = "补充你的判断或问题…"; input.maxLength = 1000; input.value = state.commentDraft;
    input.addEventListener("input", () => { state.commentDraft = input.value; });
    append(compose, input, button("发送评论", "small-primary", async () => {
      const text = state.commentDraft.trim(); if (!text) return setToast("先写下评论内容", "error");
      try { await emit("comment:add", { boardId: state.boardId, cardId: card.id, text }); state.commentDraft = ""; renderDetail(); }
      catch (error) { showError(error); }
    })); append(commentSection, compose); append(root, commentSection);
  }
  async function startEdit() {
    const card = currentCard(); if (!card) return;
    try {
      await emit("card:lock", { boardId: state.boardId, cardId: card.id });
      state.locks[card.id] = { clientId: state.clientId, nickname: state.nickname };
      state.editingCardId = card.id;
      state.draft = { text: card.text || "", type: card.type || "idea", owner: card.owner || "", reviewer: card.reviewer || "", status: card.status || "todo", source: { title: card.source?.title || "", reference: card.source?.reference || "", version: card.source?.version || "" }, acceptanceCriteria: card.acceptance?.criteria || "", version: card.version };
      renderDetail(); renderCanvas();
    } catch (error) { showError(error, "无法获取编辑锁"); }
  }
  async function cancelEdit() {
    const cardId = state.editingCardId; state.editingCardId = null; state.draft = null;
    if (cardId) { try { await emit("card:unlock", { boardId: state.boardId, cardId }); } catch (error) { showError(error); } }
    renderDetail();
  }
  async function saveCard() {
    const card = currentCard(), draft = state.draft; if (!card || !draft) return;
    if (!draft.text.trim()) return setToast("卡片内容不能为空", "error");
    if (isMatterBoard() && card.type === "evidence" && Object.values(draft.source).some((value) => value.trim()) && !Object.values(draft.source).every((value) => value.trim())) return setToast("证据来源名称、位置和版本须同时填写", "error");
    try {
      const patch = { text: draft.text.trim(), type: draft.type, owner: draft.owner.trim(), reviewer: draft.reviewer.trim(), status: draft.status };
      if (isMatterBoard() && card.type === "task" && draft.status === card.status && ["review", "done"].includes(card.status)) delete patch.status;
      if (isMatterBoard() && card.type === "evidence") patch.source = Object.values(draft.source).every((value) => value.trim()) ? { title: draft.source.title.trim(), reference: draft.source.reference.trim(), version: draft.source.version.trim() } : null;
      if (isMatterBoard() && card.type === "task") patch.acceptanceCriteria = draft.acceptanceCriteria.trim();
      await emit("card:update", { boardId: state.boardId, cardId: card.id, version: draft.version, patch });
      state.editingCardId = null; state.draft = null;
      await emit("card:unlock", { boardId: state.boardId, cardId: card.id });
      setToast("卡片已保存", "success");
    } catch (error) { showError(error, error.code === "VERSION_CONFLICT" ? "卡片版本已变化，请重新编辑" : "保存失败"); }
    renderDetail();
  }

  function openModal(title, description) {
    closeModal();
    const overlay = el("div", "modal-backdrop"), modal = el("div", "modal"), top = el("div", "modal-top");
    append(top, el("h2", "", title), button("×", "modal-close", closeModal)); append(modal, top);
    if (description) append(modal, paragraph(description));
    overlay.appendChild(modal); overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) closeModal(); });
    $("modal-root").appendChild(overlay); state.modal = overlay;
    return modal;
  }
  function closeModal() { if (state.modal) state.modal.remove(); state.modal = null; }
  function modalField(parent, label, value, placeholder, maxLength = 2000, multiline = false) {
    const id = `modal-${Math.random().toString(36).slice(2)}`; const lab = el("label", "field-label", label); lab.htmlFor = id;
    const input = el(multiline ? "textarea" : "input", "modal-input"); input.id = id; input.value = value || ""; input.placeholder = placeholder || ""; input.maxLength = maxLength; if (multiline) input.rows = 4;
    append(parent, lab, input); return input;
  }
  function modalSelect(parent, label, options, value) {
    append(parent, el("label", "field-label", label)); const select = el("select", "modal-input modal-select");
    options.forEach(([key, text]) => { const option = el("option", "", text); option.value = key; append(select, option); }); select.value = value; append(parent, select); return select;
  }
  function modalActions(modal, actionLabel, onConfirm, danger = false) {
    const actions = el("div", "modal-actions");
    append(actions, button("取消", "secondary-button", closeModal), button(actionLabel, danger ? "danger-button" : "small-primary", onConfirm)); append(modal, actions);
  }
  function openWorkItem() {
    if (!isMatterBoard()) return;
    const matter = state.board.matter || {};
    const modal = openModal("事项主卡", "写清当前问题、由谁负责决定、下一步交给谁。昵称仅用于本原型的流程演示。");
    const title = modalField(modal, "事项标题 · 必填", matter.title, "例如：确认制度问答的依据版本字段", 80);
    const owner = modalField(modal, "事项负责人", matter.owner, "输入参与者昵称", 30);
    const nextOwner = modalField(modal, "下一处理人", matter.nextOwner, "输入参与者昵称", 30);
    const dueAt = modalField(modal, "计划日期", matter.dueAt || "", "YYYY-MM-DD", 10);
    dueAt.type = "date";
    const blocker = modalField(modal, "当前阻塞", matter.blocker, "若无阻塞可留空", 500, true);
    append(modal, el("div", "modal-work-note", "变更负责人会使当前决策进入待复核。正式身份、分工和审批须接入机构系统。"));
    modalActions(modal, "保存事项", async () => {
      if (!title.value.trim()) return setToast("请填写事项标题", "error");
      try {
        await emit("matter:update", { boardId: state.boardId, version: matter.version, patch: { title: title.value.trim(), owner: owner.value.trim(), nextOwner: nextOwner.value.trim(), dueAt: dueAt.value || null, blocker: blocker.value.trim() } });
        closeModal(); setToast("事项主卡已保存", "success");
      } catch (error) { showError(error); }
    });
    title.focus();
  }
  function openDecisionPackage(decisionId) {
    if (!isMatterBoard()) return;
    const board = state.board, decision = decisionId ? (board.decisions || []).find((item) => item.id === decisionId) : null;
    if (decisionId && !decision) return setToast("找不到这条决策记录", "error");
    if (decision) {
      const current = decision.id === board.matter?.currentDecisionId;
      const modal = openModal(current ? "当前决策记录" : "历史决策记录", "决策由事项负责人以昵称代演确认，不等同于机构正式审批。");
      const status = current ? decision.status === "stale" ? "待复核" : "当前有效" : "历史决策";
      append(modal, el("div", `work-label ${current && decision.status !== "stale" ? "ok" : "warn"}`, status));
      [["方案", decision.option], ["理由", decision.rationale], ["适用范围", decision.scope], ["风险与限制", decision.risk], ["决策人 / 时间", `${decision.decidedBy} · ${formatTime(decision.decidedAt)}`]].forEach(([label, value]) => {
        const group = el("div", "modal-decision-detail"); append(group, el("strong", "", label), paragraph(safeText(value, "未填写"))); append(modal, group);
      });
      if (decision.staleReasons?.length && current) append(modal, el("div", "modal-warning", `复核原因：${decision.staleReasons.join("；")}`));
      const sources = el("div", "modal-decision-detail"); append(sources, el("strong", "", "引用依据"));
      (decision.evidenceRefs || []).forEach((ref) => { const card = cardById(ref.cardId); const changed = !card || card.contentVersion !== ref.contentVersion || card.source?.version !== ref.sourceVersion; append(sources, paragraph(`${changed ? "原依据已变更 · " : ""}${card?.source?.title || "来源名称不可用"} · 引用来源版本 ${ref.sourceVersion || "未知"} · 引用卡片内容版本 ${ref.contentVersion}`)); });
      append(modal, sources);
      const objections = el("div", "modal-decision-detail"); append(objections, el("strong", "", "异议回应"));
      if (!decision.objectionResolutions?.length) append(objections, paragraph("记录时没有正式异议"));
      (decision.objectionResolutions || []).forEach((item) => append(objections, paragraph(`${safeText(cardById(item.cardId)?.text, "原异议已变更")}：${item.response}`)));
      append(modal, objections); const actions = el("div", "modal-actions"); append(actions, button("关闭", "secondary-button", closeModal)); append(modal, actions); return;
    }
    const modal = openModal("记录人工决策", "事项负责人引用当前版本的来源证据，回应所有正式异议，再记录方案、理由与风险。模拟 Agent 不具有决策权。");
    const owner = board.matter?.owner || "未指定";
    append(modal, el("div", "modal-warning", `当前昵称：${state.nickname} · 事项负责人：${owner}。本原型按昵称校验，不构成真实身份认证或正式审批。`));
    const option = modalField(modal, "决策方案 · 必填", "", "写清确定采用的方案", 1000, true);
    const rationale = modalField(modal, "取舍理由 · 必填", "", "为什么采用这个方案，保留哪些限制", 2000, true);
    const scope = modalField(modal, "适用范围", "", "例如：仅适用于本次试点", 500, true);
    const risk = modalField(modal, "风险与限制", "", "例如：数据源版本待核验", 500, true);
    const evidence = (board.cards || []).filter((card) => card.type === "evidence" && !card.text.startsWith("示例："));
    const sourceList = el("div", "modal-record-list");
    const checks = evidence.map((card) => {
      const row = el("label", "modal-record"), input = el("input"); input.type = "checkbox"; input.disabled = !card.source?.title || !card.source?.reference || !card.source?.version;
      append(row, input, el("span", "", `${card.text.slice(0, 90)} · ${card.source ? `${card.source.title} / ${card.source.reference} / ${card.source.version}` : "缺来源名称、位置与版本"}`)); append(sourceList, row);
      return { input, card };
    });
    append(modal, el("div", "field-label", "引用依据 · 至少选一条有来源证据"), evidence.length ? sourceList : el("div", "modal-warning", "画布暂无正式依据卡。先新增依据，并填写来源名称、位置与版本。"));
    const objections = (board.cards || []).filter((card) => card.type === "objection" && !card.text.startsWith("示例："));
    const replies = objections.map((card) => ({ card, input: modalField(modal, `回应异议：${card.text.slice(0, 45)}`, "", "说明如何处理这项异议", 1000, true) }));
    if (!objections.length) append(modal, el("div", "modal-work-note", "当前没有正式异议卡；如有分歧，应先在画布中记录。"));
    modalActions(modal, "确认并记录", async () => {
      if (!option.value.trim() || !rationale.value.trim()) return setToast("请填写决策方案和取舍理由", "error");
      const evidenceCardIds = checks.filter((item) => item.input.checked).map((item) => item.card.id);
      if (!evidenceCardIds.length) return setToast("请至少选一条有来源证据", "error");
      if (replies.some((item) => !item.input.value.trim())) return setToast("请回应所有正式异议", "error");
      try {
        await emit("decision:record", { boardId: state.boardId, boardVersion: board.version, option: option.value.trim(), rationale: rationale.value.trim(), scope: scope.value.trim(), risk: risk.value.trim(), evidenceCardIds, objectionResolutions: replies.map((item) => ({ cardId: item.card.id, response: item.input.value.trim() })) });
        closeModal(); showWorkspaceView("decisions"); setToast("人工决策已记录，相关任务按当前决策验收", "success");
      } catch (error) { showError(error); }
    });
  }
  function openTaskAction(card) {
    if (!isMatterBoard() || card?.type !== "task") return;
    const task = cardById(card.id) || card, acceptance = task.acceptance || {}, current = (state.board.decisions || []).find((item) => item.id === state.board.matter?.currentDecisionId);
    const modal = openModal("任务交付与独立验收", "负责人提交交付说明，另一位指定复核人核对验收标准后通过或退回。昵称只用于原型演示。");
    append(modal, el("div", "modal-decision-detail", task.text));
    append(modal, el("div", "modal-work-note", `负责人：${task.owner || "待分配"} · 复核人：${task.reviewer || "待指定"} · 验收标准：${acceptance.criteria || "待补充"}`));
    if (acceptance.delivery) append(modal, el("div", "modal-warning", `已提交：${acceptance.delivery}${acceptance.submittedDecisionId !== current?.id ? "（对应旧决策，须重新提交）" : ""}`));
    if (acceptance.reviewNote) append(modal, el("div", "modal-work-note", `上次复核意见：${acceptance.reviewNote}`));
    if (task.status === "done") { const effective = current?.status === "confirmed" && acceptance.submittedDecisionId === current.id && acceptance.acceptedDecisionId === current.id; append(modal, el("div", "modal-warning", `${effective ? "当前有效验收" : "历史验收，当前决策下须重新处理"} · ${acceptance.acceptedBy || "复核人"} · ${formatTime(acceptance.acceptedAt)}`)); const actions = el("div", "modal-actions"); append(actions, button("关闭", "secondary-button", closeModal)); append(modal, actions); return; }
    if (current?.status !== "confirmed") { append(modal, el("div", "modal-warning", "先由事项负责人记录当前有效决策，才能提交或验收任务。")); const actions = el("div", "modal-actions"); append(actions, button("关闭", "secondary-button", closeModal)); append(modal, actions); return; }
    const canAct = task.status === "review" ? state.nickname === task.reviewer : state.nickname === task.owner;
    if (!canAct) { append(modal, el("div", "modal-warning", `当前轮到${task.status === "review" ? `复核人 ${task.reviewer || "待指定"}` : `负责人 ${task.owner || "待分配"}`}处理。`)); const actions = el("div", "modal-actions"); append(actions, button("关闭", "secondary-button", closeModal)); append(modal, actions); return; }
    if (task.status === "review") {
      const note = modalField(modal, "验收结论 / 退回原因", "", "写明核对结果；退回时说明需补什么", 1000, true);
      const actions = el("div", "modal-actions");
      append(actions, button("取消", "secondary-button", closeModal), button("退回修改", "secondary-button", async () => {
        if (!note.value.trim()) return setToast("请填写退回原因", "error");
        try { await emit("task:reject", { boardId: state.boardId, cardId: task.id, version: task.version, reviewNote: note.value.trim() }); closeModal(); setToast("任务已退回负责人", "success"); }
        catch (error) { showError(error); }
      }), button("验收通过", "small-primary", async () => {
        if (!note.value.trim()) return setToast("请填写验收结论", "error");
        try { await emit("task:accept", { boardId: state.boardId, cardId: task.id, version: task.version, reviewNote: note.value.trim() }); closeModal(); setToast("任务已通过独立验收", "success"); }
        catch (error) { showError(error); }
      })); append(modal, actions);
      return;
    }
    const delivery = modalField(modal, "交付说明或证据 · 必填", acceptance.delivery || "", "说明交付物、版本与可核验的位置", 2000, true);
    modalActions(modal, "提交复核", async () => {
      if (!delivery.value.trim()) return setToast("请填写交付说明", "error");
      try { await emit("task:submit", { boardId: state.boardId, cardId: task.id, version: task.version, delivery: delivery.value.trim() }); closeModal(); setToast("已提交，等待独立复核", "success"); }
      catch (error) { showError(error); }
    });
  }
  function openGoalModal() {
    const goal = state.board.goal || { text: "", criteria: [], version: 0 };
    const modal = openModal("协作目标", "明确这次讨论需要回答的问题及完成条件。修改后需要重新人工确认。");
    const text = modalField(modal, "要解决的问题", goal.text, "例如：如何在受控权限下提升制度问答质量？", 500, true);
    const criteria = modalField(modal, "完成条件 · 每行一条", (goal.criteria || []).join("\n"), "例如：明确负责人\n形成可验证的验收标准", 1000, true);
    modalActions(modal, "保存目标", async () => {
      if (!text.value.trim()) return setToast("请填写协作目标", "error");
      try {
        await emit("goal:update", { boardId: state.boardId, text: text.value.trim(), criteria: criteria.value.split("\n").map((line) => line.trim()).filter(Boolean), version: goal.version });
        closeModal(); setToast("目标已更新，等待人工确认", "success");
      } catch (error) { showError(error); }
    }); text.focus();
  }
  async function confirmGoal() {
    const goal = state.board.goal;
    try { await emit("goal:confirm", { boardId: state.boardId, version: goal.version }); setToast("协作目标已确认", "success"); }
    catch (error) { showError(error); }
  }
  function openCardModal(preselectedType) {
    if (!state.board) return;
    const modal = openModal("新增卡片", "把一个观点、问题或任务放到当前画布中央。拖动卡片可以重新组织讨论结构。");
    const defaults = isMatterBoard() ? [["question", "议题"], ["evidence", "依据"], ["objection", "异议"], ["idea", "方案"], ["task", "任务"], ["risk", "风险"]] : state.board.template === "plan" ? [["task", "任务"], ["question", "问题"], ["evidence", "依据"], ["risk", "风险"], ["decision", "决策"]] : [["idea", "观点"], ["question", "议题"], ["evidence", "依据"], ["objection", "质疑"], ["conclusion", "结论"], ["task", "任务"]];
    const selected = typeof preselectedType === "string" && defaults.some(([key]) => key === preselectedType) ? preselectedType : defaults[0][0];
    const type = modalSelect(modal, "卡片类型", defaults, selected);
    const text = modalField(modal, "卡片内容", "", "写下一条清晰的观点、问题或行动…", 2000, true);
    const owner = modalField(modal, "负责人 · 选填", "", "输入参与者昵称", 30);
    let reviewer, criteria, sourceTitle, sourceReference, sourceVersion;
    if (isMatterBoard()) {
      const sourceFields = el("div", "modal-conditional"), taskFields = el("div", "modal-conditional");
      sourceTitle = modalField(sourceFields, "来源名称", "", "例如：接口字段清单", 120);
      sourceReference = modalField(sourceFields, "来源编号或位置", "", "例如：文档编号或可访问位置", 300);
      sourceVersion = modalField(sourceFields, "来源版本", "", "例如：v0.2", 80);
      append(taskFields, el("div", "modal-work-note", "任务需有独立复核人和具体验收标准，才能提交交付。"));
      reviewer = modalField(taskFields, "复核人", "", "与负责人不同的参与者昵称", 30);
      criteria = modalField(taskFields, "验收标准", "", "写清怎样判断交付合格", 500, true);
      append(modal, sourceFields, taskFields);
      function toggle() { sourceFields.hidden = type.value !== "evidence"; taskFields.hidden = type.value !== "task"; }
      type.addEventListener("change", toggle); toggle();
    }
    modalActions(modal, "放到画布", async () => {
      if (!text.value.trim()) return setToast("请填写卡片内容", "error");
      if (isMatterBoard() && type.value === "evidence" && (![sourceTitle.value, sourceReference.value, sourceVersion.value].every((value) => value.trim()))) return setToast("依据卡须填写来源名称、位置和版本", "error");
      if (isMatterBoard() && type.value === "task" && (!owner.value.trim() || !reviewer.value.trim() || !criteria.value.trim() || owner.value.trim() === reviewer.value.trim())) return setToast("任务须填写不同的负责人和复核人，以及验收标准", "error");
      const point = worldCenter();
      try {
        const payload = { boardId: state.boardId, type: type.value, text: text.value.trim(), owner: owner.value.trim(), status: "todo", x: point.x, y: point.y };
        if (isMatterBoard() && type.value === "evidence") payload.source = { title: sourceTitle.value.trim(), reference: sourceReference.value.trim(), version: sourceVersion.value.trim() };
        if (isMatterBoard() && type.value === "task") { payload.reviewer = reviewer.value.trim(); payload.acceptanceCriteria = criteria.value.trim(); }
        const result = await emit("card:create", payload);
        closeModal(); if (result.card) selectCard(result.card.id); setToast("卡片已加入画布", "success");
      } catch (error) { showError(error); }
    }); text.focus();
  }
  function toggleConnect() {
    state.connectSource = null;
    const on = !$("canvas-viewport").classList.contains("connecting");
    $("canvas-viewport").classList.toggle("connecting", on); $("connect-top").classList.toggle("active", on); $("connection-hint").hidden = !on;
    $("connection-hint").textContent = "先选起点卡片，再选终点卡片";
    renderCanvas();
    if (on) setToast("依次点击两张卡片建立关系");
  }
  function connectClick(cardId) {
    if (!state.connectSource) { state.connectSource = cardId; $("connection-hint").textContent = "现在选择终点卡片"; renderCanvas(); return; }
    if (state.connectSource === cardId) { setToast("请选择另一张卡片", "error"); return; }
    const source = state.connectSource, target = cardId;
    state.connectSource = null; $("canvas-viewport").classList.remove("connecting"); $("connect-top").classList.remove("active"); $("connection-hint").hidden = true; renderCanvas();
    const modal = openModal("建立卡片关系", "给这条连线一个明确语义，让其他参与者理解两张卡片的关系。");
    const options = state.board.template === "plan" ? [["依赖", "依赖"], ["关联", "关联"], ["支持", "支持"]] : [["支持", "支持"], ["反驳", "反驳"], ["关联", "关联"]];
    const label = modalSelect(modal, "关系", options, options[0][0]);
    modalActions(modal, "创建连线", async () => {
      try { await emit("edge:create", { boardId: state.boardId, source, target, label: label.value }); closeModal(); setToast("关系已建立", "success"); }
      catch (error) { showError(error); }
    });
  }
  function openEdgeModal(edge) {
    const source = cardById(edge.source), target = cardById(edge.target);
    const modal = openModal("卡片关系", `${safeText(source && source.text).slice(0, 60)}  →  ${safeText(target && target.text).slice(0, 60)}`);
    append(modal, el("div", "edge-modal-label", edge.label || "关联"));
    modalActions(modal, "删除连线", async () => {
      try { await emit("edge:delete", { boardId: state.boardId, edgeId: edge.id }); state.selectedEdgeId = null; closeModal(); setToast("连线已删除", "success"); }
      catch (error) { showError(error); }
    }, true);
  }
  function promoteComment(comment) {
    const card = cardById(comment.cardId), modal = openModal("评论转关联卡", "保留原评论，同时在画布上创建一张可继续讨论的卡片，并自动连接来源。");
    const text = modalField(modal, "卡片内容", comment.text, "整理成一条完整观点", 2000, true);
    modalActions(modal, "转为卡片", async () => {
      if (!text.value.trim()) return setToast("请填写卡片内容", "error");
      try {
        const result = await emit("comment:promote", { boardId: state.boardId, commentId: comment.id, text: text.value.trim(), x: (Number(card.x) || 0) + 310, y: (Number(card.y) || 0) + 35 });
        closeModal(); if (result.card) selectCard(result.card.id); setToast("已转为关联卡片", "success");
      } catch (error) { showError(error); }
    });
  }

  function renderAgentTargets() {
    const select = $("agent-target"); select.replaceChildren();
    (state.board.cards || []).forEach((card) => { const option = el("option", "", `${typeLabel(card.type)} · ${safeText(card.text).slice(0, 22)}`); option.value = card.id; append(select, option); });
    if (cardById(state.agentTargetId)) select.value = state.agentTargetId;
    else if (state.selectedCardId && cardById(state.selectedCardId)) { select.value = state.selectedCardId; state.agentTargetId = state.selectedCardId; }
    else if (select.options.length) { select.selectedIndex = 0; state.agentTargetId = select.value; }
    $("agent-target-wrap").hidden = state.agentMode !== "revise";
  }
  function renderAgentContext() {
    const box = $("agent-context");
    const card = currentCard();
    box.hidden = state.agentMode !== "create" || !card;
    if (card) box.textContent = `新卡片将参考已选卡片：${safeText(card.text).slice(0, 55)}`;
    else box.textContent = "";
  }
  async function generatePreview() {
    const instruction = $("agent-prompt").value.trim(); if (!instruction) return setToast("先写下希望 Agent 完成的事", "error");
    const cardId = state.agentTargetId || $("agent-target").value;
    if (state.agentMode === "revise" && !cardId) return setToast("先选择目标卡片", "error");
    const submit = $("agent-preview-button"); submit.disabled = true; state.previewError = "";
    try {
      const result = await emit("agent:preview", { boardId: state.boardId, mode: state.agentMode, cardId: state.agentMode === "revise" ? cardId : state.selectedCardId || undefined, instruction });
      state.preview = result.preview; renderAgentPreview(); setToast("模拟预览已生成，仅你可见", "success");
    } catch (error) { state.previewError = errorMessage(error); renderAgentPreview(); }
    finally { submit.disabled = false; }
  }
  function renderAgentPreview() {
    const box = $("agent-preview"); box.replaceChildren();
    const preview = state.preview; if (!preview && !state.previewError) { box.hidden = true; return; } box.hidden = false;
    if (state.previewError) append(box, el("div", "agent-error", state.previewError));
    if (!preview) return;
    const head = el("div", "preview-head"); append(head, el("strong", "", preview.mode === "revise" ? "改写预览" : "新增卡片预览"), el("span", "sim-badge", "模拟结果")); append(box, head);
    append(box, el("div", "preview-note", `服务端处理 · 不向其他成员广播 · 生成于 ${formatTime(preview.createdAt)} · 未发布`));
    const diff = el("div", "preview-diff");
    if (preview.mode === "revise") {
      const target = cardById(preview.cardId);
      append(diff, el("div", "diff-label", `原卡片 · v${preview.sourceVersion || "?"}`), el("div", "diff-old", preview.sourceText || "原卡片快照不可用"));
    }
    append(diff, el("div", "diff-label", preview.mode === "revise" ? "建议改写" : "建议新增"), el("div", "diff-new", preview.text)); append(box, diff);
    const target = preview.mode === "revise" ? cardById(preview.cardId) : null;
    const source = preview.cardId ? cardById(preview.cardId) : null;
    const stale = !!preview.cardId && (!source || source.version !== preview.sourceVersion);
    if (stale) append(box, el("div", "agent-error", "参考卡片版本已变化，这份预览不能再发布。请重新生成。"));
    const actions = el("div", "preview-actions");
    append(actions, button("放弃预览", "secondary-button", () => { state.preview = null; state.previewError = ""; renderAgentPreview(); }), button("发布到画布", "small-primary", publishPreview));
    actions.lastChild.disabled = !!stale; append(box, actions);
    append(box, paragraph("发布后内容会出现在共享画布，并在活动中留痕。", "micro-note"));
  }
  async function publishPreview() {
    const preview = state.preview; if (!preview) return;
    const target = preview.cardId ? cardById(preview.cardId) : null;
    if (preview.cardId && (!target || target.version !== preview.sourceVersion)) { state.previewError = "参考卡片已更新，请重新生成预览。"; renderAgentPreview(); return; }
    let acquired = false;
    try {
      if (preview.mode === "revise" && !ownLock(preview.cardId)) { await emit("card:lock", { boardId: state.boardId, cardId: preview.cardId }); acquired = true; }
      const point = worldCenter();
      const result = await emit("agent:publish", { boardId: state.boardId, previewId: preview.id, x: point.x, y: point.y });
      state.preview = null; state.previewError = ""; renderAgentPreview();
      if (result.card) selectCard(result.card.id);
      setToast("建议已发布到共享画布", "success");
    } catch (error) {
      state.previewError = error.code === "VERSION_CONFLICT" ? "原卡片版本已变化，请重新生成预览。" : errorMessage(error);
      renderAgentPreview(); setToast(state.previewError, "error");
    } finally { if (acquired) { try { await emit("card:unlock", { boardId: state.boardId, cardId: preview.cardId }); } catch (_) { /* Timeout releases the lock. */ } } }
  }
  function renderOverview() {
    const root = $("overview-content"); root.replaceChildren();
    const board = state.board, agent = board.boardAgent || {}, progress = agent.progress || { done: 0, total: 0, percent: 0 };
    const goal = board.goal || {};
    const demoNote = el("div", "privacy-note"); append(demoNote, el("span", "", "◇"), el("span", "", "规则演示 / 模拟进度判断：只检查已公开卡片的类型和状态，不核验内容真实性。")); append(root, demoNote);
    const goalCard = el("div", "overview-card"); append(goalCard, el("h3", "", "协作目标"), el("div", "overview-goal", goal.text || "尚未设置目标"));
    if (Array.isArray(goal.criteria) && goal.criteria.length) { const ul = el("ul", "overview-criteria"); goal.criteria.forEach((item) => append(ul, el("li", "", item))); append(goalCard, ul); }
    append(goalCard, el("span", "goal-meta", goal.completed ? "已完成 · 人工确认" : goal.confirmed ? "已确认 · 可作为进度依据" : "待人工确认")); append(root, goalCard);
    const progressCard = el("div", "overview-card"); append(progressCard, el("h3", "", board.template === "debate" ? "讨论结构覆盖" : "任务进度"));
    const row = el("div", "progress-row"); append(row, el("strong", "", `${Math.round(Number(progress.percent) || 0)}%`), el("span", "", `${Number(progress.done) || 0} / ${Number(progress.total) || 0} ${board.template === "debate" ? "类已覆盖" : "项完成"}`));
    const track = el("div", "progress-track"), fill = el("div", "progress-fill"); fill.style.width = `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%`; append(track, fill);
    append(progressCard, row, track, paragraph(board.template === "debate" ? "只统计正式卡片的议题、观点、依据、质疑和结论；不代表内容已核实。" : "按已公开的任务卡状态计算，不代表任务质量已核实。", "micro-note")); append(root, progressCard);
    overviewList(root, "依据", agent.evidence, "evidence"); overviewList(root, "卡点", agent.blockers, "blocker");
    const steps = el("div", "overview-card"); append(steps, el("h3", "", `下一步 · ${(agent.nextSteps || []).length}`));
    if (!agent.nextSteps || !agent.nextSteps.length) append(steps, el("div", "overview-empty", "暂无待推进事项。"));
    (agent.nextSteps || []).forEach((item, index) => {
      const row = el("div", "next-step"); append(row, el("span", "next-step-number", String(index + 1)));
      const content = el("div", "next-step-content"); append(content, el("span", "", item.text));
      if (item.sourceCardId) append(content, button("查看来源", "source-link", () => focusCard(item.sourceCardId)));
      append(row, content); append(steps, row);
    }); append(root, steps);
    const suggestions = el("div", "overview-card"); append(suggestions, el("h3", "", `待确认建议 · ${(agent.suggestions || []).length}`));
    if (!agent.suggestions || !agent.suggestions.length) append(suggestions, el("div", "overview-empty", "当前没有待确认建议。"));
    (agent.suggestions || []).forEach((item) => {
      const wrap = el("div", "suggestion"); append(wrap, el("div", "suggestion-kind", item.kind === "review" ? "待审核确认" : item.kind === "assign" ? item.field === "reviewer" ? "建议指定审核人" : "建议指派" : "建议补任务"), paragraph(item.text));
      const actions = el("div", "suggestion-actions");
      if (item.sourceCardId) append(actions, button("查看来源", "source-link", () => focusCard(item.sourceCardId)));
      else append(actions, el("span"));
      append(actions, button(item.kind === "review" ? "审核确认 →" : "人工确认 →", "small-primary", () => confirmSuggestion(item))); append(wrap, actions); append(suggestions, wrap);
    }); append(root, suggestions);
    append(root, button("↻ 重新整理公开画布", "secondary-button overview-refresh", refreshBoardAgent), el("div", "overview-timestamp", agent.updatedAt ? `更新于 ${formatTime(agent.updatedAt)} · 规则演示` : "规则演示 · 仅依据公开画布"));
  }
  function overviewList(root, heading, items, kind) {
    const card = el("div", "overview-card"); append(card, el("h3", "", `${heading} · ${(items || []).length}`));
    const list = el("div", "overview-list");
    if (!items || !items.length) append(list, el("div", "overview-empty", kind === "blocker" ? "当前没有识别到卡点。" : "公开画布中暂无可引用依据。"));
    (items || []).forEach((item) => {
      const row = el("div", `overview-item ${kind === "blocker" ? "blocker" : ""}`);
      append(row, document.createTextNode(item.text));
      if (item.sourceCardId) append(row, button("查看来源", "source-link", () => focusCard(item.sourceCardId)));
      append(list, row);
    }); append(card, list); append(root, card);
  }
  async function refreshBoardAgent() {
    try { const result = await emit("boardAgent:refresh", { boardId: state.boardId }); if (result.boardAgent) { state.board.boardAgent = result.boardAgent; renderOverview(); } setToast("公开画布进展已整理", "success"); }
    catch (error) { showError(error); }
  }
  function confirmSuggestion(item) {
    if (item.kind === "review") {
      const card = cardById(item.sourceCardId);
      const modal = openModal("审核确认任务", "只有卡片所填审核人可确认。首版以当前昵称演示审核流程，正式环境需要接入真实身份与权限。");
      append(modal, el("div", "modal-warning", `当前昵称：${state.nickname} · 卡片审核人：${safeText(card && card.reviewer, "未指定")}`));
      modalActions(modal, "审核通过", async () => {
        try { await emit("suggestion:confirm", { boardId: state.boardId, suggestionId: item.id }); closeModal(); setToast("任务已由审核人确认完成", "success"); }
        catch (error) { showError(error); }
      });
      return;
    }
    const reviewerSuggestion = item.kind === "assign" && item.field === "reviewer";
    const modal = openModal(item.kind === "assign" ? reviewerSuggestion ? "确认审核人建议" : "确认负责人建议" : "确认补充任务", "此操作由你确认后才写入共享画布，并记录到协作动态。");
    const text = modalField(modal, item.kind === "assign" ? "建议说明" : "任务内容", item.text, "", 1000, item.kind !== "assign");
    const owner = reviewerSuggestion
      ? modalSelect(modal, "审核人 · 从在线成员中选择", onlineMemberOptions(), "")
      : modalField(modal, "负责人" + (item.kind === "assign" ? " · 必填" : " · 选填"), "", "输入成员昵称或姓名", 40);
    if (reviewerSuggestion) append(modal, el("div", "modal-warning", "昵称仅为 Demo 流程标识，不构成正式身份与权限校验。请选与负责人不同的在线成员。"));
    modalActions(modal, "确认并执行", async () => {
      if (item.kind === "assign" && !owner.value.trim()) return setToast(reviewerSuggestion ? "请填写审核人" : "请填写负责人", "error");
      try {
        const point = worldCenter();
        const result = await emit("suggestion:confirm", { boardId: state.boardId, suggestionId: item.id, ...(reviewerSuggestion ? { reviewer: owner.value.trim() } : { owner: owner.value.trim() }), text: text.value.trim(), x: point.x, y: point.y });
        closeModal(); if (result.card) selectCard(result.card.id); setToast("建议已由你确认", "success");
      } catch (error) { showError(error); }
    });
  }
  function openCompleteModal() {
    const tasks = (state.board.cards || []).filter((card) => card.type === "task");
    const remaining = tasks.filter((card) => card.status !== "done").length;
    const hasConclusion = (state.board.cards || []).some((card) => ["conclusion", "decision", "结论"].includes(card.type) && !safeText(card.text).startsWith("示例："));
    const modal = openModal("确认完成协作", "完成状态需要由人确认，模拟 Agent 不会自动宣布完成。");
    const missingReviewer = tasks.filter((card) => !card.reviewer || (card.owner && card.owner === card.reviewer)).length;
    const current = (state.board.decisions || []).find((item) => item.id === state.board.matter?.currentDecisionId);
    const validAcceptance = tasks.filter((card) => current?.status === "confirmed" && card.status === "done" && card.acceptance?.submittedDecisionId === current.id && card.acceptance?.acceptedDecisionId === current.id && card.acceptance?.acceptedAt).length;
    const checklist = isMatterBoard()
      ? `目标${state.board.goal.confirmed ? "已确认" : "尚未确认"}；${current?.status === "confirmed" ? "已有当前有效决策（含证据引用与异议回应）" : current ? "当前决策待复核，须核对证据与异议后重新决策" : "尚无有效人工决策"}；${tasks.length ? `${validAcceptance} / ${tasks.length} 项任务基于当前决策通过独立验收` : "尚无任务卡"}；${state.nickname === state.board.matter?.owner ? "当前为事项负责人" : "只有事项负责人可确认完成"}。`
      : state.board.template === "debate" ? `目标${state.board.goal.confirmed ? "已确认" : "尚未确认"}；${hasConclusion ? "已有正式结论卡" : "还缺正式结论卡"}；${remaining ? `还有 ${remaining} 张任务卡未完成` : "任务卡无未完成项"}。` : `目标${state.board.goal.confirmed ? "已确认" : "尚未确认"}；${tasks.length ? `${tasks.length} 张任务卡` : "尚无任务卡"}；${missingReviewer ? `${missingReviewer} 张任务卡缺独立审核人` : "审核人已指定"}；${remaining ? `还有 ${remaining} 张任务卡未审核完成` : "所有任务卡已审核完成"}。`;
    append(modal, el("div", "modal-warning", `当前检查：${checklist}`));
    modalActions(modal, "确认完成", async () => {
      try { await emit("board:complete", { boardId: state.boardId }); closeModal(); setToast("协作已标记完成", "success"); }
      catch (error) { showError(error); }
    });
  }

  async function shareBoard() {
    if (!state.boardId) return;
    const currentUrl = new URL(window.location.href); currentUrl.searchParams.set("board", state.boardId);
    const local = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
    const candidates = [];
    if (!local) candidates.push(currentUrl.toString());
    try {
      const response = await fetch("/api/network-info");
      if (response.ok) {
        const info = await response.json();
        for (const base of info.lanUrls || []) {
          const candidate = new URL(base); candidate.searchParams.set("board", state.boardId);
          if (!candidates.includes(candidate.toString())) candidates.push(candidate.toString());
        }
      }
    } catch (_) { /* Use current address. */ }
    if (!candidates.length) candidates.push(currentUrl.toString());
    const needsHostChange = candidates.every((item) => ["localhost", "127.0.0.1", "0.0.0.0"].includes(new URL(item).hostname));
    const modal = openModal("邀请成员加入", "将链接发给同一局域网内的协作者，对方输入昵称后即可加入。");
    if (candidates.length > 1) {
      const choices = candidates.map((item) => [item, new URL(item).host]);
      const select = modalSelect(modal, "选择局域网地址", choices, candidates[0]);
      append(modal, el("div", "share-hint", "可能包含 VPN 或虚拟网卡地址。请选与你的协作者处于同一局域网、且对方可访问的地址。"));
      select.addEventListener("change", () => { link.value = select.value; });
    }
    const link = modalField(modal, "画布链接", candidates[0], "", 2000);
    link.readOnly = true; link.addEventListener("focus", () => link.select());
    if (needsHostChange) append(modal, el("div", "modal-warning", "当前使用本机地址打开。发送给其他设备前，请把链接里的 localhost / 127.0.0.1 换成服务端启动时显示的局域网 IP。"));
    modalActions(modal, "复制链接", async () => {
      try { await navigator.clipboard.writeText(link.value); closeModal(); setToast(needsHostChange ? "链接已复制，请替换为局域网 IP 后分享" : "局域网分享链接已复制", "success"); }
      catch (_) { link.select(); document.execCommand("copy"); closeModal(); setToast("分享链接已复制", "success"); }
    });
  }

  // The guided story operates on a dedicated board and uses the same socket
  // commands as manual collaboration. Every actor and approval is scripted.
  let demoRun = null;
  function demoCancelled() { return new Error("演示已中止"); }
  function ensureDemo(run) { if (demoRun !== run || run.cancelled) throw demoCancelled(); }
  function demoStep(run, index, title, detail, actor) {
    ensureDemo(run);
    $("demo-counter").textContent = `${index + 1} / ${demoSteps.length}`;
    $("demo-progress").firstElementChild.style.width = `${Math.round((index + 1) / demoSteps.length * 100)}%`;
    $("demo-actor").textContent = actor;
    $("demo-step-title").textContent = title;
    $("demo-step-detail").textContent = detail;
  }
  async function demoDelay(run, milliseconds = 2200) {
    let remaining = milliseconds;
    while (remaining > 0) {
      ensureDemo(run);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if (!run.paused) remaining -= 80;
    }
  }
  function emitFrom(socket, name, payload) {
    return new Promise((resolve, reject) => {
      socket.timeout(10000).emit(name, payload, (timeout, result) => {
        if (timeout) return reject(new Error("模拟成员连接超时"));
        if (!result || result.ok === false) {
          const error = new Error(safeText(result && result.error, "演示步骤失败"));
          error.code = result && result.code;
          return reject(error);
        }
        resolve(result);
      });
    });
  }
  function demoPeer(run, name, payload) {
    ensureDemo(run);
    return emitFrom(run.peer, name, { boardId: run.boardId, ...payload });
  }
  function demoHost(run, name, payload) {
    ensureDemo(run);
    return emit(name, { boardId: run.boardId, ...payload });
  }
  function showDemoAgent(mode, cardId, instruction) {
    state.agentMode = mode;
    state.agentTargetId = cardId;
    state.selectedCardId = cardId;
    state.previewError = "";
    renderCanvas(); renderDetail();
    document.querySelectorAll(".segment").forEach((item) => item.classList.toggle("active", item.dataset.agentMode === (mode === "revise" ? "rewrite" : "add")));
    $("agent-prompt").value = instruction;
    renderAgentTargets(); renderAgentContext(); renderAgentPreview(); switchPanel("agent");
  }
  async function waitForDemoCard(run, cardId, version) {
    for (let tries = 0; tries < 50; tries++) {
      ensureDemo(run);
      if (cardById(cardId)?.version === version) return;
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    }
    throw new Error("协作画布同步超时");
  }
  let demoSteps = [];
  async function createDemoBoard() {
    const request = window.demoWorkflow?.boardRequest;
    if (!request) throw new Error("事项演示脚本未加载，请刷新页面");
    const response = await fetch("/api/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.boardId) throw new Error(safeText(body.error, "无法创建演示画布"));
    return body.boardId;
  }
  async function connectDemoPeer(run) {
    const peer = window.io({ reconnection: false });
    run.peer = peer;
    if (!peer.connected) await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { cleanup(); reject(new Error("模拟成员连接超时")); }, 9000);
      const onConnect = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("模拟成员无法连接服务")); };
      function cleanup() { window.clearTimeout(timer); peer.off("connect", onConnect); peer.off("connect_error", onError); }
      peer.on("connect", onConnect); peer.on("connect_error", onError);
    });
    ensureDemo(run);
    await emitFrom(peer, "board:join", { boardId: run.boardId, nickname: window.demoWorkflow.peerNickname });
  }
  function cancelDemo() {
    if (!demoRun) return;
    demoRun.cancelled = true;
    demoRun.peer?.disconnect();
    demoRun = null;
  }
  async function startDemo() {
    cancelDemo();
    const run = { cancelled: false, paused: false, finished: false, peer: null, boardId: null };
    demoRun = run;
    $("demo-player").hidden = false;
    $("app").classList.add("demo-playing");
    $("demo-pause").disabled = false;
    $("demo-pause").textContent = "暂停";
    $("demo-counter").textContent = "准备中";
    $("demo-progress").firstElementChild.style.width = "0%";
    $("demo-actor").textContent = "脚本模拟 · 独立演示画布";
    $("demo-step-title").textContent = "准备演示画布";
    $("demo-step-detail").textContent = "正在连接两位模拟参与者。";
    $("demo-start").disabled = true;
    try {
      if (!window.demoWorkflow?.createSteps) throw new Error("事项演示脚本未加载，请刷新页面");
      demoSteps = window.demoWorkflow.createSteps({ demoHost, demoPeer, waitForDemoCard, fitCanvas, focusCard, switchPanel, showDemoAgent, renderAgentPreview, showWorkspaceView, state });
      run.boardId = await createDemoBoard(); ensureDemo(run);
      await joinBoard(run.boardId, window.demoWorkflow.hostNickname, false); ensureDemo(run);
      await connectDemoPeer(run); ensureDemo(run);
      await demoDelay(run, 700);
      for (let index = 0; index < demoSteps.length; index++) {
        while (run.paused) await demoDelay(run, 80);
        const step = demoSteps[index]; demoStep(run, index, step.title, step.detail, step.actor);
        await step.run(run); ensureDemo(run);
        await demoDelay(run, index === 5 || index === 8 || index === 10 ? 3100 : 2100);
      }
      run.finished = true;
      run.peer?.disconnect(); run.peer = null;
      $("demo-pause").disabled = true;
      $("demo-counter").textContent = `${demoSteps.length} / ${demoSteps.length} · 已完成`;
      $("demo-actor").textContent = "自动演示结束";
      $("demo-step-title").textContent = "现在可以手动接管";
      $("demo-step-detail").textContent = "脚本模拟成员已退出。点击“手动接管”继续编辑，或点击“重播”创建新的独立演示画布。";
    } catch (error) {
      if (demoRun !== run || run.cancelled) return;
      run.peer?.disconnect(); run.peer = null; run.finished = true;
      $("demo-pause").disabled = true;
      $("demo-actor").textContent = "自动演示已停止";
      $("demo-step-title").textContent = "演示步骤未完成";
      $("demo-step-detail").textContent = `${errorMessage(error)}。可重播新画布，或手动接管当前进度。`;
      setToast(errorMessage(error), "error");
    } finally { $("demo-start").disabled = false; }
  }
  function toggleDemoPause() {
    if (!demoRun || demoRun.finished) return;
    demoRun.paused = !demoRun.paused;
    $("demo-pause").textContent = demoRun.paused ? "继续" : "暂停";
    $("demo-counter").textContent = demoRun.paused ? "已暂停" : $("demo-counter").textContent;
  }
  async function takeOverDemo() {
    if (!demoRun) return;
    cancelDemo();
    $("demo-player").hidden = true;
    $("app").classList.remove("demo-playing");
    if (!state.joined || !state.boardId) return;
    let nickname = "体验者";
    try { nickname = window.localStorage.getItem("canvasNickname") || nickname; } catch (_) { /* No storage. */ }
    if (nickname.startsWith("模拟")) nickname = "体验者";
    try {
      const result = await emit("board:join", { boardId: state.boardId, nickname });
      state.nickname = nickname; state.clientId = result.clientId; applyBoardState(result);
      setToast("已接管演示画布；若继续决策，请先把事项负责人改为你的昵称", "success");
    } catch (error) { showError(error, "接管画布失败"); }
  }

  function onCanvasPointerDown(event) {
    if (event.button !== 0 || state.modal) return;
    const cardEl = event.target.closest(".canvas-card");
    if (cardEl) {
      event.preventDefault();
      const id = cardEl.dataset.id;
      if ($("canvas-viewport").classList.contains("connecting")) { connectClick(id); return; }
      state.pointer = { type: "card", id, startClientX: event.clientX, startClientY: event.clientY, clientX: event.clientX, clientY: event.clientY, cardX: Number(cardById(id).x) || 0, cardY: Number(cardById(id).y) || 0, dragging: false, locking: false, acquired: false, ended: false };
    } else {
      state.pointer = { type: "pan", startClientX: event.clientX, startClientY: event.clientY, viewX: state.view.x, viewY: state.view.y, moved: false };
      $("canvas-viewport").classList.add("panning");
    }
  }
  async function acquireDragLock(pointer) {
    if (pointer.locking || pointer.dragging) return;
    pointer.locking = true;
    try {
      if (!ownLock(pointer.id)) { await emit("card:lock", { boardId: state.boardId, cardId: pointer.id }); pointer.acquired = true; }
      if (pointer.ended || state.pointer !== pointer) { if (pointer.acquired) await emit("card:unlock", { boardId: state.boardId, cardId: pointer.id }); return; }
      pointer.dragging = true; moveDragVisual(pointer);
    } catch (error) { showError(error, "卡片被其他人占用，暂时无法移动"); pointer.ended = true; state.pointer = null; }
  }
  function moveDragVisual(pointer) {
    const dx = (pointer.clientX - pointer.startClientX) / state.view.scale, dy = (pointer.clientY - pointer.startClientY) / state.view.scale;
    const cardEl = layerCard(pointer.id); if (cardEl) { cardEl.style.left = `${Math.round(pointer.cardX + dx)}px`; cardEl.style.top = `${Math.round(pointer.cardY + dy)}px`; renderEdges(); }
  }
  function onCanvasPointerMove(event) {
    const pointer = state.pointer; if (!pointer) return;
    if (pointer.type === "pan") {
      const dx = event.clientX - pointer.startClientX, dy = event.clientY - pointer.startClientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true;
      state.view.x = pointer.viewX + dx; state.view.y = pointer.viewY + dy; updateWorldTransform();
      return;
    }
    pointer.clientX = event.clientX; pointer.clientY = event.clientY;
    const distance = Math.hypot(event.clientX - pointer.startClientX, event.clientY - pointer.startClientY);
    if (distance > 5 && !pointer.locking && !pointer.dragging) acquireDragLock(pointer);
    if (pointer.dragging) moveDragVisual(pointer);
  }
  async function onCanvasPointerUp() {
    const pointer = state.pointer; if (!pointer) return; state.pointer = null;
    $("canvas-viewport").classList.remove("panning");
    if (pointer.type === "pan") return;
    pointer.ended = true;
    if (!pointer.dragging) { if (!pointer.locking) selectCard(pointer.id); return; }
    const card = cardById(pointer.id); if (!card) return;
    const x = Math.round(pointer.cardX + (pointer.clientX - pointer.startClientX) / state.view.scale);
    const y = Math.round(pointer.cardY + (pointer.clientY - pointer.startClientY) / state.view.scale);
    try { await emit("card:move", { boardId: state.boardId, cardId: pointer.id, x, y, version: card.version }); }
    catch (error) { showError(error, "移动卡片失败"); renderCanvas(); }
    finally { if (pointer.acquired) { try { await emit("card:unlock", { boardId: state.boardId, cardId: pointer.id }); } catch (_) { /* Lock expires. */ } } }
    selectCard(pointer.id);
  }
  function bindEvents() {
    document.querySelectorAll(".entry-tab").forEach((tab) => tab.addEventListener("click", () => {
      state.entryMode = tab.dataset.entry;
      document.querySelectorAll(".entry-tab").forEach((item) => { const active = item === tab; item.classList.toggle("active", active); item.setAttribute("aria-selected", String(active)); });
      $("create-fields").hidden = state.entryMode !== "create"; $("join-fields").hidden = state.entryMode !== "join";
      $("entry-submit").firstChild.textContent = state.entryMode === "create" ? "创建并进入 " : "加入画布 "; setEntryError("");
    }));
    document.querySelectorAll(".template-option").forEach((item) => item.addEventListener("click", () => { state.template = item.dataset.template; document.querySelectorAll(".template-option").forEach((option) => option.classList.toggle("selected", option === item)); }));
    $("entry-submit").addEventListener("click", submitEntry);
    $("demo-start").addEventListener("click", startDemo);
    $("demo-pause").addEventListener("click", toggleDemoPause);
    $("demo-replay").addEventListener("click", startDemo);
    $("demo-takeover").addEventListener("click", takeOverDemo);
    ["new-title", "join-link", "nickname"].forEach((id) => $(id).addEventListener("keydown", (event) => { if (event.key === "Enter") submitEntry(); }));
    $("goal-edit-open").addEventListener("click", openGoalModal); $("goal-confirm").addEventListener("click", confirmGoal);
    ["add-card-side", "add-card-top", "empty-add-card"].forEach((id) => $(id).addEventListener("click", () => openCardModal()));
    document.querySelectorAll(".workspace-view").forEach((tab) => tab.addEventListener("click", () => showWorkspaceView(tab.dataset.view)));
    $("matter-side-edit").addEventListener("click", openWorkItem);
    $("workflow-edit-matter").addEventListener("click", openWorkItem);
    ["connect-side", "connect-top"].forEach((id) => $(id).addEventListener("click", toggleConnect));
    $("agent-side").addEventListener("click", () => switchPanel("agent"));
    ["sidebar-share", "share-button"].forEach((id) => $(id).addEventListener("click", shareBoard));
    $("complete-button").addEventListener("click", openCompleteModal);
    document.querySelectorAll(".inspector-tab").forEach((tab) => tab.addEventListener("click", () => switchPanel(tab.dataset.panel)));
    document.querySelectorAll(".segment").forEach((segment) => segment.addEventListener("click", () => { state.agentMode = segment.dataset.agentMode === "rewrite" ? "revise" : "create"; if (state.agentMode === "revise" && state.selectedCardId) state.agentTargetId = state.selectedCardId; document.querySelectorAll(".segment").forEach((item) => item.classList.toggle("active", item === segment)); renderAgentTargets(); renderAgentContext(); }));
    $("agent-target").addEventListener("change", (event) => { state.agentTargetId = event.target.value; });
    $("agent-preview-button").addEventListener("click", generatePreview);
    $("canvas-viewport").addEventListener("pointerdown", onCanvasPointerDown);
    window.addEventListener("pointermove", onCanvasPointerMove); window.addEventListener("pointerup", onCanvasPointerUp);
    $("canvas-viewport").addEventListener("wheel", (event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY); }, { passive: false });
    $("zoom-in").addEventListener("click", () => { const r = $("canvas-viewport").getBoundingClientRect(); zoomAt(1.15, r.left + r.width / 2, r.top + r.height / 2); });
    $("zoom-out").addEventListener("click", () => { const r = $("canvas-viewport").getBoundingClientRect(); zoomAt(1 / 1.15, r.left + r.width / 2, r.top + r.height / 2); });
    $("zoom-fit").addEventListener("click", fitCanvas);
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { if (state.modal) closeModal(); else if ($("canvas-viewport").classList.contains("connecting")) toggleConnect(); return; }
      if (!state.joined || state.modal || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
      if (event.key.toLowerCase() === "n") openCardModal();
      if (event.key.toLowerCase() === "l") toggleConnect();
    });
  }
  function init() {
    bindEvents();
    try { $("nickname").value = window.localStorage.getItem("canvasNickname") || ""; } catch (_) { /* No storage. */ }
    const boardId = new URL(window.location.href).searchParams.get("board");
    if (boardId) { $("join-link").value = window.location.href; $("entry-join-tab").click(); }
  }
  init();
})();
