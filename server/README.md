<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Aurora0201/codex-router/main/assets/branding/codex-router-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Aurora0201/codex-router/main/assets/branding/codex-router-logo.png">
    <img alt="Codex Router" src="https://raw.githubusercontent.com/Aurora0201/codex-router/main/assets/branding/codex-router-logo.png" width="680">
  </picture>
</p>

<h1 align="center">@aurora0201/codex-router</h1>

<p align="center">
  <a href="https://github.com/Aurora0201/codex-router/blob/main/README.md">完整中文文档</a> ·
  <a href="https://github.com/Aurora0201/codex-router/blob/main/README.en.md">Full English documentation</a>
</p>

<p align="center">
  面向 Codex CLI 的本机多账号路由器与透明代理。
  <br>
  隔离管理账号，按需开启自动切换与预热，并保留不含数据面正文的结构化请求证据。
</p>

<p align="center">
  <a href="https://github.com/Aurora0201/codex-router/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Aurora0201/codex-router/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@aurora0201/codex-router"><img alt="npm" src="https://img.shields.io/npm/v/%40aurora0201%2Fcodex-router?logo=npm"></a>
  <img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-5FA04E?logo=nodedotjs&logoColor=white">
  <a href="https://github.com/Aurora0201/codex-router/blob/main/LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/Aurora0201/codex-router"></a>
</p>

<p align="center">
  <img alt="Codex Router 运行状态管理后台" src="https://raw.githubusercontent.com/Aurora0201/codex-router/main/assets/screenshots/admin-dashboard.png" width="1200">
</p>

运行状态页集中展示接管链路、请求结果、API 可用性和活动 WebSocket；仓库文档还提供[账号路由](https://github.com/Aurora0201/codex-router#界面预览)与[请求证据](https://github.com/Aurora0201/codex-router#请求证据)界面说明。所有预览均使用虚构演示数据。

## 安装

当前发布包支持 **Windows x64**，需要 **Node.js 24+**。

```powershell
npm install --global @aurora0201/codex-router
codex-router start
```

打开 <http://127.0.0.1:8317/admin/>，使用 OpenAI 官方 OAuth 添加账号并手动选择当前路由身份。

```powershell
codex-router config apply
codex-router restart
codex-router status
```

## 主要能力

- 每个账号使用独立 `CODEX_HOME`，默认手动选择；可显式开启有记录的自动切换，不跨账号重试当前失败请求。
- 自动预热默认关闭，会实际消费额度；发送前记录尝试，确认五小时窗口运行后才记为成功，未确认时不会自动重复发送。
- 自动预热受账号参与设置、周额度、冷却及每日自动次数上限约束；启动、休眠恢复和窗口到期后先刷新核验。
- 透明转发 Codex HTTP、SSE、WebSocket、compact、models 和 web search 请求。
- 实时展示 API 可用性、活动 WebSocket、对话/Turn 关联和请求诊断。
- Prompt、响应正文、工具参数、工具输出、Authorization 和 Cookie 不进入日志或 SQLite。
- 提供启停、状态、账号选择、日志和 Codex 配置管理 CLI。

完整文档、安全边界、源码与发布包请访问 [GitHub 仓库](https://github.com/Aurora0201/codex-router)。

## License

[MIT](https://github.com/Aurora0201/codex-router/blob/main/LICENSE)
