# Jev 本机服务

macOS：先把自己的 API Key 写入 `~/Library/Application Support/UI Review/jev-config.json`：

```json
{"apiKey":"YOUR_TYPESAFE_API_KEY","model":"jev-1.13.0"}
```

文件权限应为 `600`。运行 `安装Jev本机服务.command` 将服务安装到用户目录并在登录时启动。服务监听 `127.0.0.1:4320`；访问 `/health` 检查状态。服务不会在响应中返回密钥。

需要 Node.js 18+、Python 3。密钥只保留在本机配置或 `JEV_API_KEY` 环境变量中，不应放进 Git 仓库。只有从扩展发来的结构化请求会转发到 TypeSafe Jev；网页截图不发送到模型。API 使用额度由使用者自己的 TypeSafe 账户承担。
