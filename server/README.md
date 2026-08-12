<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Aurora0201/codex-router/main/assets/branding/codex-router-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Aurora0201/codex-router/main/assets/branding/codex-router-logo.png">
    <img alt="Codex Router" src="https://raw.githubusercontent.com/Aurora0201/codex-router/main/assets/branding/codex-router-logo.png" width="680">
  </picture>
</p>

<h1 align="center">@aurora0201/codex-router</h1>

<p align="center">
  面向 Codex CLI 的本机多账号路由器与透明代理。
  <br>
  手动选择身份，实时观察连接，并保留不含数据面正文的结构化请求证据。
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

- 每个账号使用独立 `CODEX_HOME`，不会自动轮换或跨账号绕过限额。
- 透明转发 Codex HTTP、SSE、WebSocket、compact、models 和 web search 请求。
- 实时展示 API 可用性、活动 WebSocket、对话/Turn 关联和请求诊断。
- Prompt、响应正文、工具参数、工具输出、Authorization 和 Cookie 不进入日志或 SQLite。
- 提供启停、状态、账号选择、日志和 Codex 配置管理 CLI。

完整文档、安全边界、源码与发布包请访问 [GitHub 仓库](https://github.com/Aurora0201/codex-router)。

## License

[MIT](https://github.com/Aurora0201/codex-router/blob/main/LICENSE)
