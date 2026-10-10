<img width="3840" height="1918" alt="image" src="https://github.com/user-attachments/assets/4718f8d7-aa85-4330-ab4f-23f7f71f61d5" />


# Figma 一键 UI 走查

将 Figma 导出的设计数据与当前网页对照，生成可查看局部证据的 UI 走查报告。程序测量文字、颜色、圆角与间距；Jev 协助确定结构复杂时的对象对应关系。

**当前版本：3.18.2（测试版）**。本项目公开供查看、下载和自行使用；不授予修改后再发布或再分发的许可。具体范围见 [使用条款](USAGE_TERMS.md)。本项目仍有检查未完成或区域未覆盖的情况。报告会标注这些范围，不能当作整页零误报、零漏报的保证。

## 下载与组成

下载 GitHub Releases 中的 `figma-ui-review-3.18.2.zip`。压缩包包含：

- `chrome-ui-review-extension/`：Chrome 扩展，采集网页并生成走查报告。
- `figma-module-rasterizer/`：Figma 开发插件，导出设计 ZIP；该目录提供可运行的构建产物。
- `services/`：macOS 本机 Jev 服务与安装脚本。

本项目当前以 Chrome、Figma 桌面版和 macOS 为安装路径。本机服务需要 Node.js 18+ 和 Python 3；每位使用者需自行配置 TypeSafe Jev API Key，模型调用会产生相应费用。

## 安装

1. 解压 Release 安装包。在 Chrome 的 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，指向 `chrome-ui-review-extension/`。
2. 在 Figma 桌面版选择“插件 → 开发 → 从 manifest 导入插件”，选 `figma-module-rasterizer/manifest.json`。
3. 在本机创建 `~/Library/Application Support/UI Review/jev-config.json`，填入自己的密钥：

   ```json
   {"apiKey":"YOUR_TYPESAFE_API_KEY","model":"jev-1.13.0"}
   ```

   将该文件权限设为 `600`。在 macOS 上运行 `services/安装Jev本机服务.command`，它会安装并启动仅监听 `127.0.0.1:4320` 的服务。
4. 在 Figma 插件中选择“Design to Validation”，导出所需页面的 HTML 文件包。网页打开后，在 Chrome 扩展中选择页面范围、导入设计 ZIP，再开始走查。

扩展会自动调用本机 Jev 服务，不需要手动开启 AI。调用会发送局部节点的文字和结构候选，**不发送页面截图给 Jev**。扩展安装时需要访问网页和本机服务的权限；请在自己有权检查的页面使用。

## 怎样看报告

- **需要调整**：测量对象和边界已确认，检测到数值差异。
- **一致**：该项测量符合当前规则。
- **需要确认 / 未覆盖**：缺少可靠的对应关系、绘制边界或采集数据；不把它们算成一致。
- **内容变化**：文案或数据影响排版，单独记录，不直接判为样式错误。

报告支持 JSON 与 HTML 导出。含页面文字、截图和结构信息的报告属于使用者自己的业务数据，请自行管理。

## 限制与反馈

不同页面状态、字体文件、图片内容或动态数据会影响结果。当前 Jev 用于结构候选判断；像素值由扩展采集和程序计算。旧快照中缺少的绘制边界需要刷新页面重新采集。

欢迎通过 GitHub Issues 提交问题。请尽量提供可复现的最小示例；提交前移除 API Key、客户页面数据和个人信息。

## 开发

Chrome 扩展直接加载 `chrome-ui-review-extension/`，无构建步骤。Figma 插件目录目前公开的是可运行构建产物；本仓库不提供其完整构建源文件。Jev 服务通过 `node services/jev-review-server.cjs` 运行。

可运行部分不依赖业务样本的检查：

```sh
node tests/jev-client.test.js
node tests/jev-review-server.test.js
node tests/inspection-contracts.test.js
node tests/completion-contracts.test.js
```

`chrome-ui-review-extension/vendor/jszip.min.js` 使用 JSZip 3.10.1（MIT/GPLv3 双许可）。
