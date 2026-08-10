# Codex Router Admin v2

Nova 管理界面默认连接正在运行的 Gateway Admin API，不提供 Mock 模式。

## 开发

先在仓库根目录启动 Gateway：

```bash
npm run dev
```

然后在本目录启动 v2 Vite 服务：

```bash
npm run dev
```

访问 `http://127.0.0.1:5174/admin-v2/`。开发服务器会将 `/api`
代理到 `http://127.0.0.1:8317`。

## 生产构建

```bash
npm run build
```

Gateway 会从 `web-v2/dist` 提供 `/admin-v2/`，原有 v1 继续由
`web/dist` 提供 `/admin/`。可通过 `GATEWAY_WEB_V2_DIST` 单独覆盖 v2
构建目录。

## shadcn/ui

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```
