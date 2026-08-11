# Codex Router Admin

Nova 管理界面默认连接正在运行的 Gateway Admin API，不提供 Mock 模式。

## 开发

先在仓库根目录启动 Gateway：

```bash
npm run dev
```

也可以只在本目录启动 Vite 服务：

```bash
npm run dev
```

访问 `http://127.0.0.1:5174/admin/`。开发服务器会将 `/api`
代理到 `http://127.0.0.1:8317`。

## 生产构建

```bash
npm run build
```

正式前端源码位于仓库的 `web/` 目录，生产构建输出到
`server/web-dist`，Gateway 从该目录提供唯一的管理入口 `/admin/`。
可通过 `GATEWAY_WEB_DIST` 覆盖构建目录。

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
