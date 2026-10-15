// Trusted local templates; classic script keeps file:// support.
window.NEW_BABEL_SLIDES = [
  {
    id: 'team', scene: 'team', chapter: '团队介绍', title: 'New Babel 团队介绍',
    html: `<div class="stage team-stage">
      <h1 class="visually-hidden">New Babel 团队介绍</h1>
      <img class="team-photo" src="assets/team-introduction.png" width="1672" height="941" alt="New Babel 团队：恒睿，AI开发；可汗，路演；三三，Videos与产品策划；荔枝，产品经理；沛杰，AIPM。">
      <ul class="team-roster" aria-label="团队成员与分工">
        <li><strong>恒睿</strong><span>AI开发</span></li>
        <li><strong>可汗</strong><span>路演</span></li>
        <li><strong>三三</strong><span>Videos与产品策划</span></li>
        <li><strong>荔枝</strong><span>产品经理</span></li>
        <li><strong>沛杰</strong><span>AIPM</span></li>
      </ul>
    </div>`,
    notes: `<h2>00 · 团队介绍 / 20 秒</h2><p>“我们是 New Babel 团队。”</p><p>从左到右介绍：恒睿负责 AI 开发，可汗负责路演，三三负责 Videos 与产品策划，荔枝担任产品经理，沛杰负责 AIPM。</p><p>使用团队提供的原始海报。介绍结束后按右方向键进入封面。</p>`,
  },
  {
    id: 'cover', scene: 'cover', chapter: 'NEW BABEL', title: '新巴别塔 New Babel',
    html: `<div class="stage cover-lockup">
      <p class="eyebrow">HACKATHON / PRODUCT KEYNOTE</p>
      <p class="cover-en">NEW BABEL</p>
      <h1 class="display">新巴别塔</h1>
      <p class="subhead">为企业重建统一的语言</p>
      <p class="meta muted">New Babel Team</p>
    </div>`,
    notes: `<h2>01 · 封面 / 15 秒</h2><p>先让画面停留 3 秒。</p><p>“今天，我们想重建一座塔。一座属于每一家企业的，巴别塔。”</p><p>停 2 秒，再按右方向键进入故事。不要在封面解释功能。</p>`,
  },
  {
    id: 'promo', scene: 'promo', chapter: '宣传视频', title: '新巴别塔 · 宣传视频',
    html: `<div class="stage promo-stage">
      <div class="promo-heading"><p class="eyebrow">NEW BABEL / FILM</p><h2 class="headline">新巴别塔 · 宣传视频</h2></div>
      <video class="promo-video" controls playsinline preload="metadata" tabindex="0" poster="assets/new-babel-promo-poster.jpg" aria-label="新巴别塔宣传视频，约30秒，含声音">
        <source src="assets/new-babel-promo.mp4" type="video/mp4">
        当前浏览器无法播放视频，请<a href="assets/new-babel-promo.mp4">打开宣传视频</a>。
      </video>
      <p class="aside-note">点击播放 · 建议开启声音 · 约 30 秒</p>
    </div>`,
    notes: `<h2>02 · 宣传视频 / 30 秒</h2><p>“先用一段短片，走进新巴别塔。”点击视频播放，保留原声，播放期间不口播。</p><p>视频不会自动开始或自动翻页。可使用原生控件暂停、调整音量、拖动进度及全屏；焦点在视频上时，空格和方向键交给播放器。</p><p>播放结束后点击右下角下一步进入故事；离开本页时视频自动暂停。宣传内容用于路演表达，当前实现与产品愿景仍以各页说明为准。</p>`,
  },
  {
    id: 'story', scene: 'story', chapter: '一个故事', title: '共识先散了',
    html: `<div class="stage">
      <p class="eyebrow">一个关于共识的古老寓言</p>
      <div class="story-lines"><p>人们想造一座通天的塔。</p><p>语言相通，他们一起向上。</p><p>后来，语言变乱了。</p><p>塔，就停了。</p></div>
      <h2 class="headline story-verdict fragment" data-fragment-index="0">塔还在。<br>共识先散了。</h2>
    </div>`,
    notes: `<h2>03 · 故事 / 30 秒</h2><p>平静讲完四行。这是寓言化转述，不作为历史或经文引用。</p><p>“人们曾经想建一座通天的塔。语言相通，他们一起向上。后来，语言变乱了。塔就停了。”</p><p>停 2 秒。按右键显示大字：“塔还在。共识先散了。”停 3 秒。</p><p>Wow ①：从外部倒塌转向内部失去共同理解。再按右键翻页。</p>`,
  },
  {
    id: 'loss', scene: 'loss', chapter: '今天', title: '话传到了，意思呢？',
    html: `<div class="stage">
      <p class="eyebrow">今天的企业，正在建自己的巴别塔</p>
      <h2 class="headline">话传到了。<br>意思呢？</h2>
      <div class="signal-chain" aria-label="同一个目标，在决策、部门和执行之间被不同理解">
        <div class="signal-node"><span class="tiny-label">决策</span><p>让客户用上</p></div>
        <div class="signal-node"><span class="tiny-label">部门</span><p>让功能上线</p></div>
        <div class="signal-node"><span class="tiny-label">执行</span><p>把页面做完</p></div>
      </div>
      <p class="loss-verdict fragment" data-fragment-index="0">同一条消息。三个理解。</p>
      <p class="aside-note">被误解，真的只能认命吗？</p>
    </div>`,
    notes: `<h2>04 · 信息损耗 / 25 秒</h2><p>“老板说，让客户用上。部门理解成，让功能上线。到了执行，变成了把页面做完。”</p><p>按右键：“同一条消息。三个理解。”停 2 秒。</p><p>“文件发过了。会议开过了。可我们真的在做同一件事吗？”</p><p>这是情境示例，不是客户案例，不声称有量化损耗。再按右键。</p>`,
  },
  {
    id: 'problem', scene: 'problem', chapter: '问题本质', title: '共同的上下文',
    html: `<div class="stage">
      <p class="eyebrow">企业每多一层，理解就多一次转述</p>
      <h2 class="headline">缺少的是，<br>共同的上下文。</h2>
      <div class="fracture-grid">
        <div class="fracture-item"><span class="number">01</span><h3>思想不统一</h3><p>各自理解目标</p></div>
        <div class="fracture-item"><span class="number">02</span><h3>语言不统一</h3><p>同词，不同含义</p></div>
        <div class="fracture-item"><span class="number">03</span><h3>口径不统一</h3><p>多个“最新版本”</p></div>
      </div>
      <p class="aside-note fragment" data-fragment-index="0">让目标、依据和分歧，留在同一个地方。</p>
    </div>`,
    notes: `<h2>05 · 问题本质 / 25 秒</h2><p>“思想不统一，大家追着不同的目标。语言不统一，同一个词指向不同的东西。口径不统一，每个人手里都有一个最新版本。”</p><p>按右键：“我们需要一个共同的上下文。让目标、依据，以及分歧，都有地方留下。”</p><p>统一是共享背景、追溯依据，不要求消灭不同意见。再按右键。</p>`,
  },
  {
    id: 'reveal', scene: 'reveal', chapter: 'NEW BABEL', title: '共识有了位置',
    html: `<div class="stage">
      <p class="eyebrow">NEW BABEL · 企业沟通 AGENT × 无限画布</p>
      <h2 class="headline">让所有人，<br>看见同一个问题。</h2>
      <div class="unity-canvas" aria-label="统一思想、语言和口径，围绕可见的共识连接起来">
        <div class="unity-node"><h3>统一思想</h3><small>目标可见</small></div>
        <div class="unity-node"><h3>统一语言</h3><small>上下文相连</small></div>
        <div class="unity-node"><h3>统一口径</h3><small>结论有出处</small></div>
        <div class="unity-core fragment" data-fragment-index="0"><span class="tiny-label">NEW BABEL</span><strong>共识<br>有了位置。</strong></div>
      </div>
      <p class="aside-note">人共同讨论。Agent 整理提议。人确认推进。</p>
    </div>`,
    notes: `<h2>06 · 产品揭晓 / 35 秒</h2><p>“这就是 New Babel。一个让人和 Agent，一起工作的无限画布。”</p><p>依次指向目标、上下文、结论：“当思想、语言、口径，连接到同一张画布……”停 2 秒，按右键。</p><p>“共识，就有了位置。”停 3 秒。</p><p>Wow ②：三种分散理解收拢为一个可见空间。Agent 提议，人确认。再按右键。</p>`,
  },
  {
    id: 'flow', scene: 'flow', chapter: '工作流', title: '从一句话，到一起做',
    html: `<div class="stage">
      <p class="eyebrow roadmap-label">产品愿景 · 部门自动拆解与分发尚未实现</p>
      <h2 class="headline">从一句话，<br>到一起做。</h2>
      <div class="flow-track" aria-label="明确目标，Agent建议拆解分发，部门画布协同，汇总后由人确认">
        <div class="flow-step"><span class="number">01</span><h3>明确目标</h3><p class="step-copy">决策层定方向</p></div>
        <div class="flow-step"><span class="number">02</span><h3>拆解分发</h3><p class="step-copy">Agent 建议 · 人确认</p></div>
        <div class="flow-step"><span class="number">03</span><h3>画布协同</h3><p class="step-copy">各部门同图推进</p></div>
        <div class="flow-step"><span class="number">04</span><h3>汇总验收</h3><p class="step-copy">追溯依据 · 人确认</p></div>
      </div>
      <p class="flow-proof fragment" data-fragment-index="0">任务向前走。<br><span class="accent">上下文，一起走。</span></p>
      <p class="aside-note">保留意图与依据，减少反复转述的损耗。</p>
    </div>`,
    notes: `<h2>07 · 四步闭环 / 30 秒</h2><p>先说明：“接下来三页，是我们正在构建的产品方向。”</p><p>“决策层明确目标。Agent 提议拆解和分发，由人确认。各部门在同一张画布上协同。最后汇总依据，由人验收。”</p><p>停 1 秒，按右键：“任务向前走。上下文，一起走。”停 2 秒。</p><p>Wow ③：四个环节成为连续路径。不说信息零损耗；自动分发未实现，当前只有 Mock 提案和人工确认。再按右键。</p>`,
  },
  {
    id: 'knowledge', scene: 'knowledge', chapter: '统一语言', title: '知识终于长在一起',
    html: `<div class="stage">
      <p class="eyebrow roadmap-label">产品愿景 · 知识库与版本树尚未实现</p>
      <h2 class="headline">知识，<br>终于长在一起。</h2>
      <div class="knowledge-tree" aria-label="讨论记录、方案版本和执行反馈通过分支汇入共同知识主干">
        <div class="tree-branch"><h3>讨论记录</h3><p>为什么这样做</p></div>
        <div class="tree-branch"><h3>方案版本</h3><p>这次改了什么</p></div>
        <div class="tree-branch"><h3>执行反馈</h3><p>实际发生了什么</p></div>
        <div class="tree-trunk"><strong>共同知识主干</strong><p>主干 + 分支 · 变化可追溯</p></div>
      </div>
      <p class="beat-line fragment" data-fragment-index="0">对话留痕。版本可追。问答有据。</p>
      <p class="aside-note">让新的讨论，站在已有共识上。</p>
    </div>`,
    notes: `<h2>08 · 知识版本 / 25 秒</h2><p>“每一次讨论，都会产生知识。但今天，知识常常停在某条聊天记录里。”</p><p>“我们希望借鉴代码协作中的主干与分支：讨论可以分开，结论可以汇合，每次变化都能追溯。”</p><p>按右键：“对话留痕。版本可追。问答有据。”</p><p>这是未来知识库方向；当前没有版本树、检索或真实模型问答，不承诺永远最新。再按右键。</p>`,
  },
  {
    id: 'quest', scene: 'quest', chapter: '任务图谱', title: '看见下一步',
    html: `<div class="stage">
      <p class="eyebrow roadmap-label">产品愿景 · 任务图谱示意，验收仍需人确认</p>
      <h2 class="headline">每个人，<br>看见下一步。</h2>
      <div class="quest-map" aria-label="从共同目标，经范围确认、研发实现到人工验收的任务路径">
        <div class="quest-node"><span class="number">01</span><h3>共同目标</h3><p>发布可用原型</p></div>
        <div class="quest-node"><span class="number">02</span><h3>产品</h3><p>确认范围</p></div>
        <div class="quest-node"><span class="number">03</span><h3>研发</h3><p>实现流程</p></div>
        <div class="quest-node"><span class="number">04</span><h3>验收</h3><p>人确认完成</p></div>
      </div>
      <div class="quest-status fragment" data-fragment-index="0"><span class="tiny-label">当前卡点</span><strong>等待产品负责人<br>确认验收标准。</strong></div>
      <p class="aside-note">有负责人。有依赖。有完成条件。</p>
    </div>`,
    notes: `<h2>09 · 任务图谱 / 30 秒</h2><p>“像游戏一样，每个人能看见自己的位置，也看见下一步需要谁。”</p><p>指向路径：“如果进度停住了……”停 2 秒，按右键。</p><p>“卡住的，原来是一次确认。”停 2 秒。</p><p>Wow ④：模糊的没进展变成具体的人、具体的条件。当前有分工、依赖和规则卡点面板；游戏式图谱、自动分发及自动验收属于愿景。系统提供依据，人确认完成。再按右键。</p>`,
  },
  {
    id: 'demo', scene: 'demo', chapter: 'LIVE DEMO', title: '一起走进去',
    html: `<div class="stage">
      <p class="eyebrow">已实现 DEMO · AGENT 为 MOCK</p>
      <h2 class="headline">现在，<br>一起走进去。</h2>
      <div class="demo-layout">
        <div class="demo-window">
          <img class="demo-screenshot" src="assets/demo-screenshot.png" width="3024" height="1632" alt="New Babel 实机截图：想法辩论画布中的目标、想法、依据与反驳卡片，以及右侧标识为 Mock 的个人助手。">
        </div>
        <div class="demo-cta">
          <ul class="proof-list"><li>多人实时同步</li><li>评论转为关联卡片</li><li>Mock 预览 → 人确认</li></ul>
          <a href="http://127.0.0.1:32149/" data-demo-link target="_blank" rel="noopener noreferrer">打开 New Babel <span aria-hidden="true">↗</span></a>
          <p class="aside-note">新标签打开 · 路演留在这里</p>
        </div>
      </div>
    </div>`,
    notes: `<h2>10 · 实机演示 / 70 秒</h2><p>“现在，让我们把这件事做一次。”点击打开 New Babel，新标签打开，本页保留。</p><p>准备“方案细化”画布和两个独立会话。20 秒：一边修改卡片，另一边同步。15 秒：评论转为带出处的关联卡片。25 秒：选择内容，请 Mock 细化步骤，先停在预览，再由人确认发布。10 秒：展示规则卡点与依据。</p><p>“这里的 Agent 是 Mock。今天我们验证的是协作闭环，以及每一次改变由谁确认。”</p><p>本页使用用户提供的实机截图，展示“想法辩论”画布与个人 Mock 助手。演示后切回标签，按右键。服务不可达时留在本页讲述能力，不假装实机成功。</p>`,
  },
  {
    id: 'now', scene: 'now', chapter: '为什么是现在', title: '把理解带进协作',
    html: `<div class="stage">
      <p class="eyebrow">自然语言，正在成为工作接口</p>
      <h2 class="headline">把理解，<br>带进协作。</h2>
      <div class="now-grid">
        <div class="now-item"><span class="number">01</span><h3>读懂意图</h3><p>从表达走向任务</p></div>
        <div class="now-item"><span class="number">02</span><h3>连接上下文</h3><p>让信息拥有关系</p></div>
        <div class="now-item"><span class="number">03</span><h3>参与协作</h3><p>把草案交给人确认</p></div>
      </div>
      <p class="beat-line fragment" data-fragment-index="0">谁先对齐上下文，谁先一起向前。</p>
      <p class="aside-note">下一阶段：真实模型接入与企业场景验证。</p>
    </div>`,
    notes: `<h2>11 · 时间窗口 / 25 秒</h2><p>“大模型让自然语言，开始成为工作的接口。我们有机会把理解意图、连接上下文、生成草案，放进同一个协作过程。”</p><p>按右键：“谁先对齐上下文，谁先一起向前。”停 2 秒。</p><p>不声称历史上第一次可行，也不宣称已完成企业自动化。下一阶段需真实模型与场景验证。再按右键。</p>`,
  },
  {
    id: 'vision', scene: 'vision', chapter: '向上', title: '这一次，把它建成',
    html: `<div class="stage vision-copy">
      <p class="eyebrow">NEW BABEL</p>
      <h2 class="display">这一次，<br>把它建成。</h2>
      <p class="subhead fragment" data-fragment-index="0">共同的语言。<br>从共同的画布开始。</p>
      <p class="meta muted">新巴别塔 / New Babel Team</p>
    </div>`,
    notes: `<h2>12 · 愿景 / 25 秒</h2><p>沉默 3 秒，让塔被看见。</p><p>“过去，人们因为无法相互理解，停了下来。”停 2 秒。</p><p>“这一次，我们想借助 AI，把它建成。”按右键，光塔点亮，收尾句出现。</p><p>“共同的语言。从共同的画布开始。”停 4 秒，再轻声说“谢谢”。</p><p>Wow ⑤：停工古塔成为向上生长的光塔。收束于愿景，不把愿景描述为已经交付。</p>`,
  },
];
