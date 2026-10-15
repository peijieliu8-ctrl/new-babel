# New Babel HTML 路演架构

独立静态项目，13 页（00–12），reveal.js 6.0.2 唯一分页引擎。无业务后端、模型调用、CDN 或运行时网络依赖；Demo 跳转除外。分包保存本地资源，直接打开 index.html 或运行静态预览。原 Next.js 项目与数据不改动。

## 已冻结接口与文件归属

- 主协调者：index.html、src/app.js、package/lock、scripts/**、assets/**、README.md、架构与图片提示词记录；负责集成、生成图片、分页与最终验证。
- 文案 Agent：仅 src/slides.js、docs/speaker-notes.md。13 个对象，字段 id / scene / chapter / title / html / notes。通过经典脚本设置 window.NEW_BABEL_SLIDES。id 顺序 team/cover/promo/story/loss/problem/reveal/flow/knowledge/quest/demo/now/vision；scene 与 id 相同。
- 视觉 Agent：仅 src/deck.css。样式使用下述 DOM 契约；可与文案 Agent 协调补充契约。不得修改控制器、文案文件或原产品。
- 审查 Agent：只读审查，反馈由主协调者修复。

通用类：stage / eyebrow / display / headline / subhead / muted / accent / serif / meta / aside-note；fragment 及 data-fragment-index 交给 Reveal。每页 section.slide.scene-{scene} 内有 .slide-content。控制器为当前页写 data-beat（已出现 fragment 数），可用于明确的状态变换；不要用无限动画代替演讲节奏。

专用结构：cover-lockup / story-lines / story-verdict / signal-chain / signal-node / loss-verdict / fracture-grid / fracture-item / unity-canvas / unity-node / unity-core / flow-track / flow-step / flow-proof / knowledge-tree / tree-branch / tree-trunk / quest-map / quest-node / quest-link / quest-status / demo-layout / demo-window / demo-screenshot / demo-cta / proof-list / now-grid / now-item / vision-copy。

资源路径：assets/tower-origin.png（封面与故事，黑色背景、暖白古塔偏右、左侧留字）；assets/tower-future.png（结尾，深黑背景、发光未来之塔偏右、左侧留字）；assets/new-babel-icon.png（现有品牌）。团队海报 assets/team-introduction.png 与宣传视频 assets/new-babel-promo.mp4 由用户提供；视频封面 assets/new-babel-promo-poster.jpg 从原视频提取。其余图片由主协调者生成，CSS 引用相对 src 使用 ../assets/。

## 内容与交付标准

00 为团队介绍、01 为原封面、02 为宣传视频，03–12 延续原有叙事。5 个 Wow 转折位于 P03/P06/P07/P09/P12，通过片段与停顿触发。禁止捏造效率数字、客户、黑客松具体名称或引用归属。团队名默认 New Babel Team，标识 HACKATHON / PRODUCT KEYNOTE，可配置。

当前 Demo：真实多人画布、评论转卡、Mock Agent 预览及人确认、规则检查。P07–P09 的部门自动分发、知识版本树、系统自动验收属于产品愿景，需在页内标注。用“保留上下文、减少转述损耗”优化“信息零损耗”绝对承诺；人确认目标完成不能说系统自主验收。P10 链接默认 http://127.0.0.1:32149/，可由 ?demo= 显式配置；新标签打开并保留路演位置。

使用克制的发布会节奏，不冒充真实乔布斯言论。黑色舞台、暖白大字、古塔到光塔，留白充分；每页一个主结论、内容分步出现、无自动翻页。演讲备注包含时长、停顿、点击节点、Wow 解说和能力边界。

动效增强使用本地 Canvas 2D 的 `NewBabelParticles`（`src/particles.js`），控制器调用 `setScene`、`burst`、`setActive`。单个透明画布随当前 section 挂载，位于背景之上、文案之下；`effects.css` 提供文字入场及装饰扫光。章节转场通过 Reveal 原生 `data-transition` 选择，禁止增加第二个分页状态。系统减少动态偏好默认关闭粒子、内容入场与转场，演讲者可用右上角开关对当前页面主动开启；刷新或系统偏好变化后重新跟随系统。隐藏标签、总览、黑屏、同页演讲备注暂停粒子绘制，双屏窗口保留观众主屏动效。升级需验证关闭和恢复后不会积累动画循环。

验证目标：13 页（00–12）无内滚动；键盘/触摸/滚轮及按钮翻页；概览与演讲备注；hash 深链接；可返回 Demo 前的位置；减少动态偏好；1920×1080、1280×720、768×1024、375×667、667×375 均可读。打包包含 Reveal MIT 许可，图片提示词与运行说明可查。

## 团队与视频页面

页码由控制器统一按数组索引从 00 编至 12，章节文本不再重复嵌入编号；计数器分母为末页编号 12，共 13 页。原有 hash ID 保持稳定，新增 #/team 和 #/promo。团队海报完整等比显示，小屏竖向附成员与分工名单。视频使用原生 controls / playsinline / preload=metadata，手动播放，Reveal 在离页时暂停。视频聚焦时保留原生空格、方向键操作；视频区域滚轮不翻页。两页暂停装饰粒子绘制，避免媒体干扰。静态服务使用流式响应，提供 video/mp4、Content-Length、Accept-Ranges 与单段 Range / 206 / 416；GET 与 HEAD 均有回归测试。

10 页使用用户提供的实机截图 assets/demo-screenshot.png，保持完整画面及原始比例；旁边保留能力说明和打开 Demo 的入口。截图中的个人助手仍标识为 Mock，口播备注保持相同能力边界。
