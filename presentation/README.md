# New Babel · HTML Keynote

13 页（00–12）纯前端路演，使用本地 reveal.js 6.0.2 控制分页。黑色舞台、暖白文字、塔形主视觉与五个由演讲者触发的视觉转折。无需构建、CDN、字体服务或业务后端；Demo 按钮跳转当前产品。

粒子随章节变化：封面星尘、产品揭晓时的汇聚、流程光轨、知识分支、任务卡点脉冲和结尾的上升螺旋。翻页组合使用缩放、立体旋转、横移与光束扫场，文字分层入场；Reveal 仍是唯一分页引擎。

## 打开与操作

所有演示资源均在本地，无需互联网。推荐使用静态预览；也可在支持本地文件的浏览器中打开 `index.html`：

```bash
cd html-ppt
npm start
```

访问 `http://127.0.0.1:32150/`。`PPT_PORT=32151 npm start` 可改变端口。预览仅监听本机；Node 只是提供静态文件，不参与产品逻辑。

| 操作 | 控制 |
| --- | --- |
| 下一段 / 下一页 | →、空格、滚轮向下、触屏左滑或右下角 → |
| 上一段 / 上一页 | ←、滚轮向上、触屏右滑或右下角 ← |
| 全页概览 | Esc 或「总览」 |
| 本页口播与停顿 | 「备注」，在当前页弹出，可用 Esc 关闭 |
| 双屏演讲者视图 | S 或备注内的「打开双屏演讲窗口」，需要允许本地弹窗 |
| 全屏 | F |
| 黑屏停顿 | B |
| 粒子与转场开关 | 右上角 ✦；系统减少动态效果时默认关闭，可手动开启 |
| 指定页面 | hash，如 `/#/team`、`/#/promo`、`/#/demo`、`/#/vision` |

页面顺序为 00 团队介绍、01 封面、02 宣传视频、03–12 原有路演内容；页码及演讲备注一致。计数器显示当前页码 / 末页页码。

宣传视频约 30 秒，点击播放并使用原生控件调整音量、拖动进度或全屏；离开本页时自动暂停。视频获得焦点时，空格和方向键控制播放器，可点击右下角 → 继续路演。团队海报保持完整比例，小屏竖向显示额外的可读成员名单。

各段落由手动翻页触发，不自动播放。打开 Demo 使用新标签，返回路演时保持当前位置。

画布粒子使用本地 Canvas 2D，不增加依赖；浏览器标签隐藏、总览、黑屏或本页备注打开时暂停绘制。
特效开关仅影响当前页面，不保存浏览器偏好；刷新或系统偏好变化后重新跟随系统。双屏演讲者窗口不会暂停观众主屏的动效。

默认 Demo：`http://127.0.0.1:32149/`。更换部署入口可使用 `?demo=https%3A%2F%2Fyour-host.example%2F#/demo`；只接受 HTTP(S) 地址。路演本身可离线运行，Demo 需要对应产品服务在线。

也可独立 Docker 部署（先停止占用同端口的静态预览，或使用其他端口）：

```bash
cd html-ppt
PPT_PORT=32151 docker compose up -d --build --wait
```

此时访问 `http://127.0.0.1:32151/`。容器仅提供静态资源，无数据库或 API；项目名与产品容器独立。

## 内容与维护

- `src/slides.js`：13 页（00–12）内容、分段与内置演讲备注。
- `src/deck.css`：全部视觉、响应式断点与减少动态效果支持。
- `src/app.js`：Reveal 配置、导航状态与 Demo 地址。
- `src/particles.js`、`src/effects.css`：粒子场景、章节转场、内容入场与特效开关样式。
- `docs/speaker-notes.md`：完整口播稿、停顿及五个 Wow 时刻。
- `docs/image-prompts.md`：内置 Codex 生图模型生成封面/结尾的完整提示词。
- `docs/architecture.md`：主体架构、文件归属与内容边界。
- `docs/verification.md`：实际检查结果、截图与尚未验证的环境。
- `assets/demo-screenshot.png`：10 页使用的用户提供实机截图。
- `assets/team-introduction.png`：用户提供的团队海报。
- `assets/new-babel-promo.mp4`、`assets/new-babel-promo-poster.jpg`：用户提供的宣传视频与从视频提取的封面；本地和 Docker 静态服务支持 MP4 及 HTTP 字节范围请求。
- `assets/vendor/`：Reveal 本地发行文件及 MIT 许可。

当前版本的 Demo 包含真实共享画布、评论转卡、Mock Agent 预览/人工确认及公开规则检查。部门自动分发、知识版本树、游戏式任务图谱及自动验收属于产品愿景，相关页面有标识。

项目已附带可运行的 vendor 资源。仅在重装或升级 Reveal 时执行：

```bash
npm ci --ignore-scripts
npm run vendor
npm run check
```

Reveal 官方配置说明：https://revealjs.com/config/ 。升级时同步核对 `dist/plugin/notes.js` 路径。此项目没有更改原产品的数据库、会话或 Docker 数据卷。
