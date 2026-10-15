// A guided, fictional matter workflow. The player in app.js supplies the
// collaboration commands and view functions; this file owns only the story.
(function (global) {
  "use strict";

  const hostNickname = "模拟业务负责人 A";
  const peerNickname = "模拟技术执行人 B";
  const boardRequest = { template: "plan", workflow: "matter", scenario: "autoplay" };

  async function readBoard(run) {
    const response = await fetch(`/api/boards/${encodeURIComponent(run.boardId)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.board) throw new Error(result.error || "无法读取演示事项");
    return result.board;
  }

  function createSteps(ctx) {
    const required = ["demoHost", "demoPeer", "waitForDemoCard", "fitCanvas", "focusCard", "switchPanel", "showDemoAgent", "renderAgentPreview", "showWorkspaceView", "state"];
    for (const name of required) {
      if (!ctx[name]) throw new Error(`演示缺少 ${name} 接入`);
    }
    const host = (run, event, payload) => ctx.demoHost(run, event, payload);
    const peer = (run, event, payload) => ctx.demoPeer(run, event, payload);
    async function addCard(run, side, payload) {
      const card = (await (side === "host" ? host : peer)(run, "card:create", payload)).card;
      await ctx.waitForDemoCard(run, card.id, card.version);
      return card;
    }
    function lookAt(cardId) {
      ctx.showWorkspaceView("canvas");
      ctx.fitCanvas();
      ctx.focusCard(cardId);
    }

    return [
      {
        actor: "模拟业务负责人 A · 目标确认由脚本代演",
        title: "一个字段，先明确谁来决策",
        detail: "虚构事项：制度问答结果页是否显示“依据版本”。A 对字段口径负责；这里的身份和确认仅用于演示。",
        run: async (run) => {
          const board = await readBoard(run);
          await host(run, "matter:update", {
            version: board.matter.version,
            patch: {
              title: "确认制度问答结果页的“依据版本”字段",
              owner: hostNickname,
              nextOwner: peerNickname,
              blocker: "业务与技术对字段口径存在分歧",
            },
          });
          const latest = await readBoard(run);
          await host(run, "goal:confirm", { version: latest.goal.version });
          ctx.showWorkspaceView("canvas");
        },
      },
      {
        actor: "模拟业务负责人 A",
        title: "业务提出字段差异",
        detail: "业务希望回答能追溯到具体版本；议题和诉求分别记录，避免口头反复解释。",
        run: async (run) => {
          run.question = await addCard(run, "host", {
            type: "question",
            text: "字段待确认：制度问答结果页的“依据版本”是否必须展示？缺失时应如何提示？（虚构演示）",
            x: 70, y: 130,
          });
          run.business = await addCard(run, "host", {
            type: "idea",
            text: "业务诉求（虚构）：用户须能辨认回答所依据的制度版本；仅显示制度名称不足以复核。",
            x: 400, y: 90,
          });
          await host(run, "edge:create", { source: run.question.id, target: run.business.id, label: "业务诉求" });
          lookAt(run.business.id);
        },
      },
      {
        actor: "模拟技术执行人 B",
        title: "技术提出实现异议",
        detail: "B 指出接口字段不齐。异议保留在决策链中，负责人必须逐项回应。",
        run: async (run) => {
          run.technical = await addCard(run, "peer", {
            type: "objection",
            text: "技术异议（虚构）：现有接口不能稳定返回适用范围；若直接设为必填，部分结果无法展示。",
            x: 400, y: 330,
          });
          await peer(run, "edge:create", { source: run.technical.id, target: run.business.id, label: "质疑字段口径" });
          lookAt(run.technical.id);
        },
      },
      {
        actor: "模拟技术执行人 B · 资料均为虚构",
        title: "给出可追溯的材料",
        detail: "接口字段清单被登记为带标题、编号和版本的虚构证据；这只展示来源结构，不代表已经查验真实系统。",
        run: async (run) => {
          run.interfaceEvidence = await addCard(run, "peer", {
            type: "evidence",
            text: "虚构资料：接口返回制度名称、文档 ID 与版本号；适用范围字段在部分条目中为空，正式试点前待核验。",
            source: { title: "演示用接口字段清单", reference: "DEMO-API-01", version: "v0.1" },
            x: 75, y: 360,
          });
          await peer(run, "edge:create", { source: run.interfaceEvidence.id, target: run.technical.id, label: "支持技术异议" });
          lookAt(run.interfaceEvidence.id);
        },
      },
      {
        actor: "模拟业务负责人 A · 引用虚构风险意见",
        title: "补充风险复核意见",
        detail: "风险意见作为虚构资料卡呈现，没有第三位在线成员，也不表示风险部门真的审批过。",
        run: async (run) => {
          run.riskEvidence = await addCard(run, "host", {
            type: "evidence",
            text: "虚构风险复核意见：来源版本或适用范围无法确认时，不应把回答展示为已核验结论，应提示人工复核。",
            source: { title: "演示用风险复核摘录", reference: "DEMO-RISK-01", version: "v0.1" },
            x: 75, y: 590,
          });
          await host(run, "edge:create", { source: run.riskEvidence.id, target: run.question.id, label: "风险意见来源" });
          lookAt(run.riskEvidence.id);
        },
      },
      {
        actor: "模拟业务负责人 A · 私有模拟 Agent",
        title: "先私下整理分歧",
        detail: "脚本将已公开卡片内容放进指令，模拟 Agent 生成摘要；它不会自动扫描全板或核验资料。预览只对 A 可见。",
        run: async (run) => {
          const instruction = "整理已公开的虚构材料：业务诉求卡要求展示依据版本；技术异议卡指出适用范围字段不全；接口字段清单 DEMO-API-01 v0.1 支持这一约束；风险意见 DEMO-RISK-01 v0.1 要求信息缺失时转人工。请列出分歧和待核验项，注明以上四项来源。此处仅模拟整理，不做事实判断。";
          ctx.showDemoAgent("create", run.question.id, instruction);
          ctx.state.preview = (await host(run, "agent:preview", { mode: "create", cardId: run.question.id, instruction })).preview;
          ctx.renderAgentPreview();
        },
      },
      {
        actor: "模拟业务负责人 A · 发布动作由脚本代演",
        title: "将摘要和来源公开",
        detail: "脚本代演“人点击发布”。模拟 Agent 摘要成为公共卡片，并连到异议和两份虚构来源材料。",
        run: async (run) => {
          const published = await host(run, "agent:publish", { previewId: ctx.state.preview.id, x: 730, y: 170 });
          run.summary = published.card;
          ctx.state.preview = null;
          ctx.renderAgentPreview();
          await host(run, "edge:create", { source: run.technical.id, target: run.summary.id, label: "摘要来源：技术异议" });
          await host(run, "edge:create", { source: run.interfaceEvidence.id, target: run.summary.id, label: "摘要来源：接口清单" });
          await host(run, "edge:create", { source: run.riskEvidence.id, target: run.summary.id, label: "摘要来源：风险意见" });
          lookAt(run.summary.id);
        },
      },
      {
        actor: "模拟业务负责人 A · 决策由脚本代演",
        title: "负责人记录决定和取舍",
        detail: "A 引用两份虚构证据、回应技术异议，记录适用范围与剩余风险。模拟 Agent 没有审批权。",
        run: async (run) => {
          const board = await readBoard(run);
          run.decision = (await host(run, "decision:record", {
            boardVersion: board.version,
            option: "取得可核验版本号时展示依据版本；缺少版本号或适用范围不清时提示待核验并转人工复核。",
            rationale: "业务需要可追溯，技术接口存在字段缺口；按虚构接口清单与风险意见采用条件展示。正式上线前仍需核验真实接口。",
            scope: "仅限本次虚构制度问答结果页试点方案，不等同于机构制度或上线审批。",
            risk: "版本更新、字段缺失和适用范围识别错误；进入真实试点前应完成数据源、权限和合规核验。",
            evidenceCardIds: [run.interfaceEvidence.id, run.riskEvidence.id],
            objectionResolutions: [{ cardId: run.technical.id, response: "不强制所有结果都展示版本；信息缺失时显示待核验提示并转人工。" }],
          })).decision;
          ctx.showWorkspaceView("decisions");
        },
      },
      {
        actor: "模拟业务负责人 A",
        title: "把决定拆成可验收任务",
        detail: "B 负责字段说明与分支样例，A 独立复核。工作项有责任人、复核人和具体验收标准。",
        run: async (run) => {
          const board = await readBoard(run);
          await host(run, "matter:update", { version: board.matter.version, patch: { blocker: "", nextOwner: peerNickname } });
          run.task = await addCard(run, "host", {
            type: "task",
            text: "交付“依据版本”字段规则与异常分支样例（虚构演示）",
            owner: peerNickname,
            reviewer: hostNickname,
            acceptanceCriteria: "字段说明覆盖有版本、缺版本、适用范围待确认三种情况，并写明人工复核触发条件。",
            x: 730, y: 390,
          });
          await host(run, "edge:create", { source: run.summary.id, target: run.task.id, label: "转为交付任务" });
          ctx.showWorkspaceView("inbox");
        },
      },
      {
        actor: "模拟技术执行人 B · 提交动作由脚本代演",
        title: "提交交付证据",
        detail: "B 提交虚构字段说明和三种样例，任务进入待复核；提交本身不等于验收完成。",
        run: async (run) => {
          run.deliveryEvidence = await addCard(run, "peer", {
            type: "evidence",
            text: "虚构交付：字段说明 v0.2，含“有版本 / 缺版本 / 适用范围待确认”三种展示样例及转人工条件；未接真实系统。",
            source: { title: "演示用字段说明", reference: "DEMO-FIELD-02", version: "v0.2" },
            x: 1040, y: 390,
          });
          await peer(run, "edge:create", { source: run.deliveryEvidence.id, target: run.task.id, label: "交付证据" });
          const board = await readBoard(run);
          const task = board.cards.find((card) => card.id === run.task.id);
          await peer(run, "task:submit", { cardId: task.id, version: task.version, delivery: "虚构交付物 DEMO-FIELD-02 v0.2：字段规则及三种分支样例；正式接口和权限仍待测试。" });
          ctx.showWorkspaceView("inbox");
        },
      },
      {
        actor: "模拟业务负责人 A · 复核由脚本代演",
        title: "独立验收，而非自动完成",
        detail: "A 对照验收标准确认虚构交付物；这里仅模拟业务验收，没有真实系统测试或正式上线批准。",
        run: async (run) => {
          const board = await readBoard(run);
          const task = board.cards.find((card) => card.id === run.task.id);
          await host(run, "task:accept", { cardId: task.id, version: task.version, reviewNote: "模拟验收：字段说明覆盖三种约定分支和人工复核条件；真实接口、权限及合规检查仍待进行。" });
          ctx.showWorkspaceView("inbox");
        },
      },
      {
        actor: "模拟业务负责人 A · 完成确认由脚本代演",
        title: "事项闭环，保留审计路径",
        detail: "完成前检查目标、有效决策和已验收任务；业务与技术意见、来源、取舍和复核记录可沿时间线追溯。",
        run: async (run) => {
          await host(run, "board:complete", {});
          ctx.showWorkspaceView("timeline");
        },
      },
      {
        actor: "复盘摘要 · 全程脚本模拟",
        title: "给管理者看一条可核验的事项链",
        detail: "本案例展示：1 个字段分歧、2 份决策依据、1 项人工决策、1 项独立验收。材料和角色均为虚构；未测量节省工时，也未验证真实系统。",
        run: async () => { ctx.showWorkspaceView("decisions"); },
      },
    ];
  }

  global.demoWorkflow = { boardRequest, hostNickname, peerNickname, createSteps };
})(window);
