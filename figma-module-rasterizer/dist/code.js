"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __objRest = (source, exclude) => {
    var target = {};
    for (var prop in source)
      if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
        target[prop] = source[prop];
    if (source != null && __getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(source)) {
        if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
          target[prop] = source[prop];
      }
    return target;
  };

  // src/code.ts
  var CANDIDATE_TYPES = /* @__PURE__ */ new Set([
    "FRAME",
    "COMPONENT",
    "INSTANCE",
    "COMPONENT_SET",
    "GROUP"
  ]);
  var MODULE_TYPES = /* @__PURE__ */ new Set([
    "FRAME",
    "COMPONENT",
    "INSTANCE",
    "COMPONENT_SET",
    "GROUP",
    "SECTION",
    "TEXT",
    "VECTOR",
    "BOOLEAN_OPERATION",
    "LINE",
    "ELLIPSE",
    "POLYGON",
    "STAR",
    "RECTANGLE"
  ]);
  var QUICK_REPLACE_SCALE = 2;
  var QUICK_REPLACE_KEEP_ORIGINAL = false;
  var PLACEHOLDER_SCALE = 2;
  var MAX_IMAGE_DIMENSION = 4096;
  var MIN_MODULE_WIDTH = 4;
  var MIN_MODULE_HEIGHT = 4;
  var MAX_MODULES = 1e3;
  var WORKSPACE_PAD = 24;
  var WORKSPACE_COLUMN_GAP = 80;
  var WORKSPACE_NAME_PREFIX = "[\u7535\u5546AI\u63D0\u6548\u5DE5\u5177] Workspace";
  var MANUAL_WORKSPACE_NAME_PREFIX = "[\u5DE5\u4F5C\u533A]";
  var LEGACY_WORKSPACE_NAME_PREFIXES = [
    "[\u524D\u7AEF\u4EA4\u4ED8\u751F\u6210\u5305] Workspace",
    "[Module Rasterizer] Workspace"
  ];
  var SOURCE_MAP_NAME = "Source Map";
  var SELECTED_MODULES_NAME = "Selected Modules";
  var ARCHIVE_NAME = "Archive";
  var PLACEHOLDER_PREFIX = "[MR Placeholder]";
  var CARD_PREFIX = "[MR Card]";
  var INTERNAL_NAME_PREFIXES = ["[PNG]", "[MR ", WORKSPACE_NAME_PREFIX, MANUAL_WORKSPACE_NAME_PREFIX, ...LEGACY_WORKSPACE_NAME_PREFIXES];
  var currentMode = "full";
  var currentWidth = 380;
  var workspace = null;
  var fontsLoaded = false;
  var lastCopyId = null;
  var manualWorkspace = null;
  var validation = null;
  void main();
  async function main() {
    if (figma.command === "replace-selection") {
      showPanel("compact");
      await replaceSelectionWithPng({
        scale: QUICK_REPLACE_SCALE,
        keepOriginal: QUICK_REPLACE_KEEP_ORIGINAL
      });
      return;
    }
    if (figma.command === "create-workspace") {
      showPanel("chooser");
      await runCreateWorkspace();
      return;
    }
    showPanel("chooser");
  }
  function panelSize(mode) {
    switch (mode) {
      case "chooser":
        return { width: 340, height: 260 };
      case "compact":
        return { width: 300, height: 178 };
      case "workspace":
        return { width: 340, height: 320 };
      case "validation":
        return { width: 380, height: 560 };
      default:
        return { width: 380, height: 560 };
    }
  }
  function switchMode(mode) {
    currentMode = mode;
    const size = panelSize(mode);
    currentWidth = size.width;
    figma.ui.resize(size.width, size.height);
    figma.ui.postMessage({ type: "init", mode });
    void sendState();
  }
  function showPanel(mode) {
    currentMode = mode;
    const size = panelSize(mode);
    currentWidth = size.width;
    figma.showUI(__html__, {
      width: size.width,
      height: size.height,
      themeColors: true
    });
    figma.on("selectionchange", () => {
      void sendState();
    });
    figma.ui.onmessage = async (message) => {
      try {
        if (message.type === "ready") {
          figma.ui.postMessage({ type: "init", mode: currentMode });
          await sendState();
          return;
        }
        if (message.type === "choose-mode") {
          if (message.mode === "auto") {
            await runCreateWorkspace();
          } else if (message.mode === "validation") {
            validation = null;
            switchMode("validation");
          } else {
            switchMode("full");
          }
          return;
        }
        if (message.type === "back") {
          switchMode("chooser");
          return;
        }
        if (message.type === "resize") {
          const height = Math.max(120, Math.min(Math.round(message.height), 1200));
          figma.ui.resize(currentWidth, height);
          return;
        }
        if (message.type === "scan") {
          await sendState();
          return;
        }
        if (message.type === "add-placeholders") {
          await addSelectedPlaceholders();
          await sendState();
          return;
        }
        if (message.type === "copy-payload") {
          const json = buildPayloadJson();
          figma.ui.postMessage({ type: "payload", json });
          return;
        }
        if (message.type === "set-file-url") {
          if (workspace) {
            workspace.fileUrl = message.url.trim();
          }
          return;
        }
        if (message.type === "focus") {
          const node = await getExportableNode(message.id);
          figma.currentPage.selection = [node];
          figma.viewport.scrollAndZoomIntoView([node]);
          await sendState();
          return;
        }
        if (message.type === "download") {
          const node = await getTargetNode(message.id);
          const bytes = await exportNode(node, message.scale);
          figma.ui.postMessage({
            type: "download",
            fileName: `${safeFileName(node.name)}@${message.scale}x.png`,
            bytes
          });
          figma.notify(`\u5DF2\u5C06 ${node.name} \u5BFC\u51FA\u4E3A PNG`);
          return;
        }
        if (message.type === "replace") {
          if (message.id) {
            const node = await getTargetNode(message.id);
            const sourceName = node.name;
            const imageNode = await replaceWithPng(node, {
              scale: message.scale,
              keepOriginal: message.keepOriginal
            });
            figma.currentPage.selection = [imageNode];
            figma.viewport.scrollAndZoomIntoView([imageNode]);
            figma.notify(`\u5DF2\u5C06 ${sourceName} \u66FF\u6362\u4E3A PNG \u56FE\u5C42`);
            await sendState();
            figma.ui.postMessage({ type: "status", message: `\u5DF2\u66FF\u6362 ${sourceName}` });
            return;
          }
          await replaceSelectionWithPng({
            scale: message.scale,
            keepOriginal: message.keepOriginal
          });
          await sendState();
          return;
        }
        if (message.type === "replace-copy") {
          await replaceSelectionAsCopy({ scale: message.scale });
          await sendState();
          return;
        }
        if (message.type === "make-components") {
          await makeModuleComponents();
          await sendState();
          return;
        }
        if (message.type === "generate-validation") {
          await generateValidationPackage({ scale: message.scale });
          await sendState();
          return;
        }
        if (message.type === "generate-raw-html") {
          await generateRawHtml();
          await sendState();
          return;
        }
        if (message.type === "generate-html-package") {
          await generateHtmlPackage("download");
          await sendState();
          return;
        }
        if (message.type === "send-html-package") {
          await generateHtmlPackage("web-mvp");
          await sendState();
          return;
        }
        if (message.type === "open-external") {
          if (!/^http:\/\/(?:127\.0\.0\.1|localhost):5174(?:\/|$)/.test(message.url)) {
            throw new Error("Web MVP \u5730\u5740\u4E0D\u5728\u5141\u8BB8\u8303\u56F4\u5185\u3002");
          }
          figma.openExternal(message.url);
          figma.notify("\u5DF2\u53D1\u9001\u6587\u4EF6\u5305\uFF0C\u6B63\u5728\u6253\u5F00 Web MVP\u3002");
          return;
        }
        if (message.type === "generate-raw-validation") {
          await generateRawValidationPackage();
          await sendState();
          return;
        }
        if (message.type === "add-hotspot") {
          addValidationHotspot(message.action, message.to);
          await sendState();
          return;
        }
        if (message.type === "remove-hotspot") {
          if (validation && message.index >= 0 && message.index < validation.hotspots.length) {
            validation.hotspots.splice(message.index, 1);
            postValidationFiles();
          }
          await sendState();
          return;
        }
        if (message.type === "clear-hotspots") {
          if (validation) {
            validation.hotspots = [];
            postValidationFiles();
          }
          await sendState();
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "\u672A\u77E5\u63D2\u4EF6\u9519\u8BEF";
        figma.notify(messageText, { error: true });
        figma.ui.postMessage({ type: "error", message: messageText });
      }
    };
    figma.ui.postMessage({ type: "init", mode });
    void sendState();
  }
  async function replaceSelectionWithPng(options) {
    try {
      await figma.currentPage.loadAsync();
      const targets = getSelectedTargetNodes();
      if (targets.length === 0) {
        const message = "\u8BF7\u5148\u9009\u4E2D\u4E00\u4E2A Frame\u3001\u7EC4\u4EF6\u3001\u5B9E\u4F8B\u3001\u7EC4\u4EF6\u96C6\u6216\u5206\u7EC4\u3002";
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: "status", message, isError: true });
        return;
      }
      const replacements = [];
      const label = targets.length === 1 ? targets[0].name : `${targets.length} \u4E2A\u56FE\u5C42`;
      for (const target of targets) {
        replacements.push(await replaceWithPng(target, {
          scale: options.scale,
          keepOriginal: options.keepOriginal
        }));
      }
      figma.currentPage.selection = replacements;
      figma.viewport.scrollAndZoomIntoView(replacements);
      const action = options.keepOriginal ? "\u5DF2\u9690\u85CF" : "\u5DF2\u5220\u9664";
      figma.notify(`\u5DF2\u5C06 ${label} \u66FF\u6362\u4E3A PNG\uFF1B\u539F\u56FE\u5C42${action}`);
      await sendState();
      figma.ui.postMessage({
        type: "status",
        message: `\u5DF2\u66FF\u6362 ${label}\u3002\u9009\u4E2D\u4E0B\u4E00\u4E2A\u56FE\u5C42\u540E\u70B9\u51FB\u66FF\u6362\u3002`
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "\u672A\u77E5\u63D2\u4EF6\u9519\u8BEF";
      figma.notify(messageText, { error: true });
      figma.ui.postMessage({ type: "status", message: messageText, isError: true });
    }
  }
  function getSelectedTargetNodes() {
    const selectedIds = new Set(figma.currentPage.selection.map((node) => node.id));
    return figma.currentPage.selection.filter(isCandidateNode).filter((node) => !hasSelectedAncestor(node, selectedIds));
  }
  async function replaceSelectionAsCopy(options) {
    try {
      await figma.currentPage.loadAsync();
      const targets = getSelectedTargetNodes();
      if (targets.length === 0) {
        const message = "\u8BF7\u5148\u5728\u6E90 Frame \u4E2D\u9009\u4E2D\u8981\u66FF\u6362\u4E3A PNG \u7684\u6A21\u5757\u3002";
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: "status", message, isError: true });
        return;
      }
      const sourceFrame = getTopLevelFrame(targets[0]);
      if (!sourceFrame || !("clone" in sourceFrame)) {
        const message = "\u9009\u4E2D\u7684\u6A21\u5757\u5FC5\u987B\u4F4D\u4E8E\u4E00\u4E2A\u9876\u5C42 Frame \u5185\u3002";
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: "status", message, isError: true });
        return;
      }
      const outside = targets.filter((node) => getTopLevelFrame(node) !== sourceFrame);
      if (outside.length > 0) {
        const message = "\u6240\u6709\u9009\u4E2D\u7684\u6A21\u5757\u5FC5\u987B\u5728\u540C\u4E00\u4E2A\u9876\u5C42 Frame \u5185\u3002";
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: "status", message, isError: true });
        return;
      }
      const paths = [];
      for (const target of targets) {
        const path = getIndexPath(sourceFrame, target);
        if (path) {
          paths.push(path);
        }
      }
      const clone = sourceFrame.clone();
      clone.name = `${sourceFrame.name} (\u5149\u6805\u5316\u526F\u672C)`;
      let replaced = 0;
      for (const path of paths) {
        const counterpart = resolveByIndexPath(clone, path);
        if (counterpart && isExportableNode(counterpart)) {
          await replaceWithPng(counterpart, { scale: options.scale, keepOriginal: false });
          replaced += 1;
        }
      }
      manualWorkspace = await buildManualWorkspace(sourceFrame, clone);
      lastCopyId = clone.id;
      const workspaceFrame = await figma.getNodeByIdAsync(manualWorkspace.workspaceId);
      if (workspaceFrame && "x" in workspaceFrame) {
        figma.currentPage.selection = [workspaceFrame];
        figma.viewport.scrollAndZoomIntoView([workspaceFrame]);
      }
      figma.notify(`\u5DF2\u751F\u6210\u526F\u672C\uFF1A${replaced} \u4E2A\u6A21\u5757\u66FF\u6362\u4E3A PNG\uFF0C\u526F\u672C\u5DF2\u653E\u5165\u5DE5\u4F5C\u533A\u5DE6\u4FA7\u3002`);
      figma.ui.postMessage({ type: "copy-created" });
      figma.ui.postMessage({
        type: "status",
        message: `\u5DF2\u751F\u6210\u526F\u672C\u5E76\u653E\u5165\u5DE5\u4F5C\u533A\uFF0C${replaced} \u4E2A\u6A21\u5757\u5DF2\u5149\u6805\u5316\u3002`
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "\u672A\u77E5\u63D2\u4EF6\u9519\u8BEF";
      figma.notify(messageText, { error: true });
      figma.ui.postMessage({ type: "status", message: messageText, isError: true });
    }
  }
  function createComponentsContainer(columnWidth, minHeight) {
    const container = figma.createFrame();
    container.name = "\u6A21\u5757\u7EC4\u4EF6";
    container.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    container.layoutMode = "HORIZONTAL";
    container.layoutWrap = "WRAP";
    container.primaryAxisSizingMode = "FIXED";
    container.counterAxisSizingMode = "AUTO";
    container.itemSpacing = 24;
    container.counterAxisSpacing = 24;
    container.paddingTop = 24;
    container.paddingBottom = 24;
    container.paddingLeft = 24;
    container.paddingRight = 24;
    container.resizeWithoutConstraints(columnWidth, container.height);
    if (minHeight !== void 0) {
      container.minHeight = minHeight;
    }
    return container;
  }
  function appendModuleClones(container, targets) {
    let count = 0;
    for (const target of targets) {
      if (!("clone" in target)) {
        continue;
      }
      const copy = target.clone();
      const copyAny = copy;
      if ("layoutAlign" in copyAny) {
        copyAny.layoutAlign = "INHERIT";
      }
      if ("layoutGrow" in copyAny) {
        copyAny.layoutGrow = 0;
      }
      container.appendChild(copy);
      count += 1;
    }
    return count;
  }
  async function buildManualWorkspace(source, clone) {
    await ensureFonts();
    const copyWidth = clone.width;
    const copyHeight = clone.height;
    const columnWidth = Math.max(copyWidth, 320);
    const rightX = WORKSPACE_PAD + copyWidth + WORKSPACE_COLUMN_GAP;
    const leftTitle = createColumnTitle("\u6574\u4F53\u9875\u9762");
    const rightTitle = createColumnTitle("\u6A21\u5757\u7EC4\u4EF6");
    const contentTop = WORKSPACE_PAD + Math.max(leftTitle.height, rightTitle.height) + WORKSPACE_PAD;
    const workspaceFrame = figma.createFrame();
    workspaceFrame.name = "\u524D\u7AEF\u4EA4\u4ED8\u6A21\u5757";
    workspaceFrame.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.96 } }];
    workspaceFrame.clipsContent = false;
    const workspaceWidth = rightX + columnWidth + WORKSPACE_PAD;
    const workspaceHeight = contentTop + Math.max(copyHeight, 200) + WORKSPACE_PAD;
    workspaceFrame.resizeWithoutConstraints(workspaceWidth, workspaceHeight);
    workspaceFrame.x = source.x + source.width + WORKSPACE_COLUMN_GAP;
    workspaceFrame.y = source.y;
    leftTitle.x = WORKSPACE_PAD;
    leftTitle.y = WORKSPACE_PAD;
    workspaceFrame.appendChild(leftTitle);
    rightTitle.x = rightX;
    rightTitle.y = WORKSPACE_PAD;
    workspaceFrame.appendChild(rightTitle);
    workspaceFrame.appendChild(clone);
    clone.x = WORKSPACE_PAD;
    clone.y = contentTop;
    const cloneAny = clone;
    if ("layoutAlign" in cloneAny) {
      cloneAny.layoutAlign = "INHERIT";
    }
    if ("layoutGrow" in cloneAny) {
      cloneAny.layoutGrow = 0;
    }
    const components = createComponentsContainer(columnWidth, copyHeight);
    workspaceFrame.appendChild(components);
    components.x = rightX;
    components.y = contentTop;
    setOptionalPluginData(workspaceFrame, {
      role: "manual-workspace",
      sourceNodeId: source.id,
      sourceNodeName: source.name
    });
    return {
      workspaceId: workspaceFrame.id,
      componentsId: components.id,
      columnWidth,
      contentTop,
      copyHeight
    };
  }
  async function makeModuleComponents() {
    try {
      await figma.currentPage.loadAsync();
      const targets = getSelectedTargetNodes();
      if (targets.length === 0) {
        const message = "\u8BF7\u5148\u9009\u4E2D\u8981\u751F\u6210\u7EC4\u4EF6\u7684\u6A21\u5757\uFF08\u652F\u6301\u591A\u9009\uFF09\u3002";
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: "status", message, isError: true });
        return;
      }
      let container = null;
      let workspaceFrame = null;
      if (manualWorkspace) {
        const node = await figma.getNodeByIdAsync(manualWorkspace.componentsId);
        if (node && node.type === "FRAME") {
          container = node;
          workspaceFrame = await figma.getNodeByIdAsync(manualWorkspace.workspaceId);
        }
      }
      const inWorkspace = container !== null;
      if (!container) {
        const widest = targets.reduce((max, node) => Math.max(max, node.width), 0);
        const columns = Math.min(targets.length, Math.max(1, Math.round(Math.sqrt(targets.length))));
        container = createComponentsContainer(Math.round(widest * columns + 24 * (columns + 1)));
        const anchor = await getComponentsAnchor(targets[0]);
        container.x = anchor.x + 120;
        container.y = anchor.y;
        figma.currentPage.appendChild(container);
      }
      const count = appendModuleClones(container, targets);
      if (inWorkspace && manualWorkspace && workspaceFrame && workspaceFrame.type === "FRAME") {
        const height = manualWorkspace.contentTop + Math.max(manualWorkspace.copyHeight, container.height) + WORKSPACE_PAD;
        workspaceFrame.resizeWithoutConstraints(workspaceFrame.width, height);
      }
      figma.currentPage.selection = [container];
      figma.viewport.scrollAndZoomIntoView([container]);
      figma.notify(`\u5DF2\u6DFB\u52A0 ${count} \u4E2A\u6A21\u5757\u5230\u6A21\u5757\u7EC4\u4EF6\u533A\u3002`);
      figma.ui.postMessage({
        type: "status",
        message: inWorkspace ? `\u5DF2\u8FFD\u52A0 ${count} \u4E2A\u6A21\u5757\u5230\u5DE5\u4F5C\u533A\u53F3\u4FA7\u3002` : `\u5DF2\u751F\u6210\u7EC4\u4EF6\u753B\u5E03\uFF0C${count} \u4E2A\u6A21\u5757\u5DF2\u6392\u5217\u3002`
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "\u672A\u77E5\u63D2\u4EF6\u9519\u8BEF";
      figma.notify(messageText, { error: true });
      figma.ui.postMessage({ type: "status", message: messageText, isError: true });
    }
  }
  function pageContentRightEdge() {
    let maxX = 0;
    let minY = 0;
    let hasAny = false;
    for (const node of figma.currentPage.children) {
      if ("x" in node && "width" in node) {
        const right = node.x + node.width;
        maxX = hasAny ? Math.max(maxX, right) : right;
        minY = hasAny ? Math.min(minY, node.y) : node.y;
        hasAny = true;
      }
    }
    return { x: hasAny ? maxX : 0, y: hasAny ? minY : 0 };
  }
  async function getComponentsAnchor(reference) {
    if (lastCopyId) {
      const latestCopy = await figma.getNodeByIdAsync(lastCopyId);
      if (latestCopy && hasCanvasBounds(latestCopy)) {
        return {
          x: latestCopy.x + latestCopy.width,
          y: latestCopy.y
        };
      }
      lastCopyId = null;
    }
    const sourceFrame = getTopLevelFrame(reference);
    if (sourceFrame && hasCanvasBounds(sourceFrame)) {
      return {
        x: sourceFrame.x + sourceFrame.width,
        y: sourceFrame.y
      };
    }
    return pageContentRightEdge();
  }
  function hasCanvasBounds(node) {
    return "x" in node && "y" in node && "width" in node;
  }
  function getTopLevelFrame(node) {
    let current = node;
    while (current && current.parent && current.parent.type !== "PAGE") {
      current = current.parent;
    }
    if (current && "children" in current && current.parent && current.parent.type === "PAGE") {
      return current;
    }
    return null;
  }
  function getIndexPath(ancestor, node) {
    const chain = [];
    let current = node;
    while (current && current !== ancestor) {
      chain.unshift(current);
      current = current.parent;
    }
    if (current !== ancestor) {
      return null;
    }
    const path = [];
    let parent = ancestor;
    for (const step of chain) {
      if (!("children" in parent)) {
        return null;
      }
      const index = parent.children.indexOf(step);
      if (index < 0) {
        return null;
      }
      path.push(index);
      parent = step;
    }
    return path;
  }
  function resolveByIndexPath(root, path) {
    let current = root;
    for (let i = 0; i < path.length; i += 1) {
      if (!("children" in current) || path[i] >= current.children.length) {
        return null;
      }
      const next = current.children[path[i]];
      if (i === path.length - 1) {
        return next;
      }
      if (!("children" in next)) {
        return null;
      }
      current = next;
    }
    return null;
  }
  async function sendState() {
    await figma.currentPage.loadAsync();
    if (currentMode === "workspace") {
      await sendWorkspaceState();
      return;
    }
    if (currentMode === "validation") {
      sendValidationState();
      return;
    }
    const selection = figma.currentPage.selection.filter(isCandidateNode);
    const selectedTargets = getSelectedTargetNodes();
    const candidates = collectCandidates();
    const selected = selection[0] ? toCandidate(selection[0], 0) : null;
    figma.ui.postMessage({
      type: "state",
      selected,
      selectedCount: selectedTargets.length,
      candidates
    });
  }
  async function sendWorkspaceState() {
    if (!workspace) {
      figma.ui.postMessage({
        type: "workspace-state",
        hasWorkspace: false
      });
      return;
    }
    const selectedPlaceholderIds = getSelectedPlaceholderIds();
    figma.ui.postMessage({
      type: "workspace-state",
      hasWorkspace: true,
      workspaceName: workspace.workspaceName,
      sourceFrameName: workspace.sourceFrameName,
      detectedCount: workspace.placeholders.size,
      selectedPlaceholderCount: selectedPlaceholderIds.length,
      collectedCount: workspace.collected.size,
      fileUrl: workspace.fileUrl
    });
  }
  function getSelectedPlaceholderIds() {
    if (!workspace) {
      return [];
    }
    const ids = [];
    for (const node of figma.currentPage.selection) {
      if (workspace.placeholders.has(node.id)) {
        ids.push(node.id);
      }
    }
    return ids;
  }
  function getSelectedFrames() {
    return figma.currentPage.selection.filter(isCandidateNode);
  }
  function getSelectedRawHtmlTarget() {
    const targets = figma.currentPage.selection.filter(
      (node) => isExportableNode(node) && node.visible && node.width > 0 && node.height > 0
    );
    return targets.length === 1 ? targets[0] : null;
  }
  function getRawHtmlTargetSummary() {
    const target = getSelectedRawHtmlTarget();
    if (!target) {
      return null;
    }
    return {
      id: target.id,
      name: target.name,
      type: target.type,
      width: Math.round(target.width),
      height: Math.round(target.height)
    };
  }
  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }
  function round4(value) {
    return Math.round(value * 1e4) / 1e4;
  }
  function computeHotspotCandidate() {
    if (!validation) {
      return null;
    }
    const selection = figma.currentPage.selection;
    if (selection.length !== 1) {
      return null;
    }
    const node = selection[0];
    if (!("absoluteTransform" in node) || !("width" in node)) {
      return null;
    }
    let ancestor = node.parent;
    let pageInfo = null;
    let pageNode = null;
    while (ancestor && ancestor.type !== "PAGE") {
      const match = validation.pages.find((p) => p.id === ancestor.id);
      if (match && "absoluteTransform" in ancestor && "width" in ancestor) {
        pageInfo = match;
        pageNode = ancestor;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (!pageInfo || !pageNode) {
      return null;
    }
    const pageW = pageNode.width;
    const pageH = pageNode.height;
    if (pageW <= 0 || pageH <= 0) {
      return null;
    }
    const relX = node.absoluteTransform[0][2] - pageNode.absoluteTransform[0][2];
    const relY = node.absoluteTransform[1][2] - pageNode.absoluteTransform[1][2];
    return {
      fromKey: pageKey(pageInfo.index),
      fromName: pageInfo.name,
      nodeName: node.name,
      rect: {
        x: round4(clamp01(relX / pageW)),
        y: round4(clamp01(relY / pageH)),
        width: round4(clamp01(node.width / pageW)),
        height: round4(clamp01(node.height / pageH))
      }
    };
  }
  function sendValidationState() {
    if (!validation) {
      const frames = getSelectedFrames().map((node) => ({
        id: node.id,
        name: node.name,
        width: Math.round(node.width),
        height: Math.round(node.height),
        x: Math.round(node.x),
        y: Math.round(node.y)
      }));
      figma.ui.postMessage({
        type: "validation-state",
        hasPackage: false,
        packageKind: null,
        frames,
        rawTarget: getRawHtmlTargetSummary()
      });
      return;
    }
    const candidate = computeHotspotCandidate();
    figma.ui.postMessage({
      type: "validation-state",
      hasPackage: true,
      packageKind: validation.kind,
      pages: validation.pages.map((p) => ({
        key: pageKey(p.index),
        name: p.name,
        index: p.index
      })),
      hotspots: validation.hotspots,
      candidate,
      rawTarget: getRawHtmlTargetSummary()
    });
  }
  function addValidationHotspot(action, to) {
    if (!validation) {
      figma.notify("\u8BF7\u5148\u751F\u6210\u9A8C\u8BC1\u5305\u3002", { error: true });
      return;
    }
    const candidate = computeHotspotCandidate();
    if (!candidate) {
      figma.notify("\u8BF7\u5728\u67D0\u4E2A\u9875\u9762 Frame \u5185\u9009\u4E2D\u4E00\u4E2A\u5B50\u8282\u70B9\u4F5C\u4E3A\u70ED\u70B9\u533A\u57DF\u3002", { error: true });
      return;
    }
    const needsTarget = action === "navigate" || action === "overlay";
    if (needsTarget && !to) {
      figma.notify("\u8BE5\u52A8\u4F5C\u9700\u8981\u9009\u62E9\u4E00\u4E2A\u76EE\u6807\u9875\u9762\u3002", { error: true });
      return;
    }
    const hotspot = {
      from: candidate.fromKey,
      action,
      rect: candidate.rect
    };
    if (needsTarget) {
      hotspot.to = to;
    }
    if (action === "overlay") {
      hotspot.presentation = "modal";
    }
    validation.hotspots.push(hotspot);
    postValidationFiles();
    const label = needsTarget ? `${candidate.fromKey} \xB7 ${action} \u2192 ${to}` : `${candidate.fromKey} \xB7 ${action}`;
    figma.notify(`\u5DF2\u6DFB\u52A0\u70ED\u70B9\uFF1A${label}`);
  }
  function postValidationFiles() {
    if (!validation) {
      return;
    }
    const rawPages = validation.kind === "raw-html" ? validation.rawPages : null;
    figma.ui.postMessage({
      type: "validation-files",
      packageKind: validation.kind,
      indexHtml: rawPages ? buildRawValidationIndexHtml(rawPages, validation.hotspots) : buildValidationIndexHtml(validation.pages, validation.hotspots),
      stylesCss: rawPages ? buildRawValidationStylesCss() : buildValidationStylesCss(),
      interactionsJson: buildInteractionsJson(validation.pages, validation.hotspots)
    });
  }
  async function generateValidationPackage(options) {
    try {
      await figma.currentPage.loadAsync();
      const frames = getSelectedFrames();
      if (frames.length === 0) {
        const message = "\u8BF7\u5148\u9009\u4E2D\u4E00\u4E2A\u6216\u591A\u4E2A\u9875\u9762 Frame\u3002";
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: "status", message, isError: true });
        return;
      }
      figma.notify("\u6B63\u5728\u5BFC\u51FA\u9875\u9762\u2026");
      const pages = [];
      const images = [];
      let index = 0;
      for (const frame of frames) {
        index += 1;
        const fileName = `page-${index}.png`;
        const bytes = await exportNode(frame, safeImageScale(frame, options.scale));
        images.push({ fileName, bytes });
        pages.push({
          index,
          id: frame.id,
          name: frame.name,
          width: Math.round(frame.width),
          height: Math.round(frame.height),
          fileName
        });
      }
      validation = { kind: "png", pages, hotspots: [] };
      const interactionsJson = buildInteractionsJson(pages, validation.hotspots);
      const indexHtml = buildValidationIndexHtml(pages, validation.hotspots);
      const stylesCss = buildValidationStylesCss();
      figma.ui.postMessage({
        type: "validation-package",
        packageKind: "png",
        pages: pages.map((page, i) => __spreadProps(__spreadValues({}, page), { bytes: images[i].bytes })),
        indexHtml,
        stylesCss,
        interactionsJson
      });
      figma.notify(`\u5DF2\u751F\u6210\u9A8C\u8BC1\u5305\uFF0C\u5171 ${pages.length} \u4E2A\u9875\u9762\u3002`);
      figma.ui.postMessage({
        type: "status",
        message: `\u5DF2\u751F\u6210\u9A8C\u8BC1\u5305\uFF0C\u5171 ${pages.length} \u4E2A\u9875\u9762\u3002`
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "\u672A\u77E5\u63D2\u4EF6\u9519\u8BEF";
      figma.notify(messageText, { error: true });
      figma.ui.postMessage({ type: "status", message: messageText, isError: true });
    }
  }
  async function generateRawValidationPackage() {
    try {
      await figma.currentPage.loadAsync();
      const frames = getSelectedFrames();
      if (frames.length === 0) {
        const message = "\u8BF7\u5148\u9009\u4E2D\u4E00\u4E2A\u6216\u591A\u4E2A\u9875\u9762 / \u5F39\u7A97 Frame\u3002";
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: "status", message, isError: true });
        return;
      }
      figma.notify("\u6B63\u5728\u751F\u6210 Raw HTML \u4EA4\u4E92\u5305\u2026");
      const pages = [];
      let index = 0;
      for (const frame of frames) {
        index += 1;
        pages.push({
          index,
          id: frame.id,
          name: frame.name,
          width: Math.round(frame.width),
          height: Math.round(frame.height),
          fileName: `page-${index}.html`,
          html: await renderRawHtmlRoot(frame, 5)
        });
      }
      validation = { kind: "raw-html", pages, rawPages: pages, hotspots: [] };
      const interactionsJson = buildInteractionsJson(pages, validation.hotspots);
      const indexHtml = buildRawValidationIndexHtml(pages, validation.hotspots);
      const stylesCss = buildRawValidationStylesCss();
      figma.ui.postMessage({
        type: "validation-package",
        packageKind: "raw-html",
        pages,
        indexHtml,
        stylesCss,
        interactionsJson
      });
      figma.notify(`\u5DF2\u751F\u6210 Raw HTML \u4EA4\u4E92\u5305\uFF0C\u5171 ${pages.length} \u4E2A\u9875\u9762\u3002`);
      figma.ui.postMessage({
        type: "status",
        message: `\u5DF2\u751F\u6210 Raw HTML \u4EA4\u4E92\u5305\uFF0C\u5171 ${pages.length} \u4E2A\u9875\u9762\u3002`
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "\u672A\u77E5\u63D2\u4EF6\u9519\u8BEF";
      figma.notify(messageText, { error: true });
      figma.ui.postMessage({ type: "status", message: messageText, isError: true });
    }
  }
  async function generateHtmlPackage(delivery) {
    try {
      await figma.currentPage.loadAsync();
      const frames = getSelectedFrames();
      if (frames.length === 0) {
        const message = "\u8BF7\u5148\u9009\u4E2D\u4E00\u4E2A\u6216\u591A\u4E2A\u9700\u8981\u5BFC\u51FA\u7684\u9875\u9762 Frame\u3002";
        figma.notify(message, { error: true });
        figma.ui.postMessage({ type: "status", message, isError: true });
        return;
      }
      figma.notify(`\u6B63\u5728\u751F\u6210 ${frames.length} \u4E2A HTML \u9875\u9762\u2026`);
      const pages = [];
      const designPages = [];
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];
        const fileName = `page-${String(index + 1).padStart(3, "0")}.html`;
        const previewPath = `previews/page-${String(index + 1).padStart(3, "0")}.png`;
        const previewScale = safeImageScale(frame, 1);
        const previewBytes = await exportNode(frame, previewScale);
        pages.push({
          order: index + 1,
          nodeId: frame.id,
          name: frame.name,
          fileName,
          path: `pages/${fileName}`,
          previewPath,
          previewScale,
          previewBytes,
          width: Math.round(frame.width),
          height: Math.round(frame.height),
          html: await buildRawHtmlDocument(frame)
        });
        designPages.push(await buildDesignJsonPage(frame, index + 1, {
          path: previewPath,
          width: Math.round(frame.width * previewScale),
          height: Math.round(frame.height * previewScale),
          scale: previewScale
        }));
      }
      const manifest = {
        schema: "figma-html-package",
        version: 1,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: {
          figmaPageName: figma.currentPage.name
        },
        pages: pages.map((_a) => {
          var _b = _a, { html: _html, previewBytes: _previewBytes } = _b, page = __objRest(_b, ["html", "previewBytes"]);
          return page;
        })
      };
      const design = {
        schemaVersion: "1.5.7",
        kind: "figma-design-package",
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: { figmaPageName: figma.currentPage.name },
        notes: "\u5C5E\u6027\u6BD4\u8F83\u4F7F\u7528 styles\uFF1B\u6A21\u5757\u5185\u4F4D\u7F6E\u6BD4\u8F83\u4F7F\u7528 box.local\uFF1B\u6587\u672C\u5339\u914D\u4F7F\u7528 text.direct\uFF1B\u5E03\u5C40\u95F4\u8DDD\u53EA\u7ED1\u5B9A structure \u4E2D\u7684\u5C5E\u6027\u6240\u5C5E\u5BB9\u5668\uFF1B\u77E2\u91CF\u56FE\u6807\u989C\u8272\u4F7F\u7528 fill/stroke\uFF1B\u5C40\u90E8\u5BF9\u6BD4\u56FE\u4F7F\u7528 preview.path \u4E0E\u8282\u70B9 box.local \u88C1\u526A\u3002",
        pages: designPages
      };
      figma.ui.postMessage({
        type: "html-package",
        delivery,
        fileName: "figma-html-package.zip",
        manifestJson: JSON.stringify(manifest, null, 2),
        designJson: JSON.stringify(design, null, 2),
        pages: pages.map((page) => ({
          path: page.path,
          html: page.html,
          previewPath: page.previewPath,
          previewBytes: page.previewBytes
        }))
      });
      figma.notify(`\u5DF2\u751F\u6210 HTML \u6587\u4EF6\u5305\uFF0C\u5171 ${pages.length} \u4E2A\u9875\u9762\u3002`);
      figma.ui.postMessage({
        type: "status",
        message: `\u5DF2\u5BFC\u51FA ${pages.length} \u4E2A HTML \u9875\u9762\u5E76\u7EC4\u6210\u6587\u4EF6\u5305\u3002`
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "\u672A\u77E5\u63D2\u4EF6\u9519\u8BEF";
      figma.notify(messageText, { error: true });
      figma.ui.postMessage({ type: "status", message: messageText, isError: true });
    }
  }
  async function buildDesignJsonPage(root, order, preview) {
    const elements = [];
    const rootOrigin = getNodeCanvasOrigin(root);
    async function visit(node, parentId, depth, context) {
      if (!isRenderableRawNode(node)) return;
      const children = getRenderableRawChildren(node);
      const isText = node.type === "TEXT";
      const imageFormat = getRawImageFormat(node, children.length, context);
      const gradientBackground = imageFormat === null ? await getRawGradientBackground(node) : null;
      const styleText = buildRawStyle(node, context, {
        hasChildren: children.length > 0 && imageFormat === null,
        isText,
        isImage: imageFormat !== null,
        isEllipse: node.type === "ELLIPSE",
        gradientBackground
      });
      const origin = getNodeCanvasOrigin(node);
      const descendantText = collectDesignText(node);
      const componentName = await getRawComponentName(node);
      const styles = cssDeclarationsToObject(styleText);
      addComparableLayoutStyles(styles, node);
      addComparableIconStyles(styles, node);
      addComparableStrokeStyles(styles, node);
      const visibleBounds = imageFormat ? getRawVisibleBounds(node) : null;
      const localBox = visibleBounds ? {
        x: roundDesignNumber(visibleBounds.x - rootOrigin.x),
        y: roundDesignNumber(visibleBounds.y - rootOrigin.y),
        width: roundDesignNumber(visibleBounds.width),
        height: roundDesignNumber(visibleBounds.height)
      } : {
        x: roundDesignNumber(origin.x - rootOrigin.x),
        y: roundDesignNumber(origin.y - rootOrigin.y),
        width: roundDesignNumber(node.width),
        height: roundDesignNumber(node.height)
      };
      if (visibleBounds) {
        styles.width = cssPx(visibleBounds.width);
        styles.height = cssPx(visibleBounds.height);
      }
      const entry = {
        id: node.id,
        parentId,
        depth,
        childIndex: context.siblingIndex,
        type: node.type,
        name: node.name || "",
        role: inferDesignRole(node),
        componentName,
        text: {
          direct: isText ? normalizeDesignText(node.characters) : "",
          descendant: normalizeDesignText(descendantText),
          runs: isText ? getRawTextRuns(node) : []
        },
        box: {
          local: localBox,
          rotation: rawNumber(node, "rotation") || 0,
          node: {
            x: roundDesignNumber(origin.x - rootOrigin.x),
            y: roundDesignNumber(origin.y - rootOrigin.y),
            width: roundDesignNumber(node.width),
            height: roundDesignNumber(node.height)
          }
        },
        styles
      };
      if (isText) {
        const textPaint = getRawTextPaintEvidence(node, entry.box.node);
        if (textPaint) entry.geometry = { coordinateSpace: "selection-local-css-px", textPaint };
      }
      if (imageFormat) entry.asset = { type: imageFormat === "SVG" ? "vector" : "image", format: imageFormat };
      elements.push(entry);
      const layoutMode = rawString(node, "layoutMode") || "NONE";
      const itemSpacing = getRawEffectiveItemSpacing(node);
      for (let index = 0; index < children.length; index += 1) {
        await visit(children[index], node.id, depth + 1, {
          root: false,
          parentLayoutMode: layoutMode,
          parentItemSpacing: itemSpacing,
          siblingIndex: index
        });
      }
    }
    await visit(root, null, 0, { root: true, parentLayoutMode: "NONE", parentItemSpacing: null, siblingIndex: 0 });
    const structure = buildDesignStructure(elements, root.id);
    return {
      order,
      nodeId: root.id,
      name: root.name,
      width: roundDesignNumber(root.width),
      height: roundDesignNumber(root.height),
      rootId: root.id,
      preview,
      elements,
      structure
    };
  }
  function buildDesignStructure(elements, rootId) {
    const byId = new Map(elements.map((node) => [node.id, node]));
    const children = new Map(elements.map((node) => [node.id, []]));
    for (const node of elements) {
      if (node.parentId && children.has(node.parentId)) children.get(node.parentId).push(node);
    }
    const roles = /* @__PURE__ */ new Map();
    const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    const compact = (value) => normalize(value).replace(/[，。！？：；、,.!?:;\-—_()（）\[\]【】{}]/g, "").replace(/\s+/g, "").toLowerCase();
    const numericStyle = (value) => {
      const parsed = parseFloat(value || "");
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const descendants = (node) => {
      const output = [];
      const queue = [...children.get(node.id) || []];
      while (queue.length && output.length < 240) {
        const current = queue.shift();
        output.push(current);
        queue.push(...children.get(current.id) || []);
      }
      return output;
    };
    const direction = (node) => {
      const display = String(node.styles.display || "").toLowerCase();
      if (!/flex|grid/.test(display)) return "none";
      if (/grid/.test(display)) return "grid";
      return String(node.styles["flex-direction"] || "row").toLowerCase().startsWith("column") ? "vertical" : "horizontal";
    };
    const baseRole = (node) => {
      var _a;
      if (node.id === rootId) return "root";
      const source = [node.type, node.name, node.componentName, node.role].filter(Boolean).join(" ").toLowerCase();
      const corpus = `${source} ${String(node.text.descendant || "").toLowerCase()}`;
      if (/head[ _-]?cell|表头单元格/.test(source)) return "head-cell";
      if (/^(表头|table[ _-]?head)$/.test(source.trim())) return "table-head";
      if (/^(表格|table)$/.test(source.trim())) return "table";
      if (/单元行|数据行|data[ _-]?row|table[ _-]?row|body.*(?:single|row)|(?:single|row).*body/.test(source)) return "data-row-template";
      if (/pagination|pager|分页/.test(source) || /条\/页|跳转至/.test(corpus) && corpus.length < 180) return "pagination";
      if (/(?:^|[.\s_-])(?:ai[\s_-]?module|ai模块)(?:[.\s_-]|$)|^(?:卡片|card)$/i.test([node.name, node.componentName].filter(Boolean).join(" ").trim())) return "card";
      if (/btn|button|按钮|操作/.test(source) && node.text.descendant.length <= 40) return "button";
      if (/select|dropdown|下拉/.test(source)) return "select";
      if (/input|输入框/.test(source)) return "input";
      if (/calendar|date|time|日期|时间/.test(source) && node.type !== "TEXT") return "date-input";
      const exactFilterName = /^(filter|筛选器)$/i.test(String(node.name || "").trim()) || /^(filter|筛选器)$/i.test(String(node.componentName || "").trim());
      const filterComponent = ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(node.type) && /filter/.test(String(node.componentName || "").toLowerCase()) && !/button/.test(source);
      if (exactFilterName || filterComponent) return "filter-control";
      if (node.type === "TEXT") return /cardh|title|heading|标题/.test(source) ? "title" : "text";
      if (["VECTOR", "BOOLEAN_OPERATION", "LINE", "POLYGON", "STAR"].includes(node.type)) return "icon";
      if (((_a = node.asset) == null ? void 0 : _a.type) === "image" || node.type === "RECTANGLE" && Boolean(node.asset)) return "image";
      return "container";
    };
    for (const node of elements) roles.set(node.id, baseRole(node));
    for (const node of elements) {
      const parentRole = node.parentId ? roles.get(node.parentId) : null;
      if (parentRole === "table-head" && roles.get(node.id) === "container") roles.set(node.id, "head-cell");
      if (parentRole === "data-row-template" && ["container", "filter-control"].includes(roles.get(node.id) || "")) roles.set(node.id, "data-cell");
    }
    for (const node of elements) {
      if (roles.get(node.id) !== "container") continue;
      const nodeDirection = direction(node);
      const childNodes = descendants(node);
      const anchors = childNodes.map((item) => compact(item.text.direct)).filter(Boolean);
      const hasAction = anchors.some((value) => /(查询|筛选|搜索|重置|search|filter|reset)/.test(value));
      const childRoles = childNodes.map((item) => roles.get(item.id));
      const fieldCount = childRoles.filter((role) => ["filter-control", "date-input", "input", "select", "textarea"].includes(role || "")).length;
      const actionCount = childRoles.filter((role) => ["button", "link"].includes(role || "")).length;
      if (nodeDirection === "horizontal" && hasAction && fieldCount >= 1 && (fieldCount >= 2 || actionCount >= 1)) roles.set(node.id, "filter-row");
      else if (nodeDirection === "horizontal" && childNodes.some((item) => roles.get(item.id) === "title") && anchors.length <= 2) roles.set(node.id, "title-region");
    }
    const anchorList = (node) => {
      const output = [];
      for (const item of [node, ...descendants(node)]) {
        const value = normalize(item.text.direct);
        const normalized = compact(value);
        if (!normalized || normalized.length > 32 || /^\d{5,}$/.test(normalized) || output.some((entry) => entry.compact === normalized)) continue;
        output.push({ value, compact: normalized });
        if (output.length >= 16) break;
      }
      return output.map((entry) => entry.value);
    };
    const keep = /* @__PURE__ */ new Set();
    for (const node of elements) {
      const role = roles.get(node.id) || "container";
      const nodeChildren = children.get(node.id) || [];
      const nonzeroPadding = ["padding-top", "padding-right", "padding-bottom", "padding-left"].some((property) => Math.abs(numericStyle(node.styles[property])) > 0.01);
      const ownGap = Math.max(Math.abs(numericStyle(node.styles["row-gap"])), Math.abs(numericStyle(node.styles["column-gap"])));
      const meaningfulLayout = direction(node) !== "none" && (nodeChildren.length >= 2 || nonzeroPadding) && (ownGap > 0 || nonzeroPadding || role !== "container");
      if (node.id === rootId || role !== "container" || meaningfulLayout) keep.add(node.id);
    }
    const nearestKeptParent = (node) => {
      let parent = node.parentId ? byId.get(node.parentId) : null;
      while (parent && !keep.has(parent.id)) parent = parent.parentId ? byId.get(parent.parentId) : null;
      return (parent == null ? void 0 : parent.id) || null;
    };
    const structureNodes = elements.filter((node) => keep.has(node.id)).map((node) => {
      const parent = nearestKeptParent(node);
      const controlSequence = descendants(node).map((item) => roles.get(item.id) || "").filter((role) => ["filter-control", "date-input", "input", "select", "textarea", "button", "link"].includes(role)).slice(0, 16);
      return {
        id: `s:${node.id}`,
        sourceId: node.id,
        parentId: parent ? `s:${parent}` : null,
        role: roles.get(node.id) || "container",
        direction: direction(node),
        anchors: anchorList(node),
        controls: controlSequence,
        ownSpacing: {
          padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"].map((property) => node.styles[property] || "0px"),
          rowGap: node.styles["row-gap"] || "0px",
          columnGap: node.styles["column-gap"] || "0px"
        }
      };
    });
    return { schemaVersion: "1.0.0", rootId: `s:${rootId}`, nodes: structureNodes };
  }
  function getNodeCanvasOrigin(node) {
    const transform = node.absoluteTransform;
    return transform ? { x: transform[0][2], y: transform[1][2] } : { x: rawNumber(node, "x") || 0, y: rawNumber(node, "y") || 0 };
  }
  function getRawLocalPosition(node) {
    const child = node.absoluteTransform;
    const parent = node.parent && node.parent.absoluteTransform;
    if (child && parent) {
      const a = parent[0][0], b = parent[0][1], c = parent[1][0], d = parent[1][1];
      const determinant = a * d - b * c;
      if (Number.isFinite(determinant) && Math.abs(determinant) > 1e-8) {
        const dx = child[0][2] - parent[0][2];
        const dy = child[1][2] - parent[1][2];
        return { x: (d * dx - b * dy) / determinant, y: (-c * dx + a * dy) / determinant };
      }
    }
    return { x: rawNumber(node, "x") || 0, y: rawNumber(node, "y") || 0 };
  }
  function isRenderableRawNode(node) {
    return node.visible && node.width > 0 && (node.type === "LINE" || node.height > 0);
  }
  function getRawVisibleBounds(node) {
    const renderBounds = "absoluteRenderBounds" in node ? node.absoluteRenderBounds : null;
    if (renderBounds && renderBounds.width > 0 && renderBounds.height > 0) return renderBounds;
    const boundingBox = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null;
    if (boundingBox && boundingBox.width > 0 && boundingBox.height > 0) return boundingBox;
    const origin = getNodeCanvasOrigin(node);
    const strokeWeight = rawNumber(node, "strokeWeight") || 1;
    return {
      x: origin.x,
      y: origin.y - (node.type === "LINE" ? strokeWeight / 2 : 0),
      width: node.width,
      height: node.type === "LINE" ? strokeWeight : node.height
    };
  }
  function getRawLayoutBounds(node) {
    const bounds = node.absoluteBoundingBox;
    if (bounds && bounds.width > 0 && bounds.height > 0) return bounds;
    const transform = node.absoluteTransform;
    if (!transform) {
      return { x: rawNumber(node, "x") || 0, y: rawNumber(node, "y") || 0, width: node.width, height: node.height };
    }
    const corners = [[0, 0], [node.width, 0], [0, node.height], [node.width, node.height]].map(([x, y]) => ({
      x: transform[0][0] * x + transform[0][1] * y + transform[0][2],
      y: transform[1][0] * x + transform[1][1] * y + transform[1][2]
    }));
    const left = Math.min(...corners.map((point) => point.x));
    const top = Math.min(...corners.map((point) => point.y));
    return {
      x: left,
      y: top,
      width: Math.max(...corners.map((point) => point.x)) - left,
      height: Math.max(...corners.map((point) => point.y)) - top
    };
  }
  function getRawBoundsInParentSpace(node, bounds) {
    const parent = node.parent && node.parent.absoluteTransform;
    if (!parent) return bounds;
    const a = parent[0][0], b = parent[0][1], c = parent[1][0], d = parent[1][1];
    const determinant = a * d - b * c;
    const axisAligned = (Math.abs(b) < 1e-8 && Math.abs(c) < 1e-8) ||
      (Math.abs(a) < 1e-8 && Math.abs(d) < 1e-8);
    if (!axisAligned || !Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null;
    const corners = [
      [bounds.x, bounds.y],
      [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height],
      [bounds.x + bounds.width, bounds.y + bounds.height]
    ].map(([x, y]) => {
      const dx = x - parent[0][2], dy = y - parent[1][2];
      return { x: (d * dx - b * dy) / determinant, y: (-c * dx + a * dy) / determinant };
    });
    const left = Math.min(...corners.map((point) => point.x));
    const top = Math.min(...corners.map((point) => point.y));
    return {
      x: left,
      y: top,
      width: Math.max(...corners.map((point) => point.x)) - left,
      height: Math.max(...corners.map((point) => point.y)) - top
    };
  }
  function getRawImageOffset(node, bounds) {
    const origin = getNodeCanvasOrigin(node);
    const fallback = { x: bounds.x - origin.x, y: bounds.y - origin.y };
    if (!node.parent || !node.parent.absoluteTransform) return fallback;
    const localBounds = getRawBoundsInParentSpace(node, bounds);
    if (!localBounds) return fallback;
    const local = getRawLocalPosition(node);
    return {
      x: localBounds.x - local.x,
      y: localBounds.y - local.y
    };
  }
  function getRawExportImageOffset(node, bounds, context) {
    const inAutoLayout = !context.root && context.parentLayoutMode !== "NONE" &&
      rawString(node, "layoutPositioning") !== "ABSOLUTE";
    if (inAutoLayout) {
      const layout = getRawBoundsInParentSpace(node, getRawLayoutBounds(node));
      const render = getRawBoundsInParentSpace(node, bounds);
      if (layout && render) {
        // Flex places the wrapper at the node's layout bounds, whereas the
        // transform translation may sit on the opposite edge of a flipped
        // node. Compare bounds in the same parent coordinate space. Center a
        // rotated bounding box inside its unrotated Figma layout slot.
        return {
          x: (node.width - layout.width) / 2 + render.x - layout.x,
          y: (node.height - layout.height) / 2 + render.y - layout.y
        };
      }
    }
    return getRawImageOffset(node, bounds);
  }
  function cssDeclarationsToObject(value) {
    const output = {};
    for (const declaration of value.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator <= 0) continue;
      output[declaration.slice(0, separator)] = declaration.slice(separator + 1);
    }
    return output;
  }
  function addComparableLayoutStyles(styles, node) {
    const padding = getRawPadding(node);
    const layoutMode = rawString(node, "layoutMode") || "NONE";
    const hasPadding2 = padding.top !== 0 || padding.right !== 0 || padding.bottom !== 0 || padding.left !== 0;
    if (!hasPadding2 && layoutMode === "NONE") return;
    styles["padding-top"] = cssPx(padding.top);
    styles["padding-right"] = cssPx(padding.right);
    styles["padding-bottom"] = cssPx(padding.bottom);
    styles["padding-left"] = cssPx(padding.left);
    const itemSpacing = getRawEffectiveItemSpacing(node);
    if (layoutMode !== "NONE" && itemSpacing !== null && itemSpacing >= 0) {
      const gap = cssPx(itemSpacing);
      styles.gap = gap;
      styles[layoutMode === "HORIZONTAL" ? "column-gap" : "row-gap"] = gap;
    }
  }
  function addComparableIconStyles(styles, node) {
    if (inferDesignRole(node) !== "icon") return;
    const fill = getFirstVisibleSolidPaint(rawPaints(node, "fills"));
    if (fill) styles.fill = paintToRgba(fill);
    const stroke = getFirstVisibleSolidPaint(rawPaints(node, "strokes"));
    if (stroke) styles.stroke = paintToRgba(stroke);
    const strokeWeight = rawNumber(node, "strokeWeight");
    if (stroke && strokeWeight !== null) styles["stroke-width"] = cssPx(strokeWeight);
  }
  function addComparableStrokeStyles(styles, node) {
    const stroke = getFirstVisibleSolidPaint(rawPaints(node, "strokes"));
    const sides = getRawIndividualStrokeWeights(node);
    if (!stroke || !sides) return;
    const color = paintToRgba(stroke);
    for (const side of ["top", "right", "bottom", "left"]) {
      styles[`border-${side}-width`] = cssPx(sides[side]);
      if (sides[side] > 0) {
        styles[`border-${side}-style`] = "solid";
        styles[`border-${side}-color`] = color;
      }
    }
  }
  function collectDesignText(node) {
    if (node.type === "TEXT") return node.characters;
    return getRenderableRawChildren(node).map(collectDesignText).filter(Boolean).join(" ");
  }
  function getRawTextRuns(node) {
    try {
      return node.getStyledTextSegments(["fontName", "fontWeight", "fontStyle", "fontSize", "lineHeight", "letterSpacing"]).map((segment) => ({
        start: segment.start,
        end: segment.end,
        fontFamily: segment.fontName.family,
        fontStyle: segment.fontStyle || segment.fontName.style,
        fontWeight: typeof segment.fontWeight === "number" ? segment.fontWeight : fontWeightFromStyle(segment.fontName.style),
        fontSize: segment.fontSize,
        lineHeight: segment.lineHeight,
        letterSpacing: segment.letterSpacing
      }));
    } catch (e) {
      return [];
    }
  }
  function normalizeDesignText(value) {
    return value.replace(/\s+/g, " ").trim().slice(0, 300);
  }
  function inferDesignRole(node) {
    if (node.type === "TEXT") return "text";
    if (node.type === "ELLIPSE") return "shape";
    if (["VECTOR", "BOOLEAN_OPERATION", "LINE", "POLYGON", "STAR"].includes(node.type)) return "icon";
    if (node.type === "INSTANCE" || node.type === "COMPONENT") return "component";
    return null;
  }
  function roundDesignNumber(value) {
    return Math.round(value * 100) / 100;
  }
  async function generateRawHtml() {
    await figma.currentPage.loadAsync();
    const target = getSelectedRawHtmlTarget();
    if (!target) {
      const message = "\u8BF7\u53EA\u9009\u4E2D\u4E00\u4E2A\u9700\u8981\u8F6C\u6210 Raw HTML \u7684\u8282\u70B9\u3002";
      figma.notify(message, { error: true });
      figma.ui.postMessage({ type: "error", message });
      return;
    }
    figma.notify("\u6B63\u5728\u751F\u6210 Raw HTML\u2026");
    const html = await buildRawHtmlDocument(target);
    const fileName = `${safeFileName(target.name)}-raw.html`;
    figma.ui.postMessage({
      type: "raw-html",
      fileName,
      html
    });
    figma.notify(`\u5DF2\u751F\u6210 Raw HTML\uFF1A${target.name}`);
  }
  async function renderRawHtmlRoot(node, depth = 2) {
    return renderRawHtmlNode(
      node,
      {
        root: true,
        parentLayoutMode: "NONE",
        parentItemSpacing: null,
        siblingIndex: 0
      },
      depth
    );
  }
  async function buildRawHtmlDocument(node) {
    const body = await renderRawHtmlRoot(node);
    const title = escapeXml(node.name || "Raw HTML");
    const width = cssPx(node.width);
    const height = cssPx(node.height);
    const designWidth = formatCssNumber(node.width);
    const designHeight = formatCssNumber(node.height);
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      html {
        margin: 0;
        width: 100%;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        width: 100%;
        min-width: 0;
        min-height: 100vh;
        overflow-x: hidden;
        background: #fff;
        font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif;
      }
      .raw-stage-frame {
        position: relative;
        overflow: hidden;
        margin: 0 auto;
        background: #fff;
      }
      .raw-stage {
        position: relative;
        width: ${width};
        height: ${height};
        transform-origin: top left;
      }
      img {
        display: block;
      }
      [data-raw-text-fit].raw-text-fit-active > .raw-text-html {
        visibility: hidden;
      }
      [data-raw-text-fit].raw-text-fit-active > .raw-text-fit-svg {
        display: block !important;
      }
      [data-raw-text-fit="truncation"].raw-text-fit-active {
        text-overflow: clip !important;
      }
    </style>
  </head>
  <body>
    <div class="raw-stage-frame" id="rawStageFrame">
      <div class="raw-stage" id="rawStage">
${body}
      </div>
    </div>
    <script>
      (function () {
        var DESIGN_W = ${designWidth};
        var DESIGN_H = ${designHeight};
        var stage = document.getElementById("rawStage");
        var frame = document.getElementById("rawStageFrame");
        function applyScale() {
          var viewportW = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
          var fillViewport = DESIGN_W >= 960;
          var k = fillViewport ? viewportW / DESIGN_W : Math.min((viewportW - 32) / DESIGN_W, 1);
          if (!(k > 0)) { k = 1; }
          stage.style.transform = "scale(" + k + ")";
          frame.style.width = DESIGN_W * k + "px";
          frame.style.height = DESIGN_H * k + "px";
        }
        window.addEventListener("resize", applyScale);
        applyScale();
        function applyTextFitFallbacks() {
          var nodes = document.querySelectorAll("[data-raw-text-fit]");
          for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var text = node.querySelector(":scope > .raw-text-html");
            if (!text) continue;
            node.classList.remove("raw-text-fit-active");
            // For Figma's hug-sized single-line text, the box width is its
            // measured advance. Both rectangles include the page scale, so
            // compare either direction of font metric drift after fonts load.
            var textWidth = text.getBoundingClientRect().width;
            var boxWidth = node.getBoundingClientRect().width;
            var scale = node.offsetWidth > 0 ? boxWidth / node.offsetWidth : 1;
            var nearTruncationEdge = node.getAttribute("data-raw-text-fit") === "truncation" &&
              textWidth >= boxWidth - Math.max(0.2, scale);
            var hugMetricsDiffer = node.getAttribute("data-raw-text-fit") === "hug" &&
              Math.abs(textWidth - boxWidth) > Math.max(0.2, scale * 0.75);
            if (nearTruncationEdge || hugMetricsDiffer) {
              node.classList.add("raw-text-fit-active");
            }
          }
        }
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(applyTextFitFallbacks);
          document.fonts.addEventListener("loadingdone", applyTextFitFallbacks);
        } else {
          window.addEventListener("load", applyTextFitFallbacks);
        }
      })();
    <\/script>
  </body>
</html>
`;
  }
  async function renderRawHtmlNode(node, context, depth = 2) {
    if (!isRenderableRawNode(node)) {
      return "";
    }
    const children = getRenderableRawChildren(node);
    const isText = node.type === "TEXT";
    const listType = isText ? getRawListType(node) : null;
    const exactPunctuation = isText && shouldOutlineRawTextForSpacing(node, context);
    const isEllipse = node.type === "ELLIPSE";
    const imageFormat = getRawImageFormat(node, children.length, context, listType);
    const isImage = imageFormat !== null;
    const gradientBackground = !isImage ? await getRawGradientBackground(node) : null;
    const style = buildRawStyle(node, context, {
      hasChildren: children.length > 0 && !isImage,
      isText,
      isImage,
      isEllipse,
      gradientBackground
    });
    const attrs = await buildRawAttrs(node, isText);
    const pad = "  ".repeat(depth);
    if (isImage && imageFormat) {
      let asset = await exportRawNodeDataUri(node, imageFormat, Boolean(listType || exactPunctuation));
      if (!asset && (listType || exactPunctuation)) asset = await exportRawNodeDataUri(node, "PNG");
      if (asset) {
        const bounds = getRawVisibleBounds(node);
        const width = imageFormat === "SVG" && asset.width ? asset.width : bounds.width;
        const height = imageFormat === "SVG" && asset.height ? asset.height : bounds.height;
        const imageOffset = getRawExportImageOffset(node, bounds, context);
        const imageStyle = [
          "position:absolute",
          `left:${cssPx(imageOffset.x)}`,
          `top:${cssPx(imageOffset.y)}`,
          `width:${cssPx(width)}`,
          `height:${cssPx(height)}`,
          "max-width:none",
          "max-height:none"
        ].join(";");
        const alt = isText ? ` alt="${escapeXml(node.characters.trim())}"` : "";
        return `${pad}<div ${attrs} style="${escapeXml(style)}"><img style="${escapeXml(imageStyle)}" src="${asset.src}"${alt} /></div>`;
      }
    }
    if (listType === "UNORDERED" && isText && !node.characters.trim()) {
      const marker = renderRawUnorderedMarker(node);
      if (marker) return `${pad}<div ${attrs} style="${escapeXml(style)}">${marker}</div>`;
    }
    if (isText && node.type === "TEXT") {
      const content = buildRawTextContent(node);
      const textFitMode = getRawTextFitFallbackMode(node, context);
      if (textFitMode) {
        const asset = await exportRawNodeDataUri(node, "SVG", true);
        if (asset) {
          const bounds = getRawVisibleBounds(node);
          const width = asset.width || bounds.width;
          const height = asset.height || bounds.height;
          const imageOffset = getRawExportImageOffset(node, bounds, context);
          const imageStyle = [
            "display:none",
            "position:absolute",
            `left:${cssPx(imageOffset.x)}`,
            `top:${cssPx(imageOffset.y)}`,
            `width:${cssPx(width)}`,
            `height:${cssPx(height)}`,
            "max-width:none",
            "max-height:none"
          ].join(";");
          return `${pad}<div ${attrs} data-raw-text-fit="${textFitMode}" style="${escapeXml(style)}"><span class="raw-text-html">${content}</span><img class="raw-text-fit-svg" aria-hidden="true" style="${escapeXml(imageStyle)}" src="${asset.src}" /></div>`;
        }
      }
      return `${pad}<div ${attrs} style="${escapeXml(style)}">${content}</div>`;
    }
    if (children.length === 0) {
      return `${pad}<div ${attrs} style="${escapeXml(style)}"></div>`;
    }
    const nodeLayoutMode = rawString(node, "layoutMode") || "NONE";
    const itemSpacing = getRawEffectiveItemSpacing(node);
    const childHtml = (await Promise.all(
      children.map(
        (child, index) => renderRawHtmlNode(
          child,
          {
            root: false,
            parentLayoutMode: nodeLayoutMode,
            parentItemSpacing: itemSpacing,
            siblingIndex: index
          },
          depth + 1
        )
      )
    )).filter(Boolean).join("\n");
    return `${pad}<div ${attrs} style="${escapeXml(style)}">
${childHtml}
${pad}</div>`;
  }
  async function buildRawAttrs(node, isText) {
    const attrs = [`data-node-id="${escapeXml(node.id)}"`];
    const characters = isText && node.type === "TEXT" ? node.characters : "";
    if (node.name && node.name !== characters) {
      attrs.push(`data-name="${escapeXml(node.name)}"`);
    }
    const componentName = await getRawComponentName(node);
    if (componentName) {
      attrs.push(`data-component-name="${escapeXml(componentName)}"`);
    }
    return attrs.join(" ");
  }
  async function getRawComponentName(node) {
    if (node.type !== "INSTANCE" || !("getMainComponentAsync" in node)) {
      return null;
    }
    try {
      const mainComponent = await node.getMainComponentAsync();
      return (mainComponent == null ? void 0 : mainComponent.name) || null;
    } catch (e) {
      return null;
    }
  }
  function getRenderableRawChildren(node) {
    if (!("children" in node)) {
      return [];
    }
    const children = node.children;
    return children.filter(
      (child) => isExportableNode(child) && isRenderableRawNode(child)
    );
  }
  function buildRawStyle(node, context, options) {
    const decls = [];
    const layoutMode = rawString(node, "layoutMode") || "NONE";
    const layoutPositioning = rawString(node, "layoutPositioning");
    const isAbsolute = context.root || context.parentLayoutMode === "NONE" || layoutPositioning === "ABSOLUTE";
    const padding = getRawPadding(node);
    const hasPadding2 = padding.top !== 0 || padding.right !== 0 || padding.bottom !== 0 || padding.left !== 0;
    const width = Math.max(0, node.width);
    const height = Math.max(0, node.height);
    decls.push(`position:${isAbsolute ? "absolute" : "relative"}`);
    if (context.root) {
      decls.push("left:0px", "top:0px");
    } else if (isAbsolute) {
      const local = getRawLocalPosition(node);
      decls.push(`left:${cssPx(local.x)}`, `top:${cssPx(local.y)}`);
    } else if (context.parentItemSpacing !== null && context.parentItemSpacing < 0 && context.siblingIndex > 0) {
      if (context.parentLayoutMode === "HORIZONTAL") {
        decls.push(`margin-left:${cssPx(context.parentItemSpacing)}`);
      } else {
        decls.push(`margin-top:${cssPx(context.parentItemSpacing)}`);
      }
    }
    if (!isAbsolute && rawString(node, "layoutAlign") === "STRETCH") {
      decls.push("align-self:stretch");
    }
    if (!options.isImage && options.hasChildren && layoutMode !== "NONE") {
      decls.push("display:flex");
      decls.push(`flex-direction:${layoutMode === "HORIZONTAL" ? "row" : "column"}`);
      decls.push(`justify-content:${mapRawMainAxis(rawString(node, "primaryAxisAlignItems"))}`);
      decls.push(`align-items:${mapRawCounterAxis(rawString(node, "counterAxisAlignItems"))}`);
      const itemSpacing = getRawEffectiveItemSpacing(node);
      if (itemSpacing !== null && itemSpacing > 0) {
        decls.push(`${layoutMode === "HORIZONTAL" ? "column-gap" : "row-gap"}:${cssPx(itemSpacing)}`);
      }
    }
    if (hasPadding2) {
      decls.push(`padding:${cssPadding(padding)}`);
    }
    decls.push(`width:${cssPx(width)}`);
    decls.push(`height:${cssPx(height)}`);
    const layoutGrow = rawNumber(node, "layoutGrow");
    if (!isAbsolute && layoutGrow !== null && layoutGrow > 0) {
      decls.push(`flex-grow:${formatCssNumber(layoutGrow)}`);
    } else if (!context.root && !isAbsolute) {
      decls.push("flex-shrink:0");
    }
    const fill = getFirstVisibleSolidPaint(rawPaints(node, "fills"));
    if (options.isText) {
      addRawTextStyle(decls, node, fill);
    } else if (fill && !options.isImage) {
      decls.push(`background:${paintToRgba(fill)}`);
    }
    if (options.gradientBackground && !options.isImage) {
      decls.push(`${options.gradientBackground.property}:${options.gradientBackground.value}`);
    }
    const radius = rawBorderRadius(node, options.isEllipse);
    if (radius) {
      decls.push(`border-radius:${radius}`);
    }
    const stroke = getFirstVisibleSolidPaint(rawPaints(node, "strokes"));
    const strokeWeight = rawNumber(node, "strokeWeight");
    const individualStrokes = stroke && !options.isImage ? getRawIndividualStrokeWeights(node) : null;
    const strokeColor = stroke ? paintToRgba(stroke) : null;
    const strokeIncludedInLayout = stroke && !options.isImage && layoutMode !== "NONE" && rawBoolean(node, "strokesIncludedInLayout") && rawString(node, "strokeAlign") === "INSIDE";
    if (strokeIncludedInLayout) {
      const sides = individualStrokes || (strokeWeight !== null && strokeWeight > 0 ? {
        top: strokeWeight, right: strokeWeight, bottom: strokeWeight, left: strokeWeight
      } : null);
      if (sides) {
        for (const side of ["top", "right", "bottom", "left"]) {
          if (sides[side] > 0) decls.push(`border-${side}:${cssPx(sides[side])} solid ${strokeColor}`);
        }
      }
    } else if (stroke && strokeWeight !== null && strokeWeight > 0 && !options.isImage && !individualStrokes) {
      decls.push(`outline:${cssPx(strokeWeight)} solid ${strokeColor}`);
      decls.push(`outline-offset:${cssPx(-strokeWeight)}`);
    }
    const opacity = rawNumber(node, "opacity");
    if (opacity !== null && opacity >= 0 && opacity < 1) {
      decls.push(`opacity:${formatCssNumber(opacity)}`);
    }
    const strokeShadows = individualStrokes && !strokeIncludedInLayout ? rawIndividualStrokeShadows(individualStrokes, strokeColor, rawString(node, "strokeAlign") || "INSIDE") : [];
    const effectShadows = rawBoxShadow(node);
    if (strokeShadows.length || effectShadows) {
      decls.push(`box-shadow:${[...strokeShadows, effectShadows].filter(Boolean).join(",")}`);
    }
    if (rawBoolean(node, "clipsContent")) {
      decls.push("overflow:hidden");
    }
    return decls.join(";");
  }
  function addRawTextStyle(decls, node, fill) {
    const text = node;
    if (fill) {
      decls.push(`color:${paintToRgba(fill)}`);
    }
    const fontName = text.fontName;
    if (fontName !== figma.mixed) {
      decls.push(`font-family:${rawFontFamily(fontName.family)}`);
      const weight = typeof text.fontWeight === "number" ? text.fontWeight : fontWeightFromStyle(fontName.style);
      decls.push(`font-weight:${weight}`);
      if (isRawItalicStyle(fontName.style)) decls.push("font-style:italic");
    }
    if (text.fontSize !== figma.mixed) {
      decls.push(`font-size:${cssPx(text.fontSize)}`);
    }
    if (text.lineHeight !== figma.mixed) {
      const lineHeight = cssLineHeight(text.lineHeight);
      if (lineHeight) {
        decls.push(`line-height:${lineHeight}`);
      }
    }
    if (text.letterSpacing !== figma.mixed) {
      const letterSpacing = cssLetterSpacing(text.letterSpacing);
      if (letterSpacing) {
        decls.push(`letter-spacing:${letterSpacing}`);
      }
    }
    const align = mapRawTextAlign(text.textAlignHorizontal);
    if (align) {
      decls.push(`text-align:${align}`);
    }
    const paragraphIndent = rawNumber(text, "paragraphIndent");
    if (paragraphIndent !== null && paragraphIndent !== 0 && !text.characters.includes("\n")) {
      decls.push(`text-indent:${cssPx(paragraphIndent)}`);
    }
    const truncationLines = getRawTruncationLines(text);
    if (truncationLines === 1) {
      decls.push("min-width:0", "overflow:hidden", "text-overflow:ellipsis", "white-space:nowrap");
    } else if (truncationLines > 1) {
      decls.push("min-width:0", "display:-webkit-box", "-webkit-box-orient:vertical", `-webkit-line-clamp:${truncationLines}`, "overflow:hidden", "white-space:normal", "overflow-wrap:break-word");
    } else if (text.textAutoResize === "WIDTH_AND_HEIGHT" && !text.characters.includes("\n")) {
      decls.push("white-space:nowrap");
    } else {
      decls.push("white-space:pre-wrap", "overflow-wrap:break-word");
    }
  }
  function getRawTruncationLines(text) {
    if (rawString(text, "textTruncation") !== "ENDING" && rawString(text, "textAutoResize") !== "TRUNCATE") return null;
    const maxLines = rawNumber(text, "maxLines");
    if (maxLines !== null && maxLines >= 1) return Math.floor(maxLines);
    if (text.textAutoResize !== "NONE" && text.textAutoResize !== "TRUNCATE") return null;
    const lineHeight = text.lineHeight;
    const fontSize = rawNumber(text, "fontSize");
    const linePixels = lineHeight && lineHeight.unit === "PIXELS" ? lineHeight.value :
      lineHeight && lineHeight.unit === "PERCENT" && fontSize !== null ? fontSize * lineHeight.value / 100 : null;
    return linePixels && linePixels > 0 ? Math.max(1, Math.floor((text.height + 0.5) / linePixels)) : 1;
  }
  function buildRawTextContent(text) {
    const properties = [
      "fontName",
      "fontWeight",
      "fontStyle",
      "fontSize",
      "fills",
      "lineHeight",
      "letterSpacing",
      "textCase",
      "textDecoration"
    ];
    try {
      const segments = text.getStyledTextSegments(properties);
      if (segments.length <= 1) {
        return escapeRawText(text.characters);
      }
      return segments.map((segment) => {
        const style = buildRawTextSegmentStyle(segment);
        const content = escapeRawText(segment.characters);
        return style ? `<span style="${escapeXml(style)}">${content}</span>` : content;
      }).join("");
    } catch (e) {
      return escapeRawText(text.characters);
    }
  }
  function escapeRawText(value) {
    return escapeXml(value).replace(/\n/g, "<br />");
  }
  function buildRawTextSegmentStyle(segment) {
    const decls = [];
    const fill = getFirstVisibleSolidPaint(Array.from(segment.fills || []));
    if (fill) {
      decls.push(`color:${paintToRgba(fill)}`);
    }
    decls.push(`font-family:${rawFontFamily(segment.fontName.family)}`);
    const weight = typeof segment.fontWeight === "number" ? segment.fontWeight : fontWeightFromStyle(segment.fontName.style);
    decls.push(`font-weight:${weight}`);
    if (isRawItalicStyle(segment.fontStyle || segment.fontName.style)) decls.push("font-style:italic");
    decls.push(`font-size:${cssPx(segment.fontSize)}`);
    const lineHeight = cssLineHeight(segment.lineHeight);
    if (lineHeight) {
      decls.push(`line-height:${lineHeight}`);
    }
    const letterSpacing = cssLetterSpacing(segment.letterSpacing);
    if (letterSpacing) {
      decls.push(`letter-spacing:${letterSpacing}`);
    }
    const textTransform = mapRawTextCase(segment.textCase);
    if (textTransform) {
      decls.push(`text-transform:${textTransform}`);
    }
    const textDecoration = mapRawTextDecoration(segment.textDecoration);
    if (textDecoration) {
      decls.push(`text-decoration:${textDecoration}`);
    }
    return decls.join(";");
  }
  function mapRawTextCase(value) {
    if (value === "UPPER") return "uppercase";
    if (value === "LOWER") return "lowercase";
    if (value === "TITLE") return "capitalize";
    return null;
  }
  function mapRawTextDecoration(value) {
    if (value === "UNDERLINE") return "underline";
    if (value === "STRIKETHROUGH") return "line-through";
    return null;
  }
  async function getRawGradientBackground(node) {
    const gradients = rawPaints(node, "fills").filter((paint) =>
      paint.visible !== false && (paint.opacity === void 0 || paint.opacity > 0) &&
      typeof paint.type === "string" && paint.type.startsWith("GRADIENT_"));
    if (!gradients.length) return null;
    if (typeof node.getCSSAsync === "function") {
      try {
        const css = await node.getCSSAsync();
        for (const [property, value] of [
          ["background", css.background],
          ["background-image", css["background-image"] || css.backgroundImage]
        ]) {
          if (typeof value === "string" && /(?:linear|radial|conic)-gradient\(/i.test(value)) {
            return { property, value: value.trim().replace(/;$/, "") };
          }
        }
      } catch (e) {
        // Keep a CSS fallback for files where Figma cannot provide inspect CSS.
      }
    }
    const linear = gradients.find((paint) => paint.type === "GRADIENT_LINEAR");
    const fallback = linear && rawLinearGradient(linear, node.width, node.height);
    return fallback ? { property: "background-image", value: fallback } : null;
  }
  function getRawTextPaintEvidence(node, layoutBox) {
    const paints = rawPaints(node, "fills").filter((paint) => paint.visible !== false &&
      (paint.opacity === void 0 || paint.opacity > 0));
    if (!paints.some((paint) => String(paint.type).startsWith("GRADIENT_"))) return null;
    const base = { source: "figma-gradient-fill", clip: "text", box: { ...layoutBox } };
    if (paints.length !== 1) return { ...base, kind: "unsupported-gradient", status: "unresolved", reason: "multiple-text-paints" };
    const paint = paints[0];
    const coordinates = rawGradientCoordinates(paint);
    const stops = (paint.gradientStops || []).map((stop) => {
      const color = stop.color;
      const alpha = (typeof color.a === "number" ? color.a : 1) * (typeof paint.opacity === "number" ? paint.opacity : 1);
      return { offset: stop.position,
        color: `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${formatCssNumber(alpha)})` };
    });
    const supported = paint.type === "GRADIENT_LINEAR" && coordinates && stops.length >= 2 &&
      (!paint.blendMode || paint.blendMode === "NORMAL") && !(rawNumber(node, "rotation") || 0);
    return { ...base, kind: paint.type === "GRADIENT_LINEAR" ? "linear-gradient" : "unsupported-gradient",
      paintType: paint.type, stops, ...(coordinates || {}), status: supported ? "captured" : "unresolved",
      ...(!supported ? { reason: "unsupported-gradient-paint-or-transform" } : {}) };
  }
  function rawGradientCoordinates(paint) {
    // Plugin API gives a normalized node -> gradient transform. Retain it so
    // interpolation also handles skew; inverse points are useful to CSS export.
    const matrix = paint.gradientTransform;
    if (Array.isArray(matrix) && matrix.length === 2 && matrix.every((row) => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))) {
      const [[a, c, e], [b, d, f]] = matrix;
      const determinant = a * d - b * c;
      if (Math.abs(determinant) > 1e-8) {
        const inverse = (x, y) => ({ x: (d * (x - e) - c * (y - f)) / determinant,
          y: (-b * (x - e) + a * (y - f)) / determinant });
        return { from: inverse(0, .5), to: inverse(1, .5),
          gradientTransform: matrix.map((row) => [...row]), transformSpace: "node-normalized-to-gradient" };
      }
    }
    const handles = paint.gradientHandlePositions;
    if (Array.isArray(handles) && handles.length >= 2 && handles.slice(0, 2).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
      return { from: { x: handles[0].x, y: handles[0].y }, to: { x: handles[1].x, y: handles[1].y } };
    }
    return null;
  }
  function rawLinearGradient(paint, width, height) {
    const handles = paint.gradientHandlePositions;
    const stops = paint.gradientStops;
    if (!handles || handles.length < 2 || !stops || !stops.length || !(width > 0) || !(height > 0)) return null;
    const start = { x: handles[0].x * width, y: handles[0].y * height };
    const end = { x: handles[1].x * width, y: handles[1].y * height };
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-8)) return null;
    const ux = dx / length, uy = dy / length;
    const projections = [0, ux * width, uy * height, ux * width + uy * height];
    const first = Math.min(...projections), last = Math.max(...projections);
    const startProjection = ux * start.x + uy * start.y;
    const angle = ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360;
    const colorStops = stops.map((stop) => {
      const color = stop.color;
      const opacity = (typeof color.a === "number" ? color.a : 1) * (typeof paint.opacity === "number" ? paint.opacity : 1);
      const rgba = `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${formatCssNumber(opacity)})`;
      const position = (startProjection + stop.position * length - first) / (last - first) * 100;
      return `${rgba} ${formatCssNumber(position)}%`;
    });
    return `linear-gradient(${formatCssNumber(angle)}deg,${colorStops.join(",")})`;
  }
  function getRawImageFormat(node, childCount, context, listType = getRawListType(node)) {
    if (node.type === "TEXT" && (listType || shouldOutlineRawTextForSpacing(node, context))) {
      return "SVG";
    }
    if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION" || node.type === "LINE" || node.type === "POLYGON" || node.type === "STAR") {
      return "SVG";
    }
    if (node.type === "INSTANCE" && node.width <= 48 && node.height <= 48 && !hasRawTextDescendant(node)) {
      return "SVG";
    }
    const fills = rawPaints(node, "fills");
    const hasNonSolidFill = fills.some((paint) => paint.visible !== false && paint.type !== "SOLID");
    // Image/video fills on containers otherwise disappear: CSS currently paints
    // only solid fills. Export the composed node so its overlay children stay
    // in the same rendered image as the media behind them.
    const hasMediaFill = fills.some((paint) => paint.visible !== false && (paint.type === "IMAGE" || paint.type === "VIDEO"));
    if (childCount > 0 && hasMediaFill) {
      return "PNG";
    }
    if (childCount === 0 && hasNonSolidFill) {
      return "PNG";
    }
    return null;
  }
  function getRawTextFitFallbackMode(node, context) {
    if (node.type !== "TEXT" || !node.characters || node.characters.includes("\n")) return null;
    if (getRawTruncationLines(node) === 1) return "truncation";
    if (context.parentLayoutMode === "HORIZONTAL" &&
        rawString(node, "textAutoResize") === "WIDTH_AND_HEIGHT") return "hug";
    return null;
  }
  function shouldOutlineRawTextForSpacing(node, context) {
    return node.type === "TEXT" &&
      context.parentLayoutMode === "HORIZONTAL" &&
      context.parentItemSpacing !== null && context.parentItemSpacing < 0 &&
      /^[\u3001-\u303F\uFF01-\uFF65\s]+$/.test(node.characters);
  }
  function getRawListType(node) {
    if (node.type !== "TEXT" || !node.characters) return null;
    try {
      const segments = node.getStyledTextSegments(["listOptions"]);
      const segment = segments.find((part) => part.listOptions && part.listOptions.type !== "NONE");
      if (segment) return segment.listOptions.type;
    } catch (e) {
      // Older documents can reject a range query; the plain-text path remains available.
    }
    try {
      const options = node.getRangeListOptions(0, node.characters.length);
      return options && options !== figma.mixed && options.type !== "NONE" ? options.type : null;
    } catch (e) {
      return null;
    }
  }
  function renderRawUnorderedMarker(node) {
    const fill = getFirstVisibleSolidPaint(rawPaints(node, "fills"));
    const bounds = getRawVisibleBounds(node);
    if (!fill || !(bounds.width > 0) || !(bounds.height > 0)) return null;
    const origin = getNodeCanvasOrigin(node);
    const style = [
      "position:absolute",
      `left:${cssPx(bounds.x - origin.x)}`,
      `top:${cssPx(bounds.y - origin.y)}`,
      `width:${cssPx(bounds.width)}`,
      `height:${cssPx(bounds.height)}`,
      "border-radius:50%",
      `background:${paintToRgba(fill)}`
    ].join(";");
    return `<span aria-hidden="true" style="${escapeXml(style)}"></span>`;
  }
  function hasRawTextDescendant(node) {
    if (node.type === "TEXT") {
      return true;
    }
    if (!("children" in node)) {
      return false;
    }
    return node.children.some(
      (child) => isExportableNode(child) && hasRawTextDescendant(child)
    );
  }
  async function exportRawNodeDataUri(node, format, requireVisibleGeometry = false) {
    try {
      const bytes = await node.exportAsync(format === "SVG" && node.type === "TEXT" ?
        { format, svgOutlineText: true } : { format });
      if (format === "SVG" && requireVisibleGeometry && !rawSvgHasDrawableGeometry(bytes)) return null;
      const mime = format === "SVG" ? "image/svg+xml" : "image/png";
      const metrics = format === "SVG" ? readRawSvgMetrics(bytes) : null;
      return {
        src: `data:${mime};base64,${bytesToBase64(bytes)}`,
        width: metrics == null ? void 0 : metrics.width,
        height: metrics == null ? void 0 : metrics.height
      };
    } catch (e) {
      return null;
    }
  }
  function rawSvgHasDrawableGeometry(bytes) {
    let source = "";
    const chunkSize = 32768;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      source += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return /<(?:path|circle|ellipse|rect|polygon|polyline|line|text|use)\b/i.test(source);
  }
  function readRawSvgMetrics(bytes) {
    const header = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 1024)));
    const root = header.match(/<svg\b[^>]*>/i);
    if (!root) return null;
    const viewBox = root[0].match(/\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
    if (viewBox) {
      const width = Number(viewBox[1]);
      const height = Number(viewBox[2]);
      if (width > 0 && height > 0) return { width, height };
    }
    const width = root[0].match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i);
    const height = root[0].match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i);
    if (width && height && Number(width[1]) > 0 && Number(height[1]) > 0) {
      return { width: Number(width[1]), height: Number(height[1]) };
    }
    return null;
  }
  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 32768;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = Array.from(bytes.subarray(i, i + chunkSize));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }
  function getRawPadding(node) {
    return {
      top: rawNumber(node, "paddingTop") || 0,
      right: rawNumber(node, "paddingRight") || 0,
      bottom: rawNumber(node, "paddingBottom") || 0,
      left: rawNumber(node, "paddingLeft") || 0
    };
  }
  function cssPadding(padding) {
    if (padding.top === padding.right && padding.top === padding.bottom && padding.top === padding.left) {
      return cssPx(padding.top);
    }
    if (padding.top === padding.bottom && padding.right === padding.left) {
      return `${cssPx(padding.top)} ${cssPx(padding.right)}`;
    }
    return `${cssPx(padding.top)} ${cssPx(padding.right)} ${cssPx(padding.bottom)} ${cssPx(padding.left)}`;
  }
  function rawBorderRadius(node, isEllipse) {
    if (isEllipse) {
      return "50%";
    }
    const radius = rawNumber(node, "cornerRadius");
    if (radius !== null) {
      return cssPx(radius);
    }
    const tl = rawNumber(node, "topLeftRadius");
    const tr = rawNumber(node, "topRightRadius");
    const br = rawNumber(node, "bottomRightRadius");
    const bl = rawNumber(node, "bottomLeftRadius");
    if (tl === null && tr === null && br === null && bl === null) {
      return null;
    }
    return `${cssPx(tl || 0)} ${cssPx(tr || 0)} ${cssPx(br || 0)} ${cssPx(bl || 0)}`;
  }
  function rawBoxShadow(node) {
    const effects = node.effects;
    if (!Array.isArray(effects)) {
      return null;
    }
    const shadows = effects.filter((effect) => {
      return (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") && effect.visible !== false && effect.color.a > 0;
    }).map((effect) => {
      const inset = effect.type === "INNER_SHADOW" ? "inset " : "";
      return `${inset}${cssPx(effect.offset.x)} ${cssPx(effect.offset.y)} ${cssPx(effect.radius)} ${cssPx(effect.spread || 0)} ${rgbaFromColor(effect.color)}`;
    });
    return shadows.length ? shadows.join(",") : null;
  }
  function getRawIndividualStrokeWeights(node) {
    if (rawNumber(node, "strokeWeight") !== null) return null;
    const top = rawNumber(node, "strokeTopWeight");
    const right = rawNumber(node, "strokeRightWeight");
    const bottom = rawNumber(node, "strokeBottomWeight");
    const left = rawNumber(node, "strokeLeftWeight");
    if (top === null || right === null || bottom === null || left === null) return null;
    if (top <= 0 && right <= 0 && bottom <= 0 && left <= 0) return null;
    return { top, right, bottom, left };
  }
  function rawIndividualStrokeShadows(sides, color, align) {
    const shadows = [];
    const offsets = {
      top: [0, 1],
      right: [-1, 0],
      bottom: [0, -1],
      left: [1, 0]
    };
    for (const side of ["top", "right", "bottom", "left"]) {
      const weight = sides[side];
      if (!(weight > 0)) continue;
      const [dx, dy] = offsets[side];
      const insideWeight = align === "OUTSIDE" ? 0 : align === "CENTER" ? weight / 2 : weight;
      const outsideWeight = align === "INSIDE" ? 0 : align === "CENTER" ? weight / 2 : weight;
      if (insideWeight > 0) shadows.push(`inset ${cssPx(dx * insideWeight)} ${cssPx(dy * insideWeight)} 0px 0px ${color}`);
      if (outsideWeight > 0) shadows.push(`${cssPx(-dx * outsideWeight)} ${cssPx(-dy * outsideWeight)} 0px 0px ${color}`);
    }
    return shadows;
  }
  function rawPaints(node, key) {
    const value = node[key];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.slice();
  }
  function getFirstVisibleSolidPaint(paints) {
    for (const paint of paints) {
      if (paint.type === "SOLID" && paint.visible !== false && (paint.opacity === void 0 || paint.opacity > 0)) {
        return paint;
      }
    }
    return null;
  }
  function paintToRgba(paint) {
    const opacity = paint.opacity === void 0 ? 1 : paint.opacity;
    return `rgba(${Math.round(paint.color.r * 255)},${Math.round(paint.color.g * 255)},${Math.round(paint.color.b * 255)},${formatCssNumber(opacity)})`;
  }
  function rgbaFromColor(color) {
    return `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${formatCssNumber(color.a)})`;
  }
  function mapRawMainAxis(value) {
    if (value === "CENTER") return "center";
    if (value === "MAX") return "flex-end";
    if (value === "SPACE_BETWEEN") return "space-between";
    if (value === "SPACE_EVENLY") return "space-evenly";
    if (value === "SPACE_AROUND") return "space-around";
    return "flex-start";
  }
  function getRawEffectiveItemSpacing(node) {
    const align = rawString(node, "primaryAxisAlignItems");
    if (align === "SPACE_BETWEEN" || align === "SPACE_EVENLY" || align === "SPACE_AROUND") return null;
    return rawNumber(node, "itemSpacing");
  }
  function mapRawCounterAxis(value) {
    if (value === "CENTER") return "center";
    if (value === "MAX") return "flex-end";
    if (value === "BASELINE") return "baseline";
    return "flex-start";
  }
  function mapRawTextAlign(value) {
    if (value === "CENTER") return "center";
    if (value === "RIGHT") return "right";
    if (value === "JUSTIFIED") return "justify";
    return null;
  }
  function cssLineHeight(lineHeight) {
    if (lineHeight.unit === "PIXELS") {
      return cssPx(lineHeight.value);
    }
    if (lineHeight.unit === "PERCENT") {
      return `${formatCssNumber(lineHeight.value)}%`;
    }
    return null;
  }
  function cssLetterSpacing(letterSpacing) {
    if (letterSpacing.value === 0) {
      return null;
    }
    if (letterSpacing.unit === "PIXELS") {
      return cssPx(letterSpacing.value);
    }
    if (letterSpacing.unit === "PERCENT") {
      // CSS letter-spacing accepts lengths, not percentages. Figma's percent
      // tracking is relative to each run's font size, which 1em also follows.
      return `${formatCssNumber(letterSpacing.value / 100)}em`;
    }
    return null;
  }
  function fontWeightFromStyle(style) {
    const normalized = style.toLowerCase();
    if (normalized.includes("thin")) return "100";
    if (normalized.includes("ultra light") || normalized.includes("ultralight")) return "200";
    if (normalized.includes("extra light") || normalized.includes("extralight")) return "200";
    if (normalized.includes("light")) return "300";
    if (normalized.includes("medium")) return "500";
    if (normalized.includes("semi bold") || normalized.includes("semibold")) return "600";
    if (normalized.includes("extra bold") || normalized.includes("extrabold") || normalized.includes("ultra bold") || normalized.includes("ultrabold")) return "800";
    if (normalized.includes("bold")) return "700";
    if (normalized.includes("heavy") || normalized.includes("black")) return "900";
    return "400";
  }
  function rawFontFamily(family) {
    const namedFamily = `'${escapeCssString(family)}'`;
    if (/^SF Pro(?: Text| Display)?$/i.test(family)) {
      return `${namedFamily},-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
    }
    return `${namedFamily},sans-serif`;
  }
  function isRawItalicStyle(style) {
    return /italic|oblique/i.test(style || "");
  }
  function rawNumber(node, key) {
    const value = node[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function rawString(node, key) {
    const value = node[key];
    return typeof value === "string" ? value : null;
  }
  function rawBoolean(node, key) {
    const value = node[key];
    return value === true;
  }
  function cssPx(value) {
    return `${formatCssNumber(value)}px`;
  }
  function formatCssNumber(value) {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  }
  function escapeCssString(value) {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }
  function pageKey(index) {
    return `page-${index}`;
  }
  function buildInteractionsJson(pages, hotspots) {
    let interactions;
    if (hotspots.length > 0) {
      interactions = hotspots.map((h) => {
        let action;
        if (h.action === "navigate") {
          action = { type: "navigate", to: h.to };
        } else if (h.action === "overlay") {
          action = { type: "overlay", to: h.to, presentation: h.presentation || "modal" };
        } else if (h.action === "closeOverlay") {
          action = { type: "closeOverlay" };
        } else {
          action = { type: "back" };
        }
        return {
          from: h.from,
          trigger: {
            type: "tap",
            target: "region",
            rect: {
              x: h.rect.x,
              y: h.rect.y,
              width: h.rect.width,
              height: h.rect.height
            },
            unit: "ratio"
          },
          action,
          transition: "fade"
        };
      });
    } else {
      interactions = [];
      for (let i = 0; i < pages.length - 1; i += 1) {
        interactions.push({
          from: pageKey(pages[i].index),
          trigger: { type: "tap", target: "page" },
          action: { type: "navigate", to: pageKey(pages[i + 1].index) },
          transition: "fade"
        });
      }
    }
    const payload = {
      pages: pages.map((page) => {
        const item = {
          id: page.id,
          name: page.name,
          width: page.width,
          height: page.height
        };
        if (page.fileName.endsWith(".png")) {
          item.image = `assets/${page.fileName}`;
        } else {
          item.render = "inline-html";
        }
        return item;
      }),
      interactions
    };
    return JSON.stringify(payload, null, 2);
  }
  function buildValidationIndexHtml(pages, hotspots) {
    const layers = pages.map((page, i) => {
      const key = pageKey(page.index);
      const spots = hotspots.filter((h) => h.from === key).map((h) => {
        const to = h.to ? ` data-to="${h.to}"` : "";
        const pres = h.presentation ? ` data-presentation="${h.presentation}"` : "";
        return `          <a class="hotspot" data-action="${h.action}"${to}${pres} style="left:${h.rect.x * 100}%;top:${h.rect.y * 100}%;width:${h.rect.width * 100}%;height:${h.rect.height * 100}%"></a>`;
      }).join("\n");
      return `        <div class="page${i === 0 ? " shown" : ""}" data-key="${key}" data-w="${page.width}" data-h="${page.height}" style="width:${page.width}px;height:${page.height}px">
          <img class="page-img" src="assets/${page.fileName}" alt="${escapeXml(page.name)}" width="${page.width}" height="${page.height}" />
${spots}
        </div>`;
    }).join("\n");
    const stageW = Math.max.apply(null, pages.map((p) => p.width).concat([1]));
    const stageH = Math.max.apply(null, pages.map((p) => p.height).concat([1]));
    const isMobile = stageW <= 480;
    const dataJson = buildInteractionsJson(pages, hotspots).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>\u9A8C\u8BC1\u5305\u9884\u89C8</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body class="${isMobile ? "mobile " : ""}mode-viewport">
    <div class="toolbar">
      <button id="viewportBtn" class="active">\u771F\u5B9E\u89C6\u53E3</button>
      <button id="fitBtn">\u5B8C\u6574\u9884\u89C8</button>
      <button id="actualBtn">\u539F\u59CB\u5C3A\u5BF8</button>
    </div>
    <div class="stage-wrap" id="stageWrap">
      <div class="stage-frame" id="stageFrame">
        <div class="stage" id="stage" style="width:${stageW}px;height:${stageH}px">
          <div class="overlay-mask" id="overlay-mask"></div>
${layers}
        </div>
      </div>
    </div>

    <script id="interactions-data" type="application/json">${dataJson}<\/script>
    <script>
      (function () {
        var STAGE_W = ${stageW};
        var STAGE_H = ${stageH};
        var data = JSON.parse(document.getElementById("interactions-data").textContent);
        // Whole-page navigation map (only for "page"-target navigate interactions;
        // used by the no-hotspot linear fallback).
        var pageNav = {};
        (data.interactions || []).forEach(function (it) {
          if (it.trigger && it.trigger.target === "page" && it.action && it.action.type === "navigate") {
            pageNav[it.from] = it.action.to;
          }
        });

        var stage = document.getElementById("stage");
        var stageFrame = document.getElementById("stageFrame");
        var mask = document.getElementById("overlay-mask");
        var pageEls = {};
        var pageDims = {};
        var firstKey = null;
        Array.prototype.slice.call(stage.querySelectorAll(".page")).forEach(function (el) {
          var key = el.getAttribute("data-key");
          pageEls[key] = el;
          pageDims[key] = {
            w: Number(el.getAttribute("data-w")) || STAGE_W,
            h: Number(el.getAttribute("data-h")) || STAGE_H
          };
          if (firstKey === null) { firstKey = key; }
        });

        var base = firstKey;      // current base page
        var overlays = [];        // stack of overlay page keys (topmost last)
        var history = [];         // base pages visited via navigate

        function render() {
          var top = overlays.length ? overlays[overlays.length - 1] : base;
          Object.keys(pageEls).forEach(function (key) {
            var el = pageEls[key];
            var overlayIdx = overlays.indexOf(key);
            var shown = key === base || overlayIdx !== -1;
            el.classList.toggle("shown", shown);
            if (shown) {
              el.style.zIndex = String(overlayIdx !== -1 ? 10 + overlayIdx : 1);
              el.style.pointerEvents = key === top ? "auto" : "none";
            } else {
              el.style.zIndex = "";
              el.style.pointerEvents = "none";
            }
          });
          if (mask) {
            mask.classList.toggle("shown", overlays.length > 0);
          }
          applyScale();
        }

        function run(action, to) {
          var prevBase = base;
          if (action === "navigate" && to) {
            history.push(base);
            overlays = [];
            base = to;
          } else if (action === "overlay" && to) {
            overlays.push(to);
          } else if (action === "closeOverlay") {
            overlays.pop();
          } else if (action === "back") {
            if (history.length) {
              overlays = [];
              base = history.pop();
            }
          }
          render();
          if (base !== prevBase) {
            window.scrollTo(0, 0);
          }
        }

        // ----- Viewport fit modes -----
        // "viewport": page width fills the browser (no <=1 clamp), height flows
        //             and the window scrolls \u2014 like a real page.
        // "fit":      whole current stage scaled to fit one screen (<=1x).
        // "actual":   1x, scrollable.
        var mode = "viewport";
        function applyScale() {
          var dims = pageDims[base] || { w: STAGE_W, h: STAGE_H };
          var pad = 32;
          var k;
          var stageW;
          var stageH;
          if (mode === "viewport") {
            // Stage tracks the CURRENT page's real size; width fills the window.
            stageW = dims.w;
            stageH = dims.h;
            k = window.innerWidth / dims.w; // fill width, may exceed 1x
          } else if (mode === "fit") {
            // Full overview: use the largest page so every page fits, scaled <=1x.
            stageW = STAGE_W;
            stageH = STAGE_H;
            k = Math.min((window.innerWidth - pad) / STAGE_W, (window.innerHeight - pad) / STAGE_H, 1);
          } else {
            // Actual size: current page at 1x.
            stageW = dims.w;
            stageH = dims.h;
            k = 1;
          }
          if (!(k > 0)) { k = 1; }
          // Size the stage to the chosen page so no extra area is left below a
          // shorter page, then scale it and match the frame's layout box.
          stage.style.width = stageW + "px";
          stage.style.height = stageH + "px";
          stage.style.transform = "scale(" + k + ")";
          stageFrame.style.width = (stageW * k) + "px";
          stageFrame.style.height = (stageH * k) + "px";
        }

        var viewportBtn = document.getElementById("viewportBtn");
        var fitBtn = document.getElementById("fitBtn");
        var actualBtn = document.getElementById("actualBtn");
        var modeBtns = { viewport: viewportBtn, fit: fitBtn, actual: actualBtn };
        function setMode(m) {
          mode = m;
          ["viewport", "fit", "actual"].forEach(function (x) {
            document.body.classList.toggle("mode-" + x, x === m);
            if (modeBtns[x]) { modeBtns[x].classList.toggle("active", x === m); }
          });
          applyScale();
        }
        viewportBtn.addEventListener("click", function () { setMode("viewport"); });
        fitBtn.addEventListener("click", function () { setMode("fit"); });
        actualBtn.addEventListener("click", function () { setMode("actual"); });
        window.addEventListener("resize", applyScale);

        // Region hotspots. stopPropagation so the whole-page fallback below
        // does not also fire.
        Array.prototype.slice.call(stage.querySelectorAll(".hotspot")).forEach(function (spot) {
          spot.addEventListener("click", function (event) {
            event.stopPropagation();
            run(spot.getAttribute("data-action"), spot.getAttribute("data-to"));
          });
        });

        // Whole-page tap fallback (used when no hotspots were defined). Ignored
        // while an overlay is open.
        stage.addEventListener("click", function () {
          if (overlays.length) { return; }
          var to = pageNav[base];
          if (to) {
            history.push(base);
            base = to;
            render();
          }
        });

        render();
        applyScale();
      })();
    <\/script>
  </body>
</html>
`;
  }
  function buildRawValidationIndexHtml(pages, hotspots) {
    const layers = pages.map((page, i) => {
      const key = pageKey(page.index);
      const spots = hotspots.filter((h) => h.from === key).map((h) => {
        const to = h.to ? ` data-to="${h.to}"` : "";
        const pres = h.presentation ? ` data-presentation="${h.presentation}"` : "";
        return `          <a class="hotspot" data-action="${h.action}"${to}${pres} style="left:${h.rect.x * 100}%;top:${h.rect.y * 100}%;width:${h.rect.width * 100}%;height:${h.rect.height * 100}%"></a>`;
      }).join("\n");
      return `        <div class="page raw-page${i === 0 ? " shown" : ""}" data-key="${key}" data-w="${page.width}" data-h="${page.height}" style="width:${page.width}px;height:${page.height}px">
          <div class="page-content">
${page.html}
          </div>
${spots}
        </div>`;
    }).join("\n");
    const stageW = Math.max.apply(null, pages.map((p) => p.width).concat([1]));
    const stageH = Math.max.apply(null, pages.map((p) => p.height).concat([1]));
    const isMobile = stageW <= 480;
    const dataJson = buildInteractionsJson(pages, hotspots).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Raw HTML \u4EA4\u4E92\u9A8C\u8BC1\u5305</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body class="${isMobile ? "mobile " : ""}mode-viewport">
    <div class="toolbar">
      <button id="viewportBtn" class="active">\u771F\u5B9E\u89C6\u53E3</button>
      <button id="fitBtn">\u5B8C\u6574\u9884\u89C8</button>
      <button id="actualBtn">\u539F\u59CB\u5C3A\u5BF8</button>
    </div>
    <div class="stage-wrap" id="stageWrap">
      <div class="stage-frame" id="stageFrame">
        <div class="stage" id="stage" style="width:${stageW}px;height:${stageH}px">
          <div class="overlay-mask" id="overlay-mask"></div>
${layers}
        </div>
      </div>
    </div>

    <script id="interactions-data" type="application/json">${dataJson}<\/script>
    <script>
      (function () {
        var STAGE_W = ${stageW};
        var STAGE_H = ${stageH};
        var data = JSON.parse(document.getElementById("interactions-data").textContent);
        var pageNav = {};
        (data.interactions || []).forEach(function (it) {
          if (it.trigger && it.trigger.target === "page" && it.action && it.action.type === "navigate") {
            pageNav[it.from] = it.action.to;
          }
        });

        var stage = document.getElementById("stage");
        var stageFrame = document.getElementById("stageFrame");
        var mask = document.getElementById("overlay-mask");
        var pageEls = {};
        var pageDims = {};
        var firstKey = null;
        Array.prototype.slice.call(stage.querySelectorAll(".page")).forEach(function (el) {
          var key = el.getAttribute("data-key");
          pageEls[key] = el;
          pageDims[key] = {
            w: Number(el.getAttribute("data-w")) || STAGE_W,
            h: Number(el.getAttribute("data-h")) || STAGE_H
          };
          if (firstKey === null) { firstKey = key; }
        });

        var base = firstKey;
        var overlays = [];
        var history = [];

        function render() {
          var top = overlays.length ? overlays[overlays.length - 1] : base;
          var baseDims = pageDims[base] || { w: STAGE_W, h: STAGE_H };
          Object.keys(pageEls).forEach(function (key) {
            var el = pageEls[key];
            var overlayIdx = overlays.indexOf(key);
            var shown = key === base || overlayIdx !== -1;
            el.classList.toggle("shown", shown);
            if (shown) {
              if (overlayIdx !== -1) {
                var dims = pageDims[key] || baseDims;
                el.style.left = Math.max(0, (baseDims.w - dims.w) / 2) + "px";
                el.style.top = Math.max(0, (baseDims.h - dims.h) / 2) + "px";
              } else {
                el.style.left = "0px";
                el.style.top = "0px";
              }
              el.style.zIndex = String(overlayIdx !== -1 ? 10 + overlayIdx : 1);
              el.style.pointerEvents = key === top ? "auto" : "none";
            } else {
              el.style.zIndex = "";
              el.style.pointerEvents = "none";
            }
          });
          if (mask) {
            mask.classList.toggle("shown", overlays.length > 0);
          }
          applyScale();
        }

        function run(action, to) {
          var prevBase = base;
          if (action === "navigate" && to) {
            history.push(base);
            overlays = [];
            base = to;
          } else if (action === "overlay" && to) {
            overlays.push(to);
          } else if (action === "closeOverlay") {
            overlays.pop();
          } else if (action === "back") {
            if (history.length) {
              overlays = [];
              base = history.pop();
            }
          }
          render();
          if (base !== prevBase) {
            window.scrollTo(0, 0);
          }
        }

        var mode = "viewport";
        function applyScale() {
          var dims = pageDims[base] || { w: STAGE_W, h: STAGE_H };
          var pad = 32;
          var k;
          var stageW;
          var stageH;
          if (mode === "viewport") {
            stageW = dims.w;
            stageH = dims.h;
            k = window.innerWidth / dims.w;
          } else if (mode === "fit") {
            stageW = STAGE_W;
            stageH = STAGE_H;
            k = Math.min((window.innerWidth - pad) / STAGE_W, (window.innerHeight - pad) / STAGE_H, 1);
          } else {
            stageW = dims.w;
            stageH = dims.h;
            k = 1;
          }
          if (!(k > 0)) { k = 1; }
          stage.style.width = stageW + "px";
          stage.style.height = stageH + "px";
          stage.style.transform = "scale(" + k + ")";
          stageFrame.style.width = (stageW * k) + "px";
          stageFrame.style.height = (stageH * k) + "px";
        }

        var viewportBtn = document.getElementById("viewportBtn");
        var fitBtn = document.getElementById("fitBtn");
        var actualBtn = document.getElementById("actualBtn");
        var modeBtns = { viewport: viewportBtn, fit: fitBtn, actual: actualBtn };
        function setMode(m) {
          mode = m;
          ["viewport", "fit", "actual"].forEach(function (x) {
            document.body.classList.toggle("mode-" + x, x === m);
            if (modeBtns[x]) { modeBtns[x].classList.toggle("active", x === m); }
          });
          applyScale();
        }
        viewportBtn.addEventListener("click", function () { setMode("viewport"); });
        fitBtn.addEventListener("click", function () { setMode("fit"); });
        actualBtn.addEventListener("click", function () { setMode("actual"); });
        window.addEventListener("resize", applyScale);

        Array.prototype.slice.call(stage.querySelectorAll(".hotspot")).forEach(function (spot) {
          spot.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            run(spot.getAttribute("data-action"), spot.getAttribute("data-to"));
          });
        });

        stage.addEventListener("click", function () {
          if (overlays.length) { return; }
          var to = pageNav[base];
          if (to) {
            history.push(base);
            base = to;
            render();
          }
        });

        render();
        applyScale();
      })();
    <\/script>
  </body>
</html>
`;
  }
  function buildRawValidationStylesCss() {
    return `body {
  margin: 0;
  min-height: 100vh;
  background: #e5e6eb;
  font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif;
  color: #1f1f1f;
}
body.mode-viewport {
  background: #fff;
}
body.mode-viewport .stage-wrap {
  display: block;
  min-height: 0;
  overflow: visible;
  padding: 0;
}
body.mode-viewport .stage-frame {
  margin: 0;
}
body.mode-viewport .stage {
  box-shadow: none;
  border-radius: 0;
}
body.mode-fit .stage-wrap,
body.mode-actual .stage-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
}
body.mode-fit .stage,
body.mode-actual .stage {
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.12);
}
body.mobile.mode-fit .stage,
body.mobile.mode-actual .stage {
  border-radius: 14px;
  overflow: hidden;
}
.stage-frame {
  position: relative;
  flex: none;
  overflow: hidden;
}
.stage {
  position: relative;
  transform-origin: top left;
  background: #fff;
}
.page {
  position: absolute;
  left: 0;
  top: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}
.page.shown {
  opacity: 1;
}
.page-content {
  position: relative;
  width: 100%;
  height: 100%;
}
.page-content img {
  display: block;
}
.overlay-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.4);
  transition: opacity 0.3s ease;
}
.overlay-mask.shown {
  opacity: 1;
}
.hotspot {
  position: absolute;
  z-index: 50;
  display: block;
  cursor: pointer;
  background: transparent;
}
.hotspot:hover {
  background: rgba(13, 153, 255, 0.15);
}
.toolbar {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 100;
  display: flex;
  gap: 6px;
}
.toolbar button {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  color: #1f1f1f;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  cursor: pointer;
}
.toolbar button.active {
  color: #fff;
  border-color: #0d99ff;
  background: #0d99ff;
}
`;
  }
  function buildValidationStylesCss() {
    return `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: #e5e6eb;
  font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif;
  color: #1f1f1f;
}
/* Real-viewport mode: page fills the browser width, flows/scrolls naturally,
   no gray card framing. */
body.mode-viewport {
  background: #fff;
}
body.mode-viewport .stage-wrap {
  display: block;
  min-height: 0;
  overflow: visible;
  padding: 0;
}
body.mode-viewport .stage-frame {
  margin: 0;
}
body.mode-viewport .stage {
  box-shadow: none;
  border-radius: 0;
}
/* Fit / Actual modes: center the (scaled) stage on a gray stage, like a device
   preview; Actual size can overflow and scroll. */
body.mode-fit .stage-wrap,
body.mode-actual .stage-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
}
body.mode-fit .stage,
body.mode-actual .stage {
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.12);
}
body.mobile.mode-fit .stage,
body.mobile.mode-actual .stage {
  border-radius: 14px;
  overflow: hidden;
}
/* Layout box that matches the scaled stage/page size (set by JS); clips the
   stage to the active page in real-viewport mode. */
.stage-frame {
  position: relative;
  flex: none;
  overflow: hidden;
}
/* Fixed design-size stage, scaled via transform from its top-left. */
.stage {
  position: relative;
  transform-origin: top left;
  background: #fff;
}
/* Pages stack at the stage origin; only .shown pages are visible. */
.page {
  position: absolute;
  left: 0;
  top: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}
.page.shown {
  opacity: 1;
}
.page-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fff;
}
/* Dim mask shown behind the topmost overlay, covering the whole stage. */
.overlay-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.4);
  transition: opacity 0.3s ease;
}
.overlay-mask.shown {
  opacity: 1;
}
/* Transparent tap targets; a faint tint appears on hover to aid verification. */
.hotspot {
  position: absolute;
  display: block;
  cursor: pointer;
  background: transparent;
}
.hotspot:hover {
  background: rgba(13, 153, 255, 0.15);
}
/* View mode toggle. */
.toolbar {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 100;
  display: flex;
  gap: 6px;
}
.toolbar button {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  color: #1f1f1f;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  cursor: pointer;
}
.toolbar button.active {
  color: #fff;
  border-color: #0d99ff;
  background: #0d99ff;
}
`;
  }
  function escapeXml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  async function runCreateWorkspace() {
    await figma.currentPage.loadAsync();
    const selection = figma.currentPage.selection;
    if (selection.length !== 1) {
      figma.notify("\u8BF7\u53EA\u9009\u4E2D\u4E00\u4E2A Frame \u6765\u751F\u6210\u6A21\u5757\u5DE5\u4F5C\u533A\u3002", { error: true });
      switchMode("workspace");
      return;
    }
    const source = selection[0];
    if (!isWorkspaceSourceNode(source)) {
      figma.notify("\u8BF7\u9009\u4E2D\u4E00\u4E2A\u542B\u6709\u5B50\u56FE\u5C42\u7684 Frame\u3001\u7EC4\u4EF6\u96C6\u6216\u5206\u7EC4\u3002", { error: true });
      switchMode("workspace");
      return;
    }
    switchMode("workspace");
    figma.notify("\u6B63\u5728\u8BC6\u522B\u6A21\u5757\u2026");
    try {
      const modules = detectModules(source);
      if (modules.length === 0) {
        figma.notify("\u5728\u8BE5 Frame \u4E2D\u672A\u8BC6\u522B\u5230\u5019\u9009\u6A21\u5757\u3002", { error: true });
        await sendState();
        return;
      }
      workspace = await buildWorkspace(source, modules);
      figma.currentPage.selection = [];
      const workspaceFrame = await figma.getNodeByIdAsync(workspace.workspaceId);
      if (workspaceFrame && "x" in workspaceFrame) {
        figma.viewport.scrollAndZoomIntoView([workspaceFrame]);
      }
      figma.notify(`\u5DF2\u751F\u6210\u5DE5\u4F5C\u533A\uFF0C\u5305\u542B ${modules.length} \u4E2A\u6A21\u5757\u5360\u4F4D\u56FE\u3002`);
      await sendState();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "\u65E0\u6CD5\u751F\u6210\u5DE5\u4F5C\u533A";
      figma.notify(messageText, { error: true });
      figma.ui.postMessage({ type: "error", message: messageText });
    }
  }
  function isWorkspaceSourceNode(node) {
    return isExportableNode(node) && "children" in node && node.children.length > 0 && !isInternalNode(node);
  }
  function containsModuleCandidate(node) {
    if (!("findOne" in node)) {
      return false;
    }
    return Boolean(
      node.findOne((child) => isModuleCandidate(child))
    );
  }
  function detectModules(root) {
    const modules = [];
    const visit = (node, parent) => {
      if (modules.length >= MAX_MODULES) {
        return;
      }
      if (!isModuleCandidate(node)) {
        return;
      }
      const candidate = node;
      const hasDeeper = "children" in candidate && containsModuleCandidate(candidate);
      if (!hasDeeper) {
        modules.push({ node: candidate, parent });
        return;
      }
      if (isStyledContainer(candidate) || candidate.type === "INSTANCE" || candidate.type === "COMPONENT" || candidate.type === "COMPONENT_SET" || candidate.type === "SECTION") {
        modules.push({ node: candidate, parent });
        for (const child of candidate.children) {
          visit(child, candidate);
        }
        return;
      }
      for (const child of candidate.children) {
        visit(child, parent);
      }
    };
    for (const child of root.children) {
      visit(child, null);
    }
    return modules;
  }
  function isStyledContainer(node) {
    return hasVisibleBackground(node) || hasPadding(node);
  }
  function hasVisibleBackground(node) {
    if (!("fills" in node)) {
      return false;
    }
    const fills = node.fills;
    if (fills === figma.mixed) {
      return true;
    }
    return Array.isArray(fills) && fills.some((paint) => paint.visible !== false && (paint.opacity === void 0 || paint.opacity > 0));
  }
  function hasPadding(node) {
    const box = node;
    const sides = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"];
    return sides.some((side) => typeof box[side] === "number" && box[side] > 0);
  }
  function isModuleCandidate(node) {
    return isExportableNode(node) && MODULE_TYPES.has(node.type) && node.visible && !node.locked && node.width >= MIN_MODULE_WIDTH && node.height >= MIN_MODULE_HEIGHT && !isInternalNode(node);
  }
  function isInternalNode(node) {
    const name = node.name;
    return INTERNAL_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
  }
  async function buildWorkspace(source, modules) {
    await ensureFonts();
    const pageName = figma.currentPage.name;
    const columnWidth = Math.max(source.width, 320);
    const contentTop = WORKSPACE_PAD + 40 + WORKSPACE_PAD;
    const workspaceFrame = figma.createFrame();
    workspaceFrame.name = `${WORKSPACE_NAME_PREFIX} - ${source.name}`;
    workspaceFrame.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.96 } }];
    workspaceFrame.x = source.x + source.width + WORKSPACE_COLUMN_GAP;
    workspaceFrame.y = source.y;
    workspaceFrame.clipsContent = false;
    const workspaceWidth = columnWidth * 2 + WORKSPACE_COLUMN_GAP + WORKSPACE_PAD * 2;
    const workspaceHeight = Math.max(source.height + contentTop + WORKSPACE_PAD, 800);
    workspaceFrame.resizeWithoutConstraints(workspaceWidth, workspaceHeight);
    const header = createLabel(`\u6A21\u5757\u5DE5\u4F5C\u533A \u2014 ${source.name}`, columnWidth * 2);
    header.x = WORKSPACE_PAD;
    header.y = WORKSPACE_PAD;
    workspaceFrame.appendChild(header);
    const sourceMap = figma.createFrame();
    sourceMap.name = SOURCE_MAP_NAME;
    sourceMap.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    sourceMap.x = WORKSPACE_PAD;
    sourceMap.y = contentTop;
    sourceMap.clipsContent = true;
    sourceMap.resizeWithoutConstraints(columnWidth, Math.max(source.height, 200));
    workspaceFrame.appendChild(sourceMap);
    const snapshot = await createSourceSnapshot(source, sourceMap, workspaceFrame.id);
    const selectedModules = figma.createFrame();
    selectedModules.name = SELECTED_MODULES_NAME;
    selectedModules.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    selectedModules.x = WORKSPACE_PAD + columnWidth + WORKSPACE_COLUMN_GAP;
    selectedModules.y = contentTop;
    selectedModules.layoutMode = "VERTICAL";
    selectedModules.primaryAxisSizingMode = "FIXED";
    selectedModules.counterAxisSizingMode = "FIXED";
    selectedModules.itemSpacing = 12;
    selectedModules.paddingTop = 12;
    selectedModules.paddingBottom = 12;
    selectedModules.paddingLeft = 12;
    selectedModules.paddingRight = 12;
    selectedModules.resizeWithoutConstraints(columnWidth, Math.max(source.height, 200));
    workspaceFrame.appendChild(selectedModules);
    const archive = figma.createFrame();
    archive.name = ARCHIVE_NAME;
    archive.fills = [];
    archive.visible = false;
    archive.resizeWithoutConstraints(1, 1);
    workspaceFrame.appendChild(archive);
    const workspaceId = workspaceFrame.id;
    const placeholders = /* @__PURE__ */ new Map();
    let index = 0;
    for (const detected of modules) {
      index += 1;
      const record = await createPlaceholder(detected, sourceMap, source, {
        workspaceId,
        pageName,
        index
      });
      placeholders.set(record.placeholderId, record);
    }
    if (snapshot) {
      snapshot.remove();
    }
    setOptionalPluginData(workspaceFrame, {
      role: "workspace",
      sourceNodeId: source.id,
      sourceNodeName: source.name,
      moduleCount: String(modules.length)
    });
    return {
      workspaceId,
      workspaceName: workspaceFrame.name,
      sourceMapId: sourceMap.id,
      selectedModulesId: selectedModules.id,
      archiveId: archive.id,
      sourceFrameId: source.id,
      sourceFrameName: source.name,
      sourceFrameWidth: Math.round(source.width),
      sourceFrameHeight: Math.round(source.height),
      pageName,
      fileUrl: "",
      placeholders,
      collected: /* @__PURE__ */ new Map()
    };
  }
  async function createSourceSnapshot(source, sourceMap, workspaceId) {
    try {
      const image = await createImageFromNode(source, PLACEHOLDER_SCALE);
      const snapshot = figma.createRectangle();
      snapshot.name = `[MR Snapshot] ${source.name}`;
      snapshot.x = 0;
      snapshot.y = 0;
      snapshot.resizeWithoutConstraints(source.width, source.height);
      snapshot.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
      snapshot.strokes = [];
      snapshot.locked = true;
      sourceMap.appendChild(snapshot);
      setOptionalPluginData(snapshot, { role: "snapshot", workspaceId });
      return snapshot;
    } catch (e) {
      figma.notify("\u6E90\u56FE\u6574\u9875\u5FEB\u7167\u8FC7\u5927\uFF0C\u5DF2\u8DF3\u8FC7\u3002", { timeout: 3e3 });
      return null;
    }
  }
  async function createPlaceholder(detected, sourceMap, source, context) {
    const module = detected.node;
    const parent = detected.parent;
    const image = await createImageFromNode(module, PLACEHOLDER_SCALE);
    const placeholder = figma.createRectangle();
    placeholder.name = `${PLACEHOLDER_PREFIX} ${context.index} - ${module.name}`;
    placeholder.resizeWithoutConstraints(module.width, module.height);
    const absX = module.absoluteTransform[0][2];
    const absY = module.absoluteTransform[1][2];
    const relX = absX - source.absoluteTransform[0][2];
    const relY = absY - source.absoluteTransform[1][2];
    placeholder.x = relX;
    placeholder.y = relY;
    const parentX = parent ? absX - parent.absoluteTransform[0][2] : relX;
    const parentY = parent ? absY - parent.absoluteTransform[1][2] : relY;
    placeholder.fills = [
      { type: "SOLID", color: { r: 0.05, g: 0.6, b: 1 }, opacity: 0.02 }
    ];
    placeholder.strokes = [{ type: "SOLID", color: { r: 0.05, g: 0.6, b: 1 } }];
    placeholder.strokeWeight = 0.5;
    placeholder.cornerRadius = 2;
    sourceMap.appendChild(placeholder);
    const componentInfo = await getComponentInfo(module);
    const spacing = getSpacing(module);
    const record = {
      sourceNodeId: module.id,
      sourceNodeName: module.name,
      sourceNodeType: module.type,
      pageName: context.pageName,
      sourceFrameId: source.id,
      sourceFrameName: source.name,
      placeholderId: placeholder.id,
      index: context.index,
      imageHash: image.hash,
      x: Math.round(relX),
      y: Math.round(relY),
      width: Math.round(module.width),
      height: Math.round(module.height),
      parentId: parent ? parent.id : null,
      parentX: Math.round(parentX),
      parentY: Math.round(parentY),
      paddingTop: spacing.paddingTop,
      paddingRight: spacing.paddingRight,
      paddingBottom: spacing.paddingBottom,
      paddingLeft: spacing.paddingLeft,
      itemSpacing: spacing.itemSpacing,
      layoutMode: spacing.layoutMode,
      mainComponentId: componentInfo ? componentInfo.id : void 0,
      mainComponentName: componentInfo ? componentInfo.name : void 0
    };
    setOptionalPluginData(placeholder, {
      role: "placeholder",
      workspaceId: context.workspaceId,
      sourceNodeId: record.sourceNodeId,
      sourceNodeName: record.sourceNodeName,
      sourceNodeType: record.sourceNodeType
    });
    return record;
  }
  function getSpacing(node) {
    const box = node;
    const spacing = {};
    const num = (key) => typeof box[key] === "number" ? Math.round(box[key]) : void 0;
    const layoutMode = typeof box.layoutMode === "string" ? box.layoutMode : void 0;
    if (layoutMode && layoutMode !== "NONE") {
      spacing.layoutMode = layoutMode;
      spacing.itemSpacing = num("itemSpacing");
    }
    spacing.paddingTop = num("paddingTop");
    spacing.paddingRight = num("paddingRight");
    spacing.paddingBottom = num("paddingBottom");
    spacing.paddingLeft = num("paddingLeft");
    return spacing;
  }
  async function getComponentInfo(node) {
    if (node.type !== "INSTANCE") {
      return void 0;
    }
    try {
      const main2 = await node.getMainComponentAsync();
      if (main2) {
        return { id: main2.id, name: main2.name };
      }
    } catch (e) {
    }
    return void 0;
  }
  async function addSelectedPlaceholders() {
    if (!workspace) {
      figma.notify("\u8BF7\u5148\u751F\u6210\u6A21\u5757\u5DE5\u4F5C\u533A\u3002", { error: true });
      return;
    }
    const selectedIds = getSelectedPlaceholderIds();
    if (selectedIds.length === 0) {
      figma.notify("\u8BF7\u5148\u5728\u6E90\u56FE\u6620\u5C04\u4E2D\u9009\u4E2D\u4E00\u4E2A\u6216\u591A\u4E2A\u5360\u4F4D\u56FE\u3002", { error: true });
      return;
    }
    const selectedModules = await figma.getNodeByIdAsync(workspace.selectedModulesId);
    if (!selectedModules || selectedModules.type !== "FRAME") {
      figma.notify("\u5DF2\u9009\u6A21\u5757 Frame \u4E22\u5931\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u5DE5\u4F5C\u533A\u3002", { error: true });
      return;
    }
    await ensureFonts();
    let added = 0;
    for (const placeholderId of selectedIds) {
      const record = workspace.placeholders.get(placeholderId);
      if (!record) {
        continue;
      }
      if (workspace.collected.has(record.sourceNodeId)) {
        continue;
      }
      createModuleCard(selectedModules, record);
      workspace.collected.set(record.sourceNodeId, record);
      added += 1;
    }
    if (added === 0) {
      figma.notify("\u9009\u4E2D\u7684\u6A21\u5757\u5DF2\u5168\u90E8\u6536\u96C6\u3002");
      return;
    }
    figma.notify(`\u5DF2\u6DFB\u52A0 ${added} \u4E2A\u6A21\u5757\u5230\u5DF2\u9009\u6A21\u5757\u533A\u3002`);
  }
  function createModuleCard(parent, record) {
    const card = figma.createFrame();
    card.name = `${CARD_PREFIX} ${record.sourceNodeName}`;
    card.layoutMode = "VERTICAL";
    card.primaryAxisSizingMode = "AUTO";
    card.counterAxisSizingMode = "AUTO";
    card.itemSpacing = 8;
    card.paddingTop = 12;
    card.paddingBottom = 12;
    card.paddingLeft = 12;
    card.paddingRight = 12;
    card.cornerRadius = 8;
    card.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.97 } }];
    card.strokes = [{ type: "SOLID", color: { r: 0.87, g: 0.87, b: 0.87 } }];
    card.strokeWeight = 1;
    const previewWidth = Math.min(record.width, 280);
    const previewHeight = Math.max(
      24,
      Math.round(record.height / record.width * previewWidth)
    );
    const preview = figma.createRectangle();
    preview.name = "Preview";
    preview.resizeWithoutConstraints(previewWidth, previewHeight);
    preview.fills = [{ type: "IMAGE", imageHash: record.imageHash, scaleMode: "FILL" }];
    preview.cornerRadius = 4;
    card.appendChild(preview);
    const title = createLabel(record.sourceNodeName, previewWidth);
    card.appendChild(title);
    const metaParts = [record.sourceNodeType, `${record.width}\xD7${record.height}`];
    if (record.mainComponentName) {
      metaParts.push(record.mainComponentName);
    }
    const meta = createMeta(`${metaParts.join(" \xB7 ")}
id: ${record.sourceNodeId}`, previewWidth);
    card.appendChild(meta);
    setOptionalPluginData(card, {
      role: "card",
      workspaceId: workspace ? workspace.workspaceId : "",
      sourceNodeId: record.sourceNodeId,
      placeholderId: record.placeholderId
    });
    parent.appendChild(card);
  }
  function buildPayloadJson() {
    if (!workspace) {
      return JSON.stringify({ plugin: "\u7535\u5546AI\u63D0\u6548\u5DE5\u5177", modules: [] }, null, 2);
    }
    const ws = workspace;
    const modules = Array.from(ws.collected.values()).sort((a, b) => a.index - b.index).map((record) => {
      const module = {
        id: record.sourceNodeId,
        name: record.sourceNodeName,
        type: record.sourceNodeType,
        placeholderId: record.placeholderId,
        pageName: record.pageName,
        // Nearest captured ancestor module; null for top-level modules. Only
        // included as a key when the parent was itself collected, so consumers
        // never dangle onto an uncollected id.
        parentId: record.parentId && ws.collected.has(record.parentId) ? record.parentId : null,
        // Position + size relative to the source frame's top-left, for
        // rebuilding the whole-page layout.
        frame: {
          x: record.x,
          y: record.y,
          width: record.width,
          height: record.height
        },
        // Same size, but positioned relative to the parent module's top-left.
        // For a top-level module this equals `frame`.
        frameInParent: {
          x: record.parentX,
          y: record.parentY,
          width: record.width,
          height: record.height
        }
      };
      const spacing = buildSpacingPayload(record);
      if (spacing) {
        module.spacing = spacing;
      }
      if (record.mainComponentId || record.mainComponentName) {
        module.component = {
          mainComponentId: record.mainComponentId,
          mainComponentName: record.mainComponentName
        };
      }
      if (ws.fileUrl) {
        module.url = buildNodeUrl(ws.fileUrl, record.sourceNodeId);
      }
      return module;
    });
    const payload = {
      plugin: "\u7535\u5546AI\u63D0\u6548\u5DE5\u5177",
      workspace: ws.workspaceName,
      sourceFrame: {
        id: ws.sourceFrameId,
        name: ws.sourceFrameName,
        width: ws.sourceFrameWidth,
        height: ws.sourceFrameHeight
      },
      pageName: ws.pageName,
      modules
    };
    return JSON.stringify(payload, null, 2);
  }
  function buildSpacingPayload(record) {
    const spacing = {};
    if (record.layoutMode) {
      spacing.layoutMode = record.layoutMode;
    }
    if (record.itemSpacing !== void 0) {
      spacing.itemSpacing = record.itemSpacing;
    }
    if (record.paddingTop || record.paddingRight || record.paddingBottom || record.paddingLeft) {
      spacing.padding = {
        top: record.paddingTop || 0,
        right: record.paddingRight || 0,
        bottom: record.paddingBottom || 0,
        left: record.paddingLeft || 0
      };
    }
    return Object.keys(spacing).length > 0 ? spacing : null;
  }
  function buildNodeUrl(fileUrl, nodeId) {
    const base = fileUrl.split("?")[0].replace(/\/$/, "");
    const encodedNode = encodeURIComponent(nodeId.replace(":", "-"));
    return `${base}?node-id=${encodedNode}`;
  }
  async function ensureFonts() {
    if (fontsLoaded) {
      return;
    }
    try {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      await figma.loadFontAsync({ family: "Inter", style: "Medium" });
      fontsLoaded = true;
    } catch (e) {
      fontsLoaded = false;
    }
  }
  function createLabel(text, maxWidth) {
    const label = figma.createText();
    applyFont(label, "Medium");
    label.characters = text;
    label.fontSize = 13;
    label.resizeWithoutConstraints(Math.max(120, maxWidth), label.height);
    label.textAutoResize = "HEIGHT";
    return label;
  }
  function createColumnTitle(text) {
    const title = figma.createText();
    applyFont(title, "Medium");
    title.characters = text;
    title.fontSize = 70;
    title.textAutoResize = "WIDTH_AND_HEIGHT";
    return title;
  }
  function createMeta(text, maxWidth) {
    const meta = figma.createText();
    applyFont(meta, "Regular");
    meta.characters = text;
    meta.fontSize = 11;
    meta.fills = [{ type: "SOLID", color: { r: 0.42, g: 0.42, b: 0.42 } }];
    meta.resizeWithoutConstraints(Math.max(120, maxWidth), meta.height);
    meta.textAutoResize = "HEIGHT";
    return meta;
  }
  function applyFont(node, style) {
    if (fontsLoaded) {
      try {
        node.fontName = { family: "Inter", style };
      } catch (e) {
      }
    }
  }
  function collectCandidates() {
    const roots = figma.currentPage.selection.length > 0 ? figma.currentPage.selection.filter(isScanRoot) : [figma.currentPage];
    const selectedIds = new Set(figma.currentPage.selection.map((node) => node.id));
    const candidates = [];
    for (const root of roots) {
      if (isCandidateNode(root)) {
        candidates.push(toCandidate(root, getDepth(root), selectedIds.has(root.id)));
      }
      if ("findAll" in root) {
        for (const node of root.findAll((child) => isCandidateNode(child))) {
          candidates.push(toCandidate(node, getDepth(node), selectedIds.has(node.id)));
          if (candidates.length >= 300) {
            return candidates;
          }
        }
      }
    }
    return dedupeCandidates(candidates).slice(0, 300);
  }
  function dedupeCandidates(candidates) {
    const seen = /* @__PURE__ */ new Set();
    return candidates.filter((candidate) => {
      if (seen.has(candidate.id)) {
        return false;
      }
      seen.add(candidate.id);
      return true;
    });
  }
  function hasSelectedAncestor(node, selectedIds) {
    let current = node.parent;
    while (current && current.type !== "PAGE") {
      if (selectedIds.has(current.id)) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }
  function isScanRoot(node) {
    return isExportableNode(node) || "findAll" in node;
  }
  function isCandidateNode(node) {
    return isExportableNode(node) && CANDIDATE_TYPES.has(node.type) && node.visible && node.width > 0 && node.height > 0 && !node.name.startsWith("[PNG]");
  }
  function isExportableNode(node) {
    return "exportAsync" in node && "visible" in node && "width" in node && "height" in node;
  }
  async function getTargetNode(id) {
    if (id) {
      const node2 = await getExportableNode(id);
      if (!isCandidateNode(node2)) {
        throw new Error("\u8BF7\u5148\u9009\u4E2D\u4E00\u4E2A Frame\u3001\u7EC4\u4EF6\u3001\u5B9E\u4F8B\u3001\u7EC4\u4EF6\u96C6\u6216\u5206\u7EC4\u3002");
      }
      return node2;
    }
    const [node] = figma.currentPage.selection;
    if (!node || !isCandidateNode(node)) {
      throw new Error("\u8BF7\u5148\u9009\u4E2D\u4E00\u4E2A Frame\u3001\u7EC4\u4EF6\u3001\u5B9E\u4F8B\u3001\u7EC4\u4EF6\u96C6\u6216\u5206\u7EC4\u3002");
    }
    return node;
  }
  async function getExportableNode(id) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !isExportableNode(node)) {
      throw new Error("\u8BE5\u56FE\u5C42\u5DF2\u65E0\u6CD5\u5BFC\u51FA\u3002");
    }
    return node;
  }
  async function exportNode(node, scale) {
    // 修复：当 frame 未开启 clipsContent 时，Figma 的 exportAsync 会把输出图像
    // 收缩到「渲染边界(absoluteRenderBounds)」而非声明的 bounding box。若frame
    // 底部有一段区域没有可见像素铺满（例如透明背景块），导出图会比frame.height短，
    // 而坐标采集用的是 frame.width/height(=bounding box)，两套基准错位导致底部内容残缺。
    // 对策：导出前临时开启 clipsContent，强制按完整 bounding box 导出，导出后还原原值。
    const canClip = "clipsContent" in node;
    const prevClips = canClip ? node.clipsContent : void 0;
    let toggled = false;
    if (canClip && prevClips === false) {
      try {
        node.clipsContent = true;
        toggled = true;
      } catch (e) {
        toggled = false;
      }
    }
    try {
      return await node.exportAsync({
        format: "PNG",
        constraint: {
          type: "SCALE",
          value: scale
        }
      });
    } finally {
      if (toggled) {
        try {
          node.clipsContent = prevClips;
        } catch (e) {
        }
      }
    }
  }
  function safeImageScale(node, scale) {
    const longest = Math.max(node.width, node.height);
    if (longest <= 0) {
      return scale;
    }
    const maxScale = MAX_IMAGE_DIMENSION / longest;
    return Math.max(Math.min(scale, maxScale), 0.01);
  }
  async function createImageFromNode(node, scale) {
    const bytes = await exportNode(node, safeImageScale(node, scale));
    return figma.createImage(bytes);
  }
  async function replaceWithPng(node, options) {
    const parent = node.parent;
    if (!parent || !("insertChild" in parent) || !("children" in parent)) {
      throw new Error("\u8BE5\u56FE\u5C42\u65E0\u6CD5\u539F\u4F4D\u66FF\u6362\u3002");
    }
    const index = parent.children.indexOf(node);
    if (index < 0) {
      throw new Error("\u5728\u7236\u5BB9\u5668\u4E2D\u627E\u4E0D\u5230\u8BE5\u56FE\u5C42\u3002");
    }
    const image = await createImageFromNode(node, options.scale);
    const replacement = figma.createRectangle();
    replacement.name = `[PNG] ${node.name}`;
    replacement.resizeWithoutConstraints(node.width, node.height);
    replacement.fills = [
      {
        type: "IMAGE",
        imageHash: image.hash,
        scaleMode: "FILL"
      }
    ];
    replacement.strokes = [];
    replacement.effects = [];
    setOptionalPluginData(replacement, {
      sourceNodeId: node.id,
      sourceNodeName: node.name,
      rasterScale: String(options.scale)
    });
    parent.insertChild(index, replacement);
    copyPositionAndLayout(node, replacement);
    if (options.keepOriginal) {
      node.visible = false;
    } else {
      node.remove();
    }
    return replacement;
  }
  function setOptionalPluginData(node, data) {
    for (const [key, value] of Object.entries(data)) {
      try {
        node.setPluginData(key, value);
      } catch (e) {
      }
    }
  }
  function copyPositionAndLayout(source, target) {
    const sourceAny = source;
    const targetAny = target;
    const props = [
      "x",
      "y",
      "rotation",
      "layoutAlign",
      "layoutGrow",
      "layoutPositioning",
      "layoutSizingHorizontal",
      "layoutSizingVertical",
      "minWidth",
      "maxWidth",
      "minHeight",
      "maxHeight",
      "constraints"
    ];
    for (const prop of props) {
      if (prop in sourceAny && prop in targetAny) {
        try {
          targetAny[prop] = sourceAny[prop];
        } catch (e) {
        }
      }
    }
  }
  function toCandidate(node, depth = 0, selected = false) {
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      width: Math.round(node.width),
      height: Math.round(node.height),
      depth,
      path: getPath(node),
      selected
    };
  }
  function getDepth(node) {
    let depth = 0;
    let current = node.parent;
    while (current && current.type !== "PAGE") {
      depth += 1;
      current = current.parent;
    }
    return depth;
  }
  function getPath(node) {
    const parts = [node.name];
    let current = node.parent;
    while (current && current.type !== "PAGE") {
      parts.unshift(current.name);
      current = current.parent;
    }
    return parts.join(" / ");
  }
  function safeFileName(name) {
    return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "module";
  }
})();
