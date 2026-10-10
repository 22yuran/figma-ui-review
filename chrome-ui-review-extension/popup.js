const $ = selector => document.querySelector(selector);
const REVIEW_RELEASE = '3.18.2';

let design = null;
let runtime = null;
let report = null;
let inspectionExecution = null;
let captureDiagnostics = null;
let backgroundMeasurements = {design: null, runtime: null};
let designPreviews = new Map();
// Two-pass comparison: resolve ambiguous identities before measurement, then
// publish the single measurement pass without post-measurement AI discovery.
const REVIEW_STAGE_POLICY = {identityReview: true, finalAdjudication: false};

const STYLE_PROPERTIES = [
  'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color',
  'background-color', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'border-radius', 'row-gap', 'column-gap',
  'overflow-x', 'overflow-y'
];

const PROPERTY_LABELS = {
  'font-size': '字号',
  'font-weight': '字重',
  'line-height': '行高',
  'letter-spacing': '字间距',
  color: '颜色',
  'background-color': '背景色',
  'padding-top': '顶部 Padding',
  'padding-right': '右侧 Padding',
  'padding-bottom': '底部 Padding',
  'padding-left': '左侧 Padding',
  'border-radius': '圆角',
  gap: '内部间距',
  'row-gap': '纵向间距',
  'column-gap': '横向间距',
  'layout.horizontal-gap': '横向间距',
  'layout.vertical-gap': '纵向间距',
  'layout.scope': '对象范围',
  'overflow-x': '横向溢出',
  'overflow-y': '纵向溢出',
  'box.local.width': '宽度',
  'box.local.height': '高度'
};

const LAYOUT_INSET_LABELS = {
  top: '顶部可见留白',
  right: '右侧可见留白',
  bottom: '底部可见留白',
  left: '左侧可见留白'
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const compactText = value => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, '')
  .replace(/[，。！？：；、,.!?:;\-—_()（）\[\]【】{}]/g, '')
  .toLowerCase();

const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const number = value => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const rounded = value => Math.round(value * 100) / 100;

function expandBoxShorthand(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  if (parts.length === 1) return {top: parts[0], right: parts[0], bottom: parts[0], left: parts[0]};
  if (parts.length === 2) return {top: parts[0], right: parts[1], bottom: parts[0], left: parts[1]};
  if (parts.length === 3) return {top: parts[0], right: parts[1], bottom: parts[2], left: parts[1]};
  return {top: parts[0], right: parts[1], bottom: parts[2], left: parts[3]};
}

function canonicalStyles(node = {}) {
  const styles = {...(node.styles || {})};
  // Figma exports visible strokes as `border-top: 1px solid rgba(...)`.
  // DOM snapshots already carry the longhands. Normalize both before deciding
  // whether a painted child, rather than its label, defines a visual edge.
  for (const edge of ['top','right','bottom','left']) {
    const shorthand = String(styles[`border-${edge}`] || '').trim();
    const border = shorthand.match(/^([\d.]+(?:px|pt))\s+(solid|dashed|dotted|double)\s+(.+)$/i);
    if (!border) continue;
    if (styles[`border-${edge}-width`] == null) styles[`border-${edge}-width`] = border[1];
    if (styles[`border-${edge}-style`] == null) styles[`border-${edge}-style`] = border[2];
    if (styles[`border-${edge}-color`] == null) styles[`border-${edge}-color`] = border[3];
  }
  const padding = expandBoxShorthand(styles.padding);
  if (padding) {
    if (styles['padding-top'] == null) styles['padding-top'] = padding.top;
    if (styles['padding-right'] == null) styles['padding-right'] = padding.right;
    if (styles['padding-bottom'] == null) styles['padding-bottom'] = padding.bottom;
    if (styles['padding-left'] == null) styles['padding-left'] = padding.left;
  }

  const gap = String(styles.gap || '').trim().split(/\s+/).filter(Boolean);
  if (gap.length) {
    if (styles['row-gap'] == null) styles['row-gap'] = gap[0];
    if (styles['column-gap'] == null) styles['column-gap'] = gap[1] || gap[0];
  }

  if (/flex|grid/i.test(styles.display || '')) {
    if (clean(styles['row-gap']) === 'normal') styles['row-gap'] = '0px';
    if (clean(styles['column-gap']) === 'normal') styles['column-gap'] = '0px';
  }

  if (styles['background-color'] == null && colorChannels(styles.background)) {
    styles['background-color'] = styles.background;
  }
  return styles;
}

function colorChannels(value) {
  const input = clean(value);
  if (input === 'transparent') return [0, 0, 0, 0];
  const hex = input.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map(char => char + char).join('') : hex;
    if (expanded.length === 6 || expanded.length === 8) {
      return [
        parseInt(expanded.slice(0, 2), 16),
        parseInt(expanded.slice(2, 4), 16),
        parseInt(expanded.slice(4, 6), 16),
        expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1
      ];
    }
  }
  const match = input.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const slashParts = match[1].split('/');
  const channels = slashParts[0].replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (channels.length < 3) return null;
  const rgb = channels.slice(0, 3).map(token => token.endsWith('%') ? number(token) * 2.55 : number(token));
  const alphaToken = slashParts[1]?.trim() || channels[3];
  const alpha = alphaToken == null ? 1 : alphaToken.endsWith('%') ? number(alphaToken) / 100 : number(alphaToken);
  return rgb.every(Number.isFinite) && Number.isFinite(alpha) ? [...rgb, alpha] : null;
}

function fontSizePx(styles = {}) {
  const value = clean(styles['font-size']);
  const parsed = number(value);
  if (parsed == null) return null;
  if (value.endsWith('rem')) return parsed * 16;
  if (value.endsWith('em')) return parsed * 16;
  return parsed;
}

const isPaintProperty = property => /color/.test(property) || property === 'fill' || property === 'stroke';

function normalizedStyle(property, value, styles = {}) {
  if (value == null || value === '') return {kind: 'empty', raw: value, display: '—'};
  const raw = String(value).trim();
  const normalized = clean(raw);

  if (isPaintProperty(property)) {
    const channels = colorChannels(raw);
    return channels ? {kind: 'color', raw, channels, display: readableValue(raw)} : {kind: 'text', raw, value: normalized, display: raw};
  }
  if (property === 'font-family') {
    const family = normalized.replace(/["']/g, '').replace(/\s*,\s*/g, ',');
    return {kind: 'text', raw, value: family, display: raw};
  }
  if (property === 'font-weight') {
    const weights = {normal: 400, bold: 700};
    const weight = weights[normalized] ?? number(normalized);
    return weight == null ? {kind: 'text', raw, value: normalized, display: raw} : {kind: 'number', raw, value: weight, unit: '', display: String(weight)};
  }

  if (property === 'line-height') {
    const fontSize = fontSizePx(styles);
    let pixels = null;
    if (normalized.endsWith('%') && fontSize != null) pixels = fontSize * number(normalized) / 100;
    else if (/^-?[\d.]+$/.test(normalized) && fontSize != null) pixels = fontSize * number(normalized);
    else if (normalized.endsWith('rem')) pixels = number(normalized) * 16;
    else if (normalized.endsWith('em') && fontSize != null) pixels = number(normalized) * fontSize;
    else if (normalized.endsWith('px')) pixels = number(normalized);
    if (pixels != null) return {kind: 'number', raw, value: pixels, unit: 'px', display: `${rounded(pixels)}px`};
  }

  if (/^-?[\d.]+px$/.test(normalized)) {
    return {kind: 'number', raw, value: number(normalized), unit: 'px', display: `${rounded(number(normalized))}px`};
  }
  if (/^-?[\d.]+rem$/.test(normalized)) {
    const pixels = number(normalized) * 16;
    return {kind: 'number', raw, value: pixels, unit: 'px', display: `${rounded(pixels)}px`};
  }
  if (/^-?[\d.]+em$/.test(normalized)) {
    const base = fontSizePx(styles) || 16;
    const pixels = number(normalized) * base;
    return {kind: 'number', raw, value: pixels, unit: 'px', display: `${rounded(pixels)}px`};
  }
  if (/^-?[\d.]+$/.test(normalized)) {
    return {kind: 'number', raw, value: number(normalized), unit: '', display: normalized};
  }
  return {kind: 'text', raw, value: normalized, display: raw};
}

function compareStyle(property, designValue, runtimeValue, designStyles = {}, runtimeStyles = {}) {
  const left = normalizedStyle(property, designValue, designStyles);
  const right = normalizedStyle(property, runtimeValue, runtimeStyles);
  let same;
  if (left.kind === 'color' && right.kind === 'color') {
    same = left.channels.slice(0, 3).every((channel, index) => Math.abs(channel - right.channels[index]) <= 2)
      && Math.abs(left.channels[3] - right.channels[3]) <= 0.02;
  } else if (left.kind === 'number' && right.kind === 'number' && left.unit === right.unit) {
    const tolerance = property === 'font-weight'
      ? 0
      : /^geometry\.padding-/.test(property)
        ? 1.5
        : /padding|gap|spacing|layout\./.test(property)
          ? 1
          : 0.5;
    same = Math.abs(left.value - right.value) <= tolerance;
  } else {
    same = clean(left.value ?? left.raw) === clean(right.value ?? right.raw);
  }
  return {same, left, right};
}

function equalStyle(property, designValue, runtimeValue, designStyles = {}, runtimeStyles = {}) {
  return compareStyle(property, designValue, runtimeValue, designStyles, runtimeStyles).same;
}

function flatten(page) {
  if (Array.isArray(page.elements)) return page.elements;
  const output = [];
  (function walk(node) {
    if (!node) return;
    output.push(node);
    (node.children || []).forEach(walk);
  })(page.root);
  return output;
}

function prepareNodes(rawNodes, root) {
  const nodes = rawNodes.map((raw, index) => {
    const box = raw.box?.local || {};
    return {
      ...raw,
      _captureScope: {x:0,y:0,width:root.width,height:root.height},
      _index: index,
      _text: compactText(raw.text?.direct),
      _box: box,
      _nx: (box.x || 0) / (root.width || 1),
      _ny: (box.y || 0) / (root.height || 1),
      _nw: (box.width || 0) / (root.width || 1),
      _nh: (box.height || 0) / (root.height || 1),
      _parent: null,
      _ancestors: [],
      _children: [],
      _siblingIndex: 0,
      _structureRole: '',
      _structureArea: '',
      _structureKey: ''
    };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  nodes.forEach(node => {
    node._parent = byId.get(node.parentId) || null;
    if (node._parent) node._parent._children.push(node);
  });
  nodes.forEach(node => node._children.forEach((child, index) => {
    child._siblingIndex = index;
  }));
  nodes.forEach(node => {
    let cursor = node._parent;
    const seen = new Set();
    while (cursor && !seen.has(cursor.id)) {
      node._ancestors.push(cursor);
      seen.add(cursor.id);
      cursor = cursor._parent;
    }
  });
  return nodes;
}

// The same clipped visibility decision is used by identity and check creation.
function inspectionVisible(node) {
  if (typeof InspectionContracts !== 'undefined' && InspectionContracts.visible) return InspectionContracts.visible(node);
  const box = visualBox(node);
  return Boolean(box && box.width > 0 && box.height > 0 && !geometrySubtreeHidden(node)
    && !(node._ancestors || []).some(geometrySubtreeHidden));
}

function visibilityCoverage(designNodes, runtimeNodes) {
  const entry = node => ({id: node.id, text: node.text?.direct || '', box: visualBox(node),
    clippingAncestors: (node._ancestors || []).filter(n => /hidden|clip|scroll|auto/.test(
      [n.styles?.overflow, n.styles?.['overflow-x'], n.styles?.['overflow-y']].join(' ')))
      .map(n => ({id:n.id, box:visualBox(n)}))});
  const excluded = {};
  for (const [side,nodes] of [['design',designNodes],['runtime',runtimeNodes]])
    excluded[side] = nodes.filter(n => n.text?.direct && !inspectionVisible(n)).map(entry);
  const asymmetric = [];
  for (const [side,otherSide,nodes] of [['design','runtime',runtimeNodes],['runtime','design',designNodes]])
    for (const n of excluded[side]) {
      const candidates = nodes.filter(other => inspectionVisible(other) && compactText(other.text?.direct) === compactText(n.text));
      if (candidates.length === 1) asymmetric.push({hiddenSide:side,hidden:n,visibleSide:otherSide,visible:entry(candidates[0])});
    }
  return {policy:'shared-ancestor-clipping-v1',excluded,asymmetric,
    reason:'裁切范围外的文字不生成当前视图的样式检查；单侧可见候选只记录采集范围差异，不视为已配对或一致'};
}

function nodeRole(node, side) {
  const explicit = clean(node.role);
  if (['text', 'image', 'icon', 'shape', 'container', 'control'].includes(explicit)) return explicit;
  if (['button', 'link', 'textbox', 'combobox', 'searchbox'].includes(explicit)) return 'control';
  if (side === 'design') {
    if (node.type === 'TEXT') return 'text';
    if (node.asset) {
      // 设计侧曾把所有带 asset 的节点一律判 image。但设计师常把小图标做成矢量组件(asset=vector/SVG),
      //   它们本质是 icon, 却被判成 image → 与前端同款 icon 因 role 类别不同被硬门槛否决(配不上)。
      //   加尺寸判断: 矢量(SVG/vector) + 小尺寸(≤48) + 近方形 → 判 icon; 其余(位图/大图)才 image。
      const b = node._box || (node.box && node.box.local) || {};
      const w = b.width || node.width || 0;
      const h = b.height || node.height || 0;
      const isVector = node.asset.type === 'vector' || node.asset.format === 'SVG';
      const small = w > 0 && h > 0 && w <= 48 && h <= 48;
      const squarish = w > 0 && h > 0 && Math.max(w, h) / Math.min(w, h) <= 1.6;
      if (isVector && small && squarish) return 'icon';
      return 'image';
    }
    return 'container';
  }
  const tag = clean(node.tag);
  const selector = clean(node.selector);
  if (/(?:^|[.\s_-])(checkbox|check-box|radio|switch|toggle)(?:[.\s_-]|$)/.test(selector) && !node._text) return 'icon';
  if (['svg', 'path', 'use', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'].includes(tag)) return 'icon';
  if ((tag === 'i' || /(?:^|[._-])(icon|ico)(?:[._-]|$)/.test(selector)) && !node._text) return 'icon';
  if (['button', 'input', 'select', 'textarea', 'a'].includes(tag)) return 'control';
  if (node._text || ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'label', 'strong', 'em', 'th', 'td'].includes(tag)) return 'text';
  return ['img', 'svg', 'picture'].includes(tag) ? 'image' : 'container';
}

function semanticArea(node) {
  const normalized = String(node?._structureArea || node?._structureRole || '');
  if (/pagination/.test(normalized)) return '分页';
  if (/table|head-cell|data-cell|data-row/.test(normalized)) return '表格';
  if (/filter-row|filter-control/.test(normalized)) return '筛选区';
  if (/card/.test(normalized)) return '卡片';
  const path = [node, ...(node?._ancestors || [])];
  const corpus = path.map(item => [item.selector, item.name, item.componentName, item.tag].filter(Boolean).join(' ')).join(' ').toLowerCase();
  if (/pagination|pager|page-number|分页|跳转至|条\/页/.test(corpus)) return '分页';
  if (/table|thead|tbody|\btr\b|\btd\b|\bth\b|表格|表头/.test(corpus)) return '表格';
  if (/filter|search|query|form|筛选|查询区|搜索区|时间段/.test(corpus)) return '筛选区';
  if (/card|卡片/.test(corpus)) return '卡片';
  return '';
}

const STRUCTURE_REGIONS = new Set([
  'root', 'card', 'title-region', 'filter-row', 'table', 'table-head', 'table-body',
  'head-row', 'data-row-template', 'head-cell', 'data-cell', 'pagination'
]);
const CONTROL_ROLES = new Set(['filter-control', 'date-input', 'input', 'select', 'textarea', 'button', 'link']);

function setSimilarity(leftValues, rightValues) {
  const left = new Set((leftValues || []).filter(Boolean));
  const right = new Set((rightValues || []).filter(Boolean));
  if (!left.size && !right.size) return 1;
  let common = 0;
  left.forEach(value => {
    if (right.has(value)) common += 1;
  });
  return common / Math.max(1, left.size + right.size - common);
}

function nodeDirection(node) {
  const styles = canonicalStyles(node);
  const display = clean(styles.display);
  if (!/flex|grid/.test(display)) return 'none';
  if (/grid/.test(display)) return 'grid';
  return clean(styles['flex-direction'] || 'row').startsWith('column') ? 'vertical' : 'horizontal';
}

function nodeAnchor(node) {
  const direct = node?.text?.direct || node?.placeholder || node?.ariaLabel || node?.title || node?.alt || '';
  if (direct) return humanText(direct, 32);
  const tag = clean(node?.tag);
  const type = clean(node?.type);
  const iconLike = ['svg', 'path', 'use', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'i'].includes(tag)
    || ['vector', 'boolean_operation', 'line', 'polygon', 'star'].includes(type);
  if (!iconLike) return '';
  const source = [node?.name, node?.componentName, node?.selector].filter(Boolean).join(' ').toLowerCase();
  if (/calendar|date-picker|日期|日历/.test(source)) return '日历';
  if (/search|magnif|搜索|查询/.test(source)) return '搜索';
  if (/filter|筛选/.test(source)) return '筛选';
  if (/arrow.?right|right.?arrow|chevron.?right|右箭头/.test(source)) return '右箭头';
  if (/arrow.?left|left.?arrow|chevron.?left|左箭头/.test(source)) return '左箭头';
  if (/arrow.?down|down.?arrow|chevron.?down|下箭头/.test(source)) return '下箭头';
  if (/close|clear|remove|关闭|清除/.test(source)) return '关闭';
  return '';
}

function looksLikeCard(node, side) {
  const styles = canonicalStyles(node);
  const background = colorChannels(styles['background-color'] || styles.background);
  const hasRadius = radiusValues(styles).some(value => value > 0.01);
  const hasBorder = ['top', 'right', 'bottom', 'left'].some(edge => (number(styles[`border-${edge}-width`]) || 0) > 0.01
    && clean(styles[`border-${edge}-style`]) !== 'none');
  const hasShadow = styles['box-shadow'] && clean(styles['box-shadow']) !== 'none';
  const hasSurface = (background && background[3] > 0.02) || hasRadius || hasBorder || hasShadow;
  if (!hasSurface) return false;

  // 表格容器不是卡片：自身 selector/class 明显是表格容器，或直接子里有 <table> 结构。
  const selfCorpus = [node.selector, node.className, node.name].filter(Boolean).join(' ').toLowerCase();
  if (/table__content|table-content|table-wrapper|table__wrapper|table-container/.test(selfCorpus)) return false;
  const children = node._children || [];
  if (children.some(child => clean(child.tag) === 'table' || clean(child.tag) === 'thead' || clean(child.tag) === 'tbody')) return false;

  const width = number(node._box?.width) || 0;
  const height = number(node._box?.height) || 0;
  const bigEnough = (node._nw >= 0.4) || width >= 320 || (width >= 150 && height >= 72);
  if (!bigEnough) return false;

  const flatBar = height > 0 && height < 60 && width / Math.max(1, height) > 8;
  if (flatBar && !hasRadius && !hasShadow) return false;

  const contentRoles = new Set(['text', 'image', 'icon', 'control']);
  const contentChildren = descendantNodes(node, 200)
    .filter(child => contentRoles.has(nodeRole(child, side))).length;
  return contentChildren >= 2;
}

function semanticBaseRole(node, side, rootIndex) {
  if (node._index === rootIndex) return 'root';
  const tag = clean(node.tag);
  const source = [node.selector, node.type, node.name, node.componentName, node.role, node.ariaLabel, node.title]
    .filter(Boolean).join(' ').toLowerCase();
  const descendant = String(node.text?.descendant || '').toLowerCase();
  const identity = [node.selector, node.name, node.componentName].filter(Boolean).join(' ').toLowerCase();

  if (tag === 'table' || /^(frame\s+)?(表格|table)$/i.test(String(node.name || '').trim())) return 'table';
  if (tag === 'thead' || /^(表头|table[ _-]?head)$/i.test(String(node.name || '').trim())) return 'table-head';
  if (tag === 'tbody') return 'table-body';
  // 判 head-cell 排除 TEXT 节点: 单元格里的文字常继承组件名(如 TEXT "表头单元格"/文字"成交金额"),
  // 名字会命中下面正则,但它是单元格的【内容】而非单元格【容器】。若不排除,同一列会出现"外层单元格
  // 容器(INSTANCE)+内层文字"两个 head-cell,重复干扰配对与留白。文字应保持 text 角色。
  if ((tag === 'th' || /head[ _-]?cell|表头单元格/i.test(`${node.name || ''} ${node.componentName || ''}`))
    && clean(node.type) !== 'text' && tag !== 'span') return 'head-cell';
  if (tag === 'td') return 'data-cell';
  if (tag === 'tr') return 'table-row';
  if (/单元行|数据行|data[ _-]?row|table[ _-]?row|body.*(?:single|row)|(?:single|row).*body/i.test(source)) return 'data-row-template';
  if (/pagination|(?:^|[.\s_-])pager(?:[.\s_-]|$)|page-number|分页/.test(source)
    || (/条\/页|跳转至/.test(descendant) && /\b1\b.*\b2\b/.test(descendant))) return 'pagination';
  if (/(?:^|[.\s_-])(?:ai[\s_-]?module|ai模块)(?:[.\s_-]|$)|^(?:卡片|card)$/i.test(identity.trim())) return 'card';
  if (/^h[1-6]$/.test(tag) || /(?:^|[._-])(title|heading|cardh)(?:[._-]|$)|标题/.test(source)) return 'title';

  if (side === 'runtime') {
    if (/(?:^|[.\s_-])(checkbox|check-box|radio|switch|toggle)(?:[.\s_-]|$)/.test(source) && !node._text) return 'icon';
    const explicitRole = clean(node.role);
    const inputType = clean(node.inputType || 'text');
    if (tag === 'button' || explicitRole === 'button'
      || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType))) return 'button';
    if (tag === 'input') return /date|日期|时间|开始|结束/.test(`${node.inputType || ''} ${node.placeholder || ''} ${source}`) ? 'date-input' : 'input';
    if (tag === 'select' || ['combobox', 'listbox'].includes(explicitRole)
      || /listbox/.test(clean(node.ariaHasPopup))) return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'a' || explicitRole === 'link') return 'link';
    const selectorClasses = String(node.selector || '').toLowerCase().split('.').slice(1);
    const customSelect = selectorClasses.some(token => token === 'weui-desktop-form__dropdown'
      || /(?:^|[-_])(?:dropdown|select|combobox|picker)$/.test(token));
    const popupPanel = /(?:menu|popper|popup|option-list|dropdown-menu|select-menu)/.test(source);
    if (customSelect && !popupPanel && node._children.length > 0) return 'select';
    if (/form_item_content|form-item|filter-control|date-range/.test(source)) return 'filter-control';
    // 前端"伪日期选择器": div 里一排日期区间选项(今天/近7天/近30天/自定义), 无 <input> 特征,
    // 默认会退化成 card。设计侧靠图层名"时间筛选"命中 date-input, 前端侧原本没有对应识别 →
    // 两侧角色不一致(design=date-input / runtime=card)导致日期行配不上、上下间距漏测。此处按"内容+形状"补判:
    // 后代>=2个日期区间词 + 宽扁(w/h>=4) + 一行高度(20~60) + 宽<=800(排除撑满的外层面板壳) → date-input。
    {
      const dw = (node._box && node._box.width) || 0;
      const dh = (node._box && node._box.height) || 1;
      if (dw / Math.max(dh, 1e-6) >= 4 && dh >= 20 && dh <= 60 && dw <= 800) {
        const DATE_RANGE = /^(今[天日]|昨[天日]|近\d+[天日]|本[周月年]|上[周月年]|自定义|全部|全年)$/;
        let dateWords = 0;
        const stack = [...(node._children || [])];
        while (stack.length && dateWords < 2) {
          const child = stack.pop();
          if (DATE_RANGE.test(String(child._text || child.text?.direct || '').trim())) dateWords += 1;
          if (child._children) stack.push(...child._children);
        }
        if (dateWords >= 2) return 'date-input';
      }
    }
    if (['img', 'picture'].includes(tag)) return 'image';
    if (['svg', 'path', 'use', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'i'].includes(tag)) return 'icon';
  } else {
    const controlSource = `${node.name || ''} ${node.componentName || ''}`.toLowerCase();
    if (/btn|button|按钮/.test(controlSource) && String(node.text?.descendant || '').length <= 48) return 'button';
    if (/select|dropdown|下拉/.test(controlSource)) return 'select';
    if (/input|输入框/.test(controlSource)) return 'input';
    if (/calendar|date|time|日期|时间/.test(controlSource) && clean(node.type) !== 'text') return 'date-input';
    const exactFilterName = /^(filter|筛选器)$/i.test(String(node.name || '').trim())
      || /^(filter|筛选器)$/i.test(String(node.componentName || '').trim());
    const filterComponent = ['instance', 'component', 'component_set'].includes(clean(node.type))
      && /filter/.test(String(node.componentName || '').toLowerCase())
      && !/button/.test(controlSource);
    // "只认图层名"不可靠: 名叫 filter 的可能只是个 filter 图标(如"筛选指标"按钮前的漏斗图标),不是筛选控件。
    // 真正的筛选控件是"宽扁(含文字标签的下拉/输入框)"; filter 图标是"近正方形(宽高比<1.6)且内部无文字"。
    // 后者应判为 icon,否则会两侧角色不一致(design判control、runtime判icon)导致 icon 配不上、内部间距漏检。
    const boxW = (node._box && node._box.width) || node.width || 0;
    const boxH = (node._box && node._box.height) || node.height || 1;
    const hasOwnText = String(node.text?.descendant || node.text?.direct || '').trim().length > 0;
    const looksLikeIconNotControl = (boxW / Math.max(boxH, 1e-6)) < 1.6 && !hasOwnText;
    if ((exactFilterName || filterComponent) && !looksLikeIconNotControl) return 'filter-control';
  }

  const role = nodeRole(node, side);
  if (role === 'text') return 'text';
  if (role === 'icon') return 'icon';
  if (role === 'image') return 'image';
  if (role === 'control') return 'control';
  if (looksLikeCard(node, side)) return 'card';
  // 规范: "图标+文字"的小尺寸组合 → button。图标按钮(如"筛选指标""下载数据""自定义")常是无 button
  // 关键词的容器(icon/image 子 + text 子)。若漏判成 container, 会导致所在筛选区 actionCount=0 → 不被判
  // filter-row → 内部控件路径层级与另一侧错位配不上。此处按结构补判, ★两侧对称(否则一侧button一侧
  // container → 内部 icon 的 componentOwner 不一致、反而配不上)。
  {
    const kids = node._children || [];
    const boxW = (node._box && node._box.width) || 0;
  const boxH = (node._box && node._box.height) || 0;
    // 图形子: 设计看 asset/矢量/实例; 前端看 tag(img/svg/i)或 nodeRole=icon/image。
    const isGraphicKid = kid => Boolean(kid.asset) || kid.type === 'VECTOR' || kid.type === 'BOOLEAN_OPERATION'
      || (['INSTANCE', 'COMPONENT'].includes(kid.type) && !kid._text)
   || ['img', 'svg', 'picture', 'i'].includes(clean(kid.tag))
      || ['icon', 'image'].includes(nodeRole(kid, side));
    const isTextKid = kid => kid.type === 'TEXT' || Boolean(kid._text);
    const iconKids = kids.filter(isGraphicKid).length;
    const textKids = kids.filter(isTextKid).length;
    const small = boxW > 0 && boxW <= 200 && boxH > 0 && boxH <= 48;
    if (iconKids >= 1 && textKids >= 1 && small && kids.length <= 3) return 'button';
  }
  return 'container';
}

// ==== 角色识别统一(V2, 并行,暂不接入) ====
// 目标: 用一套"多信号"逻辑替代 semanticBaseRole 里 design/runtime 两套独立分支。
// 落地策略(用户确认): P1 先做到"新逻辑在现有数据上输出与旧逻辑一致"(diff 验证), 证明重构不改坏,
// 再逐角色强化信号。此处V2 保持与旧函数【相同判定优先级】, 仅把判定重组为可两侧共用的信号:
// 命名关键词(btn/date/select...)两侧都查、显式标记按side取tag/组件类型、内容特征(图标+文字/一排日期词)。
function semanticBaseRoleV2(node, side, rootIndex) {
  if (node._index === rootIndex) return 'root';
  const tag = clean(node.tag);
  const source = [node.selector, node.type, node.name, node.componentName, node.role, node.ariaLabel, node.title]
    .filter(Boolean).join(' ').toLowerCase();
  const identity = [node.selector, node.name, node.componentName].filter(Boolean).join(' ').toLowerCase();
  const descendant = String(node.text?.descendant || '').toLowerCase();
  const controlSource = `${node.name || ''} ${node.componentName || ''}`.toLowerCase();
  const boxW = (node._box && node._box.width) || node.width || 0;
  const boxH = (node._box && node._box.height) || node.height || 1;
  const hasOwnText = String(node.text?.descendant || node.text?.direct || '').trim().length > 0;
  const explicitRole = clean(node.role);
  const inputType = clean(node.inputType || 'text');
  // —— 结构/区域级(两侧共用, 与旧函数同序) ——
  if (tag === 'table' || /^(frame\s+)?(表格|table)$/i.test(String(node.name || '').trim())) return 'table';
  if (tag === 'thead' || /^(表头|table[ _-]?head)$/i.test(String(node.name || '').trim())) return 'table-head';
  if (tag === 'tbody') return 'table-body';
  if ((tag === 'th' || /head[ _-]?cell|表头单元格/i.test(`${node.name || ''} ${node.componentName || ''}`))
    && clean(node.type) !== 'text' && tag !== 'span') return 'head-cell';
  if (tag === 'td') return 'data-cell';
  if (tag === 'tr') return 'table-row';
  if (/单元行|数据行|data[ _-]?row|table[ _-]?row|body.*(?:single|row)|(?:single|row).*body/i.test(source)) return 'data-row-template';
  if (/pagination|pager|page-number|分页/.test(source)
    || (/条\/页|跳转至/.test(descendant) && /\b1\b.*\b2\b/.test(descendant))) return 'pagination';
  if (/(?:^|[.\s_-])(?:ai[\s_-]?module|ai模块)(?:[.\s_-]|$)|^(?:卡片|card)$/i.test(identity.trim())) return 'card';
  if (/^h[1-6]$/.test(tag) || /(?:^|[._-])(title|heading|cardh)(?:[._-]|$)|标题/.test(source)) return 'title';
  // —— 控件级(保持旧优先级, 但控件信号重组) ——
  if (side === 'runtime') {
    if (/(?:^|[.\s_-])(checkbox|check-box|radio|switch|toggle)(?:[.\s_-]|$)/.test(source) && !node._text) return 'icon';
    if (tag === 'button' || explicitRole === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType))) return 'button';
    if (tag === 'input') return /date|日期|时间|开始|结束/.test(`${node.inputType || ''} ${node.placeholder || ''} ${source}`) ? 'date-input' : 'input';
    if (tag === 'select' || ['combobox', 'listbox'].includes(explicitRole) || /listbox/.test(clean(node.ariaHasPopup))) return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'a' || explicitRole === 'link') return 'link';
    const selectorClasses = String(node.selector || '').toLowerCase().split('.').slice(1);
    const customSelect = selectorClasses.some(t => t === 'weui-desktop-form__dropdown' || /(?:^|[-_])(?:dropdown|select|combobox|picker)$/.test(t));
    const popupPanel = /(?:menu|popper|popup|option-list|dropdown-menu|select-menu)/.test(source);
    if (customSelect && !popupPanel && node._children.length > 0) return 'select';
    if (/form_item_content|form-item|filter-control|date-range/.test(source)) return 'filter-control';
    // 内容信号: 伪日期选择器(一排日期区间词)
    if (boxW / Math.max(boxH, 1e-6) >= 4 && boxH >= 20 && boxH <= 60 && boxW <= 800) {
      const DATE_RANGE = /^(今[天日]|昨[天日]|近\d+[天日]|本[周月年]|上[周月年]|自定义|全部|全年)$/;
      let n = 0; const stack = [...(node._children || [])];
      while (stack.length && n < 2) { const c = stack.pop(); if (DATE_RANGE.test(String(c._text || c.text?.direct || '').trim())) n += 1; if (c._children) stack.push(...c._children); }
      if (n >= 2) return 'date-input';
    }
    if (['img', 'picture'].includes(tag)) return 'image';
    if (['svg', 'path', 'use', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'i'].includes(tag)) return 'icon';
  } else {
    if (/btn|button|按钮/.test(controlSource) && String(node.text?.descendant || '').length <= 48) return 'button';
    if (/select|dropdown|下拉/.test(controlSource)) return 'select';
    if (/input|输入框/.test(controlSource)) return 'input';
    if (/calendar|date|time|日期|时间/.test(controlSource) && clean(node.type) !== 'text') return 'date-input';
    const exactFilterName = /^(filter|筛选器)$/i.test(String(node.name || '').trim()) || /^(filter|筛选器)$/i.test(String(node.componentName || '').trim());
    const filterComponent = ['instance', 'component', 'component_set'].includes(clean(node.type)) && /filter/.test(String(node.componentName || '').toLowerCase()) && !/button/.test(controlSource);
    const looksLikeIconNotControl = (boxW / Math.max(boxH, 1e-6)) < 1.6 && !hasOwnText;
    if ((exactFilterName || filterComponent) && !looksLikeIconNotControl) return 'filter-control';
  }
  // —— 内容/叶子 +卡片 + 图标按钮 + 兜底(与旧函数同序) ——
  const role = nodeRole(node, side);
  if (role === 'text') return 'text';
  if (role === 'icon') return 'icon';
  if (role === 'image') return 'image';
  if (role === 'control') return 'control';
  if (looksLikeCard(node, side)) return 'card';
  {
    const kids = node._children || [];
    const isGraphicKid = kid => Boolean(kid.asset) || kid.type === 'VECTOR' || kid.type === 'BOOLEAN_OPERATION'
      || (['INSTANCE', 'COMPONENT'].includes(kid.type) && !kid._text)
      || ['img', 'svg', 'picture', 'i'].includes(clean(kid.tag))
      || ['icon', 'image'].includes(nodeRole(kid, side));
    const isTextKid = kid => kid.type === 'TEXT' || Boolean(kid._text);
    const iconKids = kids.filter(isGraphicKid).length;
    const textKids = kids.filter(isTextKid).length;
    const small = boxW > 0 && boxW <= 200 && boxH > 0 && boxH <= 48;
    if (iconKids >= 1 && textKids >= 1 && small && kids.length <= 3) return 'button';
  }
  return 'container';
}

function descendantNodes(node, limit = 240) {
  const output = [];
  const queue = [...(node?._children || [])];
  while (queue.length && output.length < limit) {
    const current = queue.shift();
    output.push(current);
    queue.push(...(current._children || []));
  }
  return output;
}

function structureAnchors(node, skipped) {
  const output = [];
  const candidates = [node, ...descendantNodes(node)];
  for (const item of candidates) {
    if (skipped.has(item._index)) continue;
    const value = nodeAnchor(item);
    const compact = compactText(value);
    if (!compact || compact.length > 32 || /^\d{5,}$/.test(compact) || output.some(entry => entry.compact === compact)) continue;
    output.push({value, compact});
    if (output.length >= 16) break;
  }
  return output;
}

// 表格几何重建(仅 design 侧): 设计稿常把表格外框/行/单元格图层名全命名为"Table"，
// semanticBaseRole 只认名字 → 整表塌成一堆笼统table，行/列层级丢失，内部间距无从计算。
// 这里对"塌陷的表格"按几何网格重建: 按 y聚类成行、按 x 聚类成列，
// 给每个文字叶子的最近 table 祖先改判 head-cell(首行)/data-cell(其余)，并标 _gridRow/_gridCol。
// 最小实现: 不造虚拟节点，只改角色 + 标网格索引，风险最低。失败(行/列<2)则整表回退，不动。
const TABLE_ROW_TOLERANCE = 12;
const TABLE_COL_TOLERANCE = 24;
function rebuildCollapsedTables(nodes, roles) {
  // 触发对象: 已识别为 table 的最外层节点，且正规 pipeline 没能在它内部生成任何单元格
  // (head-cell/data-cell)。两种形态都会落到这里:
  //   1) 整表子孙全叫 "Table" 塌成一堆 table，行/列/单元格都没被判成 cell;
  //   2) 表名规整("表格")但内部行/单元格叫 "标题行/内容行/文本内容"，被判成 title/container，
  //      正规 pipeline(依赖 table-head/table-row 命名)接不住 → 内部同样无 cell。
  // 只要内部还没有 cell，就用几何(按 y 分行、按 x 分列)重建兜底；已成功生成 cell 的表跳过。
  const tableNodes = nodes.filter(node => roles.get(node._index) === 'table');
  const tableIndexSet = new Set(tableNodes.map(node => node._index));
  const collapsedRoots = tableNodes.filter(node => {
    if (node._ancestors.some(anc => tableIndexSet.has(anc._index))) return false; // 只取最外层 table
    const inner = descendantNodes(node, 2000);
    const hasCell = inner.some(item => {
      const r = roles.get(item._index);
      return r === 'head-cell' || r === 'data-cell';
    });
    return !hasCell; // 内部没有任何正规单元格 → 需要几何重建
  });

  collapsedRoots.forEach(root => {
    // 收集整表子树内的文字叶子(有 text.direct)
    const leaves = descendantNodes(root, 2000)
      .filter(item => clean(item.text?.direct))
      .map(item => ({node: item, x: item._box.x || 0, y: item._box.y || 0, w: item._box.width || 0}));
    if (leaves.length < 4) return;

    // 分行: 优先用"行容器"分组，而非纯 y 聚类。理由——同一单元格内常有多行文字
    // (如主数值 y=1175 与涨跌 +7.6% y=1197相差 22px)，纯 y 聚类会把一行拆成两行。
    // 而Figma/DOM 里"行"通常是一个宽度接近整表的容器(内容行/标题行/塌陷表的行级 Table)，
    // 用"叶子向上最近的、宽度≥整表 80% 的祖先"当行键，能把同格多行文字正确并回一行。
    // 阈值取 0.8: 实测(4 张真实表) 0.6 会把"行内嵌的宽信息块"(占比 0.6~0.7)误当成独立行导致列数
    // 错乱，抬到 0.7 以上即可挡住；0.8 居中——既高于伪行宽块，又给"真行略有左右内缩"留 20% 余量。
    // 找不到这种祖先的叶子(直接挂在表下)则回退到自身 y 单独成行。
    const tableWidth = root._box.width || 1;
    const rowKeyOf = leaf => {
      let cur = leaf.node._parent;
      while (cur && cur._index !== root._index) {
        if ((cur._box.width || 0) >= tableWidth * 0.8) return cur;
        cur = cur._parent;
      }
      return null;
    };
    const rowMap = new Map();
    leaves.forEach(leaf => {
      const container = rowKeyOf(leaf);
      const key = container ? `c${container._index}` : `y${Math.round(leaf.y / TABLE_ROW_TOLERANCE)}`;
      const rowY = container ? (container._box.y || leaf.y) : leaf.y;
      if (!rowMap.has(key)) rowMap.set(key, {y: rowY, items: []});
      rowMap.get(key).items.push(leaf);
    });
    const rows = [...rowMap.values()];
    if (rows.length < 2) return; // 分不出多行 → 放弃
    rows.sort((a, b) => a.y - b.y);

    // 先把每个文字叶子归到它的"单元格容器"。
    //   优先: 取"行容器的直接子"那一层当单元格(如设计 Header 行→Title/数值等直接子单元格)。因为单元格容器
    //   通常直挂在行下, 它才带真实 padding(文字到单元格边的留白); 若取更内层的文字包裹FRAME(如 Title, 宽=文字宽)
    //   则cell 边=文字边、inset 恒 0、量不出 padding。
    //   兜底: 找不到行容器时, 取"叶子向上、宽度< 整表80% 的最小包裹 FRAME"(原逻辑)。
    const cellOf = leaf => {
      const rowContainer = rowKeyOf(leaf); // 该叶子所属的行容器(宽≈整表)
      if (rowContainer) {
        // 从叶子向上找"父==行容器"的那一层 = 单元格
        let cur = leaf.node;
        while (cur && cur._parent && cur._parent._index !== rowContainer._index) cur = cur._parent;
        if (cur && cur._parent && cur._parent._index === rowContainer._index) return cur;
      }
      let cell = leaf.node._parent || leaf.node;
      let cur = leaf.node._parent;
      while (cur && cur._index !== root._index) {
        if ((cur._box.width || 0) < tableWidth * 0.8) { cell = cur; break; }
        cur = cur._parent;
      }
      return cell;
    };
    const cellCenterX = cell => (cell._box.x || 0) + (cell._box.width || 0) / 2;

    // 列由表头行(第一行)各单元格容器的中心 x 确定——用容器中心而非文字左缘，避免"同格多文字"
    // (主数值靠左、涨跌靠右)被拆成两列，导致数据行列数比表头多。
    const headCells = [];
    rows[0].items.forEach(leaf => {
      const cell = cellOf(leaf);
      if (!headCells.some(item => item._index === cell._index)) headCells.push(cell);
    });
    const cols = [];
    headCells.map(cellCenterX).sort((a, b) => a - b).forEach(cx => {
      if (!cols.some(c => Math.abs(c.x - cx) <= TABLE_COL_TOLERANCE)) cols.push({x: cx});
    });
    cols.sort((a, b) => a.x - b.x);
    if (cols.length < 2) return; // 分不出多列 → 放弃

    // 给每个单元格容器改判 head-cell/data-cell + 标网格索引。按容器中心 x 就近归列。
    rows.forEach((row, rowIndex) => {
      const seen = new Set();
      row.items.forEach(leaf => {
        const cell = cellOf(leaf);
        if (seen.has(cell._index)) return; // 同格多文字只标一次
        seen.add(cell._index);
        const cx = cellCenterX(cell);
        let colIndex = 0, best = Infinity;
        cols.forEach((c, ci) => { const d = Math.abs(c.x - cx); if (d < best) { best = d; colIndex = ci; } });
        roles.set(cell._index, rowIndex === 0 ? 'head-cell' : 'data-cell');
        cell._gridRow = rowIndex;
        cell._gridCol = colIndex;
        cell._gridTableIndex = root._index;
      });
    });
    root._gridRows = rows.length;
    root._gridCols = cols.length;
    root._gridColX = cols.map(c => c.x);
    // 清理内层残留 table role:塌陷表里行/单元格容器常也被判成 table(图层名全叫 Table),
    //   重建只给"叶子的单元格容器"标了 head-cell/data-cell, 但那些被误判成 table 的中间层(行/格容器)
    //   若不清理会原样输出→一个表炸成 26 个 table(套娃), 污染配对候选池。故把 root 内部(非root 自身)
    //   所有残留 table 降级为 container(普通容器, 不再当表, 也不干扰已标好的 cell)。
    descendantNodes(root, 2000).forEach(item => {
      if (item._index !== root._index && roles.get(item._index) === 'table') {
        roles.set(item._index, 'container');
      }
    });
  });
}

function buildSemanticStructure(nodes, side, rootIndex, exportedStructure) {
  const exportedBySource = new Map((exportedStructure?.nodes || []).map(node => [node.sourceId, node]));
  const roles = new Map(nodes.map(node => [node._index, semanticBaseRole(node, side, rootIndex)]));

  nodes.forEach(node => {
    const role = roles.get(node._index);
    const parentRole = node._parent ? roles.get(node._parent._index) : '';
    if (role === 'table-row') roles.set(node._index, parentRole === 'table-head' ? 'head-row' : 'data-row-template');
    if (parentRole === 'table-head' && role === 'container') roles.set(node._index, 'head-cell');
    if (parentRole === 'data-row-template' && !['text', 'icon', 'image'].includes(role)) roles.set(node._index, 'data-cell');
  });

  nodes.forEach(node => {
    const role = roles.get(node._index);
    if (role !== 'container') return;
    const ancestorRoles = node._ancestors.map(ancestor => roles.get(ancestor._index));
    // 单元格不嵌套单元格: 若某祖先已被判为 head-cell/data-cell,则本节点是"单元格内部的子容器",
    // 不能再重复打成 cell(否则同一列会出现"外层单元格+内层内容块"两个 head-cell,干扰配对与留白)。
    if (ancestorRoles.includes('head-cell') || ancestorRoles.includes('data-cell')) return;
    const source = [node.name, node.componentName, node.selector].filter(Boolean).join(' ').toLowerCase();
    if (ancestorRoles.includes('table-head') && /(?:cell|column|表头|列)/.test(source)) roles.set(node._index, 'head-cell');
    if (ancestorRoles.includes('data-row-template') && /(?:cell|column|单元格|列)/.test(source)) roles.set(node._index, 'data-cell');
  });

  nodes.forEach(node => {
    if (roles.get(node._index) !== 'container') return;
    const direction = nodeDirection(node);
    const descendants = descendantNodes(node);
    const anchors = descendants.map(item => compactText(nodeAnchor(item))).filter(Boolean);
    const hasAction = anchors.some(value => /(查询|筛选|搜索|重置|search|filter|reset)/.test(value));
    const descendantRoles = descendants.map(item => roles.get(item._index));
    const fieldCount = descendantRoles.filter(role => FORM_FIELD_ROLES.has(role)).length;
    const actionCount = descendantRoles.filter(role => ['button', 'link'].includes(role)).length;
    if (direction === 'horizontal' && hasAction && fieldCount >= 1 && (fieldCount >= 2 || actionCount >= 1)) {
      roles.set(node._index, 'filter-row');
    } else if (direction === 'horizontal' && descendants.some(item => roles.get(item._index) === 'title') && anchors.length <= 2) {
      roles.set(node._index, 'title-region');
    }
  });

  if (side === 'design') rebuildCollapsedTables(nodes, roles);
  // 前端(runtime)真实 DOM 表格: cell 天然有行列结构(th/td 在 tr 下), 但没走几何重建、无 _gridRow/_gridCol。
  //   按 DOM 位置补标网格坐标, 使前端 cell 的 areaKey 编号(head-cell#{col}/data-cell#{row}-{col})与设计侧几何
  //   重建的编号格式统一, 两侧才能靠 areaKey 对齐配对。列=cell 在其行内按 x 的序; 行=表头0/数据行按y 序。
  if (side === 'runtime') {
    const rtTables = nodes.filter(node => roles.get(node._index) === 'table');
    rtTables.forEach(tbl => {
      const cells = descendantNodes(tbl, 2000).filter(n =>['head-cell', 'data-cell'].includes(roles.get(n._index)));
      if (!cells.length) return;
      // 按 y 分行(容差), 行内按 x 定列
      const rowsY = [];
      cells.forEach(c => {
        const cy = c._box.y || 0;
        let row = rowsY.find(r => Math.abs(r.y - cy) <= TABLE_ROW_TOLERANCE);
        if (!row) { row = {y: cy, items: []}; rowsY.push(row); }
        row.items.push(c);
      });
      rowsY.sort((a, b) => a.y - b.y);
      rowsY.forEach((row, ri) => {
        row.items.sort((a, b) => (a._box.x || 0) - (b._box.x || 0));
        row.items.forEach((c, ci) => { c._gridRow = ri; c._gridCol = ci; });
      });
    });
  }

  const rowsByTable = new Map();
  nodes.filter(node => roles.get(node._index) === 'data-row-template').forEach(row => {
    const table = [row, ...row._ancestors].find(item => roles.get(item._index) === 'table');
    const key = table?._index ?? -1;
    if (!rowsByTable.has(key)) rowsByTable.set(key, []);
    rowsByTable.get(key).push(row);
  });
  const skipped = new Set();
  rowsByTable.forEach(rows => {
    rows.sort((left, right) => (left._box.y || 0) - (right._box.y || 0));
    rows.slice(1).forEach(row => {
      skipped.add(row._index);
      descendantNodes(row, 1000).forEach(node => skipped.add(node._index));
    });
  });

  const keep = new Set();
  nodes.forEach(node => {
    if (skipped.has(node._index)) return;
    const role = roles.get(node._index);
    const styles = canonicalStyles(node);
    const nonzeroPadding = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']
      .some(property => Math.abs(number(styles[property]) || 0) > 0.01);
    const gap = Math.max(Math.abs(number(styles['row-gap']) || 0), Math.abs(number(styles['column-gap']) || 0));
    const directSemanticChildren = node._children.filter(child => roles.get(child._index) !== 'container').length;
    const descendants = descendantNodes(node);
    const singleLabelBoundary = nonzeroPadding && node._children.length > 0
      && descendants.filter(child => compactText(child.text?.direct)).length === 1
      && !descendants.some(child => geometrySemanticLeaf(child, side));
    const meaningfulLayout = singleLabelBoundary || (nodeDirection(node) !== 'none' && node._children.length >= 2
      && (gap > 0 || nonzeroPadding || directSemanticChildren >= 2));
    const exportedHint = exportedBySource.get(node.id);
    const hasVisualSurface = geometryPaintedBox(node, side);
    if (node._index === rootIndex || role !== 'container' || meaningfulLayout || hasVisualSurface || (exportedHint && exportedHint.role !== 'container')) keep.add(node._index);
  });

  const structureNodes = nodes.filter(node => keep.has(node._index)).map((raw, index) => {
    let parent = raw._parent;
    while (parent && !keep.has(parent._index)) parent = parent._parent;
    const anchors = structureAnchors(raw, skipped);
    const exportedHint = exportedBySource.get(raw.id);
    return {
      id: `${side[0]}s${index + 1}`,
      raw,
      rawIndex: raw._index,
      role: roles.get(raw._index),
      direction: nodeDirection(raw),
      anchors,
      primaryAnchor: anchors[0]?.compact || '',
      controls: descendantNodes(raw).map(item => roles.get(item._index)).filter(role => CONTROL_ROLES.has(role)).slice(0, 16),
      parentRawIndex: parent?._index ?? null,
      parent: null,
      children: [],
      ordinal: 0,
      areaKey: '',
      structureKey: '',
      exportedHint: exportedHint || null
    };
  });
  const byRawIndex = new Map(structureNodes.map(node => [node.rawIndex, node]));
  structureNodes.forEach(node => {
    node.parent = byRawIndex.get(node.parentRawIndex) || null;
    if (node.parent) node.parent.children.push(node);
  });
  structureNodes.forEach(parent => {
    const ordered = [...parent.children].sort((left, right) => {
      const y = (left.raw._box.y || 0) - (right.raw._box.y || 0);
      return Math.abs(y) > 2 ? y : (left.raw._box.x || 0) - (right.raw._box.x || 0);
    });
    const counts = new Map();
    ordered.forEach(child => {
      const count = counts.get(child.role) || 0;
      child.ordinal = count;
      counts.set(child.role, count + 1);
    });
  });

  structureNodes.filter(node => node.role === 'card')
    .sort((left, right) => {
      const y = (left.raw._box.y || 0) - (right.raw._box.y || 0);
      return Math.abs(y) > 2 ? y : (left.raw._box.x || 0) - (right.raw._box.x || 0);
    })
    .forEach((node, index) => {
      node.ordinal = index;
    });

  const regionToken = node => {
    if (!['card', 'head-cell', 'data-cell', 'filter-row', 'pagination', 'table'].includes(node.role)) return node.role;
    // 表格单元格: 若几何重建标了网格坐标(_gridRow/_gridCol), 用【网格位置】而非父容器内 ordinal 定编号。
    //   原因: 设计侧塌陷表几何重建后, cell 常散挂在不同 container 里, 按"父内ordinal"编号(head-cell#0/#6)
    //   与真实列号无关且两侧对不上→areaKey 不等→data-cell 全被 996 行"areaKey 必须相同"拒配。
    //   改用网格坐标:前端 DOM cell 的 ordinal 天然=列号, 设计 gridCol也=列号 → 两侧head-cell#{col} 对齐。
    if ((node.role === 'head-cell' || node.role === 'data-cell')) {
      const gc = node.raw._gridCol, gr = node.raw._gridRow;
      if (gc != null) return node.role === 'head-cell' ? `${node.role}#${gc}` : `${node.role}#${gr ?? 0}-${gc}`;
    }
    return `${node.role}#${node.ordinal}`;
  };
  // 单子包装壳:一个 card 若只有 1 个直接子(不管子是另一个 card 还是单个控件), 它只是"包裹壳"。
  // 但只透明化"内层"的单子壳、保留最外层一层 card, 避免把整条 card 链抹平导致比另一侧少一层。
  // 典型: 前端日期选择器被 div.content(单子card)→div.filter-panel-new(单子card)→date-input 两层壳包着,
  // 设计侧只有 card→date-input 一层。若两层壳都透明→前端 date-input 直挂 root、比设计还少一层; 若都不透明
  //→比设计多一层。正解: 保留最外层壳(对齐设计的那一层card)、只透明其内层多余的单子壳。
  // 判据"只包单个子 + 父也是card(即它是内层)"精准命中多余层, 不误伤真卡片(多子)与最外层。
  const isSingleChildWrapper = node => node.role === 'card' && node.children.length === 1
    && node.parent && node.parent.role === 'card' && node.parent.children.length === 1;
  // 表格 DOM 结构中间层(table-head/table-body/head-row/data-row-template)不进 areaKey:
  //   前端真实 DOM 有这几层(table>thead>tr>th), 但设计侧几何重建的表 cell 直挂 table(无这些层)。
  //   若它们进 areaKey→两侧 cell 路径不等(前端 table#0/table-head/head-row/head-cell#0 vs 设计 table#0/head-cell#0)
  //   →data-cell 靠 areaKey 配对全失败。透明化这几层后两侧 cell 路径归一到 table#N/cell#N。
  const TABLE_TRANSPARENT_ROLES = new Set(['table-head', 'table-body', 'head-row', 'data-row-template']);
  const assignKeys = node => {
    const parentRegions = node.parent?.areaKey ? node.parent.areaKey.split('/') : [];
    const selfIsRegion = STRUCTURE_REGIONS.has(node.role) && !isSingleChildWrapper(node)
      && !TABLE_TRANSPARENT_ROLES.has(node.role);
    const regions = selfIsRegion ? [...parentRegions, regionToken(node)] : parentRegions;
    node.areaKey = collapseAreaKey(regions.join('/') || 'root');
    const anchorPart = node.primaryAnchor ? `:${node.primaryAnchor}` : '';
    node.structureKey = `${node.areaKey}|${node.role}|${node.direction}|${node.ordinal}${anchorPart}`;
    node.raw._structureRole = node.role;
    node.raw._structureArea = node.areaKey;
    node.raw._structureKey = node.structureKey;
    node.raw._structureAnchors = node.anchors.map(item => item.compact).filter(Boolean);
    node.children.forEach(assignKeys);
  };
  structureNodes.filter(node => !node.parent).forEach(assignKeys);
  nodes.forEach(raw => {
    raw._semanticRole = roles.get(raw._index) || '';
    raw._templateSkipped = skipped.has(raw._index);
    if (raw._structureKey || skipped.has(raw._index)) return;
    const owner = raw._ancestors.find(ancestor => ancestor._structureKey);
    if (!owner) return;
    raw._structureRole = owner._structureRole;
    raw._structureArea = owner._structureArea;
    raw._structureOwnerIndex = owner._index;
  });
  structureNodes.forEach(node => {
    node.childRoles = node.children.map(child => child.role);
    node.childShapes = node.children.map(child => `${structureRoleCategory(child.role)}:${child.direction}`);
  });
  return {nodes: structureNodes, byRawIndex, skipped, templatesCollapsed: skipped.size, ambiguous: []};
}

function structureRoleCategory(role) {
  if (CONTROL_ROLES.has(role) || role === 'control') return 'control';
  if (STRUCTURE_REGIONS.has(role)) return role;
  if (['text', 'title'].includes(role)) return 'text';
  if (['icon', 'image'].includes(role)) return role;
  return 'layout';
}

// 折叠 areaKey 里"连续且完全相同"的区域 token: root/card#1/filter-row#0/filter-row#0 → root/card#1/filter-row#0。
// 治"同一区域被冗余自嵌套"(设计师爱多套一层同名 Frame, 前端只有一层)导致的两侧路径深度不一致→配不上。
// 只折叠"完全相同(含序号)且相邻"的, 不碰不同序号/不同类型 → 不会把不同卡片/不同区域混为一谈。
// 在 assignKeys 生成 areaKey 后即折叠, 全局(groupKey/配对确认/padding)一致使用折叠后路径。
function collapseAreaKey(areaKey) {
  const parts = areaKey.split('/');
  const out = [];
  for (const part of parts) {
    if (out.length && out[out.length - 1] === part) continue; // 相邻完全相同 → 折叠
    out.push(part);
  }
  return out.join('/');
}

function structureGroupKey(node) {
  const category = structureRoleCategory(node.role);
  if (STRUCTURE_REGIONS.has(node.role)) return `region:${node.role}`;
  let owner = node.parent;
  while (owner && structureRoleCategory(owner.role) === 'layout') owner = owner.parent;
  const componentOwner = owner && structureRoleCategory(owner.role) === 'control'
    ? `${owner.role}:${owner.primaryAnchor || owner.ordinal}`
    : '';
  // 控件/带锚点布局容器的分组键淡化"绝对卡片序号": areaKey 里的 card#N 用 card#* 归一。
  // 原因: 两侧顶层模块数量/顺序常不一致(设计 card#1 ↔ 前端 card#3)，绝对序号会让本该同组的同一个
  // 元素分到不同组、永远无法相遇配对(其间距/留白因此全查不了)。归一后靠 primaryAnchor(如"成交场景"
  // /"重置")+ uniqueAnchor(组内锚点两侧各唯一)保证不会把不同卡的同名元素错配。
  //
  // ⚠️ 补丁(治标非治本): 真正的病根是 groupKey 依赖"绝对卡片序号"这一脆弱分组依据。这里逐类型开口
  // (先control、再"带锚点的 layout")是打补丁——下次别的类型漏了还得再开口，条件会越堆越复杂。
  // 治本方向: groupKey 全类型去序号化(card#*) + 强化配对确认(几何接近/内容重合)，或改用"结构指纹"
  // 分组。待case积累够后专门重构收掉这串补丁。
  //
  // 为何"带锚点的 layout"可以、"纯布局空盒"不行: 带primaryAnchor 的容器(如重置按钮含"重置")有内容
  // 身份证，归一卡号后仍能区分谁是谁; 纯布局空盒无锚点，去掉卡号后多个卡的"孪生盒"groupKey 变得一样、
  // 几何也像，只能靠 margin/hardIdentity 兜底而这俩在孪生盒面前很脆 → 易跨卡错配。故只对有锚点的 layout 归一。
  //
  // icon/image 也纳入卡号归一: 它们没有内容锚点(前端 src/alt 空、Figma 矢量名没进锚点)，本身是"哑元素"，
  // 只能靠 区域路径+序号+几何 配对。归一卡号让两侧 icon 能进同组相遇; 而"跨容器错配"由下游 reliableGraphic
  // 的"归一后 areaKey 仍需相同"(含filter-row/head-cell 等容器路径,跨容器必不等)挡住 → 只有同一容器内的
  // icon 才可能配, 天然被约束在已配对容器内部。
  //带锚点的 text 也纳入归一: 如重置按钮里的"重置"文字,两侧卡号错位(card#1↔card#3)会让它分到不同组、
  // 永不相遇,导致按钮内部icon↔文字间距查不了。text 的真身份是 primaryAnchor(文字内容),归一卡号后靠
  // uniqueAnchor(组内该锚点两侧各唯一)仍能区分——重复文字(多个"全部")不唯一则不误配。无锚装饰文字不动。
  const normalizeCard = category === 'control'
    || (category === 'layout' && node.primaryAnchor)
    || (category === 'text' && node.primaryAnchor)
    || category === 'icon' || category === 'image';
  const areaKey = normalizeCard ? node.areaKey.replace(/card#\d+/g, 'card#*') : node.areaKey;
  return `${areaKey}|${category}|${category === 'layout' ? node.direction : ''}|${componentOwner}`;
}

const FORM_FIELD_ROLES = new Set(['filter-control', 'date-input', 'input', 'select', 'textarea', 'control']);

function sequenceSimilarity(leftValues, rightValues) {
  const left = leftValues || [];
  const right = rightValues || [];
  if (!left.length && !right.length) return 1;
  if (!left.length || !right.length) return 0;
  const rows = Array.from({length: left.length + 1}, () => Array(right.length + 1).fill(0));
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      rows[leftIndex][rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? rows[leftIndex - 1][rightIndex - 1] + 1
        : Math.max(rows[leftIndex - 1][rightIndex], rows[leftIndex][rightIndex - 1]);
    }
  }
  return (2 * rows[left.length][right.length]) / (left.length + right.length);
}

function controlRolesCompatible(designRole, runtimeRole) {
  if (designRole === runtimeRole) return true;
  if (!FORM_FIELD_ROLES.has(designRole) || !FORM_FIELD_ROLES.has(runtimeRole)) return false;
  return ['filter-control', 'control'].includes(designRole)
    || ['filter-control', 'control'].includes(runtimeRole);
}

function structurePairScore(designNode, runtimeNode) {
  if (!semanticScopesCompatible(designNode.raw, runtimeNode.raw)) return null;
  const designCategory = structureRoleCategory(designNode.role);
  const runtimeCategory = structureRoleCategory(runtimeNode.role);
  if (designCategory !== runtimeCategory) return null;
  if(['icon', 'image'].includes(designCategory) && designNode.role !== runtimeNode.role) return null;
  if (STRUCTURE_REGIONS.has(designNode.role) && designNode.role !== runtimeNode.role) return null;
  if (designCategory === 'text' && designNode.primaryAnchor && runtimeNode.primaryAnchor && designNode.primaryAnchor !== runtimeNode.primaryAnchor) return null;
  if (designNode.direction !== 'none' && runtimeNode.direction !== 'none' && designNode.direction !== runtimeNode.direction) return null;
  const designCardChildren = designNode.children.filter(child => child.role === 'card').length;
  const runtimeCardChildren = runtimeNode.children.filter(child => child.role === 'card').length;
  if (Boolean(designCardChildren) !== Boolean(runtimeCardChildren)) return null;

  // 卡片/表格类体量否决：宽度比过小意味着一个是小卡、一个是大模块，视觉体量不同，绝不是同一个东西。
  if ((designNode.role === 'card' || designNode.role === 'table') && (runtimeNode.role === 'card' || runtimeNode.role === 'table')) {
    const cardWidthRatio = Math.min(designNode.raw._nw, runtimeNode.raw._nw) / Math.max(designNode.raw._nw, runtimeNode.raw._nw, 1e-6);
    if (cardWidthRatio < 0.35) return null;
  }

  // icon/image 是无内容身份的"哑元素",归一卡号后 areaKey 可能不足以区分同卡不同容器里的 icon
  // (普通容器不进 areaKey)。故对icon/image 强制位置硬约束:两侧中心距超阈值直接拒——只有几何位置
  // 真正接近的 icon 才可能是同一个,杜绝"位置差很远的两个 icon 因都是小方块而跨容器错配"。
  const anchorOnly = designCategory === 'text' || designCategory === 'control';
  if (anchorOnly || ['icon', 'image'].includes(designCategory)) {
    const designCx = designNode.raw._nx + designNode.raw._nw / 2;
    const designCy = designNode.raw._ny + designNode.raw._nh / 2;
    const runtimeCx = runtimeNode.raw._nx + runtimeNode.raw._nw / 2;
    const runtimeCy = runtimeNode.raw._ny + runtimeNode.raw._nh / 2;
    const centerDist = Math.abs(designCx - runtimeCx) + Math.abs(designCy - runtimeCy);
    // icon/image阈值放宽到0.2:跨卡场景下同一icon 两侧 x 接近但 y 可能因模块高度不同而有偏移,
    // 太严(如0.08)会误杀正常跨卡配对;0.2 仍能挡住"位置相距很远(差数百px)的明显跨容器错配"。
    const POS_HARD = ['icon', 'image'].includes(designCategory) ? 0.2 : 0.28;
    if (centerDist > POS_HARD) return null;
    if (designCategory === 'control') {
      const widthRatio = Math.min(designNode.raw._nw, runtimeNode.raw._nw) / Math.max(designNode.raw._nw, runtimeNode.raw._nw, 1e-6);
      const heightRatio = Math.min(designNode.raw._nh, runtimeNode.raw._nh) / Math.max(designNode.raw._nh, runtimeNode.raw._nh, 1e-6);
      const SIZE_HARD = 0.45;
      if (widthRatio < SIZE_HARD || heightRatio < SIZE_HARD) return null;
    }
  }

  const designAnchors = designNode.anchors.map(item => item.compact);
  const runtimeAnchors = runtimeNode.anchors.map(item => item.compact);
  // 数据单元格(data-cell)的内容是数据驱动的(设计稿放示例数据、前端是真实数据)，两侧内容天生不同；
  // 连"1"这种短数字也可能在不同表格的同序号列上巧合撞值。故 data-cell 之间一律不把"内容锚点"
  // (无论 primaryAnchor 还是 anchor 集合)当作身份证据——否则会把 A 表的数据格错配到 B 表同序号
  // 的数据格上(跨表错配)。表头(head-cell)不受影响：列名是稳定标识，仍可精确配对。
  const isDataCellPair = designNode.role === 'data-cell' && runtimeNode.role === 'data-cell';
  // data-cell 的内容不可当身份 → 只能靠"结构位置"确认。两侧必须处于同一条区域路径(areaKey 完全相同)
  // 才允许配对。⚠️ 不可归一化 card 号: 归一后多个表(card#13/#14/#15 的 table#0)的同位置 data-cell 会
  //   全部撞成 card#*/table#0/data-cell#{r}-{c}, 造成跨表错配(实测card#15"关联账号"错配到前端"m")。
  //   跨表 data-cell 的正确配对应由"父表已配对"驱动, 而非在此逐对放宽 —— 保持严格,宁可不配不错配。
  if (isDataCellPair && designNode.areaKey !== runtimeNode.areaKey) return null;
  const anchorSimilarity = isDataCellPair ? 0 : setSimilarity(designAnchors, runtimeAnchors);
  let controlGeometryExempt = false; // control 锚点相似度0 但几何强证据充分 → 豁免锚点门槛
  if (designCategory === 'control') {
    if (!controlRolesCompatible(designNode.role, runtimeNode.role)) return null;
    // 锚点相似度为0(两侧文字完全不同, 如搜索框 placeholder"输入商品名称"vs"搜索商品名称")时,
    // 默认否决(锚点是控件身份证)。但若"几何强证据"充分——位置极近 + 高度接近 + 同一区域路径——
    // 说明它就是同位置的同一个控件, 文字只是文案差异, 此时豁免锚点门槛(不卡宽度: 前端输入框常撑宽)。
    // 阈值比 POS_HARD/SIZE_HARD 更严, 且要求同区域路径, 杜绝跨区错配。
    if ((designAnchors.length || runtimeAnchors.length) && anchorSimilarity <= 0) {
      const dcx = designNode.raw._nx + designNode.raw._nw / 2, dcy = designNode.raw._ny + designNode.raw._nh / 2;
      const rcx = runtimeNode.raw._nx + runtimeNode.raw._nw / 2, rcy = runtimeNode.raw._ny + runtimeNode.raw._nh / 2;
      const cDist = Math.abs(dcx - rcx) + Math.abs(dcy - rcy);
      const hr = Math.min(designNode.raw._nh, runtimeNode.raw._nh) / Math.max(designNode.raw._nh, runtimeNode.raw._nh, 1e-6);
      const sameArea = designNode.areaKey.replace(/card#\d+/g, 'card#*') === runtimeNode.areaKey.replace(/card#\d+/g, 'card#*');
      controlGeometryExempt = cDist <= 0.15 && hr >= 0.7 && sameArea;
      if (!controlGeometryExempt) return null; // 几何证据不足 → 仍否决(维持"宁可少报不错报")
    }
  }

  const basis = [];
  let score = designNode.role === runtimeNode.role ? 38 : 18;
  // 区域路径比较对做过卡号归一的类(icon/image/带锚点 layout/text)也用归一后的 areaKey——否则 icon 的
  // areaKey末段常就是 card#N(中间的普通容器不进 areaKey),两侧卡号错位会在 846 行被"区域末段不同"误杀。
  // data-cell 例外:它必须靠原始 areaKey 完全相同锁定,不能归一(见上方 831 行注释)。
  const areaNormalizable = !isDataCellPair
    && (['icon', 'image'].includes(designCategory)
      || (designCategory === 'layout' && designNode.primaryAnchor)
      || (designCategory === 'text' && designNode.primaryAnchor)
      || designCategory === 'control');
  const dArea = areaNormalizable ? designNode.areaKey.replace(/card#\d+/g, 'card#*') : designNode.areaKey;
  const rArea = areaNormalizable ? runtimeNode.areaKey.replace(/card#\d+/g, 'card#*') : runtimeNode.areaKey;
  if (dArea === rArea) {
    score += 34;
    basis.push('同一区域路径');
  } else {
    const designArea = dArea.split('/').slice(-1)[0];
    const runtimeArea = rArea.split('/').slice(-1)[0];
    if (designArea !== runtimeArea && !STRUCTURE_REGIONS.has(designNode.role)) return null;
    if (designArea === runtimeArea) score += 16;
  }
  if (designNode.structureKey === runtimeNode.structureKey) {
    score += 110;
    basis.push('确定性结构键');
  }
  if (!isDataCellPair && designNode.primaryAnchor && designNode.primaryAnchor === runtimeNode.primaryAnchor) {
    score += 70;
    basis.push('相同内容锚点');
  }
  if (anchorSimilarity > 0) {
    score += anchorSimilarity * 52;
    basis.push('子内容集合');
  }
  const controlSimilarity = setSimilarity(designNode.controls, runtimeNode.controls);
  if (designNode.controls.length || runtimeNode.controls.length) {
    score += controlSimilarity * 28;
    if (controlSimilarity > 0.5) basis.push('控件序列');
  }
  const childSimilarity = setSimilarity(designNode.childRoles, runtimeNode.childRoles);
  const childShapeSimilarity = sequenceSimilarity(designNode.childShapes, runtimeNode.childShapes);
  score += childSimilarity * 12 + childShapeSimilarity * 20;
  if (designNode.ordinal === runtimeNode.ordinal) score += 12;
  const positionDelta = Math.abs(designNode.raw._nx - runtimeNode.raw._nx) + Math.abs(designNode.raw._ny - runtimeNode.raw._ny);
  score += Math.max(0, 12 - positionDelta * 18);

  const reliableRegion = STRUCTURE_REGIONS.has(designNode.role) && designNode.role === runtimeNode.role;
  const reliableLeaf = !isDataCellPair && designNode.primaryAnchor && designNode.primaryAnchor === runtimeNode.primaryAnchor;
  const reliableLayout = designCategory === 'layout' && designNode.areaKey === runtimeNode.areaKey
    && (anchorSimilarity >= 0.45 || childShapeSimilarity >= 0.65);
  const reliableControl = designCategory === 'control'
    && ((designNode.areaKey === runtimeNode.areaKey
      && (anchorSimilarity > 0 || (!designAnchors.length && !runtimeAnchors.length && designNode.role === runtimeNode.role)))
      // 几何强证据豁免: 文字不同但位置/高度/归一区域路径都强匹配的同一控件(如搜索框文案差异)。
   || controlGeometryExempt);
  const reliableGraphic = ['icon', 'image'].includes(designCategory)
    && designNode.role === runtimeNode.role
    // icon/image 无内容身份，只能靠"同一容器内同序号"确认。areaKey 需归一卡号后比较(两侧顶层模块序号
    // 常错位)，归一后仍含 filter-row/head-cell 等容器路径 → 跨容器必不等,故只有同一已配对容器内的
    // icon 才可能可靠;跨卡但同容器路径的 icon(如两侧都在 reset-btn 内)则能配上。
    && designNode.areaKey.replace(/card#\d+/g, 'card#*') === runtimeNode.areaKey.replace(/card#\d+/g, 'card#*')
    && designNode.ordinal === runtimeNode.ordinal;
  if (!reliableRegion && !reliableLeaf && !reliableControl && !reliableLayout && !reliableGraphic) return null;
  const hardIdentity = Boolean(
    reliableLeaf
    || reliableControl
    || reliableGraphic
    || (reliableRegion && (anchorSimilarity > 0 || childShapeSimilarity >= 0.5 || designNode.role === 'root'))
    || (reliableLayout && (anchorSimilarity >= 0.55 || childShapeSimilarity >= 0.8))
  );
  return {score, basis, hardIdentity};
}

function maximumWeightPairs(designNodes, runtimeNodes) {
  if (!designNodes.length || !runtimeNodes.length) return [];
  const size = designNodes.length + runtimeNodes.length;
  const invalid = -1000000;
  const weights = Array.from({length: size}, (_, row) => Array.from({length: size}, (_, column) => {
    if (row >= designNodes.length || column >= runtimeNodes.length) return 0;
    return structurePairScore(designNodes[row], runtimeNodes[column])?.score ?? invalid;
  }));
  let maxWeight = 0;
  weights.forEach(row => row.forEach(value => {
    if (value > invalid && value > maxWeight) maxWeight = value;
  }));
  const u = Array(size + 1).fill(0);
  const v = Array(size + 1).fill(0);
  const p = Array(size + 1).fill(0);
  const way = Array(size + 1).fill(0);
  for (let row = 1; row <= size; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minValue = Array(size + 1).fill(Infinity);
    const used = Array(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Infinity;
      let column1 = 0;
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue;
        const current = maxWeight - weights[row0 - 1][column - 1] - u[row0] - v[column];
        if (current < minValue[column]) {
          minValue[column] = current;
          way[column] = column0;
        }
        if (minValue[column] < delta) {
          delta = minValue[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          minValue[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const assignment = Array(size).fill(-1);
  for (let column = 1; column <= size; column += 1) assignment[p[column] - 1] = column - 1;
  return designNodes.map((designNode, row) => {
    const column = assignment[row];
    if (column < 0 || column >= runtimeNodes.length || weights[row][column] <= 0) return null;
    const pair = structurePairScore(designNode, runtimeNodes[column]);
    if (!pair) return null;
    return {designNode, runtimeNode: runtimeNodes[column], ...pair};
  }).filter(Boolean);
}

function matchSemanticStructures(designStructure, runtimeStructure) {
  const matches = [];
  const ambiguous = [];
  const designRoot = designStructure.nodes.find(node => node.role === 'root');
  const runtimeRoot = runtimeStructure.nodes.find(node => node.role === 'root');
  const usedDesign = new Set();
  const usedRuntime = new Set();
  if (designRoot && runtimeRoot) {
    matches.push({designNode: designRoot, runtimeNode: runtimeRoot, score: 300, basis: ['选区根节点'], unique: true});
    usedDesign.add(designRoot.id);
    usedRuntime.add(runtimeRoot.id);
  }

  const designGroups = new Map();
  const runtimeGroups = new Map();
  designStructure.nodes.filter(node => !usedDesign.has(node.id)).forEach(node => {
    const key = structureGroupKey(node);
    if (!designGroups.has(key)) designGroups.set(key, []);
    designGroups.get(key).push(node);
  });
  runtimeStructure.nodes.filter(node => !usedRuntime.has(node.id)).forEach(node => {
    const key = structureGroupKey(node);
    if (!runtimeGroups.has(key)) runtimeGroups.set(key, []);
    runtimeGroups.get(key).push(node);
  });

  designGroups.forEach((designNodes, key) => {
    const runtimeNodes = runtimeGroups.get(key) || [];
    const designAnchorCounts = new Map();
    designNodes.forEach(node => {
      if (node.primaryAnchor) designAnchorCounts.set(node.primaryAnchor, (designAnchorCounts.get(node.primaryAnchor) || 0) + 1);
    });
    const runtimeAnchorCounts = new Map();
    runtimeNodes.forEach(node => {
      if (node.primaryAnchor) runtimeAnchorCounts.set(node.primaryAnchor, (runtimeAnchorCounts.get(node.primaryAnchor) || 0) + 1);
    });
    // 思路C：按"锚点是否出现在节点的 anchors 集合"统计——用于"单向唯一锚点命中"判定。
    // 解决"标题锚点被提示文字挤掉 primaryAnchor"：前端某卡 primaryAnchor 被提示文字占了，
    // 但它的 anchors 集合里仍含真标题。若 Figma 卡的 primaryAnchor 恰好唯一命中前端某卡的集合
    //（且反向也唯一），即可确定匹配——完全不改 primaryAnchor 取值，只多一条判定。
    const anchorSetCount = (nodes, anchor) => nodes.reduce((count, node) =>
      count + (node.anchors.some(entry => entry.compact === anchor) ? 1 : 0), 0);
    maximumWeightPairs(designNodes, runtimeNodes).forEach(pair => {
      const rowScores = runtimeNodes.map(candidate => structurePairScore(pair.designNode, candidate)?.score ?? -Infinity).sort((a, b) => b - a);
      const columnScores = designNodes.map(candidate => structurePairScore(candidate, pair.runtimeNode)?.score ?? -Infinity).sort((a, b) => b - a);
      const rowMargin = pair.score - (rowScores[1] ?? -Infinity);
      const columnMargin = pair.score - (columnScores[1] ?? -Infinity);
      const uniqueAnchor = Boolean(pair.designNode.primaryAnchor)
        && pair.designNode.primaryAnchor === pair.runtimeNode.primaryAnchor
        && designAnchorCounts.get(pair.designNode.primaryAnchor) === 1
        && runtimeAnchorCounts.get(pair.runtimeNode.primaryAnchor) === 1;
      // 单向唯一锚点命中：仅对区域级(card/table等)生效；一侧 primaryAnchor 命中另一侧 anchors 集合，
      // 且该锚点在两侧各自组内都只被1 个节点拥有（primaryAnchor 侧唯一 + 集合命中侧唯一）→ 确定匹配。
      const crossUniqueAnchor = STRUCTURE_REGIONS.has(pair.designNode.role)
        && pair.designNode.role === pair.runtimeNode.role
        && (
          // Figma 主锚点唯一命中前端某卡的 anchors 集合
          (pair.runtimeNode.anchors.some(entry => entry.compact === pair.designNode.primaryAnchor)
            && designAnchorCounts.get(pair.designNode.primaryAnchor) === 1
            && anchorSetCount(runtimeNodes, pair.designNode.primaryAnchor) === 1)
          // 或前端主锚点唯一命中Figma 某卡的 anchors 集合
          || (pair.designNode.anchors.some(entry => entry.compact === pair.runtimeNode.primaryAnchor)
            && runtimeAnchorCounts.get(pair.runtimeNode.primaryAnchor) === 1
            && anchorSetCount(designNodes, pair.runtimeNode.primaryAnchor) === 1)
        );
      const deterministic = uniqueAnchor
        || crossUniqueAnchor
        || (pair.basis.includes('相同内容锚点') && designNodes.length === 1 && runtimeNodes.length === 1)
        || (pair.designNode.role === 'card' && pair.runtimeNode.role === 'card' && pair.designNode.areaKey === pair.runtimeNode.areaKey)
        || (STRUCTURE_REGIONS.has(pair.designNode.role) && designNodes.length === 1 && runtimeNodes.length === 1);
      const unique = (pair.hardIdentity || crossUniqueAnchor) && (deterministic || (rowMargin >= 8 && columnMargin >= 8));
      if (!unique) {
        ambiguous.push({designNode: pair.designNode, runtimeNode: pair.runtimeNode, score: pair.score});
        return;
      }
      matches.push({...pair, unique: true});
      usedDesign.add(pair.designNode.id);
      usedRuntime.add(pair.runtimeNode.id);
    });
  });

  // 第二遍·补漏 pass：文字锚点完全不同(如时间轴"今日"vs"今天"、商品名两端不同数据)导致第一遍漏配的
  // 顶层模块，靠"DOM 顺序 + 已匹配模块切分的区间 + 结构指纹"兜底。严格约束以杜绝错配：
  // 只在某区间内两侧残留模块数量相等时按序一一对应，且每对须通过结构指纹校验；数量不等则整区间跳过。
  const isTopModule = node => /^root\/card#\d+$/.test(node.areaKey) && node.role === 'card';
  const topModulesByDom = nodes => nodes.filter(isTopModule).sort((a, b) => a.rawIndex - b.rawIndex);
  const designModules = topModulesByDom(designStructure.nodes);
  const runtimeModules = topModulesByDom(runtimeStructure.nodes);
  // 结构指纹相似：区间已提供"同位置+数量相等+顺序一致"的强确定性，指纹只需确认两侧"不是完全不搭"。
  // 判据：宽度体量接近(模块级卡近满宽) 且 (子角色/形状序列够像 或 共享显著非文字角色如 image/table/icon)。
  const salientRoles = ['image', 'table', 'icon', 'control', 'date-input'];
  const fingerprintMatch = (d, r) => {
    const widthRatio = Math.min(d.raw._nw, r.raw._nw) / Math.max(d.raw._nw, r.raw._nw, 1e-6);
    if (widthRatio < 0.6) return false;
    const roleSim = setSimilarity(d.childRoles, r.childRoles);
    const shapeSim = sequenceSimilarity(d.childShapes, r.childShapes);
    const sharedSalient = salientRoles.some(role => d.childRoles.includes(role) && r.childRoles.includes(role));
    const bothHaveControls = (d.controls && d.controls.length > 0) && (r.controls && r.controls.length > 0);
    return roleSim >= 0.5 || shapeSim >= 0.5 || sharedSalient || bothHaveControls;
  };
  // 用"已匹配的顶层模块"把两侧序列切成对齐的区间；相邻已匹配锚之间的残留即为一个区间。
  const segmentResiduals = (modules, used, matchedPartnerOrder) => {
    const segments = [];
    let bucket = [];
    modules.forEach(mod => {
      if (used.has(mod.id)) {
        segments.push({anchorKey: matchedPartnerOrder.get(mod.id) ?? -1, residuals: bucket});
        bucket = [];
      } else {
        bucket.push(mod);
      }
    });
    segments.push({anchorKey: Infinity, residuals: bucket});
    return segments;
  };
  // 给每个"已匹配模块"一个稳定的配对序号，用于两侧区间对齐（同一对匹配 → 同序号）。
  const pairOrder = new Map();
  matches.filter(m => isTopModule(m.designNode) && isTopModule(m.runtimeNode)).forEach((m, i) => {
    pairOrder.set(m.designNode.id, i);
    pairOrder.set(m.runtimeNode.id, i);
  });
  const designSegs = segmentResiduals(designModules, usedDesign, pairOrder);
  const runtimeSegs = segmentResiduals(runtimeModules, usedRuntime, pairOrder);
  const runtimeSegByAnchor = new Map(runtimeSegs.map(seg => [seg.anchorKey, seg]));
  designSegs.forEach(dSeg => {
    const rSeg = runtimeSegByAnchor.get(dSeg.anchorKey);
    if (!rSeg) return;
    // 区间内两侧残留数量必须相等，才敢按序一一对应（数量不等=有增删，无法确定谁对谁）。
    if (dSeg.residuals.length === 0 || dSeg.residuals.length !== rSeg.residuals.length) return;
    dSeg.residuals.forEach((dMod, idx) => {
      const rMod = rSeg.residuals[idx];
      if (usedDesign.has(dMod.id) || usedRuntime.has(rMod.id)) return;
      if (!fingerprintMatch(dMod, rMod)) return;
      matches.push({designNode: dMod, runtimeNode: rMod, score: 0, basis: ['补漏:DOM序+结构指纹'], unique: true, backfill: true});
      usedDesign.add(dMod.id);
      usedRuntime.add(rMod.id);
    });
  });

  return {matches, ambiguous};
}

// ==== Bottom-Up 容器传播(GumTree 风格) ====
// 在 Top-Down (matchSemanticStructures) 之后运行。
// 从已配对的叶子/子树向上传播: 当一个 layout 容器的后代中有足够比例已配对时, 配对该容器本身。
// 容器配对成功后触发 Recovery: 在容器内部做宽松的子节点补配。
// 只追加新配对, 不修改/覆盖 Top-Down 结果。

function bottomUpPropagate(designStructure, runtimeStructure, existingMatches) {
  const usedDesign = new Set(existingMatches.map(m => m.designNode.id));
  const usedRuntime = new Set(existingMatches.map(m => m.runtimeNode.id));
  const newMatches = [];

  // 构建后代集合缓存
  const descendantCache = new Map();
  function getDescendantIds(node) {
    if (descendantCache.has(node.id)) return descendantCache.get(node.id);
    const ids = new Set();
    (node.children || []).forEach(child => {
      ids.add(child.id);
      getDescendantIds(child).forEach(id => ids.add(id));
    });
    descendantCache.set(node.id, ids);
    return ids;
  }

  // Dice 系数: 2 * 共同已配后代 / (A后代数 + B后代数)
  function diceCoefficient(designNode, runtimeNode) {
    const dDesc = getDescendantIds(designNode);
    const rDesc = getDescendantIds(runtimeNode);
    if (!dDesc.size && !rDesc.size) return 0;
    let commonMapped = 0;
    const allMatches = [...existingMatches, ...newMatches];
    allMatches.forEach(pair => {
      if (dDesc.has(pair.designNode.id) && rDesc.has(pair.runtimeNode.id)) commonMapped += 1;
    });
    return (2 * commonMapped) / (dDesc.size + rDesc.size);
  }

  // 祖先路径检查: 配对节点须在已配祖先的 runtime 子树内(防跨区域错配)
  function ancestorPathOk(designNode, runtimeNode) {
    let dAncestor = designNode.parent;
    while (dAncestor) {
      const ancestorMatch = existingMatches.find(m => m.designNode.id === dAncestor.id)
        || newMatches.find(m => m.designNode.id === dAncestor.id);
      if (ancestorMatch) {
        let rCursor = runtimeNode.parent;
        while (rCursor) {
          if (rCursor.id === ancestorMatch.runtimeNode.id) return true;
          rCursor = rCursor.parent;
        }
        return false;
      }
      dAncestor = dAncestor.parent;
    }
    return true; // 没找到已配祖先, 不阻拦
  }

  // 后序遍历设计树
  const postOrder = [];
  const walk = node => { (node.children || []).forEach(walk); postOrder.push(node); };
  designStructure.nodes.filter(n => !n.parent).forEach(walk);

  const MIN_DICE = 0.12;  // 宽松阈值: Figma/DOM 结构差异大,后代稀疏也允许(但祖先路径+方向会兜底安全)

  postOrder.forEach(designNode => {
    if (usedDesign.has(designNode.id)) return;
    if (designNode.role === 'root') return;
    const dCategory = structureRoleCategory(designNode.role);
    // 允许 layout 和有子节点的非叶子角色参与(container/title-region等)
    if (!['layout', 'title-region'].includes(dCategory) && !STRUCTURE_REGIONS.has(designNode.role)
        && !(designNode.children && designNode.children.length)) return;
    // 至少有1个已配后代
    const dDesc = getDescendantIds(designNode);
    const allMatches = [...existingMatches, ...newMatches];
    const hasMappedDescendant = allMatches.some(m => dDesc.has(m.designNode.id));
    if (!hasMappedDescendant) return;

    // Property ownership is resolved separately by InspectionContracts. A label
    // match is never promoted to a component outer box here.
    // 候选: 未配对的 runtime 节点(有子节点, 非叶子, 非root)
    const candidates = runtimeStructure.nodes.filter(rNode => {
      if (usedRuntime.has(rNode.id)) return false;
      if (!semanticScopesCompatible(designNode.raw, rNode.raw)) return false;
      if (rNode.role === 'root') return false;
      // 允许 layout / title / title-region / container 等非叶子角色
      if (!(rNode.children && rNode.children.length)) return false;
      // 方向硬冲突仅在两侧都是 layout 时检查; 跨角色(如 layout↔title)不卡方向
      const rCategory = structureRoleCategory(rNode.role);
      if (dCategory === 'layout' && rCategory === 'layout'
          && designNode.direction !== 'none' && rNode.direction !== 'none'
          && designNode.direction !== rNode.direction) return false;
      return true;
    });

    let bestCandidate = null;
    let bestDice = 0;
    candidates.forEach(rNode => {
      const dice = diceCoefficient(designNode, rNode);
      if (dice > bestDice) { bestDice = dice; bestCandidate = rNode; }
    });

    if (bestDice >= MIN_DICE && bestCandidate && ancestorPathOk(designNode, bestCandidate)) {
      newMatches.push({
        designNode, runtimeNode: bestCandidate,
        score: Math.round(bestDice * 100),
        basis: ['Bottom-Up:后代传播', `dice=${bestDice.toFixed(2)}`],
        unique: true, bottomUp: true
      });
      usedDesign.add(designNode.id);
      usedRuntime.add(bestCandidate.id);
      // Recovery: 容器内部补配
      bottomUpRecovery(designNode, bestCandidate, usedDesign, usedRuntime, newMatches);
    }
  });

  return newMatches;
}

function bottomUpRecovery(designContainer, runtimeContainer, usedDesign, usedRuntime, newMatches) {
  const unmappedD = (designContainer.children || []).filter(c => !usedDesign.has(c.id));
  const unmappedR = (runtimeContainer.children || []).filter(c => !usedRuntime.has(c.id));
  if (!unmappedD.length || !unmappedR.length) return;

  unmappedD.forEach(dChild => {
    if (usedDesign.has(dChild.id)) return;
    const dCat = structureRoleCategory(dChild.role);
    let bestMatch = null;
    let bestScore = -Infinity;

    unmappedR.forEach(rChild => {
      if (usedRuntime.has(rChild.id)) return;
      if (!semanticScopesCompatible(dChild.raw, rChild.raw)) return;
      if (structureRoleCategory(rChild.role) !== dCat) return;
      let score = 0;
      // 位置接近
      const posDelta = Math.abs((dChild.raw._nx || 0) - (rChild.raw._nx || 0))
                     + Math.abs((dChild.raw._ny || 0) - (rChild.raw._ny || 0));
      score += Math.max(0, 30 - posDelta * 60);
      // 锚点相似
      const dAnchors = dChild.anchors.map(a => a.compact);
      const rAnchors = rChild.anchors.map(a => a.compact);
      score += setSimilarity(dAnchors, rAnchors) * 40;
      // 方向一致
      if (dChild.direction !== 'none' && dChild.direction === rChild.direction) score += 15;
      // 子形状相似
      score += sequenceSimilarity(dChild.childShapes || [], rChild.childShapes || []) * 15;
      if (score > bestScore) { bestScore = score; bestMatch = rChild; }
    });

    if (bestMatch && bestScore >= 20) {
      newMatches.push({
        designNode: dChild, runtimeNode: bestMatch,
        score: Math.round(bestScore),
        basis: ['Recovery:容器内补配'],
        unique: true, recovery: true
      });
      usedDesign.add(dChild.id);
      usedRuntime.add(bestMatch.id);
    }
  });
}

// ==== R0/R1: 自顶向下递归锚定配对(影子模式, 并行不接管) ====
// 详见 自顶向下递归锚定配对引擎_设计_v1.md。此函数只用于影子对比:
// 与现groupKey 引擎并行跑, 结果写进 report.shadowRecursive 供离线分析, 【不改变任何现有配对/测量/展示行为】。
// 三块拼图: ①穿透壳收模块级子(几何为主) ②局部位置对照对齐(带跳过) ③递归下钻。
const RECUR_MODULE_ROLES = new Set(['card', 'filter-row', 'title-region', 'title', 'table',
  'pagination', 'date-input', 'filter-control', 'button', 'head-cell', 'data-cell',
  'data-row-template', 'text', 'icon', 'image', 'select', 'input', 'link', 'textarea']);

function recursiveShadowMatch(designStructure, runtimeStructure) {
  const isShell = node => structureRoleCategory(node.role) === 'layout';
  // "空文本包裹壳": role 归类为 text(text/title) 但自身无文本、却有子节点(典型: 前端把 icon 套在
  //   一个空 <span> 里, 该 span 被判成空 text)。它不该以"空 text"身份占位参与叶子对齐——否则会把
  //   几何位置让给空节点, 干扰 LCS 序列对齐(实测 report75: 空 text 壳挤错位, 导致"所属行业↔行业"
  //   这种归一位置几乎重合(Δ0.02)的对没配上)。穿透它, 让里面真正的 icon/内容暴露参与配对。
  const isEmptyTextWrapper = node => {
    if (structureRoleCategory(node.role) !== 'text') return false;
    const own = String((node.raw && node.raw.text && node.raw.text.direct) || node.primaryAnchor || '').trim();
    if (own) return false;                       // 自身有文本 → 真文本节点, 不穿透
    return (node.children || []).length > 0;      // 空文本但有子 → 包裹壳, 穿透
  };
  // 穿透布局壳 + 空文本包裹壳, 收集第一层遇到的"模块级"子节点;遇到模块级就停(不再往内钻)
  const collectChildren = node => {
    const out = [];
    const visit = n => {
      for (const c of (n.children || [])) {
        if (RECUR_MODULE_ROLES.has(c.role) && !isShell(c) && !isEmptyTextWrapper(c)) out.push(c);
        else visit(c);
      }
    };
    visit(node);
    // 排序: 先按行(y)再按列(x)。但同一行内的元素常因基线对齐有几像素 y 微差(如 icon 比文字低 2px),
    //   若用严格 y 主序会把这些 icon 甩到序列末尾、打乱视觉从左到右的真实顺序 → LCS 保序对齐错位
    //   (实测 report75: ⓘ 图标 y 比同行文字大 2px, 被排到末尾, 导致"所属行业↔行业"等几何达标的对
    //   因保序路径偏移而没配上)。故加"同行容差": 两元素 y 差小于其行高的一半时视为同行, 按 x 排。
    const rowTol = (a, b) => Math.max(6, Math.min((a.raw._box.height || 0), (b.raw._box.height || 0)) * 0.5);
    return out.sort((a, b) => {
      const dy = (a.raw._box.y || 0) - (b.raw._box.y || 0);
      if (Math.abs(dy) <= rowTol(a, b)) return (a.raw._box.x || 0) - (b.raw._box.x || 0); // 同行 → 按 x
      return dy; // 跨行 → 按 y
    });
  };
  const localBox = (n, p) => ({
    x: (n.raw._box.x - p.raw._box.x) / Math.max(p.raw._box.width, 1),
    y: (n.raw._box.y - p.raw._box.y) / Math.max(p.raw._box.height, 1),
    w: n.raw._box.width / Math.max(p.raw._box.width, 1),
    h: n.raw._box.height / Math.max(p.raw._box.height, 1)
  });
  const wordSet = n => {
    const s = new Set();
    const stack = [...(n.children || [])];
    let guard = 0;
    while (stack.length && guard < 80) {
      guard += 1;
      const c = stack.pop();
      const t = String(c.primaryAnchor || c.raw?.text?.direct || '').trim();
      if (t) s.add(t);
      if (c.children) stack.push(...c.children);
    }
    const own = String(n.primaryAnchor || n.raw?.text?.direct || '').trim();
    if (own) s.add(own);
    return s;
  };
  // anchors 集合交集:两侧 anchors(structureAnchors, 各≤16个 compact)有无共同项。
  // 用于第二步(模块内部,depth>=2): primaryAnchor 在两侧不稳定(同一指标卡设计侧首文字="成交金额"、
  // 前端侧首文字="¥300", 取决遍历序非语义), 但两侧 anchors 集合都含 {成交金额,¥300}→有交集。
  const anchorSetsShare = (d, r) => {
    const da = (d.anchors || []).map(e => e.compact).filter(Boolean);
    const ra = new Set((r.anchors || []).map(e => e.compact).filter(Boolean));
    if (!da.length || !ra.size) return null; // 一侧无 anchors -> 不适用, 交回上层判据
    return da.some(c => ra.has(c));
  };
  // 内容叶子: 角色为 text/icon/image 且无子节点(真叶子)。这类节点的配对天然是"模块内部叶子配对",
  //   应走"几何为主、不卡文字"逻辑——无论它在 depth 几层。修正 depth 阈值漏洞(report77/runtime21):
  //   选区为小模块时, 扒壳后叶子直接挂在 root 下(depth=0/1), 若只按 depth>=2 判定, 会误走第一层卡文字逻辑,
  //   把"女装↔二手奢侈品箱包"(字符集无交集)硬否决→LCS保序错位→icon被凑去配文字。
  const isContentLeaf = n => {
    const cat = structureRoleCategory(n.role);
    return (cat === 'text' || cat === 'icon' || cat === 'image') && !(n.children && n.children.length);
  };
  const simScore = (d, dParent, r, rParent, depth = 0) => {
    const la = localBox(d, dParent), lb = localBox(r, rParent);
    const dw = wordSet(d), rw = wordSet(r);
    let inter = 0; dw.forEach(w => { if (rw.has(w)) inter += 1; });
    const jac = inter / Math.max(dw.size + rw.size - inter, 1);
    if (depth >= 2 || (isContentLeaf(d) && isContentLeaf(r))) {
      // ──【第二层·模块内部叶子配对】(方案 v12.4 三信号投票) ──
      // 角色一致=硬门槛; 位置=序列对齐保序; 文字anchors交集=轻加分。
      const dCat = structureRoleCategory(d.role), rCat = structureRoleCategory(r.role);
      //硬门槛①: 角色类别不同(text vs image)-> 不可配。text/title归一为 text 已由 category 处理。
      if (dCat !== rCat) return Infinity;
      // 几何: |Δx| 仅轻微降权(*0.7)。教训(v3.7.0 report30): 降到*0.25会让"顺序被打乱"的网格
      //   (如指标卡设计[成交金额..]vs前端[成交人数..]乱序)同行卡geoDeep都≈0.07, 保序对齐按错位置硬配
      //   →全线错配。轻微降权让顺序乱的卡因横向差(Δx≈0.39)几何超阈值【配不上】(宁可少报不错报),
      //   而顺序一致的模块(商品卡 Δx≈0)不受影响仍能配。
      const geoDeep = Math.abs(la.x - lb.x) * 0.7 + Math.abs(la.y - lb.y)
        + Math.abs(la.w - lb.w) * 0.5 + Math.abs(la.h - lb.h) * 0.5;
      // 文字: anchors 集合有交集 -> 轻加分(-0.15,仅微调不足以把几何差很大的错配拉进阈值); 无交集/一侧无 -> 不拦。
      const share = anchorSetsShare(d, r);
      const textBonus = share === true ? -0.15 : 0;
      return geoDeep + textBonus;
    }
    // ── 【第一层·模块级】保持 primaryAnchor 字符集判据(区分大容器真假对, 不误杀"今日↔今天") ──
    const geo = Math.abs(la.x - lb.x) + Math.abs(la.y - lb.y)
      + Math.abs(la.w - lb.w) * 0.5 + Math.abs(la.h - lb.h) * 0.5;
    const ownA = String(d.primaryAnchor || d.raw?.text?.direct || '').trim();
    const ownB = String(r.primaryAnchor || r.raw?.text?.direct || '').trim();
    if (ownA && ownB) {
      const cs = new Set([...ownA]);
      let sh = false; for (const ch of ownB) { if (cs.has(ch)) { sh = true; break; } }
      if (!sh) return Infinity;
    }
    if (dw.size > 0 && rw.size > 0 && inter === 0) return Infinity;
    return geo - jac * 0.5; // 越低越匹配, 内容重叠加成
  };
  const THRESHOLD = 0.30;
  const matches = [];
  const designOnly = [];
  const runtimeOnly = [];
  const align = (dParent, rParent, depth) => {
    if (depth > 6) return;
    const dK = collectChildren(dParent), rK = collectChildren(rParent);
    const n = dK.length, m = rK.length;
    // ── 序列对齐 (带权 LCS / DP 全局最优, 替代贪心先到先得) ──
    // dp[i][j] = 处理完 dK[0..i) 与 rK[0..j) 的"最大匹配对数(带微弱质量偏好)";
    // 只有 simScore <= THRESHOLD 才允许对角线匹配;收益=1(每对计1)加上极小的质量项(THRESHOLD-score)*0.01,
    // 主目标是"阈值内配尽量多的对"(最大化数量), 质量项仅用于平局时优先更优的对, 不会用分数换数量。
    if (n === 0) { rK.forEach(r => runtimeOnly.push({node: r, depth})); return; }
    if (m === 0) { dK.forEach(d => designOnly.push({node: d, depth})); return; }
    const NEG = -1e9;
    const gain = Array.from({length: n}, () => new Array(m).fill(NEG));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const s = simScore(dK[i], dParent, rK[j], rParent, depth + 1);
        if (s <= THRESHOLD) gain[i][j] = 1 + (THRESHOLD - s) * 0.01; // 计1对 + 微弱质量偏好
      }
    }
    const dp = Array.from({length: n + 1}, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        let v = Math.max(dp[i - 1][j], dp[i][j - 1]); // 跳过 d 或 跳过 r
        if (gain[i - 1][j - 1] > NEG / 2) {
          const diag = dp[i - 1][j - 1] + gain[i - 1][j - 1];
          if (diag > v) v = diag;
        }
        dp[i][j] = v;
      }
    }
    // 回溯
    let i = n, j = m;
    const paired = [];
    while (i > 0 && j > 0) {
      const g = gain[i - 1][j - 1];
      if (g > NEG / 2 && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + g)) < 1e-6) {
        paired.push([i - 1, j - 1]);
        i--; j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        designOnly.push({node: dK[i - 1], depth}); i--;
      } else {
        runtimeOnly.push({node: rK[j - 1], depth}); j--;
      }
    }
    while (i > 0) { designOnly.push({node: dK[i - 1], depth}); i--; }
    while (j > 0) { runtimeOnly.push({node: rK[j - 1], depth}); j--; }
    // paired 是逆序回溯得到的,逐对记录并递归下钻
    paired.reverse().forEach(([di, rj]) => {
      const score = simScore(dK[di], dParent, rK[rj], rParent, depth + 1);
      matches.push({d: dK[di], r: rK[rj], score, depth});
      align(dK[di], rK[rj], depth + 1);
    });
  };
  try {
    const dRoot = designStructure.nodes.find(n => n.role === 'root') || designStructure.nodes[0];
    const rRoot = runtimeStructure.nodes.find(n => n.role === 'root') || runtimeStructure.nodes[0];
    if (!dRoot || !rRoot) return null;
    align(dRoot, rRoot, 0);
    // 顶2层的可读明细(供离线分析), 全量只留统计
    const topPairs = matches.filter(m => m.depth <= 1).map(m =>
      `${''.repeat(m.depth)}${m.d.role}"${(m.d.primaryAnchor || '').slice(0, 10)}"↔${m.r.role}"${(m.r.primaryAnchor || '').slice(0, 10)}" ${m.score.toFixed(2)}`);
    const topDesignOnly = designOnly.filter(x => x.depth <= 1).map(x => `[设计独有d${x.depth}] ${x.node.role}"${(x.node.primaryAnchor || '').slice(0, 10)}"`);
    const topRuntimeOnly = runtimeOnly.filter(x => x.depth <= 1).map(x => `[前端独有 d${x.depth}] ${x.node.role}"${(x.node.primaryAnchor || '').slice(0, 10)}"`);
    return {
      pairs: matches.length,
      designOnly: designOnly.length,
      runtimeOnly: runtimeOnly.length,
      topPairs,
      topDesignOnly,
      topRuntimeOnly,
      rawPairs: matches // 带节点对象/score/depth, 供间距检测接入(不进report JSON)
    };
  } catch (e) {
    return {error: String(e && e.message || e)};
  }
}

function matchScore(designNode, runtimeNode) {
  const designRole = nodeRole(designNode, 'design');
  const runtimeRole = nodeRole(runtimeNode, 'runtime');
  if (designRole !== runtimeRole) return -100;

  const designDirection = nodeDirection(designNode);
  const runtimeDirection = nodeDirection(runtimeNode);
  if (designRole === 'container' && runtimeRole === 'container'
    && designDirection !== 'none' && runtimeDirection !== 'none' && designDirection !== runtimeDirection) return -100;

  const designStructureRole = designNode._structureRole || '';
  const runtimeStructureRole = runtimeNode._structureRole || '';
  const designStructureCategory = designStructureRole ? structureRoleCategory(designStructureRole) : '';
  const runtimeStructureCategory = runtimeStructureRole ? structureRoleCategory(runtimeStructureRole) : '';
  if (designStructureCategory === 'control' || runtimeStructureCategory === 'control') {
    if (designStructureCategory !== 'control' || runtimeStructureCategory !== 'control') return -100;
    if (!controlRolesCompatible(designStructureRole, runtimeStructureRole)) return -100;
    const designAnchors = designNode._structureAnchors || [];
    const runtimeAnchors = runtimeNode._structureAnchors || [];
    if ((designAnchors.length || runtimeAnchors.length) && setSimilarity(designAnchors, runtimeAnchors) <= 0) return -100;
  }

  let score = designRole === runtimeRole ? (designRole === 'icon' ? 22 : 14) : 0;
  if (designNode._text && runtimeNode._text) {
    if (designNode._text !== runtimeNode._text) return -100;
    score += 58;
  } else if (!designNode._text && !runtimeNode._text) {
    score += designRole === 'icon' ? 10 : 6;
  } else {
    score -= 18;
  }

  const designArea = semanticArea(designNode);
  const runtimeArea = semanticArea(runtimeNode);
  if (designArea && runtimeArea && designArea !== runtimeArea) return -100;
  if (designArea && runtimeArea) score += 14;
  if (designDirection !== 'none' && designDirection === runtimeDirection) score += 12;

  const horizontal = Math.abs(designNode._nx - runtimeNode._nx) + Math.abs(designNode._nw - runtimeNode._nw);
  const vertical = Math.abs(designNode._ny - runtimeNode._ny) + Math.abs(designNode._nh - runtimeNode._nh);
  score += Math.max(0, 18 - horizontal * 40);
  score += Math.max(0, 8 - vertical * 12);
  return score;
}

function hierarchyBonus(designNode, runtimeNode, designToRuntime, runtimeToDesign) {
  let bonus = 0;
  const mappedDesignAncestor = designNode._ancestors.find(ancestor => designToRuntime.has(ancestor._index));
  if (mappedDesignAncestor) {
    const expectedRuntimeIndex = designToRuntime.get(mappedDesignAncestor._index);
    const runtimeDistance = runtimeNode._ancestors.findIndex(ancestor => ancestor._index === expectedRuntimeIndex);
    if (runtimeDistance < 0) return -1000;
    const designDistance = designNode._ancestors.indexOf(mappedDesignAncestor);
    bonus += Math.max(4, 18 - Math.abs(designDistance - runtimeDistance) * 3);
  }
  const mappedRuntimeAncestor = runtimeNode._ancestors.find(ancestor => runtimeToDesign.has(ancestor._index));
  if (mappedRuntimeAncestor) {
    const expectedDesignIndex = runtimeToDesign.get(mappedRuntimeAncestor._index);
    const designDistance = designNode._ancestors.findIndex(ancestor => ancestor._index === expectedDesignIndex);
    if (designDistance < 0) return -1000;
    const runtimeDistance = runtimeNode._ancestors.indexOf(mappedRuntimeAncestor);
    bonus += Math.max(4, 18 - Math.abs(designDistance - runtimeDistance) * 3);
  }
  return bonus;
}

function matchNodes(
  designNodes,
  runtimeNodes,
  designRootIndex,
  runtimeRootIndex,
  structureMatches = [],
  designStructure = null,
  runtimeStructure = null
) {
  const usedDesign = new Set();
  const usedRuntime = new Set();
  const designToRuntime = new Map();
  const runtimeToDesign = new Map();
  const matches = [];
  const structuredDesign = new Set((designStructure?.nodes || []).map(node => node.rawIndex));
  const structuredRuntime = new Set((runtimeStructure?.nodes || []).map(node => node.rawIndex));
  const structureGuarded = Boolean(designStructure && runtimeStructure);
  const addMatch = (designIndex, runtimeIndex, score, metadata = {}) => {
    if (!Number.isInteger(designIndex) || !Number.isInteger(runtimeIndex)) return;
    if (!inspectionVisible(designNodes[designIndex]) || !inspectionVisible(runtimeNodes[runtimeIndex])) return;
    if (usedDesign.has(designIndex) || usedRuntime.has(runtimeIndex)) return;
    usedDesign.add(designIndex);
    usedRuntime.add(runtimeIndex);
    designToRuntime.set(designIndex, runtimeIndex);
    runtimeToDesign.set(runtimeIndex, designIndex);
    matches.push({designIndex, runtimeIndex, score, ...metadata});
  };

  addMatch(designRootIndex, runtimeRootIndex, 100, {source: 'root', basis: ['选区根节点'], confidence: 'high'});
  structureMatches.filter(match => match.unique !== false && !match.layoutOnly).forEach(match => {
    addMatch(match.designNode?.rawIndex, match.runtimeNode?.rawIndex, Math.round(match.score || 100), {
      source: 'semantic-structure',
      basis: match.basis || [],
      confidence: 'high',
      designStructureNode: match.designNode,
      runtimeStructureNode: match.runtimeNode
    });
  });
  const candidates = [];
  const skippedDesign = designStructure?.skipped || new Set();
  const skippedRuntime = runtimeStructure?.skipped || new Set();
  const mappedOwner = (node, mapping) => {
    if (Number.isInteger(node._structureOwnerIndex) && mapping.has(node._structureOwnerIndex)) return mapping.get(node._structureOwnerIndex);
    const ancestor = node._ancestors.find(item => mapping.has(item._index));
    return ancestor ? mapping.get(ancestor._index) : null;
  };

  designNodes.forEach((designNode, designIndex) => runtimeNodes.forEach((runtimeNode, runtimeIndex) => {
    if (!inspectionVisible(designNode) || !inspectionVisible(runtimeNode)) return;
    if (designIndex === designRootIndex || runtimeIndex === runtimeRootIndex) return;
    if (skippedDesign.has(designIndex) || skippedRuntime.has(runtimeIndex)) return;
    if (structuredDesign.has(designIndex) || structuredRuntime.has(runtimeIndex)) return;
    if (structureGuarded) {
      const designRole = nodeRole(designNode, 'design');
      const runtimeRole = nodeRole(runtimeNode, 'runtime');
      if (designRole !== runtimeRole || !['text', 'image'].includes(designRole)) return;
      const expectedRuntimeOwner = mappedOwner(designNode, designToRuntime);
      const actualRuntimeOwner = runtimeNode._ancestors.find(item => usedRuntime.has(item._index))?._index ?? null;
      if (expectedRuntimeOwner == null || actualRuntimeOwner !== expectedRuntimeOwner) return;
      if (designRole === 'text' && (!designNode._text || designNode._text !== runtimeNode._text)) return;
      if (designRole === 'image') {
        const widthRatio = Math.max(designNode._nw, runtimeNode._nw) / Math.max(0.001, Math.min(designNode._nw, runtimeNode._nw));
        const heightRatio = Math.max(designNode._nh, runtimeNode._nh) / Math.max(0.001, Math.min(designNode._nh, runtimeNode._nh));
        if (widthRatio > 1.6 || heightRatio > 1.6) return;
      }
    }
    const score = matchScore(designNode, runtimeNode);
    if (score >= 38) candidates.push({designIndex, runtimeIndex, score});
  }));

  while (true) {
    let best = null;
    candidates.forEach(candidate => {
      if (usedDesign.has(candidate.designIndex) || usedRuntime.has(candidate.runtimeIndex)) return;
      const bonus = hierarchyBonus(
        designNodes[candidate.designIndex],
        runtimeNodes[candidate.runtimeIndex],
        designToRuntime,
        runtimeToDesign
      );
      const total = candidate.score + bonus;
      if (bonus <= -1000 || total < 46) return;
      if (!best || total > best.total) best = {...candidate, total};
    });
    if (!best) break;
    const rowAlternatives = candidates.filter(candidate => candidate.designIndex === best.designIndex
      && !usedRuntime.has(candidate.runtimeIndex))
      .map(candidate => candidate.score + hierarchyBonus(designNodes[candidate.designIndex], runtimeNodes[candidate.runtimeIndex], designToRuntime, runtimeToDesign))
      .filter(value => value > -900)
      .sort((left, right) => right - left);
    const columnAlternatives = candidates.filter(candidate => candidate.runtimeIndex === best.runtimeIndex
      && !usedDesign.has(candidate.designIndex))
      .map(candidate => candidate.score + hierarchyBonus(designNodes[candidate.designIndex], runtimeNodes[candidate.runtimeIndex], designToRuntime, runtimeToDesign))
      .filter(value => value > -900)
      .sort((left, right) => right - left);
    const rowMargin = best.total - (rowAlternatives[1] ?? -Infinity);
    const columnMargin = best.total - (columnAlternatives[1] ?? -Infinity);
    if (structureGuarded && (rowMargin < 8 || columnMargin < 8)) {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        if ((rowMargin < 8 && candidate.designIndex === best.designIndex)
          || (columnMargin < 8 && candidate.runtimeIndex === best.runtimeIndex)) candidates.splice(index, 1);
      }
      continue;
    }
    addMatch(best.designIndex, best.runtimeIndex, best.total, {
      source: structureGuarded ? 'strict-leaf' : 'legacy-leaf',
      basis: structureGuarded ? ['同角色', '同语义父区', '双向唯一'] : ['内容与几何'],
      confidence: 'high'
    });
  }

  // 第二遍·卡内文字补配(方向2)：进了结构树的 text 节点被主循环 L1069 排除、
  // 又因 groupKey 带绝对卡片序号(card#2 vs card#4)在结构匹配里分不到同组 → 文字全丢。
  // 此处专门捞回它们：仅在"父卡片两侧已配对"(mappedOwner)且"文字内容完全相同"时配对。
  // 候选池天然限定在已配对卡内 → 杜绝跨卡误配；文字内容相同是强身份证据 → 零歧义时才配。
  if (structureGuarded) {
    const runtimeTextByOwner = new Map();
    runtimeNodes.forEach((runtimeNode, runtimeIndex) => {
      if (!inspectionVisible(runtimeNode)) return;
      if (usedRuntime.has(runtimeIndex)) return;
      if (!structuredRuntime.has(runtimeIndex)) return;
      if (nodeRole(runtimeNode, 'runtime') !== 'text' || !runtimeNode._text) return;
      const owner = runtimeNode._ancestors.find(item => usedRuntime.has(item._index))?._index ?? null;
      if (owner == null) return;
      const key = `${owner}\u0000${runtimeNode._text}`;
      if (!runtimeTextByOwner.has(key)) runtimeTextByOwner.set(key, []);
      runtimeTextByOwner.get(key).push(runtimeIndex);
    });
    designNodes.forEach((designNode, designIndex) => {
      if (!inspectionVisible(designNode)) return;
      if (usedDesign.has(designIndex)) return;
      if (!structuredDesign.has(designIndex)) return;
      if (nodeRole(designNode, 'design') !== 'text' || !designNode._text) return;
      const expectedRuntimeOwner = mappedOwner(designNode, designToRuntime);
      if (expectedRuntimeOwner == null) return;
      const key = `${expectedRuntimeOwner}\u0000${designNode._text}`;
      const bucket = runtimeTextByOwner.get(key);
      // 同一父卡内、同文字，若前端恰好唯一一个未用候选 → 确定配对(零歧义)。
      if (!bucket || bucket.length !== 1) return;
      const runtimeIndex = bucket[0];
      if (usedRuntime.has(runtimeIndex)) return;
      const runtimeNode = runtimeNodes[runtimeIndex];
      // 弱文字保险：纯数字/符号或≤2字符(如"3""全部")身份弱，同卡内可能有多个不同位置的同值文字。
      // 额外要求全页归一化中心距≤0.25，挡住"左边的3配右边的3"这类同卡跨位置误配。
      // 长文字(≥3字符且非纯数字)身份强，不加此限，避免误伤位置有真差异的文字。
      const compact = designNode._text;
      const weakText = compact.length <= 2 || /^[\d.,%¥$€\s]+$/.test(compact);
      if (weakText) {
        const dcx = designNode._nx + designNode._nw / 2;
        const dcy = designNode._ny + designNode._nh / 2;
        const rcx = runtimeNode._nx + runtimeNode._nw / 2;
        const rcy = runtimeNode._ny + runtimeNode._nh / 2;
        if (Math.abs(dcx - rcx) + Math.abs(dcy - rcy) > 0.25) return;
      }
      addMatch(designIndex, runtimeIndex, 80, {
        source: 'card-inner-text',
        basis: ['父卡已配对', '同文字内容', '卡内唯一'],
        confidence: 'high'
      });
    });
  }
  return matches;
}

// A transparent component and its text can legitimately share a DOM node.
// Keep field measurement independent of the one-to-one component registry.
function styleMeasurementMatches(matches, structureMatches, ctx) {
  const out = [...matches], keys = new Set(matches.map(m => `${m.designIndex}|${m.runtimeIndex}`));
  for (const m of structureMatches) {
    const d = m.designNode?.raw, r = m.runtimeNode?.raw;
    if (m.unique === false || d?.type !== 'TEXT' || !r || !ctx
      || !InspectionContracts.pairValid(ctx, d, r) || !inspectionVisible(d) || !inspectionVisible(r)) continue;
    const key = `${d._index}|${r._index}`;
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({designIndex:d._index, runtimeIndex:r._index, confidence:'high',
      source:'confirmed-text-field', typographyOnly:true, basis:m.basis || []});
  }
  return out;
}

function humanText(value, max = 24) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function roleLabel(node) {
  const selector = clean(node?.selector);
  const tag = clean(node?.tag);
  if (/subtitle/.test(selector)) return '副标题';
  if (/collapse-trigger/.test(selector)) return '展开行';
  if (/collapse-dot/.test(selector)) return '状态圆点';
  if (/collapse-arrow/.test(selector)) return '展开箭头';
  if (/highlight/.test(selector)) return '高亮数字';
  if (/feedback/.test(selector)) return '反馈区';
  if (/pagination|pager/.test(selector)) return '分页';
  if (/^h[1-6]$/.test(tag) || /\.title(?:\.|$)/.test(selector)) return '标题';
  if (tag === 'button') return '按钮';
  if (['input', 'select', 'textarea'].includes(tag)) return '输入框';
  if (tag === 'th') return '表头';
  if (tag === 'td') return '表格单元格';
  if (tag === 'a') return '链接';
  if (nodeRole(node || {}, 'runtime') === 'text') return '文字';
  if (nodeRole(node || {}, 'runtime') === 'image') return '图片';
  return '组件';
}

function elementLabel(runtimeNode, designNode) {
  const text = humanText(runtimeNode?.text?.direct || designNode?.text?.direct);
  const area = semanticArea(runtimeNode) || semanticArea(designNode);
  let element = text;
  if (area === '分页' && /^\d+$/.test(text)) element = `页码 ${text}`;
  if (!element) element = roleLabel(runtimeNode || designNode);
  if (!element || element === '组件') element = humanText(designNode?.componentName || runtimeNode?.componentName);
  if (!element || element === '组件') {
    const layerName = String(designNode?.name || '');
    element = /^(frame|title|group|rectangle|ellipse|vector)\b/i.test(layerName) ? '组件' : humanText(layerName);
  }
  return [area, element].filter((value, index, list) => value && list.indexOf(value) === index).join(' · ') || '组件';
}

function checkName(element, property) {
  return `${element} · ${PROPERTY_LABELS[property] || property}`;
}

// Measurement contracts are separate from the raw boxes used by matching and style collection.
function scopeText(node) {
  return compactText(String(node?.text?.descendant || node?.text?.direct || '').replace(/[\u200b\ufeff]/g, ''));
}

function semanticScope(node) {
  if (typeof InspectionContracts !== 'undefined' && InspectionContracts.describeScope) return InspectionContracts.describeScope(node);
  if (!node) return {kind: 'unknown', labels: []};
  const role = clean(node.role);
  const children = node._children || [];
  const label = scopeText(node);
  if (['tablist', 'listbox', 'menu', 'radiogroup'].includes(role)) return {kind: 'collection', labels: children.map(scopeText).filter(Boolean)};
  const units = children.filter(child => {
    const display = clean(child.styles?.display);
    return scopeText(child) && (['tab', 'option', 'menuitem', 'button', 'radio'].includes(clean(child.role))
      || ['button', 'a'].includes(clean(child.tag))
      || ['flex', 'inline-flex', 'block', 'inline-block', 'grid'].includes(display)
      || (child.type && child.type !== 'TEXT'));
  });
  // Multiple independent, non-overlapping peers constitute a scope larger than one item.
  const labels = [...new Set(units.map(scopeText))];
  const disjoint = units.length >= 2 && units.every((a, i) => units.slice(i + 1).every(b => {
    const x = visualBox(a), y = visualBox(b);
    return x && y && (x.x + x.width <= y.x + 1 || y.x + y.width <= x.x + 1
      || x.y + x.height <= y.y + 1 || y.y + y.height <= x.y + 1);
  }));
  if (labels.length >= 2 && disjoint) return {kind: 'collection', labels};
  return {kind: label ? 'single' : 'unknown', labels: label ? [label] : []};
}

function semanticScopesCompatible(designNode, runtimeNode) {
  if (typeof InspectionContracts !== 'undefined' && InspectionContracts.semanticScopesCompatible)
    return InspectionContracts.semanticScopesCompatible(designNode, runtimeNode);
  const d = semanticScope(designNode), r = semanticScope(runtimeNode);
  const conflict = (single, collection) => single.kind === 'single' && collection.kind === 'collection'
    && collection.labels.includes(single.labels[0]);
  return !conflict(d, r) && !conflict(r, d);
}

function contentLayoutBox(node) {
  const box = visualBox(node);
  if (!box) return null;
  const styles = canonicalStyles(node);
  const inset = side => (number(styles[`padding-${side}`]) || 0) + (number(styles[`border-${side}-width`]) || 0);
  const left = inset('left'), top = inset('top');
  return {x: box.x + left, y: box.y + top,
    width: Math.max(0, box.width - left - inset('right')),
    height: Math.max(0, box.height - top - inset('bottom'))};
}

function explicitLineHeight(styles) {
  const value = normalizedStyle('line-height', styles?.['line-height'], styles);
  return value.kind === 'number' && value.unit === 'px' && value.value > 0 ? value.value : null;
}

// Text spacing always uses screenshot glyph bounds. Layout boxes are only locators.
function textLayoutMeasurement(node, side, limit = null) {
  const ink = node?.geometry?.textInk;
  const verified = ink?.policy === 'visible-text-ink-v1' && ink.status === 'measured'
    && ink.validation?.verified === true && ink.box
    && ['x','y','width','height'].every(k => Number.isFinite(ink.box[k]));
  return {box: verified ? ink.box : visualBox(node),
    axes: {horizontal: verified ? 'ink' : 'unknown', vertical: verified ? 'ink' : 'unknown'},
    source: verified ? 'screenshot-ink' : 'unresolved-text-ink', nodeId: node?.id, ownerId: node?.id,
    policy: 'visible-text-ink-v1', includesLineHeight: false,
    uncertaintyPx: ink?.uncertaintyPx, reason: verified ? null : ink?.reason || 'missing-text-screenshot'};
}

function inkOuter(node, side) {
  return typeof InspectionContracts !== 'undefined' ? InspectionContracts.paint(node) || InspectionContracts.control(node) : geometryPaintedBox(node, side) || ['button','input','select','textarea'].includes(node?.tag);
}

function layoutMeasurement(node, side, limit = null) {
  const isText = side === 'design' ? node?.type === 'TEXT' : Boolean(compactText(node?.text?.direct)) || geometryTextEntries(node).length > 0;
  // Painted controls keep their outer boundary when used as a spacing endpoint.
  // contentGeometryEntries measures their direct text separately for inner whitespace.
  if (isText && !(side === 'runtime' && inkOuter(node, side)))
    return textLayoutMeasurement(node, side, limit);
  if (side === 'design' && node?.type === 'TEXT') return textLayoutMeasurement(node, side, limit);
  if (scopeText(node) && !inkOuter(node, side)) {
    const entries = contentGeometryEntries(node, side);
    const complete = entries.length && entries.every(e => ['ink','layout'].includes(e.axes?.horizontal) && ['ink','layout'].includes(e.axes?.vertical));
    return {box: unionGeometryBoxes(entries.map(e=>e.box)) || visualBox(node),
      axes: {horizontal: complete ? 'ink' : 'unknown', vertical: complete ? 'ink' : 'unknown'},
      source: complete ? 'visible-content-union' : 'unresolved-text-ink', policy:'visible-text-ink-v1', includesLineHeight:false,nodeId:node.id,ownerId:node.id};
  }
  return {box: visualBox(node), axes: {horizontal: 'layout', vertical: 'layout'}, source: 'element-layout', nodeId: node?.id, ownerId: node?.id};
}

function visualBox(node) {
  const box = node?._box || node?.box?.local;
  if (!box) return null;
  const values = ['x', 'y', 'width', 'height'].map(key => number(box[key]));
  if (values.some(value => value == null)) return null;
  return {x: values[0], y: values[1], width: values[2], height: values[3]};
}

function visualTarget(designNodes, runtimeNodes) {
  const designList = (Array.isArray(designNodes) ? designNodes : [designNodes]).filter(Boolean);
  const runtimeList = (Array.isArray(runtimeNodes) ? runtimeNodes : [runtimeNodes]).filter(Boolean);
  const designBoxes = designList.map(visualBox).filter(Boolean);
  const runtimeBoxes = runtimeList.map(visualBox).filter(Boolean);
  if (!designBoxes.length && !runtimeBoxes.length) return null;
  const groups=nodes=>nodes.filter(n=>n._compoundMemberIds).map(n=>({id:n.id,memberIds:n._compoundMemberIds}));
  return {
    design: {groups:groups(designList),nodeIds: designList.map(node => node.id).filter(Boolean), boxes: designBoxes, measurements: designList.map(node => node._measurement).filter(Boolean)},
    runtime: {groups:groups(runtimeList),nodeIds: runtimeList.map(node => node.id).filter(Boolean), boxes: runtimeBoxes, measurements: runtimeList.map(node => node._measurement).filter(Boolean)}
  };
}

function propertyVisualTarget(property, designNode, runtimeNode) {
  const visual = visualTarget(designNode, runtimeNode);
  if (!visual || !['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'].includes(property)) return visual;
  const measuredTextBoxes = node => (node?.geometry?.textBoxes || []).map(box => {
    const values = ['x', 'y', 'width', 'height'].map(key => number(box?.[key]));
    return values.some(value => value == null) || values[2] <= 0 || values[3] <= 0
      ? null
      : {x: values[0], y: values[1], width: values[2], height: values[3]};
  }).filter(Boolean);
  const designTextBoxes = measuredTextBoxes(designNode);
  const runtimeTextBoxes = measuredTextBoxes(runtimeNode);
  if (designTextBoxes.length) visual.design.boxes = designTextBoxes;
  if (runtimeTextBoxes.length) visual.runtime.boxes = runtimeTextBoxes;
  return visual;
}

function unionGeometryBoxes(boxes) {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.x));
  const top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width));
  const bottom = Math.max(...boxes.map(box => box.y + box.height));
  return {x: left, y: top, width: right - left, height: bottom - top};
}

function geometryTextEntries(node) {
  return (node?.geometry?.textBoxes || []).map(box => ({node, box})).filter(entry => {
    const values = ['x', 'y', 'width', 'height'].map(key => number(entry.box?.[key]));
    return values.every(value => value != null) && values[2] > 0 && values[3] > 0;
  });
}

function geometryLeaf(node, side) {
  if (side === 'runtime') {
    return ['img', 'picture', 'canvas', 'video'].includes(clean(node?.tag));
  }
  return ['text', 'vector', 'boolean_operation', 'rectangle', 'ellipse', 'line', 'polygon', 'star']
    .includes(clean(node?.type));
}

function colorsVisuallyEqual(left, right) {
  if (!left || !right) return false;
  return left.every((channel, index) => Math.abs(channel - right[index]) <= (index === 3 ? 0.02 : 1));
}

function compositeColorChannels(source, backdrop) {
  const sourceAlpha = Math.max(0, Math.min(1, number(source?.[3]) ?? 0));
  const backdropAlpha = Math.max(0, Math.min(1, number(backdrop?.[3]) ?? 0));
  const alpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  if (alpha <= 0.0001) return [0, 0, 0, 0];
  const channels = [0, 1, 2].map(index => (
    (Math.max(0, Math.min(255, number(source?.[index]) ?? 0)) * sourceAlpha)
    + (Math.max(0, Math.min(255, number(backdrop?.[index]) ?? 0)) * backdropAlpha * (1 - sourceAlpha))
  ) / alpha);
  return [...channels, alpha];
}

function formattedColorChannels(channels) {
  const rgb = (channels || []).slice(0, 3).map(channel => Math.round(Math.max(0, Math.min(255, number(channel) ?? 0))));
  const alpha = Math.max(0, Math.min(1, number(channels?.[3]) ?? 0));
  if (alpha >= 0.999) return `rgb(${rgb.join(',')})`;
  return `rgba(${rgb.join(',')},${rounded(alpha)})`;
}

function effectiveBackground(node) {
  const ownStyles = canonicalStyles(node);
  const ownValue = textClippedBackground(node) ? 'transparent' : ownStyles['background-color'] ?? ownStyles.background;
  const layers = [];
  let owner = null;
  let remainingTransparency = 1;
  let reason = '';
  let current = node;
  while (current) {
    const styles = canonicalStyles(current);
    const opacity = number(styles.opacity);
    if (opacity != null && opacity < 0.999) {
      reason = 'opacity';
      break;
    }
    const backgroundImage = textClippedBackground(current) ? '' : clean(styles['background-image']);
    if (remainingTransparency > 0.001 && backgroundImage && backgroundImage !== 'none') {
      reason = 'background-image';
      break;
    }
    const value = textClippedBackground(current) ? 'transparent' : styles['background-color'] ?? styles.background;
    const channels = colorChannels(value);
    if (value != null && !channels && !['', 'none'].includes(clean(value))) {
      reason = 'unsupported-background';
      break;
    }
    if (channels && channels[3] > 0.001) {
      const layer = {node: current, value, styles, channels};
      layers.push(layer);
      if (!owner && channels[3] > 0.02) owner = layer;
      remainingTransparency *= 1 - channels[3];
      if (remainingTransparency <= 0.001) break;
    }
    // 背景 Owner 追溯边界：不越过"已是另一个卡片/区域"的祖先。
    // 否则透明小卡(如品退率指标卡自身透明)会一路穿透追到外层大模块容器,
    // 借用大模块白底 → 红框圈错位置、背景色取错(误报"淡绿vs白")。
    // 小卡自身背景(current===node 首轮)不受限;仅当往上遇到祖先区域节点时停。
    const parent = current._parent;
    if (parent && parent !== node) {
      const parentRole = parent._semanticRole || '';
      if (STRUCTURE_REGIONS.has(parentRole)) {
        reason = reason || 'region-boundary';
        break;
      }
    }
    current = parent;
  }
  let channels = [0, 0, 0, 0];
  [...layers].reverse().forEach(layer => {
    channels = compositeColorChannels(layer.channels, channels);
  });
  const resolved = !reason && channels[3] >= 0.999;
  const target = owner || {node, value: ownValue, styles: ownStyles};
  return {
    node: target.node,
    value: formattedColorChannels(channels),
    rawValue: target.value,
    styles: target.styles,
    channels,
    resolved,
    reason: reason || (resolved ? 'composited' : 'missing-opaque-background'),
    layers
  };
}

function radiusValues(styles = {}) {
  const shorthand = String(styles['border-radius'] || '').split('/')[0];
  const expanded = expandBoxShorthand(shorthand);
  const values = expanded
    ? Object.values(expanded).map(number).filter(value => value != null)
    : [];
  ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
    .forEach(property => {
      const value = number(styles[property]);
      if (value != null) values.push(value);
    });
  return values;
}

function radiusFootprint(node, anchor) {
  const box = visualBox(node);
  const anchorBox = visualBox(anchor);
  if (!box || !anchorBox || box.width <= 0 || box.height <= 0 || anchorBox.width <= 0 || anchorBox.height <= 0) return null;
  const tolerance = Math.max(2, Math.min(anchorBox.width, anchorBox.height) * 0.08);
  const left = box.x - anchorBox.x;
  const top = box.y - anchorBox.y;
  const right = anchorBox.x + anchorBox.width - box.x - box.width;
  const bottom = anchorBox.y + anchorBox.height - box.y - box.height;
  if ([left, top, right, bottom].some(value => value < -tolerance)) return null;
  const widthCoverage = Math.min(1, box.width / anchorBox.width);
  const heightCoverage = Math.min(1, box.height / anchorBox.height);
  const closeEdges = [left, top, right, bottom].filter(value => Math.abs(value) <= tolerance).length;
  if (widthCoverage < 0.72 || heightCoverage < 0.72 || closeEdges < 3) return null;
  return {
    widthCoverage,
    heightCoverage,
    closeEdges,
    score: (widthCoverage + heightCoverage) * 30 + closeEdges * 8
  };
}

function radiusTraversalBoundary(anchor, candidate) {
  const anchorRole = anchor?._semanticRole || '';
  const candidateRole = candidate?._semanticRole || '';
  if (!candidateRole || candidateRole === anchorRole) return false;
  if (CONTROL_ROLES.has(candidateRole) && !CONTROL_ROLES.has(anchorRole)) return true;
  return ['card', 'table', 'pagination', 'filter-row', 'data-row-template'].includes(candidateRole);
}

function radiusOwnerVisuallyHidden(node) {
  let current = node;
  let effectiveOpacity = 1;
  while (current) {
    const styles = canonicalStyles(current);
    if (clean(styles.display) === 'none') return true;
    if (['hidden', 'collapse'].includes(clean(styles.visibility))) return true;
    if (clean(styles['content-visibility']) === 'hidden') return true;
    const opacity = number(styles.opacity);
    if (opacity != null) effectiveOpacity *= Math.max(0, Math.min(1, opacity));
    if (effectiveOpacity <= 0.02) return true;
    current = current._parent;
  }
  return false;
}

// 圆角要"看得见"，必须有可见载体：非透明背景/背景图、或裁剪子元素(overflow hidden/clip)、
// 或圆角对应的角上有可见边框。透明背景 + overflow visible + 无对应边框的纯 border-radius 声明，
// 圆的是"空气"，人眼看不到任何圆角(典型:组件库给<table> 声明的 4px 微圆角但表格透明无边框)。
// 这类不可见圆角不应作为圆角视觉 Owner 参与比较，否则会产生"0px → 4px"这种视觉零差异的误报。
function radiusClipsContents(styles) {
  const values = ['x','y'].map(axis => clean(styles[`overflow-${axis}`] || styles.overflow || 'visible'));
  // Computed browser styles already normalize the mixed-axis cases. Figma
  // snapshots may contain only the shorthand. A scrollport clips too.
  return values.every(value => ['hidden','clip','auto','scroll'].includes(value));
}

function radiusHasVisibleCarrier(node, styles, side) {
  // 1. 非透明背景 / 背景图 → 圆角裁背景 → 可见
  const background = colorChannels(styles['background-color'] ?? styles.background);
  if (!textClippedBackground(node) && background && background[3] > 0.02) return true;
  const backgroundImage = clean(styles['background-image']);
  if (!textClippedBackground(node) && backgroundImage && backgroundImage !== 'none') return true;
  //注意：不能用 geometryPaintedBox 判"圆角可见"——它表示"节点有绘制/内容"(如内部文字)，
  // 但内部文字/无关边框圆不到角上。圆角可见的载体必须是圆角能真正弯折/裁剪出来的东西。
  // 2. 裁剪子元素 → 圆角裁掉子内容 → 可见
  if (radiusClipsContents(styles) || (clean(styles['clip-path']) && clean(styles['clip-path']) !== 'none')) return true;
  if (styles['box-shadow'] && clean(styles['box-shadow']) !== 'none') return true;
  // 3. 圆角对应角上有可见边框 → 边框被圆角弯折 → 可见
  const hasBorder = edge => (number(styles[`border-${edge}-width`]) || 0) > 0.01
    && !['none', ''].includes(clean(styles[`border-${edge}-style`]));
  const r = {
    tl: number(styles['border-top-left-radius']),
    tr: number(styles['border-top-right-radius']),
    br: number(styles['border-bottom-right-radius']),
    bl: number(styles['border-bottom-left-radius'])
  };
  const expanded = expandBoxShorthand(String(styles['border-radius'] || '').split('/')[0]);
  if (expanded) {
    if (r.tl == null) r.tl = number(expanded.top);
    if (r.tr == null) r.tr = number(expanded.right);
    if (r.br == null) r.br = number(expanded.bottom);
    if (r.bl == null) r.bl = number(expanded.left);
  }
  // 每个圆角只有当它相邻的两条边都有可见边框时才可见(圆角是两边的交汇处的弯折)
  if ((r.tl || 0) > 0.01 && hasBorder('top') && hasBorder('left')) return true;
  if ((r.tr || 0) > 0.01 && hasBorder('top') && hasBorder('right')) return true;
  if ((r.br || 0) > 0.01 && hasBorder('bottom') && hasBorder('right')) return true;
  if ((r.bl || 0) > 0.01 && hasBorder('bottom') && hasBorder('left')) return true;
  return false;
}

function radiusCandidate(node, anchor, side, depth) {
  if (radiusOwnerVisuallyHidden(node)) return null;
  const footprint = radiusFootprint(node, anchor);
  if (!footprint) return null;
  const styles = canonicalStyles(node);
  const radii = radiusValues(styles);
  if (!radii.length) return null;
  const positive = radii.some(value => value > 0.01);
  const clips = radiusClipsContents(styles) || (clean(styles['clip-path']) && clean(styles['clip-path']) !== 'none');
  const painted = geometryPaintedBox(node, side);
  const anchorNode = node.id === anchor.id;
  if (!anchorNode && !positive && !clips && !painted) return null;
  // 有正圆角但无可见载体(透明背景+无裁剪+无对应边框) → 圆角不可见 → 不作为 owner。
  // 仅对 runtime(前端)侧生效：前端受 CSS 渲染规则约束，透明无边框的 border-radius 圆的是空气看不见
  // (典型:组件库给<table>声明的 4px 微圆角)。Figma 侧圆角是"形状属性"而非 CSS 渲染副产品，
  // 声明了就代表设计意图上是圆角，不受此门槛限制。
  if (side === 'runtime' && positive && !radiusHasVisibleCarrier(node, styles, side)) return null;
  const value = styles['border-radius'] || `${Math.max(...radii)}px`;
  return {
    node,
    styles,
    value,
    positive,
    clips,
    painted,
    depth,
    score: footprint.score + (positive ? 38 : 0) + (painted ? 14 : 0) + (clips ? 10 : 0) + (anchorNode ? 5 : 0)
  };
}

function radiusVisualOwner(node, side) {
  const candidates = [];
  const seen = new Set();
  const addCandidate = (candidateNode, depth) => {
    if (!candidateNode || seen.has(candidateNode.id)) return;
    seen.add(candidateNode.id);
    const candidate = radiusCandidate(candidateNode, node, side, depth);
    if (candidate) candidates.push(candidate);
  };
  addCandidate(node, 0);

  const queue = (node?._children || []).map(child => ({node: child, depth: 1}));
  while (queue.length) {
    const current = queue.shift();
    if (current.depth > 4 || radiusTraversalBoundary(node, current.node)) continue;
    addCandidate(current.node, current.depth);
    current.node._children.forEach(child => queue.push({node: child, depth: current.depth + 1}));
  }

  let ancestor = node?._parent;
  let ancestorDepth = 1;
  while (ancestor && ancestorDepth <= 4) {
    if (radiusTraversalBoundary(node, ancestor)) break;
    addCandidate(ancestor, ancestorDepth);
    if (!radiusFootprint(ancestor, node)) break;
    ancestor = ancestor._parent;
    ancestorDepth += 1;
  }

  candidates.sort((left, right) => right.score - left.score || left.depth - right.depth);
  const owner = candidates[0];
  if (!owner) {
    return {node, styles: canonicalStyles(node), value: null, resolved: false, evidence: ['未找到明确圆角轮廓']};
  }
  const alternative = candidates[1];
  if (alternative && Math.abs(owner.score - alternative.score) < 4
    && !equalStyle('border-radius', owner.value, alternative.value, owner.styles, alternative.styles)) {
    return {node, styles: canonicalStyles(node), value: null, resolved: false, evidence: ['圆角轮廓存在歧义']};
  }
  return {
    node: owner.node,
    styles: owner.styles,
    value: owner.value,
    resolved: true,
    confidence: owner.score,
    evidence: owner.node.id === node.id
      ? ['圆角视觉轮廓']
      : ['圆角视觉轮廓', '同组件内轮廓层']
  };
}

function radiusScopePriority(node, side) {
  const role = node?._semanticRole || semanticBaseRole(node, side, -1);
  if (CONTROL_ROLES.has(role)) return 120;
  if (role === 'image' || nodeRole(node, side) === 'image') return 112;
  if (role === 'card') return 108;
  if (['table', 'filter-row', 'pagination', 'data-row-template'].includes(role)) return 96;
  if (['head-cell', 'data-cell', 'table-head', 'title-region'].includes(role)) return 70;
  if (role === 'root') return 48;
  return 56;
}

function radiusPairGeometryScore(designNode, runtimeNode) {
  const designBox = visualBox(designNode);
  const runtimeBox = visualBox(runtimeNode);
  if (!designBox || !runtimeBox || designBox.width <= 0 || designBox.height <= 0 || runtimeBox.width <= 0 || runtimeBox.height <= 0) return 0;
  const widthRatio = Math.min(designBox.width, runtimeBox.width) / Math.max(designBox.width, runtimeBox.width);
  const heightRatio = Math.min(designBox.height, runtimeBox.height) / Math.max(designBox.height, runtimeBox.height);
  const designAspect = designBox.width / designBox.height;
  const runtimeAspect = runtimeBox.width / runtimeBox.height;
  const aspectRatio = Math.min(designAspect, runtimeAspect) / Math.max(designAspect, runtimeAspect);
  return (widthRatio + heightRatio + aspectRatio) * 18;
}

function resolveRadiusOwnerPairs(matches, designNodes, runtimeNodes) {
  const proposals = [];
  matches.forEach(match => {
    const designNode = designNodes[match.designIndex];
    const runtimeNode = runtimeNodes[match.runtimeIndex];
    if (!designNode || !runtimeNode || !propertyEligibleForMatch('border-radius', match, designNode, runtimeNode)) return;
    const designProperty = radiusVisualOwner(designNode, 'design');
    const runtimeProperty = radiusVisualOwner(runtimeNode, 'runtime');
    if (!designProperty.resolved || !runtimeProperty.resolved
      || designProperty.value == null || runtimeProperty.value == null) return;
    proposals.push({
      match,
      designProperty,
      runtimeProperty,
      score: radiusScopePriority(designNode, 'design')
        + radiusScopePriority(runtimeNode, 'runtime')
        + radiusPairGeometryScore(designProperty.node, runtimeProperty.node)
        + Math.min(36, ((designProperty.confidence || 0) + (runtimeProperty.confidence || 0)) / 8)
        + (match.source === 'semantic-structure' ? 12 : match.source === 'root' ? 4 : 0)
    });
  });
  proposals.sort((left, right) => right.score - left.score);
  const usedDesignOwners = new Set();
  const usedRuntimeOwners = new Set();
  const selected = new Map();
  proposals.forEach(proposal => {
    const designId = proposal.designProperty.node.id;
    const runtimeId = proposal.runtimeProperty.node.id;
    if (usedDesignOwners.has(designId) || usedRuntimeOwners.has(runtimeId)) return;
    usedDesignOwners.add(designId);
    usedRuntimeOwners.add(runtimeId);
    selected.set(proposal.match, proposal);
  });
  return selected;
}

function resolveVisualProperty(node, side, property) {
  if (property === 'background-color') {
    const background = effectiveBackground(node);
    return {
      node: background.node,
      styles: background.styles,
      value: background.value,
      resolved: background.resolved,
      evidence: background.layers?.length > 1 ? ['透明度合成后的可见背景'] : ['可见背景所有者']
    };
  }
  if (property === 'border-radius') return radiusVisualOwner(node, side);
  const styles = canonicalStyles(node);
  if (side === 'runtime' && /^(input|textarea)$/i.test(node.tag || '')
    && ['color','font-size','font-weight','line-height','letter-spacing'].includes(property)) {
    const controlText = node.controlTextStyle;
    if (controlText?.mode === 'placeholder') {
      const own = controlText.styles || {}, painted = {...styles, ...own};
      let value = own[property];
      if (property === 'color') {
        const channels = colorChannels(own['-webkit-text-fill-color'] || value);
        const opacity = number(own.opacity);
        if (channels && opacity != null) {
          channels[3] *= opacity;
          value = `rgba(${channels.join(',')})`;
        }
      }
      return {node, styles: painted, value, resolved: value != null, evidence: ['占位文字实际绘制样式']};
    }
    if (controlText?.mode === 'empty' || !controlText && node.placeholder) {
      return {node, styles, value: null, resolved: false, evidence: ['尚未采集占位文字的实际样式']};
    }
  }
  return {node, styles, value: styles[property], resolved: true, evidence: ['属性所在节点']};
}

function measureVisibleBackground(designNode, runtimeNode, context) {
  if (typeof BackgroundReview === 'undefined' || !context) return null;
  // Ordinary controls keep their existing solid-color owner measurement. A
  // selected page or a module with separate backdrop layers uses painted pixels.
  const inputs = {};
  for (const [side,node] of [['design',designNode],['runtime',runtimeNode]]) {
    const pixels = backgroundMeasurements[side];
    inputs[side] = {root:node,nodes:context[side+'Nodes'],image:pixels?.image,
      cssWidth:pixels?.cssWidth,cssHeight:pixels?.cssHeight,validRegion:pixels?.validRegion,
      ancestorBackgrounds:side==='runtime' && !node._parent ? runtime?._meta?.backgroundContext?.ancestors || [] : node._ancestors || []};
  }
  const rootPair = !designNode._parent && !runtimeNode._parent;
  if (!rootPair && !['design','runtime'].some(side => BackgroundReview.describe(inputs[side]).layerIds?.length)) return null;
  if (captureDiagnostics?.stateValidation?.status==='mismatch') return {status:'unresolved',
    reasonCode:'background-capture-state-mismatch',reason:'截图与节点测量时的滚动或视口状态不同，背景需在同一状态重新采集',samples:[]};
  return BackgroundReview.review(inputs);
}

async function prepareBackgroundMeasurements() {
  backgroundMeasurements = {design:null,runtime:null};
  if (typeof BackgroundReview === 'undefined') return;
  const stats = {};
  for (const side of ['design','runtime']) {
    const source=report?.visuals?.[side];
    if (!source?.dataUrl) {stats[side]={status:'missing-image'};continue;}
    try {
      const image=await loadImage(source.dataUrl),canvas=document.createElement('canvas');
      canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
      const first=side==='runtime'?captureDiagnostics?.coverage?.rectangles?.[0]:null;
      backgroundMeasurements[side]={image:context.getImageData(0,0,canvas.width,canvas.height),
        cssWidth:source.width,cssHeight:source.height,
        validRegion:first?{x:first.left,y:first.top,width:first.right-first.left,height:first.bottom-first.top}:null};
      stats[side]={status:'ready',validRegion:backgroundMeasurements[side].validRegion};
    } catch(error) {stats[side]={status:'failed',reason:error.message};}
  }
  if(report) report.technical.backgroundCapture=stats;
  return stats;
}

function propertyEligibleForMatch(property, match, designNode, runtimeNode) {
  if (match.confidence !== 'high') return false;
  const designRole = designNode._semanticRole || semanticBaseRole(designNode, 'design', -1);
  const runtimeRole = runtimeNode._semanticRole || semanticBaseRole(runtimeNode, 'runtime', -1);
  const textProperty = ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'].includes(property);
  if (match.typographyOnly) return textProperty && designNode.type === 'TEXT' && Boolean(runtimeNode.text?.direct);
  if (textProperty) {
    // head-cell / data-cell 本质是"装文字的单元格"，其字号/颜色等价于内部文字，应参与文字属性比较。
    // 否则表格表头/单元格即使匹配上了也不产出任何文字检查（表格在报告里完全空白）。
    const textRoles = ['text', 'title', 'button', 'input', 'select', 'textarea', 'date-input', 'head-cell', 'data-cell'];
    const designText = textRoles.includes(designRole);
    const runtimeText = textRoles.includes(runtimeRole);
    return designText && runtimeText;
  }
  if (property === 'background-color') {
    return match.source === 'root'
      || (match.source === 'semantic-structure'
        && (STRUCTURE_REGIONS.has(designRole) || CONTROL_ROLES.has(designRole))
        && (STRUCTURE_REGIONS.has(runtimeRole) || CONTROL_ROLES.has(runtimeRole)));
  }
  if (property === 'border-radius') {
    const designOwnerRole = STRUCTURE_REGIONS.has(designRole) || CONTROL_ROLES.has(designRole) || designRole === 'image';
    const runtimeOwnerRole = STRUCTURE_REGIONS.has(runtimeRole) || CONTROL_ROLES.has(runtimeRole) || runtimeRole === 'image';
    return designOwnerRole && runtimeOwnerRole;
  }
  if (/^overflow-/.test(property)) {
    return match.source === 'root' || (STRUCTURE_REGIONS.has(designRole) && STRUCTURE_REGIONS.has(runtimeRole));
  }
  return false;
}

function geometryBackgroundVisible(node) {
  if (textClippedBackground(node)) return false;
  const styles = canonicalStyles(node);
  const background = colorChannels(styles['background-color'] || styles.background);
  if (!background || background[3] <= 0.02) return false;
  let parent = node?._parent;
  while (parent) {
    const parentStyles = canonicalStyles(parent);
    const parentBackground = colorChannels(parentStyles['background-color'] || parentStyles.background);
    if (parentBackground && parentBackground[3] > 0.02) return !colorsVisuallyEqual(background, parentBackground);
    parent = parent._parent;
  }
  return true;
}

function textClippedBackground(node) {
  if (typeof InspectionContracts !== 'undefined' && typeof InspectionContracts.textClippedBackground === 'function') return InspectionContracts.textClippedBackground(node);
  const styles = node?.styles || {};
  const clips = String(styles['background-clip'] || styles['-webkit-background-clip'] || '').split(',').map(v => v.trim());
  if (clips.length > 1) return clips.every(v => v === 'text');
  return node?.geometry?.textPaint?.clip === 'text' || ['linear-gradient', 'css-gradient'].includes(node?.geometry?.textPaint?.kind)
    || [styles['background-clip'], styles['-webkit-background-clip']].some(v => clean(v) === 'text');
}

function geometryPaintedBox(node, side) {
  const styles = canonicalStyles(node);
  const hasBackground = geometryBackgroundVisible(node);
  const borderSides = ['top', 'right', 'bottom', 'left'];
  const hasBorder = borderSides.some(edge => {
    const width = number(styles[`border-${edge}-width`]) || 0;
    const borderStyle = clean(styles[`border-${edge}-style`]);
    const color = colorChannels(styles[`border-${edge}-color`]);
    return width > 0.01 && borderStyle !== 'none' && (!color || color[3] > 0.02);
  });
  const hasShadow = styles['box-shadow'] && clean(styles['box-shadow']) !== 'none';
  const hasOutline = styles.outline && clean(styles.outline) !== 'none';
  const backgroundImage = clean(styles['background-image']);
  const maskImage = clean(styles['mask-image'] || styles['-webkit-mask-image']);
  const fill = clean(styles.fill);
  const stroke = clean(styles.stroke);
  const hasImage = Boolean((!textClippedBackground(node) && backgroundImage && backgroundImage !== 'none') || (maskImage && maskImage !== 'none'));
  const vectorNode = side === 'runtime'
    ? ['svg', 'path', 'use', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'].includes(clean(node?.tag))
    : ['vector', 'boolean_operation', 'rectangle', 'ellipse', 'line', 'polygon', 'star'].includes(clean(node?.type));
  const hasVectorPaint = vectorNode && Boolean((fill && fill !== 'none' && fill !== 'transparent')
    || (stroke && stroke !== 'none' && stroke !== 'transparent'));
  return Boolean(hasBackground || hasBorder || hasShadow || hasOutline || hasImage || hasVectorPaint);
}

// paint 型节点(有绘制)在"有子内容时"是否应作为内容边界计入包围盒。
// 边框/阴影/图片/矢量绘制 → 能勾勒出可见形状 → 是内容边界(保留)。
// 仅背景色铺满 → 是容器底色而非内容 → 不作为内容边界(否则视觉留白被撑到外框恒为0)。
function geometryPaintIsContentBoundary(node, side) {
  const styles = canonicalStyles(node);
  const borderSides = ['top', 'right', 'bottom', 'left'];
  const hasBorder = borderSides.some(edge => {
    const width = number(styles[`border-${edge}-width`]) || 0;
    const borderStyle = clean(styles[`border-${edge}-style`]);
    const color = colorChannels(styles[`border-${edge}-color`]);
    return width > 0.01 && borderStyle !== 'none' && (!color || color[3] > 0.02);
  });
  const hasShadow = styles['box-shadow'] && clean(styles['box-shadow']) !== 'none';
  const hasOutline = styles.outline && clean(styles.outline) !== 'none';
  const backgroundImage = clean(styles['background-image']);
  const maskImage = clean(styles['mask-image'] || styles['-webkit-mask-image']);
  const hasImage = Boolean((!textClippedBackground(node) && backgroundImage && backgroundImage !== 'none') || (maskImage && maskImage !== 'none'));
  const fill = clean(styles.fill);
  const stroke = clean(styles.stroke);
  const vectorNode = side === 'runtime'
    ? ['svg', 'path', 'use', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'].includes(clean(node?.tag))
    : ['vector', 'boolean_operation', 'rectangle', 'ellipse', 'line', 'polygon', 'star'].includes(clean(node?.type));
  const hasVectorPaint = vectorNode && Boolean((fill && fill !== 'none' && fill !== 'transparent')
    || (stroke && stroke !== 'none' && stroke !== 'transparent'));
  return Boolean(hasBorder || hasShadow || hasOutline || hasImage || hasVectorPaint);
}

function geometryRisk(node) {
  const styles = canonicalStyles(node);
  const transform = clean(styles.transform);
  const clipPath = clean(styles['clip-path']);
  const pseudo = node?.geometry?.pseudoElements;
  // Legacy captures only had a boolean. Keep those uncertain; fresh captures
  // distinguish an unpainted pseudo from a bounded painted pseudo.
  const pseudoRisk = Array.isArray(pseudo)
    ? pseudo.some(item => item.status !== 'unpainted'
      && (item.status !== 'bounded' || !item.box))
    : Boolean(node?.geometry?.hasPseudoContent);
  // getBoundingClientRect already includes a pure translation; it does not
  // change which side of the captured box is left/right/top/bottom.
  const matrix = transform.match(/^matrix\(\s*1\s*,\s*0\s*,\s*0\s*,\s*1\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/);
  return Boolean(pseudoRisk
    || (transform && transform !== 'none' && !matrix)
    || (clipPath && clipPath !== 'none'));
}

function geometryEntryKind(node, side, source) {
  if (source === 'text' || source === 'control-text') return 'text';
  // A span can paint a button border while containing text. Its visible outer
  // edge is a painted boundary on both sides, regardless of the DOM tag/role.
  if (source === 'paint') return 'paint';
  const role = nodeRole(node || {}, side);
  if (role === 'text') return 'text';
  if (role === 'icon') return 'icon';
  if (role === 'image') return 'image';
  if (role === 'shape') return 'paint';
  if (role === 'control') return 'control';
  return source === 'media' ? 'graphic' : 'paint';
}

function geometrySemanticLeaf(node, side) {
  const role = nodeRole(node || {}, side);
  return role === 'icon' || role === 'image';
}

function geometryContentEntry(node, box, kind, source) {
  return {
    node,
    box,
    kind,
    source,
    axes: {horizontal: 'layout', vertical: 'layout'},
    anchor: compactText(nodeAnchor(node))
  };
}

function geometrySubtreeHidden(node) {
  const css = canonicalStyles(node);
  // visibility can be overridden by a descendant; it must not prune its subtree.
  return node?.visible === false || clean(css.display) === 'none'
    || clean(css['content-visibility']) === 'hidden'
    || (css.opacity != null && Number(css.opacity) === 0);
}

function clipContentEntries(entries, owner) {
  const css = canonicalStyles(owner), outer = visualBox(owner);
  if (!outer) return entries;
  const clipX = /^(hidden|clip|scroll|auto)$/.test(clean(css['overflow-x'] || css.overflow));
  const clipY = /^(hidden|clip|scroll|auto)$/.test(clean(css['overflow-y'] || css.overflow));
  if (!clipX && !clipY) return entries;
  return entries.map(entry => {
    const b=entry.box,x=clipX?Math.max(b.x,outer.x):b.x,y=clipY?Math.max(b.y,outer.y):b.y;
    const right=clipX?Math.min(b.x+b.width,outer.x+outer.width):b.x+b.width;
    const bottom=clipY?Math.min(b.y+b.height,outer.y+outer.height):b.y+b.height;
    return {...entry,box:{x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)}};
  }).filter(entry => entry.box.width>0 && entry.box.height>0);
}

function contentGeometryEntries(node, side, depth = 0, limit = node) {
  if (!node || depth > 64 || geometrySubtreeHidden(node)) return [];
  const isText = side === 'design' ? node.type === 'TEXT' : Boolean(compactText(node.text?.direct)) || geometryTextEntries(node).length > 0;
  const measurement = isText ? textLayoutMeasurement(node, side, limit) : null;
  const ownText = isText && measurement?.box ? [{
    ...geometryContentEntry(node, measurement.box, 'text', measurement.source),
    axes: measurement.axes, ownerId: measurement.ownerId
  }] : [];
  const ownPseudo = side === 'runtime' && Array.isArray(node.geometry?.pseudoElements)
    ? node.geometry.pseudoElements.filter(item => item.status === 'bounded' && item.box)
      .map(item => ({...geometryContentEntry(node, item.box, 'paint', 'pseudo'), ownerId: node.id}))
    : [];
  const ownBox = visualBox(node);
  // A zero-sized wrapper can own visible absolutely-positioned descendants.
  // Only a subtree that cannot paint is pruned; individual boxes are filtered later.
  const children = (node._children || []).filter(child => !geometrySubtreeHidden(child));
  if (depth > 0 && ownBox && geometrySemanticLeaf(node, side)) {
    return [geometryContentEntry(node, ownBox, geometryEntryKind(node, side, 'media'), 'semantic-leaf')];
  }
  const nested = clipContentEntries(children.flatMap(child => contentGeometryEntries(child, side, depth + 1, limit)), node);
  const content = [...ownText, ...ownPseudo, ...nested];
  if (content.length) {
    // 有子内容时，仅当自身paint 是"能勾勒内容形状的绘制"(边框/阴影/图片/矢量)才把满框计入内容边界。
    // 纯背景色铺满的容器是"底色"不是内容——子内容已代表真实内容边缘，若把满框背景计入，
    // 视觉留白会被撑到外框而恒为 0(典型:filter-panel-new 白底铺满整条,导致"今日模块留白=0px"误报)。
    if (depth > 0 && ownBox && geometryPaintedBox(node, side) && geometryPaintIsContentBoundary(node, side)) {
      content.unshift(geometryContentEntry(node, ownBox, geometryEntryKind(node, side, 'paint'), 'paint'));
    }
    return content;
  }
  if (depth > 0 && ownBox && geometryLeaf(node, side)) {
    return [geometryContentEntry(node, ownBox, geometryEntryKind(node, side, 'media'), 'media')];
  }
  if (depth > 0 && ownBox && geometryPaintedBox(node, side)) {
    return [geometryContentEntry(node, ownBox, geometryEntryKind(node, side, 'paint'), 'paint')];
  }
  return [];
}

function geometryEdge(entries, side, outerRisk) {
  if (!entries.length) return {confidence: 'none', kinds: [], nodeIds: []};
  const tolerance = 1.5;
  const value = entry => {
    if (side === 'top') return entry.box.y;
    if (side === 'right') return entry.box.x + entry.box.width;
    if (side === 'bottom') return entry.box.y + entry.box.height;
    return entry.box.x;
  };
  const target = ['right', 'bottom'].includes(side)
    ? Math.max(...entries.map(value))
    : Math.min(...entries.map(value));
  const contributors = entries.filter(entry => Math.abs(value(entry) - target) <= tolerance);
  const axis = ['top', 'bottom'].includes(side) ? 'vertical' : 'horizontal';
  const boundaryKinds = [...new Set(contributors.map(entry => entry.axes?.[axis] || 'unknown'))];
  // An unresolved child elsewhere in the module cannot make this edge
  // uncertain if it does not contribute to the measured boundary.
  const risky = outerRisk || contributors.some(entry => geometryRisk(entry.node) || entry.axes?.[axis] === 'unknown') || boundaryKinds.some(kind => !['layout','ink'].includes(kind));
  return {
    confidence: risky ? 'medium' : 'high',
    boundaryKinds,
    sources: [...new Set(contributors.map(entry => entry.source))],
    ownerIds: [...new Set(contributors.map(entry => entry.ownerId || entry.node.id))],
    kinds: [...new Set(contributors.map(entry => entry.kind).filter(Boolean))],
    anchors: [...new Set(contributors.map(entry => entry.anchor).filter(Boolean))],
    nodeIds: contributors.map(entry => entry.node?.id).filter(Boolean)
  };
}

function geometryEdgesComparable(designGeometry, runtimeGeometry, side, allowContentMismatch, ownerPairs) {
  const designEdge = designGeometry.edges?.[side];
  const runtimeEdge = runtimeGeometry.edges?.[side];
  if (!designEdge?.boundaryKinds?.every(kind => ['layout','ink'].includes(kind)) || !runtimeEdge?.boundaryKinds?.every(kind => ['layout','ink'].includes(kind))) return false;
  if (designEdge?.confidence !== 'high' || runtimeEdge?.confidence !== 'high') return false;
  const sharedKinds = designEdge.kinds.filter(kind => runtimeEdge.kinds.includes(kind));
  const graphics=new Set(['icon','image','graphic']);
  const pairedGraphic=ownerPairs&&designEdge.kinds.every(k=>graphics.has(k))&&runtimeEdge.kinds.every(k=>graphics.has(k))
    &&designEdge.ownerIds?.some(id=>runtimeEdge.ownerIds?.includes(ownerPairs.get(id)));
  if (!sharedKinds.length && !pairedGraphic) return false;
  if(pairedGraphic)return true;
  // allowContentMismatch: 数据单元格(data-cell)的文字内容天生不同(设计占位"¥4545" vs 前端真实"¥200"),
  //   只要两侧边缘都是同类内容(如都 text)即可比留白, 不要求文字锚点一致。
  if (allowContentMismatch && sharedKinds.length) return true;
  const designAnchors = designEdge.anchors || [];
  const runtimeAnchors = runtimeEdge.anchors || [];
  if (designAnchors.length || runtimeAnchors.length) {
    if (ownerPairs && designEdge.ownerIds?.some(id => runtimeEdge.ownerIds?.includes(ownerPairs.get(id)))) return true;
    return designAnchors.some(anchor => runtimeAnchors.includes(anchor));
  }
  return sharedKinds.some(kind => ['icon', 'image', 'graphic', 'paint'].includes(kind));
}

function measureContentGeometry(node, side) {
  const outer = visualBox(node);
  if (!outer || outer.width <= 0 || outer.height <= 0) return {confidence: 'none', reason: 'missing-outer-box'};
  const entries = contentGeometryEntries(node, side);
  if (!entries.length) return {confidence: 'none', reason: 'missing-content-box'};
  const tolerance = 1.5;
  const left = outer.x;
  const top = outer.y;
  const right = outer.x + outer.width;
  const bottom = outer.y + outer.height;
  let invalid = false;
  const clippedEntries = entries.map(entry => {
    const box = entry.box;
    const boxRight = box.x + box.width;
    const boxBottom = box.y + box.height;
    if (box.x < left - tolerance || box.y < top - tolerance || boxRight > right + tolerance || boxBottom > bottom + tolerance) invalid = true;
    const x = Math.max(left, box.x);
    const y = Math.max(top, box.y);
    return {
      ...entry,
      box: {
        x,
        y,
        width: Math.max(0, Math.min(right, boxRight) - x),
        height: Math.max(0, Math.min(bottom, boxBottom) - y)
      }
    };
  }).filter(entry => entry.box.width > 0 && entry.box.height > 0);
  const clipped = clippedEntries.map(entry => entry.box);
  const content = unionGeometryBoxes(clipped);
  if (!content || invalid) return {confidence: 'none', reason: 'overflowing-content'};
  const insets = {
    top: rounded(content.y - top),
    right: rounded(right - (content.x + content.width)),
    bottom: rounded(bottom - (content.y + content.height)),
    left: rounded(content.x - left)
  };
  if (Object.values(insets).some(value => value < -tolerance)) return {confidence: 'none', reason: 'negative-inset'};
  const outerRisk = geometryRisk(node);
  const edges = {
    top: geometryEdge(clippedEntries, 'top', outerRisk),
    right: geometryEdge(clippedEntries, 'right', outerRisk),
    bottom: geometryEdge(clippedEntries, 'bottom', outerRisk),
    left: geometryEdge(clippedEntries, 'left', outerRisk)
  };
  const risky = Object.values(edges).some(edge => edge.confidence !== 'high');
  return {
    confidence: risky ? 'medium' : 'high',
    insets,
    content,
    boxes: clipped,
    entries: clippedEntries,
    edges,
    reason: risky ? 'complex-geometry' : 'measured'
  };
}

function readableValue(value) {
  if (value == null || value === '') return '—';
  return String(value)
    .replace(/^rgba\(0,\s*0,\s*0,\s*([\d.]+)\)$/i, 'rgba(0,0,0,$1)')
    .replace(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i, 'rgb($1,$2,$3)');
}

function judgment(property, comparison) {
  if (comparison.same) return '一致';
  const {left, right} = comparison;
  if (isPaintProperty(property)) return '颜色不同（含透明度）';
  if (/overflow/.test(property)) return '行为不同';
  if (property === 'font-weight' && left.kind === 'number' && right.kind === 'number') {
    return right.value > left.value ? '前端字重偏粗' : '前端字重偏细';
  }
  if (left.kind === 'number' && right.kind === 'number' && left.unit === 'px' && right.unit === 'px') {
    const delta = rounded(Math.abs(right.value - left.value));
    return right.value > left.value ? `前端多 ${delta}px` : `前端少 ${delta}px`;
  }
  return '需要调整';
}

function dedupeChecks(checks) {
  const result = [], seen = new Map();
  const gapRelation = check => {
    if (!/^layout\.(horizontal|vertical)-gap$/.test(check.property)) return null;
    const design = check.visual?.design?.nodeIds || [];
    const runtime = check.visual?.runtime?.nodeIds || [];
    if (design.length !== 2 || runtime.length !== 2) return null;
    // An accepted inner wrapper and its containing module can resolve to the
    // exact same visible endpoints. This is one visual distance even when the
    // original DOM/Figma IDs differ. Only validated, same-policy boxes qualify.
    if (check.publication?.status === 'validated' && check.publication.metric === 'content-to-content') {
      const sides = [check.visual.design.boxes, check.visual.runtime.boxes];
      if (sides.every(boxes => boxes?.length === 2 && boxes.every(box =>
        ['x','y','width','height'].every(key => Number.isFinite(box[key]))))) {
        return JSON.stringify(['visible-gap-boxes', check.property,
          sides.map(boxes => boxes.map(box => [box.x,box.y,box.width,box.height]))]);
      }
    }
    // A former padding task may have been converted into the same adjacent
    // gap as a sibling-spacing task. Their original keys and labels differ.
    return ['visible-gap', check.property, ...design, ...runtime].join('|');
  };
  const quality = check => (check.publication?.status === 'validated' ? 10 : 0)
    + (!/与相邻可见内容/.test(check.item || '') ? 1 : 0);
  for (const check of checks) {
    const relation = gapRelation(check);
    // Repeated fields can share a label and the same defect while belonging to
    // different components. Keep the actual objects in ordinary-check identity.
    const objects = [check.visual?.design?.nodeIds || [], check.visual?.runtime?.nodeIds || []];
    const objectKey = objects.some(ids => ids.length) ? JSON.stringify(objects) : '';
    const key = relation || check.key || [objectKey, check.item, check.property, clean(check.design), clean(check.runtime), check.status].join('|');
    if (!seen.has(key)) {seen.set(key, result.length);result.push(check);continue;}
    if (!relation) continue;
    const index = seen.get(key), prior = result[index];
    if (prior.publication?.reasonCode === 'duplicate-gap-values') continue;
    const a = prior.publication?.status === 'validated', b = check.publication?.status === 'validated';
    if (a !== b) {if (b) result[index] = check;continue;}
    if (clean(prior.design) !== clean(check.design) || clean(prior.runtime) !== clean(check.runtime)) {
      result[index] = {...(quality(check) > quality(prior) ? check : prior),
        design:'待确认',runtime:'待确认',status:'review',judgment:'同一对组件的间距测量值冲突',
        publication:{status:'pending',reason:'同一对组件的间距测量值冲突',reasonCode:'duplicate-gap-values'}};
      continue;
    }
    if (quality(check) > quality(prior)) result[index] = check;
  }
  return result;
}

function structureLabel(structureNode) {
  const role = structureNode?.role;
  if (role === 'region-boundary') return structureNode.virtualLabel || '内容区域';
  if (role === 'filter-row') return '筛选项';
  if (role === 'title-region') return '标题区';
  if (role === 'pagination') return '分页';
  if (role === 'table') return '表格';
  if (role === 'table-head' || role === 'head-row') return '表头';
  if (role === 'data-row-template') return '表格行';
  if (role === 'head-cell' || role === 'data-cell') return humanText(structureNode.anchors?.[0]?.value, 14) || '表格单元格';
  if (role === 'root') return '选中区域';
  const raw=structureNode?.raw;
  if(raw && (clean(raw.tag)==='pre' || descendantNodes(raw,1200).some(n=>clean(n.tag)==='pre')
    || ((raw._box?.width||0)>250 && /(?:import |const |function |client[.]|response[ =])/.test(raw.text?.descendant||'')
      && /复制|copy/i.test(raw.text?.descendant||'')))) return '代码块';
  return humanText(structureNode?.anchors?.[0]?.value, 14) || roleLabel(structureNode?.raw || {});
}

function rootContentInsetChecks(rootMatch, matches) {
  const roots={design:rootMatch.designNode.raw,runtime:rootMatch.runtimeNode.raw};
  const inside=(node,ancestor)=>node===ancestor || node._ancestors?.includes(ancestor);
  const container=n=>!['TEXT'].includes(n.type) && !['inline','contents'].includes(clean(n.styles?.display))
    && (n._children||[]).length && !compactText(n.text?.direct);
  let groups=matches.filter(m=>m!==rootMatch&&m.unique&&['design','runtime'].every(side=>{
    const n=m[side+'Node'].raw,b=visualBox(n),r=visualBox(roots[side]);
    const path=[n,...(n._ancestors||[]).slice(0,(n._ancestors||[]).indexOf(roots[side])+1)];
    return inside(n,roots[side])&&container(n)&&!path.some(geometryRisk)&&b&&r&&b.width>0&&b.height>0
      && b.x>=r.x-0.5&&b.y>=r.y-0.5&&b.x+b.width<=r.x+r.width+0.5&&b.y+b.height<=r.y+r.height+0.5;
  }));
  groups=groups.filter(m=>!groups.some(other=>other!==m&&['design','runtime'].every(side=>inside(m[side+'Node'].raw,other[side+'Node'].raw))));
  if(!groups.length)return null;
  // Every visible content leaf must belong to one of these groups on both sides.
  // Unmatched content is never silently excluded from a root boundary measurement.
  for(const side of ['design','runtime']) {
    const descendants=[],seen=new Set(),queue=[...(roots[side]._children||[])];
    while(queue.length){
      const n=queue.pop();if(seen.has(n)||seen.size>=25000)return null;
      seen.add(n);descendants.push(n);queue.push(...(n._children||[]));
    }
    const leaves=descendants.filter(n=>{
      const b=visualBox(n);
      return b&&b.width>0&&b.height>0&&!geometrySubtreeHidden(n)
        && !(n._ancestors||[]).some(geometrySubtreeHidden)
        && (compactText(n.text?.direct)||geometrySemanticLeaf(n,side)
          || (Array.isArray(n.geometry?.pseudoElements)
            ? n.geometry.pseudoElements.some(item => item.status !== 'unpainted')
            : n.geometry?.hasPseudoContent)
          || (!(n._children||[]).length&&geometryPaintedBox(n,side)));
    });
    if(!leaves.length||leaves.some(n=>!groups.some(m=>inside(n,m[side+'Node'].raw))))return null;
  }
  const boxes={},insets={};
  for(const side of ['design','runtime']) {
    const measures=groups.map(m=>layoutMeasurement(m[side+'Node'].raw,side));
    if(measures.some(m=>!m?.box||!['layout','ink'].includes(m.axes?.horizontal)||!['layout','ink'].includes(m.axes?.vertical)))return null;
    const outer=visualBox(roots[side]),content=unionGeometryBoxes(measures.map(m=>m.box));
    boxes[side]=content;
    insets[side]={top:content.y-outer.y,right:outer.x+outer.width-content.x-content.width,
      bottom:outer.y+outer.height-content.y-content.height,left:content.x-outer.x};
  }
  return ['top','right','bottom','left'].map(side=>{
    const d=rounded(insets.design[side]),r=rounded(insets.runtime[side]),delta=rounded(r-d);
    const visual=visualTarget(roots.design,roots.runtime);
    for(const key of ['design','runtime'])visual[key].contentBoxes=[boxes[key]];
    visual.measurementSide=side;
    return {key:`root-content:${roots.design.id}:${roots.runtime.id}:${side}`,item:`选中区域 · ${LAYOUT_INSET_LABELS[side]}`,
      property:`padding-${side}`,design:`${d}px`,runtime:`${r}px`,status:Math.abs(delta)<=1.5?'same':'different',
      judgment:Math.abs(delta)<=1.5?'一致':`前端${delta>0?'多':'少'} ${Math.abs(delta)}px`,category:'layout',visual,
      measurementEvidence:{metric:'matched-root-content-groups',side,complete:true,
        groups:groups.map(m=>({designId:m.designNode.raw.id,runtimeId:m.runtimeNode.raw.id})),values:{design:d,runtime:r},delta}};
  });
}

function layoutPaddingChecks(structureMatches) {
  const checks = [];
  const paddingProperties = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
  const sideForProperty = {
    'padding-top': 'top',
    'padding-right': 'right',
    'padding-bottom': 'bottom',
    'padding-left': 'left'
  };
  structureMatches.forEach(match => {
    if (!match.unique) return;
    const designNode = match.designNode.raw;
    const runtimeNode = match.runtimeNode.raw;
    if (!inspectionVisible(designNode) || !inspectionVisible(runtimeNode)) return;
    if(match.designNode.role==='root' && match.runtimeNode.role==='root') {
      const scoped=rootContentInsetChecks(match,structureMatches);
      if(scoped){checks.push(...scoped);return;}
    }
    if(match.designNode.role!=='root' && typeof InspectionContracts!=='undefined'
      &&(!InspectionContracts.visibleSurface(designNode)||!InspectionContracts.visibleSurface(runtimeNode)))return;
    if(match.designNode.role!=='root' && !inkOuter(designNode,'design') && !inkOuter(runtimeNode,'runtime'))return;
    if (!semanticScopesCompatible(designNode, runtimeNode)) {
      const scopeDecision = typeof InspectionContracts !== 'undefined' && InspectionContracts.compareScopes
        ? InspectionContracts.compareScopes(designNode, runtimeNode) : null;
      checks.push({key: `scope-review:${designNode.id}:${runtimeNode.id}`, item: `${structureLabel(match.designNode)} · 对象范围`,
        property: 'layout.scope', design: '待确认', runtime: '待确认', status: 'review', category: 'layout',
        judgment: scopeDecision?.reason || '单个对象与包含多个对象的集合不能直接比较可见留白',
        scopeDecision, visual: visualTarget(designNode, runtimeNode)});
      return;
    }
    const designStyles = canonicalStyles(designNode);
    const runtimeStyles = canonicalStyles(runtimeNode);
    const designGeometry = measureContentGeometry(designNode, 'design');
    const runtimeGeometry = measureContentGeometry(runtimeNode, 'runtime');
    // 表格单元格(head-cell/data-cell)的留白只查【垂直(上/下)】,禁查【水平(左/右)】:
    // 水平: 两侧单元格宽度模型天生不同——Figma 常按"内容宽"(紧贴文字,如"规格名称"仅56px),DOM 的 th/td
    //   按"列宽"撑满(如165.7px),量左/右必报巨大差值(右侧 0 vs 93.7px),是纯结构差异误报 → 左右跳过。
    // 垂直: 行高不受列宽影响,两侧接近(实测 top12↔11.8、bottom12↔12.2),文字在格内的上下留白可比可查 → 保留。
    // (之前为修右侧误报把上下也一起排除,属误伤,此处修正:仅禁水平,放开垂直。)
    const isCellRole = role => role === 'head-cell' || role === 'data-cell';
    const isCellPair = isCellRole(match.designNode.role) || isCellRole(match.runtimeNode.role);
    const ownerLike = match.designNode.direction !== 'none' || STRUCTURE_REGIONS.has(match.designNode.role)
      || paddingProperties.some(property => designNode.styles?.[property] != null);
    if (!ownerLike) return;
    paddingProperties.forEach(property => {
      const designValue = designStyles[property];
      const runtimeValue = runtimeStyles[property];
      if (designValue == null || runtimeValue == null) return;
      if (number(designValue) === 0 && number(runtimeValue) === 0) return;
      const side = sideForProperty[property];
      // 单元格水平留白(左/右)按规则选边测(只测能干净测准的对齐边):
      //   - 第一列(gridCol=0, 名称列, 左对齐: 图/文靠左): 测【左侧】(左inset 干净, 右侧是大空隙不可比)。
      //   - 其余数据列(右对齐: 数字靠右): 测【右侧】(右 inset=16 是真实 padding, 两侧干净可比)。
      //   规则对head-cell / data-cell 一致(同列对齐方式相同)。唯一例外: head-cell 数据列右边贴了【排序图标】
      //   (设计image vs 前端text), edgesCmp 会自动拦, 不会误测→ 表头数据列右侧实际测不出(正确, 有图标干扰)。
      const isHeadCellPair = match.designNode.role === 'head-cell' && match.runtimeNode.role === 'head-cell';
      const isDataCellPair = match.designNode.role === 'data-cell' && match.runtimeNode.role === 'data-cell';
      if (isCellPair && (side === 'left' || side === 'right')) {
        const gridCol = match.designNode.raw._gridCol;
        const wantSide = gridCol === 0 ? 'left' : 'right'; // 首列(名称,左对齐)测左, 其余(数据,右对齐)测右
        if (side !== wantSide) return;
      }
      const designInset = designGeometry.insets?.[side];
      const runtimeInset = runtimeGeometry.insets?.[side];
      const designPadding = number(designValue);
      // 【通用对齐边护栏】左/右留白: 内容在容器内非居中(左对齐/右对齐)时, 只有"对齐边"的 inset 才是真实 padding,
      //   另一侧是对齐留下的大空隙(内容宽度不同→空隙差异巨大, 如左对齐内容右侧 16vs 157), 量了必误报。
      //   判据: 若本侧 inset 明显大于对侧(> 对侧+8 且 > 24), 说明本侧是"空隙侧"非对齐边 → 跳过。
      //   居中内容(两侧 inset 接近)不受影响, 两侧都可测。
      if (side === 'left' || side === 'right') {
        const opp = side === 'left' ? 'right' : 'left';
        const dOpp = designGeometry.insets?.[opp], rOpp = runtimeGeometry.insets?.[opp];
        const isGapSide = (self, other) => self != null && other != null && self > other + 8 && self > 24;
        // 两侧任一判定本侧为"空隙侧"即跳过(设计或前端只要有一侧是明显空隙, 该边就不可比)
        if (isGapSide(designInset, dOpp) || isGapSide(runtimeInset, rOpp)) return;
      }
      // 数据单元格(data-cell)内容天生不同(占位vs真实数据), 边缘只要同类(都text)即可比留白, 不要求文字一致。
      const isDataCell = match.designNode.role === 'data-cell' && match.runtimeNode.role === 'data-cell';
      const edgesOk = geometryEdgesComparable(designGeometry, runtimeGeometry, side, isDataCell, aiFallbackContext?.inspectionContext?.pairs);
      const boundaryUnknown = [designGeometry, runtimeGeometry].some(g =>
        g.edges?.[side]?.boundaryKinds?.some(kind => kind !== 'layout'));
      if (boundaryUnknown) {
        const key = `boundary-review:${designNode.id}:${runtimeNode.id}`;
        if (!checks.some(check => check.key === key)) checks.push({key,
          item: `${structureLabel(match.designNode)} · 可见留白`, property: 'layout.content-inset',
          design: '待确认', runtime: '待确认', status: 'review', category: 'layout',
          judgment: '两侧文字边界口径不同，尚不能可靠还原布局框',
          measurementEvidence: {metric: 'layout-inset', design: designGeometry.edges, runtime: runtimeGeometry.edges},
          visual: visualTarget(designNode, runtimeNode)});
        return;
      }

      // 校准:一般节点要求"几何inset ≈ CSS padding声明"(确认几何量对了)。
      //   但data-cell 内容常垂直居中, 几何inset=(格高-内容高)/2 是"居中余量", 不等于 padding声明(如inset30 vs padding12),
      //   这个余量差本身就反映"行高不同"(设计格高80/前端53), 是该暴露的真实差异 → data-cell 放宽: 只要两侧inset都由
      //   high-confidence边缘量出(edgesOk已保证), 直接比两侧inset, 不要求等于CSS padding声明。
      const geometryCalibrated = edgesOk && designInset != null && runtimeInset != null
        && (isDataCell || (designPadding != null && Math.abs(designInset - designPadding) <= 1));
      if (!geometryCalibrated) return;
      const comparison = compareStyle(`geometry.${property}`, `${designInset}px`, `${runtimeInset}px`);
      const status = comparison.same ? 'same' : 'different';
      const visual = visualTarget(designNode, runtimeNode);
      if (visual) {
        visual.design.contentBoxes = designGeometry.content ? [designGeometry.content] : [];
        visual.runtime.contentBoxes = runtimeGeometry.content ? [runtimeGeometry.content] : [];
        visual.measurementSide = side;
      }
      checks.push({
        key: `spacing-owner:${designNode.id}:${runtimeNode.id}:${property}`,
        item: `${structureLabel(match.designNode)} · ${LAYOUT_INSET_LABELS[side]}`,
        property,
        design: comparison.left.display,
        runtime: comparison.right.display,
        status,
        judgment: judgment(property, comparison),
        category: 'layout',
        matchBasis: match.basis,
        measurementEvidence: {metric: 'layout-inset', side, design: designGeometry.edges[side], runtime: runtimeGeometry.edges[side]},
        visual
      });
    });
  });
  return checks;
}

function structureContains(ancestor, node) {
  let current = node;
  while (current) {
    if (current.id === ancestor?.id) return true;
    current = current.parent;
  }
  return false;
}

function transparentStructurePath(node, ancestor) {
  let current = node?.parent;
  while (current && current.id !== ancestor?.id) {
    if (structureRoleCategory(current.role) !== 'layout') {
      const measurement = node?.raw?._measurement;
      const provenTextOwner = measurement?.ownerId === current.raw?.id
        && ['layout','ink'].includes(measurement.axes?.[measurement.measuredAxis])
        && ['text-block-content', 'shared-single-line','screenshot-ink','visible-content-union'].includes(measurement.source)
        && structureRoleCategory(current.role) === 'text';
      if (!provenTextOwner) return false;
    }
    current = current.parent;
  }
  return Boolean(current && current.id === ancestor?.id);
}

function crossAxisOverlapRatio(left, right, axis) {
  const start = axis === 'horizontal' ? 'y' : 'x';
  const size = axis === 'horizontal' ? 'height' : 'width';
  const leftStart = number(left?.raw?._box?.[start]);
  const rightStart = number(right?.raw?._box?.[start]);
  const leftSize = number(left?.raw?._box?.[size]);
  const rightSize = number(right?.raw?._box?.[size]);
  if ([leftStart, rightStart, leftSize, rightSize].some(value => value == null) || leftSize <= 0 || rightSize <= 0) return 0;
  const overlap = Math.min(leftStart + leftSize, rightStart + rightSize) - Math.max(leftStart, rightStart);
  return Math.max(0, overlap) / Math.max(1, Math.min(leftSize, rightSize));
}

function meaningfulStructureBetween(structure, anchor, before, after, axis) {
  if (!structure || !anchor || !before || !after) return true;
  const start = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'width' : 'height';
  const crossStart = axis === 'horizontal' ? 'y' : 'x';
  const crossSize = axis === 'horizontal' ? 'height' : 'width';
  const beforeStart = number(before.raw?._box?.[start]);
  const beforeSize = number(before.raw?._box?.[size]);
  const afterStart = number(after.raw?._box?.[start]);
  const afterSize = number(after.raw?._box?.[size]);
  if ([beforeStart, beforeSize, afterStart, afterSize].some(value => value == null)) return true;
  const gapStart = beforeStart + beforeSize;
  const gapEnd = afterStart;
  if (gapEnd < gapStart - 1) return true;

  const beforeCrossStart = number(before.raw?._box?.[crossStart]) || 0;
  const beforeCrossSize = number(before.raw?._box?.[crossSize]) || 0;
  const afterCrossStart = number(after.raw?._box?.[crossStart]) || 0;
  const afterCrossSize = number(after.raw?._box?.[crossSize]) || 0;
  const pairCrossStart = Math.min(beforeCrossStart, afterCrossStart);
  const pairCrossEnd = Math.max(beforeCrossStart + beforeCrossSize, afterCrossStart + afterCrossSize);

  return structure.nodes.some(candidate => {
    if (candidate.id === anchor.id || candidate.id === before.id || candidate.id === after.id) return false;
    if (!structureContains(anchor, candidate)) return false;
    if (structureContains(before, candidate) || structureContains(after, candidate)) return false;
    if (structureContains(candidate, before) || structureContains(candidate, after)) return false;
    if (structureRoleCategory(candidate.role) === 'layout') return false;
    const candidateStart = number(candidate.raw?._box?.[start]);
    const candidateSize = number(candidate.raw?._box?.[size]);
    const candidateCrossStart = number(candidate.raw?._box?.[crossStart]);
    const candidateCrossSize = number(candidate.raw?._box?.[crossSize]);
    if ([candidateStart, candidateSize, candidateCrossStart, candidateCrossSize].some(value => value == null)
      || candidateSize <= 0 || candidateCrossSize <= 0) return false;
    const occupiesGap = candidateStart < gapEnd - 0.5 && candidateStart + candidateSize > gapStart + 0.5;
    const crossOverlap = Math.min(candidateCrossStart + candidateCrossSize, pairCrossEnd)
      - Math.max(candidateCrossStart, pairCrossStart);
    return occupiesGap && crossOverlap > Math.min(candidateCrossSize, Math.max(0, pairCrossEnd - pairCrossStart)) * 0.2;
  });
}

function spacingEndpointEligible(node) {
  if (!node || node.role === 'root') return false;
  // 内容叶子(text/icon/image)也作为间距端点: 修复"标签/值/图标/操作"这类同行文本块之间的间距
  //   (report77/runtime21: 所属行业:↔女装↔ⓘ↔修改 分散在多层布局壳里, 共同父是壳配不上,
  //    第一段测不到; 而这里原本排除 text/icon → 第二段也测不到)。护栏由第二段兜住:
  //   仅当父声明了 column/row-gap 且实测 gap 与声明校准一致(|Δ|≤1)、role 兼容、中间无有效结构时才产出,
  //   故"卖出第一单·攻略"这类无 gap 声明的排版碎字不会被误测。
  //   注: icon/image 允许带装饰性嵌套子(矢量路径), 仍作端点(其内部子非独立内容);
  //       text 要求真叶子(无子), 避免把包裹容器当端点。
  const cat = structureRoleCategory(node.role);
  if (cat === 'icon' || cat === 'image') return true;
  if (cat === 'text' && !(node.children && node.children.length)) return true;
  if (['icon', 'text'].includes(node.role)) return false;
  return STRUCTURE_REGIONS.has(node.role) || CONTROL_ROLES.has(node.role)
    || ['image', 'title'].includes(node.role);
}

function spacingRolesCompatible(designNode, runtimeNode) {
  if (!designNode || !runtimeNode) return false;
  if (designNode.role === runtimeNode.role) return true;
  if (structureRoleCategory(designNode.role) === 'text' && structureRoleCategory(runtimeNode.role) === 'text') return true;
  return structureRoleCategory(designNode.role) === 'control'
    && structureRoleCategory(runtimeNode.role) === 'control'
    && controlRolesCompatible(designNode.role, runtimeNode.role);
}

function virtualSpacingNode(sourceNode, memberNodes, side) {
  const members = memberNodes.filter(Boolean);
  const memberBoxes = members.map(member => visualBox(member.raw)).filter(Boolean);
  const union = unionGeometryBoxes(memberBoxes);
  // Composite projections compare the same member-union boundary on both sides.
  const box = union;
  if (!box) return null;
  const labels = [...new Set(members.map(structureLabel).filter(Boolean))];
  return {
    id: `virtual-spacing:${side}:${sourceNode?.id || members.map(member => member.id).join('+')}`,
    role: 'region-boundary',
    direction: sourceNode?.direction || 'none',
    anchors: sourceNode?.anchors || [],
    primaryAnchor: sourceNode?.primaryAnchor || '',
    parent: sourceNode?.parent || null,
    children: [],
    memberNodes: members,
    virtualLabel: labels.length <= 2 ? `${labels.join('与')}区域` : '内容区域',
    raw: {
      id: `virtual-spacing:${side}:${sourceNode?.raw?.id || members.map(member => member.raw.id).join('+')}`,
      name: sourceNode?.raw?.name || 'Visual region',
      _compoundMemberIds: members.map(member=>member.raw.id),
      _measurement: {box, source: 'member-layout-union', axes: Object.fromEntries(['horizontal', 'vertical'].map(axis =>
        [axis, members.every(member => !member.raw._measurement || ['layout','ink'].includes(member.raw._measurement.axes[axis])) ? 'layout' : 'unknown']))},
      _box: box,
      box: {local: box},
      styles: sourceNode?.raw?.styles || {}
    }
  };
}

function projectedSpacingChildren(parent, pairByDesignId) {
  const virtualEntry = (sourceNode, entries) => {
    if (!entries.length) return {complete: false, entries: []};
    const designMembers = entries.flatMap(entry => entry.designMembers);
    const runtimeMembers = entries.flatMap(entry => entry.runtimeMembers);
    const designNode = virtualSpacingNode(sourceNode, designMembers, 'design');
    const runtimeNode = virtualSpacingNode(null, runtimeMembers, 'runtime');
    if (!designNode || !runtimeNode) return {complete: false, entries: []};
    return {
      complete: true,
      entries: [{
        designNode,
        runtimeNode,
        designMembers,
        runtimeMembers,
        sourceNode,
        virtual: true
      }]
    };
  };
  const project = child => {
    if (spacingEndpointEligible(child)) {
      const match = pairByDesignId.get(child.id);
      if (match) {
        return {
          complete: true,
          entries: [{
            designNode: child,
            runtimeNode: match.runtimeNode,
            designMembers: [child],
            runtimeMembers: [match.runtimeNode],
            sourceNode: child,
            virtual: false
          }]
        };
      }
      if (!child.children.length) return {complete: false, entries: []};
      const projected = child.children.map(project);
      if (projected.some(result => !result.complete)) return {complete: false, entries: []};
      return virtualEntry(child, projected.flatMap(result => result.entries));
    }
    if (structureRoleCategory(child.role) !== 'layout' || !child.children.length) {
      return {complete: false, entries: []};
    }
    const projected = child.children.map(project);
    if (projected.some(result => !result.complete)) return {complete: false, entries: []};
    const entries = projected.flatMap(result => result.entries);
    if (entries.length === 1) return {complete: true, entries};
    if (entries.length < 2) return {complete: false, entries: []};
    return virtualEntry(child, entries);
  };
  return parent.children.flatMap(child => project(child).entries);
}

function spacingEntryWithinAnchors(entry, designAnchor, runtimeAnchor) {
  const designPathNode = entry.virtual ? entry.sourceNode : entry.designNode;
  if (!transparentStructurePath(designPathNode, designAnchor)) return false;
  if (entry.virtual) {
    return entry.runtimeMembers.length > 0
      && entry.runtimeMembers.every(member => structureContains(runtimeAnchor, member));
  }
  return structureContains(runtimeAnchor, entry.runtimeNode)
    && transparentStructurePath(entry.runtimeNode, runtimeAnchor);
}

function spacingVisualNodes(node) {
  return node?.raw;
}

function spacingEntryComponentPairs(entry) {
  return (entry?.designMembers || []).map((designMember, index) => [
    designMember.raw.id,
    entry.runtimeMembers?.[index]?.raw?.id
  ]).filter(pair => pair[0] && pair[1]);
}

// 表格数据行样式对比(用户方案·加闸版)：
// 前提(三道闸,全满足才启用逐行对比，否则完全不碰数据行)：
//   ① 这张表两侧已作为同一张表被配对(来自 matches 的 table↔table)——防跨表错配；
//   ② 两侧列数相同——防列错位；
//   ③ 两侧都识别出表头行(作为第0 行锚点)——才能"从表头下面一行"开始数数据行。
// 满足后：数据行数取 min(设计, 前端)，多出的行忽略；从数据行第 1 行起逐行对应。
// 只比"数据格字号"这一最稳属性——不比内容(数据驱动必不同)、不比颜色(涨跌红绿随数据正负变)、
// 不比对齐(Figma flex 对齐与 DOM text-align 格式不可比)、不比行高(受数据量影响)。
function tableRowStyleChecks(matches, designNodes, runtimeNodes) {
  const checks = [];

  // design 侧网格: 来自 rebuildCollapsedTables 标注的 _gridRow/_gridCol/_gridTableIndex。
  // 每个 (row,col) 取该格内字号(优先格内文字叶子的 font-size)。
  const leafFontSize = node => {
    let found = null;
    (function walk(item) {
      if (found != null) return;
      const size = fontSizePx(canonicalStyles(item));
      if (clean(item.text?.direct) && size) { found = size; return; }
      (item._children || []).forEach(walk);
    })(node);
    return found != null ? found : fontSizePx(canonicalStyles(node));
  };

  const buildDesignGrid = tableNode => {
    const cells = designNodes.filter(node => node._gridTableIndex === tableNode._index);
    if (!cells.length || tableNode._gridRows == null) return null;
    const grid = new Map(); // key `${row}:${col}` -> fontSize
    cells.forEach(cell => {
      const key = `${cell._gridRow}:${cell._gridCol}`;
      if (!grid.has(key)) grid.set(key, leafFontSize(cell));
    });
    return {rows: tableNode._gridRows, cols: tableNode._gridCols, get: (r, c) => grid.get(`${r}:${c}`)};
  };

  // runtime 侧网格: 用真实 DOM 结构 table > tr > (th|td)。tr 按 y 排序=行(第 0 行=表头),
  // 行内 th/td 按 x 排序=列。第 0 行须为表头(含 th)才算"识别出表头"。
  const buildRuntimeGrid = tableNode => {
    const descendants = descendantNodes(tableNode, 4000);
    const rowEls = descendants.filter(node => clean(node.tag) === 'tr');
    if (rowEls.length < 2) return null;
    rowEls.sort((a, b) => (a._box.y || 0) - (b._box.y || 0));
    const headHasTh = descendantNodes(rowEls[0], 200).some(node => clean(node.tag) === 'th');
    if (!headHasTh) return null; // 第 0 行不是表头 → 判不出表头锚点
    const grid = new Map();
    let colCount = 0;
    rowEls.forEach((rowEl, rowIndex) => {
      const cellEls = descendantNodes(rowEl, 400)
        .filter(node => ['th', 'td'].includes(clean(node.tag)))
        .sort((a, b) => (a._box.x || 0) - (b._box.x || 0));
      colCount = Math.max(colCount, cellEls.length);
      cellEls.forEach((cellEl, colIndex) => grid.set(`${rowIndex}:${colIndex}`, leafFontSize(cellEl)));
    });
    return {rows: rowEls.length, cols: colCount, get: (r, c) => grid.get(`${r}:${c}`)};
  };

  const isTable = (node, side) => semanticBaseRole(node,
    side, side === 'design' ? -1 : -1) === 'table';

  matches.forEach(match => {
    const designNode = designNodes[match.designIndex];
    const runtimeNode = runtimeNodes[match.runtimeIndex];
    if (!designNode || !runtimeNode) return;
    // 闸①: 两侧都必须是 table(已作为同一张表配对)
    if (!isTable(designNode, 'design') || !isTable(runtimeNode, 'runtime')) return;

    const designGrid = buildDesignGrid(designNode);
    const runtimeGrid = buildRuntimeGrid(runtimeNode);
    if (!designGrid || !runtimeGrid) return; // 任一侧建不出网格(闸③表头也在此拦) → 不碰

    // 闸②: 列数必须相同
    if (designGrid.cols !== runtimeGrid.cols || designGrid.cols < 2) return;

    // 数据行 = 除第 0 行(表头)外的行；行数取两侧最小值。
    const designDataRows = designGrid.rows - 1;
    const runtimeDataRows = runtimeGrid.rows - 1;
    const rowLimit = Math.min(designDataRows, runtimeDataRows);
    if (rowLimit < 1) return;

    const tableLabel = humanText(designNode.name, 14) || '表格';

    // 先按列求design 侧基准字号:仅当该列所有数据行字号一致时，这一列才有明确基准、可判前端对错。
    // 若design 自身该列字号就不统一(常见于序号列这类示例数据随手打的字号)，说明设计稿无统一规范，
    // 判不出前端是否"错"，跳过该列——宁可不报。
    const columnBaseline = [];
    for (let col = 0; col < designGrid.cols; col += 1) {
      const sizes = [];
      for (let row = 1; row <= rowLimit; row += 1) {
        const size = designGrid.get(row, col);
        if (size != null) sizes.push(size);
      }
      const consistent = sizes.length >= 1 && sizes.every(size => Math.abs(size - sizes[0]) <= 1);
      columnBaseline[col] = consistent ? sizes[0] : null;
    }

    let mismatch = 0, compared = 0;
    for (let row = 1; row <= rowLimit; row += 1) {
      for (let col = 0; col < designGrid.cols; col += 1) {
        if (columnBaseline[col] == null) continue; // 该列 design 自身字号不统一 → 无基准，跳过
        const designSize = designGrid.get(row, col);
        const runtimeSize = runtimeGrid.get(row, col);
        if (designSize == null || runtimeSize == null) continue; // 缺格跳过(不猜)
        compared += 1;
        const same = Math.abs(designSize - runtimeSize) <= 1;
        if (!same) mismatch += 1;
      }
    }
    if (!compared) return;

    // 汇总成一条检查项(逐格铺开会淹没报告)：数据行字号是否整体一致。
    const same = mismatch === 0;
    checks.push({
      key: `table-row-font|${designNode.id}|${runtimeNode.id}`,
      item: `${tableLabel} · 数据行字号`,
      property: 'font-size',
      design: `${designGrid.cols}列×${rowLimit}行抽样`,
      runtime: same ? '字号一致' : `${mismatch}/${compared} 格字号不一致`,
      status: same ? 'same' : 'different',
      judgment: same ? '数据行字号与设计一致' : '数据行存在字号不一致(仅比字号，已忽略内容/颜色/对齐)',
      category: 'style',
      visual: visualTarget(designNode, runtimeNode)
    });
  });

  return checks;
}

function matchedSiblingSpacingChecks(structureMatches, designStructure = null, runtimeStructure = null) {
  const forAxis = axis => {
    const cloneStructure = (structure, side) => {
      const clones = new Map();
      const clone = node => {
        if (!node) return null;
        if (clones.has(node)) return clones.get(node);
        const raw = node.raw;
        const mappedText = structureMatches.some(m => m.runtimeNode === node && m.designNode.raw?.type === 'TEXT');
        const sharedControlOwner = structureMatches.some(m => m.runtimeNode === node && m.layoutOnly);
        const inlineText = side === 'runtime' && scopeText(raw) && (clean(raw?.styles?.display) === 'inline'
          || (mappedText && !sharedControlOwner && ['block', 'flow-root', 'inline-block', 'flex', 'inline-flex'].includes(clean(raw?.styles?.display))));
        const measurement = layoutMeasurement(raw, side);
        const rawBox = visualBox(raw);
        const measuredBox = measurement.box && rawBox ? (axis === 'vertical'
          ? {...rawBox, y: measurement.box.y, height: measurement.box.height}
          : {...rawBox, x: measurement.box.x, width: measurement.box.width}) : rawBox;
        const copy = {...node, raw: {...raw, _box: measuredBox || raw._box,
          _measurement: {...measurement, box: measuredBox, measuredAxis: axis, originalBox: rawBox}}};
        clones.set(node, copy);
        copy.parent = clone(node.parent);
        copy.children = (node.children || []).map(clone);
        if (node.memberNodes) copy.memberNodes = node.memberNodes.map(clone);
        return copy;
      };
      return {clone, structure: structure ? {...structure, nodes: structure.nodes.map(clone)} : null};
    };
    const d = cloneStructure(designStructure, 'design'), r = cloneStructure(runtimeStructure, 'runtime');
    const matches = structureMatches.filter(m => semanticScopesCompatible(m.designNode.raw, m.runtimeNode.raw))
      .map(m => ({...m, designNode: d.clone(m.designNode), runtimeNode: r.clone(m.runtimeNode)}));
    return matchedSiblingSpacingChecksMeasured(matches, d.structure, r.structure, axis);
  };
  return [...forAxis('horizontal'), ...forAxis('vertical')];
}

function matchedSiblingSpacingChecksMeasured(structureMatches, designStructure = null, runtimeStructure = null, requestedAxis = null) {
  const checks = [];
  const axisCounts = {horizontal: 0, vertical: 0};
  const relationLimit = 24;
  const canAdd = axis => (!requestedAxis || requestedAxis === axis) && axisCounts[axis] < relationLimit;
  const addCheck = (axis, check) => {
    if (!canAdd(axis)) return;
    checks.push(check);
    axisCounts[axis] += 1;
  };
  const canMeasure = (axis, nodes) => {
    // Prove a spatial relationship before creating a task to recover its edges.
    const start=axis==='vertical'?'y':'x',size=axis==='vertical'?'height':'width';
    const cross=axis==='vertical'?'x':'y',crossSize=axis==='vertical'?'width':'height';
    for(const [before,after] of [[nodes[0],nodes[1]],[nodes[2],nodes[3]]]){
      const a=before?.raw?._measurement?.originalBox||before?.raw?._box,b=after?.raw?._measurement?.originalBox||after?.raw?._box;
      if(!a||!b||b[start]<a[start]+a[size]-1
        ||Math.min(a[cross]+a[crossSize],b[cross]+b[crossSize])<=Math.max(a[cross],b[cross]))return false;
    }
    // A node outside an ancestor's clipping viewport is not a visible spacing
    // endpoint. Re-reading the same screenshot cannot recover its glyphs.
    if (nodes.some(n => n.raw._measurement?.reason === 'text-clipped-by-ancestor')) return false;
    if (nodes.every(n => !n.raw._measurement || ['layout','ink'].includes(n.raw._measurement.axes[axis]))) return true;
    const [db, da, rb, ra] = nodes;
    const key = `measurement-review:${axis}:${db.id}:${da.id}`;
    if (!checks.some(c => c.key === key)) addCheck(axis, {key,
      item: `${structureLabel(db)}与${structureLabel(da)} · ${PROPERTY_LABELS[`layout.${axis}-gap`]}`,
      property: `layout.${axis}-gap`, design: '待确认', runtime: '待确认', status: 'review', category: 'layout',
      judgment: '文字布局边界尚未可靠确定，暂不判定间距差异',
      measurementEvidence: nodes.map(n => n.raw._measurement),
      visual: visualTarget([db.raw, da.raw], [rb.raw, ra.raw])});
    return false;
  };
  const pairByDesignId = new Map(structureMatches.filter(match => match.unique).map(match => [match.designNode.id, match]));
  const measuredPairs = new Set();
  const pairKey = (designBefore, designAfter, runtimeBefore, runtimeAfter) =>
    [designBefore.id, designAfter.id, runtimeBefore.id, runtimeAfter.id].join('|');

  structureMatches.forEach(parentMatch => {
    if (!parentMatch.unique) return;
    const designParent = parentMatch.designNode;
    const runtimeParent = parentMatch.runtimeNode;
    let axis = designParent.direction === 'horizontal' ? 'horizontal' : designParent.direction === 'vertical' ? 'vertical' : null;
    if (!axis || !canAdd(axis) || designParent.children.length < 2 || runtimeParent.children.length < 2) return;
    const start = axis === 'horizontal' ? 'x' : 'y';
    const size = axis === 'horizontal' ? 'width' : 'height';
    const designChildren = [...designParent.children].sort((left, right) => (left.raw._box[start] || 0) - (right.raw._box[start] || 0));
    const runtimeChildren = [...runtimeParent.children].sort((left, right) => (left.raw._box[start] || 0) - (right.raw._box[start] || 0));
    const runtimePosition = new Map(runtimeChildren.map((child, index) => [child.id, index]));
    const candidates = [];
    // ── 投影相邻(替代严格相邻): 先筛出"两侧都已配对、且前端父也是runtimeParent"的子节点子序列,
    //    在该已配序列里取前后相邻两个算间距,【允许中间夹着未配节点】(两边都没配上的中间模块直接忽略)。
    //    修复: 核心转化概览↔规格数据这类"已配大模块之间隔着一堆未配 card"→之前 index 差!=1 被跳过, 测不出间距。
    //    安全护栏: ①要求前端侧顺序一致(runtimeAfterIndex > runtimeBeforeIndex, 不颠倒);
    //             ②只在"已配序列里相邻"时算, 若中间存在别的【已配 card】则不会跨(因为会先与那个中间已配项配对)。
    const projected = designChildren
      .map(child => {
        const match = pairByDesignId.get(child.id);
        if (!match || match.runtimeNode.parent?.id !== runtimeParent.id) return null;
        return {designNode: child, runtimeNode: match.runtimeNode, match};
      })
      .filter(Boolean);

    for (let index = 1; index < projected.length; index += 1) {
      const designBefore = projected[index - 1].designNode;
      const designAfter = projected[index].designNode;
      const beforeMatch = projected[index - 1].match;
      const afterMatch = projected[index].match;
      const runtimeBeforeIndex = runtimePosition.get(beforeMatch.runtimeNode.id);
      const runtimeAfterIndex = runtimePosition.get(afterMatch.runtimeNode.id);
      if (runtimeAfterIndex == null || runtimeBeforeIndex == null || runtimeAfterIndex <= runtimeBeforeIndex) continue; // 前端顺序须一致(不颠倒)
      if (!canMeasure(axis, [designBefore, designAfter, beforeMatch.runtimeNode, afterMatch.runtimeNode])) continue;
      const designGap = (designAfter.raw._box[start] || 0) - ((designBefore.raw._box[start] || 0) + (designBefore.raw._box[size] || 0));
      const runtimeGap = (afterMatch.runtimeNode.raw._box[start] || 0)
        - ((beforeMatch.runtimeNode.raw._box[start] || 0) + (beforeMatch.runtimeNode.raw._box[size] || 0));
      if (designGap < -1 || runtimeGap < -1) continue;
      // 走廊干净护栏: 放宽相邻后, 两个已配 card 之间若夹着"其它占位的可见节点"(某个真实模块只是没配上),
      //   跨过它测出的 gap 会包含该模块高度→假间距。故要求间隙区间内无同父其它直接子占位, 两侧都要干净。
      const corridorClear = (children, before, after) => {
        const gapStart = (before.raw._box[start] || 0) + (before.raw._box[size] || 0);
        const gapEnd = after.raw._box[start] || 0;
        if (gapEnd - gapStart <= 1) return true; // 紧贴, 无缝隙
        return !children.some(c => {
          if (c.id === before.id || c.id === after.id) return false;
          const cs = c.raw._box[start] || 0,ce = cs + (c.raw._box[size] || 0);
          const overlap = Math.min(ce, gapEnd) - Math.max(cs, gapStart);
          return overlap > 2; // 有节点实质落在间隙里-> 走廊不干净
        });
      };
      if (!corridorClear(designChildren, designBefore, designAfter)) continue;
      if (!corridorClear(runtimeChildren, beforeMatch.runtimeNode, afterMatch.runtimeNode)) continue;
      const property = `layout.${axis}-gap`;
      const comparison = compareStyle(property, `${Math.max(0, designGap)}px`, `${Math.max(0, runtimeGap)}px`);
      measuredPairs.add(pairKey(designBefore, designAfter, beforeMatch.runtimeNode, afterMatch.runtimeNode));
      candidates.push({
        property,
        comparison,
        designBefore,
        designAfter,
        runtimeBefore: beforeMatch.runtimeNode,
        runtimeAfter: afterMatch.runtimeNode,
        evidence: {
          componentPairs: [
            [designBefore.raw.id, beforeMatch.runtimeNode.raw.id],
            [designAfter.raw.id, afterMatch.runtimeNode.raw.id]
          ],
          direction: axis,
          ordered: true,
          sameSemanticParent: true,
          corridorClear: true
        }
      });
    }
    if (!candidates.length) return;
    const sameValues = candidates.every(candidate => candidate.comparison.left.display === candidates[0].comparison.left.display
      && candidate.comparison.right.display === candidates[0].comparison.right.display);
    const selected = sameValues ? [candidates[0]] : candidates;
    selected.forEach((candidate, index) => {
      if (!canAdd(axis)) return;
      const beforeLabel = structureLabel(candidate.designBefore);
      const afterLabel = structureLabel(candidate.designAfter);
      const pairLabel = sameValues ? '' : ` · ${beforeLabel}与${afterLabel}`;
      addCheck(axis, {
        key: `spacing-relation:${designParent.raw.id}:${runtimeParent.raw.id}:${candidate.property}:${sameValues ? 'uniform' : index}`,
        item: `${checkName(structureLabel(designParent), candidate.property)}${pairLabel}`,
        property: candidate.property,
        design: candidate.comparison.left.display,
        runtime: candidate.comparison.right.display,
        status: candidate.comparison.same ? 'same' : 'different',
        judgment: judgment(candidate.property, candidate.comparison),
        category: 'layout',
        matchBasis: ['组件一一对应', '方向与顺序一致', '同一语义父区内视觉相邻'],
        relationEvidence: candidate.evidence,
        visual: visualTarget(
          [candidate.designBefore.raw, candidate.designAfter.raw],
          [candidate.runtimeBefore.raw, candidate.runtimeAfter.raw]
        )
      });
    });
  });

  if (designStructure && runtimeStructure) {
    designStructure.nodes.forEach(designParent => {
      const axis = designParent.direction === 'horizontal' ? 'horizontal' : designParent.direction === 'vertical' ? 'vertical' : null;
      if (!axis || !canAdd(axis) || designParent.children.length < 2) return;
      if (clean(canonicalStyles(designParent.raw)['flex-wrap']) === 'wrap') return;
      const start = axis === 'horizontal' ? 'x' : 'y';
      const size = axis === 'horizontal' ? 'width' : 'height';
      const declaredProperty = axis === 'horizontal' ? 'column-gap' : 'row-gap';
      const declaredGap = number(canonicalStyles(designParent.raw)[declaredProperty]);
      if (declaredGap == null || declaredGap < 0) return;
      const spacingEntries = projectedSpacingChildren(designParent, pairByDesignId).sort((left, right) =>
        (left.designNode.raw._box[start] || 0) - (right.designNode.raw._box[start] || 0));
      if (spacingEntries.length < 2) return;
      // ── anchor 派生 ──
      // 首选: designParent 向上找"已配对祖先"作锚(原逻辑, 适用于父本身配对成功的场景)。
      // 回退: 当祖先全是未配对布局壳(纯叶子配对场景, 如 report77/runtime21 的"标签/值/图标/修改"
      //   分散在多层 container 壳里、壳都没配上)时——改用"投影子的 runtime 对家的最近公共祖先(LCA)"作 runtimeAnchor,
      //   designParent 自身作 designAnchor。这样不再强求壳配对, 让"共同父是壳"的同行文本间距也能测。
      //   安全性: 下方 spacingEntryWithinAnchors 仍校验两侧路径透明(全布局壳)+被 anchor 包含, 防跨容器误测。
      let designAnchor = designParent;
      while (designAnchor && !pairByDesignId.has(designAnchor.id)) {
        if (designAnchor.id !== designParent.id && structureRoleCategory(designAnchor.role) !== 'layout') { designAnchor = null; break; }
        designAnchor = designAnchor.parent;
      }
      let anchorMatch = designAnchor ? pairByDesignId.get(designAnchor.id) : null;
      let runtimeAnchor = anchorMatch ? anchorMatch.runtimeNode : null;
      if (!runtimeAnchor) {
        // 回退: designParent 到各投影子路径须全透明(布局壳), 再取对家 runtime LCA
        const pathAllTransparent = spacingEntries.every(entry => {
          const dNode = entry.virtual ? entry.sourceNode : entry.designNode;
          return transparentStructurePath(dNode, designParent) || dNode === designParent || dNode.parent === designParent;
        });
        if (!pathAllTransparent) return;
        const runtimeMembers = spacingEntries.flatMap(entry =>
          entry.virtual ? (entry.runtimeMembers || []) : [entry.runtimeNode]).filter(Boolean);
        if (runtimeMembers.length < 2) return;
        // 求 runtime LCA: 从第一个成员的祖先链里, 找最深的、能包含所有成员的祖先
        let lca = null;
        let cur = runtimeMembers[0].parent;
        while (cur) {
          if (runtimeMembers.every(m => structureContains(cur, m))) { lca = cur; break; }
          cur = cur.parent;
        }
        if (!lca) return;
        designAnchor = designParent;
        runtimeAnchor = lca;
      }
      const projectedCandidates = [];

      for (let index = 1; index < spacingEntries.length; index += 1) {
        const beforeEntry = spacingEntries[index - 1];
        const afterEntry = spacingEntries[index];
        const designBefore = beforeEntry.designNode;
        const designAfter = afterEntry.designNode;
        const runtimeBefore = beforeEntry.runtimeNode;
        const runtimeAfter = afterEntry.runtimeNode;
        if (!spacingRolesCompatible(designBefore, runtimeBefore) || !spacingRolesCompatible(designAfter, runtimeAfter)) continue;
        if (!spacingEntryWithinAnchors(beforeEntry, designAnchor, runtimeAnchor)
          || !spacingEntryWithinAnchors(afterEntry, designAnchor, runtimeAnchor)) continue;
        if (clean(canonicalStyles(runtimeAnchor.raw)['flex-wrap']) === 'wrap') continue;
        if (crossAxisOverlapRatio(designBefore, designAfter, axis) < 0.6
          || crossAxisOverlapRatio(runtimeBefore, runtimeAfter, axis) < 0.6) continue;
        if (!canMeasure(axis, [designBefore, designAfter, runtimeBefore, runtimeAfter])) continue;
        const designGap = (designAfter.raw._box[start] || 0)
          - ((designBefore.raw._box[start] || 0) + (designBefore.raw._box[size] || 0));
        const runtimeGap = (runtimeAfter.raw._box[start] || 0)
          - ((runtimeBefore.raw._box[start] || 0) + (runtimeBefore.raw._box[size] || 0));
        if (designGap < -1 || runtimeGap < -1 || Math.abs(designGap - declaredGap) > 1) continue;
        const key = pairKey(designBefore, designAfter, runtimeBefore, runtimeAfter);
        if (measuredPairs.has(key)) continue;
        if (meaningfulStructureBetween(designStructure, designParent, designBefore, designAfter, axis)
          || meaningfulStructureBetween(runtimeStructure, runtimeAnchor, runtimeBefore, runtimeAfter, axis)) continue;
        const property = `layout.${axis}-gap`;
        const comparison = compareStyle(property, `${Math.max(0, designGap)}px`, `${Math.max(0, runtimeGap)}px`);
        measuredPairs.add(key);
        projectedCandidates.push({
          property,
          comparison,
          designBefore,
          designAfter,
          runtimeBefore,
          runtimeAfter,
          beforeEntry,
          afterEntry,
          evidence: {
            componentPairs: [
              ...spacingEntryComponentPairs(beforeEntry),
              ...spacingEntryComponentPairs(afterEntry)
            ],
            direction: axis,
            ordered: true,
            crossAxisOverlap: {
              design: rounded(crossAxisOverlapRatio(designBefore, designAfter, axis)),
              runtime: rounded(crossAxisOverlapRatio(runtimeBefore, runtimeAfter, axis))
            },
            corridorClear: true,
            designGapCalibrated: true,
            compositeBoundary: beforeEntry.virtual || afterEntry.virtual,
            runtimeDirectionSource: 'geometry'
          }
        });
      }

      if (!projectedCandidates.length) return;
      const sameValues = projectedCandidates.every(candidate =>
        candidate.comparison.left.display === projectedCandidates[0].comparison.left.display
        && candidate.comparison.right.display === projectedCandidates[0].comparison.right.display);
      const selected = sameValues ? [projectedCandidates[0]] : projectedCandidates;
      selected.forEach((candidate, index) => {
        if (!canAdd(axis)) return;
        const repeatedRole = candidate.designBefore.role === candidate.designAfter.role;
        const pairLabel = repeatedRole && candidate.designBefore.role === 'card'
          ? '卡片之间'
          : `${structureLabel(candidate.designBefore)}与${structureLabel(candidate.designAfter)}`;
        addCheck(axis, {
          key: `projected-spacing:${designParent.raw.id}:${candidate.property}:${sameValues ? 'uniform' : index}`,
          item: `${pairLabel} · ${PROPERTY_LABELS[candidate.property]}`,
          property: candidate.property,
          design: candidate.comparison.left.display,
          runtime: candidate.comparison.right.display,
          status: candidate.comparison.same ? 'same' : 'different',
          judgment: judgment(candidate.property, candidate.comparison),
          category: 'layout',
          matchBasis: ['组件一一对应', '方向与顺序一致', '中间无有效内容', 'Figma 间距已用几何校准'],
          relationEvidence: candidate.evidence,
          visual: visualTarget(
            [spacingVisualNodes(candidate.designBefore), spacingVisualNodes(candidate.designAfter)].flat(),
            [spacingVisualNodes(candidate.runtimeBefore), spacingVisualNodes(candidate.runtimeAfter)].flat()
          )
        });
      });
    });
  }
  return checks;
}

// 递归“模块内卡片间距”端点资格：必须两侧都是真正的 card。
// 避免普通 text/button/icon 兄弟被旁路误命名为卡片并产生巨额假间距(report86)。
function recursiveCardGapEligible(designNode, runtimeNode) {
  return designNode?.role === 'card' && runtimeNode?.role === 'card';
}

// ── 数字两侧留白 · 跨侧对比(方案 v1) ──
// 场景: 设计师把数字单独成图层(左右常留 2px 设计间距), 前端却把整句写成一个文本节点(数字是字符)。
//   采集端(content.js numericSegments)已用 Range 测出前端每个"文字/数字/文字"结构里数字子串的左右留白。
//   本函数负责"跨侧对比": 前端数字留白 vs 设计侧对应独立数字图层的留白。
// 定位方式(不强求文案一致): 靠"承载该文本的父模块两侧已配对"作锚点, 在设计侧该模块内按
//   "同一行 + 相同数字文本 + 也是文字/数字/文字结构"定位对应的设计数字图层, 再按句内出现顺序对齐。
// 只增间距 check, 不改配对; 失败静默跳过(宁可少报)。
function numericSpacingChecks(structureMatches, designStructure) {
  const checks = [];
  if (!designStructure) return checks;
  const round1 = n => Math.round(n * 10) / 10;
  // 设计侧: 按 id 建索引 + 父子关系(用 structure.nodes 的 parentId)
  const dNodes = designStructure.nodes || [];
  const dById = new Map(dNodes.map(n => [n.id, n]));
  const dParentId = n => n?.parent?.id || n?.parentId || null;
  const dChildren = new Map();
  dNodes.forEach(n => {
    const pid = dParentId(n);
    if (!dChildren.has(pid)) dChildren.set(pid, []);
    dChildren.get(pid).push(n);
  });
  const dBox = n => n.raw?.geometry?.textInk?.status === 'measured' ? n.raw.geometry.textInk.box : (n.raw && n.raw._box) || (n.raw && n.raw.box && n.raw.box.local) || {};
  const dText = n => String((n.raw && n.raw.text && n.raw.text.direct) || '').trim();
  const isNumText = t => /^\d[\d/.]*$/.test(t); // 数字图层: 纯数字, 允许分数/小数(如 1/2, 1.5)
  const isWordText = t => /^[\u4e00-\u9fa5a-zA-Z]/.test(t); // 以文字开头(排除标点/纯符号)
  // 设计侧: 找"独立数字图层"的左右相邻文字图层(同父、同行), 算左右留白
  const designNumberGap = numNode => {
    const b = dBox(numNode);
    const sibs = (dChildren.get(dParentId(numNode)) || []).filter(s =>
      s.id !== numNode.id && Math.abs(((dBox(s).y) || 0) - (b.y || 0)) < 6);
    const left = sibs.filter(s => (dBox(s).x || 0) < (b.x || 0))
      .sort((a, c) => (dBox(c).x || 0) - (dBox(a).x || 0))[0];
    const right = sibs.filter(s => (dBox(s).x || 0) >= (b.x || 0))
      .sort((a, c) => (dBox(a).x || 0) - (dBox(c).x || 0))[0];
    if (!left || !right) return null;                    // 必须左右都有文字邻居(文字/数字/文字)
    if (!isWordText(dText(left)) || !isWordText(dText(right))) return null;
    const leftGap = (b.x || 0) - ((dBox(left).x || 0) + (dBox(left).width || 0));
    const rightGap = (dBox(right).x || 0) - ((b.x || 0) + (b.width || 0));
    if (leftGap < -1 || rightGap < -1) return null;      // 重叠 → 异常, 跳过
    return { leftGap, rightGap, leftText: dText(left), rightText: dText(right), num: dText(numNode), node: numNode, leftNode:left, rightNode:right };
  };

  structureMatches.forEach(match => {
    if (!match.unique) return;
    const rn = match.runtimeNode;
    const dn = match.designNode;
    if (!rn || !dn) return;

    // numericSegments 通常挂在已配对根/模块的后代文本叶子上，而不是配对节点自身。
    // report84 的主配对是 root↔div(e1)，真正带数字段的是 e1 下的 text 子节点；旧逻辑只读 rn.geometry，故永远为空。
    // 现在遍历已配对 runtime 模块整棵子树，收集所有带 numericSegments 的文本节点。
    const runtimeSegmentNodes = [];
    const collectRuntimeSegments = node => {
      if (!node) return;
      const segs = node.geometry?.numericSegments || node.raw?.geometry?.numericSegments;
      if (Array.isArray(segs) && segs.length) runtimeSegmentNodes.push({node, segs});
      (node.children || []).forEach(collectRuntimeSegments);
    };
    collectRuntimeSegments(rn);
    if (!runtimeSegmentNodes.length) return;

    // 设计侧配对节点: 以它为锚, 在其"所在父模块"内找设计数字图层
    const anchorId = dn.id;
    const anchorNode = dById.get(anchorId);
    const scopeRootId = anchorNode ? (dParentId(anchorNode) || anchorId) : anchorId;
    const scopeNumbers = [];
    const collect = id => {
      (dChildren.get(id) || []).forEach(c => {
        if (isNumText(dText(c))) { const g = designNumberGap(c); if (g) scopeNumbers.push(g); }
        collect(c.id);
      });
    };
    collect(scopeRootId);
    if (!scopeNumbers.length) return;

    // 同一锚字组合可能在一句里出现多次，例如“共完成 9 个攻略、达成 1 个足迹”两处都是 成/个。
    // 按视觉阅读顺序(y→x、同文本内按字符index)做第N次↔第N次映射，不能都取第一个设计数字。
    scopeNumbers.sort((a, b) => ((dBox(a.node).y || 0) - (dBox(b.node).y || 0))
      || ((dBox(a.node).x || 0) - (dBox(b.node).x || 0)));
    const runtimeSegments = runtimeSegmentNodes.flatMap(({node, segs}) => segs.map(seg => ({runtimeTextNode: node, seg})))
      .sort((a, b) => ((a.runtimeTextNode.raw?._box?.y || 0) - (b.runtimeTextNode.raw?._box?.y || 0))
        || ((a.runtimeTextNode.raw?._box?.x || 0) - (b.runtimeTextNode.raw?._box?.x || 0))
        || ((a.seg.index || 0) - (b.seg.index || 0)));
    const anchorOrdinals = new Map();
    runtimeSegments.forEach(({runtimeTextNode, seg:rawSeg}) => {
      const ink=rawSeg.textInk;
      const seg=ink?.status==='measured'?{...rawSeg,box:ink.box,leftBox:ink.leftBox,rightBox:ink.rightBox,leftGap:ink.box.x-ink.leftBox.x-ink.leftBox.width,rightGap:ink.rightBox.x-ink.box.x-ink.box.width}:rawSeg;
      const signature = `${String(seg.leftChar)}|${String(seg.rightChar)}`;
      const ordinal = anchorOrdinals.get(signature) || 0;
      anchorOrdinals.set(signature, ordinal + 1);
      const anchorMatched = scopeNumbers.filter(g => g.leftText.slice(-1) === String(seg.leftChar)
        && g.rightText.slice(0, 1) === String(seg.rightChar));
      // 顺序优先；若当前顺序超界，才回退到唯一的同值候选。
      const cand = anchorMatched[ordinal]
        || (anchorMatched.filter(g => g.num === String(seg.text)).length === 1
          ? anchorMatched.find(g => g.num === String(seg.text)) : null);
      if (!cand) return;
      [['left', cand.leftGap, seg.leftGap, '左'], ['right', cand.rightGap, seg.rightGap, '右']].forEach(([side, dGap, rGap, label]) => {
        const property = 'layout.horizontal-gap';
        const comparison = compareStyle(property, `${Math.max(0, round1(dGap))}px`, `${Math.max(0, round1(rGap))}px`);
        checks.push({
          key: `numeric-gap|${match.designNode.id}|${runtimeTextNode.id}|${seg.index}|${side}`,
          item: `数字「${seg.text}」· ${label}侧间距`,
          property,
          design: comparison.left.display,
          runtime: comparison.right.display,
          status: comparison.same ? 'same' : 'different',
          judgment: comparison.same ? '数字与相邻文字间距与设计一致'
            : '数字与相邻文字间距与设计不一致(仅比间距)',
          category: 'layout',
          source: 'numeric-segment',
          measurementEvidence: {metric:'numeric-segment-gap',side,segmentIndex:seg.index,
            designScopeId:(dById.get(scopeRootId)||dn).raw.id,runtimeScopeId:rn.raw.id,
            designNumberId:cand.node.raw.id,designLeftId:cand.leftNode.raw.id,designRightId:cand.rightNode.raw.id,
            runtimeTextId:runtimeTextNode.raw.id},
          matchBasis: ['父模块已配对', '同行数字位置', '两侧文字锚点一致'],
          visual: visualTarget([cand.node.raw], [runtimeTextNode.raw])
        });
      });
    });
  });
  return checks;
}

// 未覆盖区域: 把"有语义价值但两侧没配上"的区域显式报出来(status='uncovered'),
// 消除"幸存者偏差"——避免报告只呈现配上的那一小撮、让人误以为整页都对上了。
// 规则(与用户确认):
//   Q1 独立状态 uncovered(不混入 different/review)。
//   Q2 只收录 区域级(STRUCTURE_REGIONS 去 root) 或 控件级(CONTROL_ROLES) 的节点; 排除布局壳(layout)与文字碎片。
//   Q3 只报最外层: 若某节点的祖先已是"未覆盖"收录项, 则不再重复报其子孙(一个区域报1条, 不炸开内部)。
function uncoveredRegionChecks(structureMatches, designStructure, runtimeStructure) {
  if (!designStructure || !runtimeStructure) return [];
  const matchedDesign = new Set();
  const matchedRuntime = new Set();
  structureMatches.forEach(match => {
    if (!match.unique) return;
    matchedDesign.add(match.designNode.id);
    matchedRuntime.add(match.runtimeNode.id);
  });
  // 模块级(方案A): 只报用户一眼能感知的大模块——卡片/筛选行/标题区/表格/分页/图标按钮。
  // 排除: 表格内部单元格(head-cell/data-cell,太细,炸开)、控件碎片(input/select等)、
  //纯HTML结构层(table-body/head-row)、root(选区自身)。
  const MODULE_ROLES = new Set(['card', 'filter-row', 'title-region', 'table', 'pagination', 'button']);
  const reportableRole = role => MODULE_ROLES.has(role);
  const checks = [];
  const collectSide = (structure, matchedSet, sideLabel) => {
    const side=sideLabel==='设计'?'design':'runtime',slots=new Map();
    const rawWithin=(node,outer)=>node===outer||(node?._ancestors||[]).includes(outer);
    const sameRectangle=(a,b)=>a&&b&&['x','y','width','height'].every(k=>Number.isFinite(a[k])&&Number.isFinite(b[k])&&Math.abs(a[k]-b[k])<=0.5);
    const visibleSlots=raw=>{
      if(slots.has(raw))return slots.get(raw);
      const ids=[],controls=[];
      const visit=node=>{
        if(!node||geometrySubtreeHidden(node))return false;
        const visible=inspectionVisible(node);
        let descendantVisible=false;
        for(const child of node._children||[])if(visit(child))descendantVisible=true;
        if(visible){
          const control=['button','input','select','textarea'].includes(clean(node.tag))
            ||['button','tab','option','slider','progressbar','textbox','combobox','menuitem','radio','checkbox'].includes(clean(node.role));
          if(control)controls.push(node.id);
          // A wrapper's own text/control is a separate slot even if it also
          // contains descendants. It cannot inherit their coverage silently.
          if(!descendantVisible||compactText(node.text?.direct)||control)ids.push(node.id);
        }
        return visible||descendantVisible;
      };
      visit(raw);const value={ids:ids.sort(),controls:controls.sort()};slots.set(raw,value);return value;
    };
    const paintKeys=['background','background-color','background-image','box-shadow','outline','border-radius',
      ...['top','right','bottom','left'].flatMap(edge=>[`border-${edge}`,`border-${edge}-width`,`border-${edge}-style`,`border-${edge}-color`])];
    const paintSignature=raw=>{const styles=canonicalStyles(raw);return paintKeys.map(key=>clean(styles[key])).join('|');};
    const equivalentWrapper=(node,matched)=>{
      const n=node.raw,m=matched.raw;
      if(!n||!m||!(rawWithin(n,m)||rawWithin(m,n))||!sameRectangle(n._box,m._box))return false;
      const a=visibleSlots(n),b=visibleSlots(m);
      if(!a.ids.length||a.ids.join('|')!==b.ids.join('|')||a.controls.join('|')!==b.controls.join('|'))return false;
      const inner=rawWithin(n,m)?n:m,outer=inner===n?m:n,path=[];
      for(let cursor=inner;cursor&&cursor!==outer;cursor=cursor._parent)path.push(cursor);
      path.push(outer);
      // Equal text leaves alone do not prove an extra painted layer is merely
      // packaging. Keep independently styled borders, backgrounds and pseudos.
      if(path.some(raw=>geometryRisk(raw)||raw.geometry?.hasPseudoContent
        ||raw.geometry?.pseudoElements?.some(p=>p.status!=='unpainted')))return false;
      const painted=path.filter(raw=>inspectionVisible(raw)&&(
        typeof InspectionContracts!=='undefined'&&InspectionContracts.paint(raw)||geometryPaintedBox(raw,side)));
      if(painted.some(raw=>!sameRectangle(raw._box,n._box)))return false;
      return !painted.length||painted.every(raw=>paintSignature(raw)===paintSignature(painted[0]));
    };
    const matchedNodes=structure.nodes.filter(node=>matchedSet.has(node.id));
    for(const node of structure.nodes){
      delete node.coverageAlias;
      if(matchedSet.has(node.id)||!reportableRole(node.role)||!inspectionVisible(node.raw))continue;
      const alias=matchedNodes.find(matched=>equivalentWrapper(node,matched));
      if(alias)node.coverageAlias={coveredByNodeId:alias.raw.id,coveredByStructureId:alias.id,
        kind:'equivalent-visual-wrapper',basis:['same-visible-rectangle','same-visible-content-slots','no-independent-painted-or-control-slot'],
        scope:'module-identity-only'};
    }
    const nodes = structure.nodes.filter(node => reportableRole(node.role) && !matchedSet.has(node.id)
      && !node.coverageAlias && inspectionVisible(node.raw));
    const uncoveredIds = new Set(nodes.map(node => node.id));
    nodes.forEach(node => {
      // 只报最外层: 祖先里若已有"未覆盖且可报"的模块, 跳过(避免一个大模块里再报子模块)。
      let ancestor = node.parent;
      let coveredByAncestor = false;
      while (ancestor) {
        if (uncoveredIds.has(ancestor.id)) { coveredByAncestor = true; break; }
        ancestor = ancestor.parent;
      }
      if (coveredByAncestor) return;
      const label = structureLabel(node);
      const box = node.raw?._box;
      const pos = box ? `x=${Math.round(box.x)} y=${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}` : '';
      checks.push({
        key: `uncovered:${sideLabel}:${node.id}`,
        item: `${label} · 未纳入对比`,
        property: 'coverage.unmatched',
        design: sideLabel === '设计' ? pos : '—',
        runtime: sideLabel === '前端' ? pos : '—',
        status: 'uncovered',
        judgment: `${sideLabel}侧该区域因两侧结构差异未能配对，未纳入间距/留白/属性对比`,
        category: 'coverage',
        coverageNodeId: node.raw?.id,
        uncoveredSide: sideLabel,
        uncoveredRole: node.role
      });
    });
  };
  collectSide(designStructure, matchedDesign, '设计');
  collectSide(runtimeStructure, matchedRuntime, '前端');
  return checks;
}

function representativeTitle(nodes) {
  const candidates = nodes.filter(node => {
    const text = String(node.text?.direct || '').trim();
    return text && text.length <= 32 && text.length >= 2;
  }).map(node => {
    const name = `${node.name || ''} ${node.selector || ''} ${node.tag || ''}`;
    const strong = /title|heading|cardh|标题|\bh[1-6]\b/i.test(name);
    let score = 1000 - (node.box?.local?.y || 0);
    if (strong) score += 500;
    if (String(node.text?.direct || '').trim().length <= 12) score += 40;
    return {text: String(node.text.direct).trim(), score, strong};
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || {text: '', strong: false};
}

function scopeAssessment() {
  if (!design || !runtime) return null;
  const page = design.pages[$('#page').selectedIndex];
  const designRaw = flatten(page);
  const runtimeRaw = runtime.elements || [];
  const runtimeBox = runtime._meta?.rootElement?.box || runtimeRaw.find(node => !node.parentId)?.box?.local || {};
  const figmaTitle = representativeTitle(designRaw);
  const frontendTitle = representativeTitle(runtimeRaw);
  const figma = {
    name: page.name || '未命名',
    title: figmaTitle.text,
    width: number(page.width ?? designRaw[0]?.box?.local?.width),
    height: number(page.height ?? designRaw[0]?.box?.local?.height),
    nodes: designRaw.length
  };
  const frontend = {
    name: runtime._meta?.rootElement?.selector || runtimeRaw.find(node => !node.parentId)?.selector || '已选组件',
    title: frontendTitle.text,
    width: number(runtimeBox.width),
    height: number(runtimeBox.height),
    nodes: runtimeRaw.length
  };
  const blockers = [];
  const warnings = [];
  if (figma.width && frontend.width) {
    const ratio = Math.abs(figma.width - frontend.width) / Math.max(figma.width, frontend.width);
    if (Math.abs(figma.width - frontend.width) > 80 && ratio > 0.15) blockers.push(`宽度相差 ${rounded(Math.abs(figma.width - frontend.width))}px，疑似不是同一层级`);
  }
  if (figma.height && frontend.height) {
    const ratio = Math.abs(figma.height - frontend.height) / Math.max(figma.height, frontend.height);
    if (ratio > 0.3) warnings.push('高度差较大，可能由数据行数或展开状态不同造成');
  }
  if (figma.nodes && frontend.nodes && Math.max(figma.nodes, frontend.nodes) / Math.min(figma.nodes, frontend.nodes) > 3) {
    warnings.push('节点数量差距较大，请确认两边都选择了最小完整模块');
  }
  const genericPage = /^(卡片|frame|页面|组件|group)$/i.test(figma.name);
  const label = figma.title ? `${figma.title}${genericPage && /卡片/.test(figma.name) ? '卡片' : ''}` : figma.name;
  return {figma, frontend, blockers, warnings, blocked: blockers.length > 0, label};
}

// ===== AI 兜底裁判:仅解决"design侧image↔ 前端icon 因类别不同被803行拒配"的图标 =====
// 设计铁律: 关闭 aiConfig.enabled 时下面全部不执行, 走查完全等于纯引擎。
//两阶段: ①收集(同步,compare内) 找候选; ②裁决(异步,截图就绪后) 批量问Kimi。
let aiFallbackContext = null;

// 阶段① 收集: 扫两侧未匹配的 icon/image, 找"几何位置接近、仅因 icon↔image 类别不同被拒"的候选对。
// 复用 structurePairScore 的位置约束逻辑(POS_HARD 0.2), 只放行"本该配、只差类别"的对。
function collectAiIconCandidates(designStructure, runtimeStructure, structureMatches) {
  const matchedDesign = new Set(structureMatches.map(m => m.designNode.id));
  const matchedRuntime = new Set(structureMatches.map(m => m.runtimeNode.id));
  const isGraphic = node => ['icon', 'image'].includes(structureRoleCategory(node.role));
  const designGraphics = designStructure.nodes.filter(n => isGraphic(n) && !matchedDesign.has(n.id));
  const runtimeGraphics = runtimeStructure.nodes.filter(n => isGraphic(n) && !matchedRuntime.has(n.id));
  const candidates = [];
  designGraphics.forEach(d => {
    runtimeGraphics.forEach(r => {
      // 只要"跨类别"(一icon一image)——同类别的本就该走引擎, 不劳AI。
      // Same-category unmatched icons also require an identity/slot decision.
      // 位置硬约束: 中心距超阈值直接不算候选(杜绝位置差很远的乱配)。
      const dcx = d.raw._nx + d.raw._nw / 2, dcy = d.raw._ny + d.raw._nh / 2;
      const rcx = r.raw._nx + r.raw._nw / 2, rcy = r.raw._ny + r.raw._nh / 2;
      if (Math.abs(dcx - rcx) + Math.abs(dcy - rcy) > 0.2) return;
      // 尺寸比例太悬殊也不算(skill纪律: 多源一致才定罪)。
      const wr = Math.min(d.raw._nw, r.raw._nw) / Math.max(d.raw._nw, r.raw._nw, 1e-6);
      const hr = Math.min(d.raw._nh, r.raw._nh) / Math.max(d.raw._nh, r.raw._nh, 1e-6);
      if (wr < 0.25 || hr < 0.25) return;
      candidates.push({
        id: `${d.raw.id}__${r.raw.id}`,
        designNode: d, runtimeNode: r,
        centerDist: Math.abs(dcx - rcx) + Math.abs(dcy - rcy)
      });
    });
  });
  // 一个 design 图标可能对多个 runtime 候选, 只保留中心距最近的那个, 避免一对多。
  const bestByDesign = new Map();
  candidates.sort((a, b) => a.centerDist - b.centerDist).forEach(c => {
    if (!bestByDesign.has(c.designNode.id)) bestByDesign.set(c.designNode.id, c);
  });
  const usedRuntime = new Set();
  const result = [];
  bestByDesign.forEach(c => {
    if (usedRuntime.has(c.runtimeNode.id)) return;
    usedRuntime.add(c.runtimeNode.id);
    result.push(c);
  });
  for(const match of structureMatches) {
    const d=match.designNode,r=match.runtimeNode;
    const small=n=>isGraphic(n)&&n.raw?._box?.width>0&&n.raw._box.height>0&&Math.max(n.raw._box.width,n.raw._box.height)<=128;
    if(match.unique&&small(d)&&small(r))result.push({id:`${d.raw.id}__${r.raw.id}`,designNode:d,runtimeNode:r,source:'matched-slot-candidate'});
  }
  return result;
}

// 从某侧整页截图里按节点 box 裁出 128px 小图(base64 png), 复用 draw 的坐标换算思路。
async function cropNodeThumb(source, node) {
  if (!source?.dataUrl) return null;
  const box = node.raw._box;
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('截图读取失败'));
    img.src = source.dataUrl;
  });
  const rootWidth = Number(source.width) || image.naturalWidth;
  const rootHeight = Number(source.height) || image.naturalHeight;
  const pad = Math.max(6, Math.min(24, Math.max(box.width, box.height) * 0.4));
  const cx = Math.max(0, box.x - pad), cy = Math.max(0, box.y - pad);
  const cw = Math.min(rootWidth, box.x + box.width + pad) - cx;
  const ch = Math.min(rootHeight, box.y + box.height + pad) - cy;
  if (!(cw > 0) || !(ch > 0)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
  const fit = Math.min(128 / cw, 128 / ch);
  const w = cw * fit, h = ch * fit, ox = (128 - w) / 2, oy = (128 - h) / 2;
  const sx = image.naturalWidth / rootWidth, sy = image.naturalHeight / rootHeight;
  ctx.drawImage(image, cx * sx, cy * sy, cw * sx, ch * sy, ox, oy, w, h);
  return canvas.toDataURL('image/png');
}

// 批量问 Kimi: 这些图标对里哪些是"同一个"。带 skill 判定纪律, 要求 JSON 结构化输出。
async function judgeIconPairsWithAi(pairs, cfg) {
  if (!pairs.length) return {};
  if(cfg.provider==='jev')return {__unsupported:'Jev 不接收图片，未执行图标图案检查'};
  const content = [{
    type: 'text',
    text: '你是UI走查的"图标配对裁判"。下面按顺序给出若干组图标对, 每组两张图(设计稿裁剪、前端裁剪)。'
      + '判断每一组是不是"同一个UI图标"(同一功能位上的同一枚图标, 如都是刷新/筛选/排序图标)。\n'
      + '判定纪律(必须遵守):\n'
      + '1. 多源一致才判same: 不能只看图案像, 图案语义必须一致。图案不同→ different。\n'
      + '2. 拿不准就uncertain: 证据不足、模糊、可能是不同图标时判uncertain, 不要硬判same。宁可漏配不可错配。\n'
      + '3. 不因渲染细节否决: 描边粗细、抗锯齿、轻微色差是渲染差异, 不作为different理由。\n'
      + '4. 只判是否同一个, 不判哪里不一样。\n'
      + `共${pairs.length} 组。严格输出JSON: {"results":[{"index":0,"verdict":"same|different|uncertain","confidence":0.0,"reason":"一句中文"}]}`
  }];
  for (let i = 0; i < pairs.length; i += 1) {
    content.push({type: 'text', text: `第${i}组(设计稿):`});
    content.push({type: 'image_url', image_url: {url: pairs[i].designImg}});
    content.push({type: 'text', text: `第${i}组(前端):`});
    content.push({type: 'image_url', image_url: {url: pairs[i].runtimeImg}});
  }
  try {
    const limits=typeof InspectionReview!=='undefined'?InspectionReview.routing.LIMITS:null;
    const remaining=limits&&cfg.session?.budget?limits.maxPreVerifyAiMs-cfg.session.budget.usedAiMs:null;
    const {value}=await KimiClient.completeJSON({cfg,messages:[{role:'user',content}],maxTokens:1200,
      ...(remaining!=null?{totalMs:Math.max(1,Math.min(limits.totalMs,remaining))}:{})});
    const verdictByIndex={};
    (value.results||[]).forEach(item=>{verdictByIndex[item.index]=item;});
    return verdictByIndex;
  }catch(error){return {__error:error.message};}

}

function iconBoundary(node) {
  const raw=node.raw||node,tag=clean(raw.tag),type=clean(raw.type);
  const kind=['path','g','use','circle','ellipse','rect','line','polyline','polygon'].includes(tag)
    || ['vector','boolean_operation'].includes(type)?'paint-path'
    :tag==='img'||type==='image'?'image-element':'graphic-element';
  return {kind,box:visualBox(raw)};
}

function verifiedIconSlot(candidate,ctx) {
  const d=candidate.designNode,r=candidate.runtimeNode;
  const inside=(n,p)=>n.id===p.id||n.raw?._ancestors?.includes(p.raw);
  const parents=ctx.structureMatches.filter(m=>m.unique&&m.designNode!==d&&m.runtimeNode!==r
    &&inside(d,m.designNode)&&inside(r,m.runtimeNode));
  parents.sort((a,b)=>(a.designNode.raw._box.width*a.designNode.raw._box.height)-(b.designNode.raw._box.width*b.designNode.raw._box.height));
  const parent=parents[0];
  if(!parent)return {verified:false,basis:['没有共同的已验证父级']};
  const graphics=(structure,owner)=>structure.nodes.filter(n=>['icon','image'].includes(structureRoleCategory(n.role))&&inside(n,owner));
  const dg=graphics(ctx.designStructure,parent.designNode),rg=graphics(ctx.runtimeStructure,parent.runtimeNode);
  // Slot identity comes from the enclosing matched component and its content, not
  // merely from the model's confidence or nearest position in a screenshot.
  const verified=dg.length===1&&rg.length===1&&dg[0]===d&&rg[0]===r;
  return {verified,basis:verified?['已匹配组件内唯一图标槽位']:['所属组件含多个图标槽位'],
    designParentId:parent.designNode.raw.id,runtimeParentId:parent.runtimeNode.raw.id};
}

async function aiIconFallback() {
  const ctx=aiFallbackContext,current=report;
  if(!ctx||!current||current.iconReview?.started||typeof IconReview==='undefined')return;
  const result={version:IconReview.VERSION,records:[],coverage:[],matches:[],calls:0};
  current.iconReview=result;result.started=true;
  const candidates=ctx.candidates||[];
  for(const side of ['design','runtime']) {
    const represented=new Set(candidates.map(c=>c[side+'Node'].raw.id));
    const graphics=ctx[side+'Structure'].nodes.filter(n=>['icon','image'].includes(structureRoleCategory(n.role)));
    for(const node of graphics.filter(n=>!represented.has(n.raw.id)))result.coverage.push({id:`icon-unpaired-${side}-${node.raw.id}`,property:'icon.slot',status:'unverified',nodeIds:{[side]:node.raw.id},reason:'尚未完成该图形的功能槽位和图案检查'});
  }
  let cursor=0;
  const iconLimits=typeof InspectionReview!=='undefined'?InspectionReview.routing.LIMITS:{maxIconCalls:2,maxPreVerifyCalls:9,maxPreVerifyAiMs:90000};
  let iconReserved=0;
  const worker=async()=>{
    while(cursor<candidates.length&&report===current){
      const c=candidates[cursor++],slot=verifiedIconSlot(c,ctx);
      let identity={verdict:'uncertain',reason:'图标图案尚未复核'};
      if(!slot.verified)identity.error='先确定图标所在功能位置，本轮不请求图案复核';
      else if(aiConfig.provider==='jev')identity={verdict:'uncertain',unsupported:true,reason:'Jev 不接收图片，图标图案检查未覆盖'};
      else if(!aiConfig.apiKey)identity.error='模型连接尚未配置';
      else if(aiConfig.requestSession?.budget&&(iconReserved>=iconLimits.maxIconCalls||aiConfig.requestSession.budget.calls>=iconLimits.maxPreVerifyCalls||aiConfig.requestSession.budget.usedAiMs>=iconLimits.maxPreVerifyAiMs))identity.error='图标阶段已达到预留额度，剩余额度留给最终复核';
      else if(KimiClient.unavailableReason({apiKey:aiConfig.apiKey,session:aiConfig.requestSession}))identity.error=KimiClient.unavailableReason({apiKey:aiConfig.apiKey,session:aiConfig.requestSession});
      else if(!current.visuals?.design?.dataUrl||!current.visuals?.runtime?.dataUrl)identity.error='本轮图标截图不可用';
      else {
        iconReserved++;
        try {
          const [designImg,runtimeImg]=await Promise.all([cropNodeThumb(current.visuals.design,c.designNode),cropNodeThumb(current.visuals.runtime,c.runtimeNode)]);
          if(!designImg||!runtimeImg)throw Error('局部截图未取得');
          const verdict=await judgeIconPairsWithAi([{designImg,runtimeImg}],{apiKey:aiConfig.apiKey,model:aiConfig.model,session:aiConfig.requestSession});
          result.calls++;
          identity=verdict.__error?{verdict:'uncertain',error:verdict.__error}:verdict[0]||identity;
        }catch(error){identity={verdict:'uncertain',error:error.message};}
      }
      if(report!==current)return;
      const decision=IconReview.evaluate({pairId:c.id,design:c.designNode.raw,runtime:c.runtimeNode.raw,slot,identity,
        boundaries:{design:iconBoundary(c.designNode),runtime:iconBoundary(c.runtimeNode)}});
      decision.checks.forEach(check=>{check.item=`${elementLabel(c.runtimeNode.raw,c.designNode.raw)} · ${check.item}`;});
      current.checks.push(...decision.checks);
      result.records.push(decision.evidence);result.coverage.push(...decision.coverage);result.matches.push(...decision.matches);
      if(decision.matches.length&&!ctx.structureMatches.some(m=>m.designNode===c.designNode||m.runtimeNode===c.runtimeNode)){
        ctx.structureMatches.push({designNode:c.designNode,runtimeNode:c.runtimeNode,unique:true,score:150,basis:slot.basis,source:'verified-icon-slot'});
      }
      $('#status').textContent=`正在自动检查图标 ${result.records.length}/${candidates.length}`;
    }
  };
  await Promise.all(Array.from({length:Math.min(aiConfig.requestSession?.budget?1:2,candidates.length)},worker));
  if(report!==current)return;
  current.technical.coverage.icons={pairs:result.records.length,checked:result.coverage.filter(c=>c.status==='checked').length,
    unresolved:result.coverage.filter(c=>c.status==='unverified').length,unsupported:result.coverage.filter(c=>c.status==='unsupported').length};
  current.technical.structure.matches.push(...result.matches.map(m=>({...m,basis:m.basis||['verified-icon-slot']})));
  current.technical.structure.matched=ctx.structureMatches.length;
  result.completed=true;
  refreshInspectionSummary(current);
}

// ═══════════════════════════════════════════════════════════════════
// P1: AI 语义配对 + 引擎几何验证 (仅筛选区试点)
// 设计: AI语义配对+引擎几何验证_设计_v1.md
// 铁律: AI 只做"谁对谁"(读文本,不看图,不出数字); 引擎做几何验证+测量。
//       关闭 aiConfig.enabled → 完全不执行, 走查等于纯引擎。
// ═══════════════════════════════════════════════════════════════════

// 可比角色: 只有这些角色的残差节点才值得送 AI 配对(有测量价值)。
const AI_PAIR_ELIGIBLE_ROLES = new Set([
  'container', 'card', 'title-region', 'filter-row',
  'button', 'link', 'title', 'text',
  'filter-control', 'date-input', 'input', 'select', 'textarea', 'control',
  'icon', 'image'
]);

// 阶段一: 提取"筛选区内部未被引擎配上的可比节点"作为残差。
// 只在"两侧都已配上的 filter-row"内部找残差 → 天然限定同区、防跨区乱配。
function collectFilterRegionResidual(designStructure, runtimeStructure, structureMatches) {
  // 找已配对的 filter-row 对(引擎已确认两侧是同一个筛选区)。
  const filterPairs = structureMatches.filter(m => m.unique &&
    m.designNode.role === 'filter-row' && m.runtimeNode.role === 'filter-row');
  if (!filterPairs.length) return null;

  const matchedD = new Set(structureMatches.map(m => m.designNode.id));
  const matchedR = new Set(structureMatches.map(m => m.runtimeNode.id));
  // 收集某 structure node 的全部后代(含自身除外)。
  const descendantsOf = (root) => {
 const out = [];
    const walk = (n) => { (n.children || []).forEach(c => { out.push(c); walk(c); }); };
  walk(root);
    return out;
  };
  const eligible = (n) => AI_PAIR_ELIGIBLE_ROLES.has(n.role);
  const designResidual = [], runtimeResidual = [], buckets = [];
  const assignedD = new Set(), assignedR = new Set();
  // A nested filter owns its descendants before an outer filter can claim them.
  filterPairs.slice().sort((a,b) => (a.designNode.raw?._box?.width || 0) * (a.designNode.raw?._box?.height || 0)
    - (b.designNode.raw?._box?.width || 0) * (b.designNode.raw?._box?.height || 0)).forEach(pair => {
    const collect = (root, matched, assigned) => descendantsOf(root).filter(n => {
      if (!eligible(n) || matched.has(n.id) || assigned.has(n.id)) return false;
      assigned.add(n.id); return true;
    });
    const d = collect(pair.designNode, matchedD, assignedD), r = collect(pair.runtimeNode, matchedR, assignedR);
    if (!d.length && !r.length) return;
    buckets.push({id: JSON.stringify([pair.designNode.id,pair.runtimeNode.id]), parentPair: pair, designResidual:d, runtimeResidual:r});
    designResidual.push(...d); runtimeResidual.push(...r);
  });
  if (!designResidual.length && !runtimeResidual.length) return null;
  return {designResidual, runtimeResidual, filterPairs, buckets};
}

// 把一个 structure node 序列化成喂给 AI 的紧凑对象(语义+归一化几何, 不含图)。
function serializeNodeForAi(n) {
  const b = n.raw || {};
  const r2 = (v) => Math.round((v || 0) * 1000) / 1000; // 归一化坐标保留3位
  return {
    id: n.id,
    role: n.role,
    text: (n.primaryAnchor || (n.anchors && n.anchors[0]?.compact) || '').slice(0, 40),
    name: String(n.raw?.name || n.raw?.componentName || n.raw?.selector || '').slice(0, 40),
    box: {x: r2(b._nx), y: r2(b._ny), w: r2(b._nw), h: r2(b._nh)},
    depth: (n.raw?._ancestors || []).length,
    parentId: n.parent?.id || ''
  };
}

// 阶段二: AI 语义配对。读两侧残差的结构化文本, 输出"谁对谁"映射。不看图、不出数字。
// 几何阈值(前置预筛 + 后置验证共用)
const AI_PAIR_POS_HARD = 0.28;   // 归一化中心距上限(复用引擎 POS_HARD 量级)
const AI_PAIR_SIZE_MIN = 0.5;    // 尺寸比下限

// 阶段二之前: 前置几何预筛。把 D×R 全组合(可能数百)砍成"几何上真有可能配"的候选对,
// 只把候选对喂 AI, 避免全组合导致输入过大/推理组合爆炸/超时。
// 只筛位置+尺寸(不加同类别), 给 AI 保留跨类别语义判断的余地(如 icon↔image)。
function prefilterSemanticCandidates(designResidual, runtimeResidual) {
  const cx = n => (n.raw._nx || 0) + (n.raw._nw || 0) / 2;
  const cy = n => (n.raw._ny || 0) + (n.raw._nh || 0) / 2;
  const pairs = [];
  designResidual.forEach(d => {
    runtimeResidual.forEach(r => {
      if (![d.raw,r.raw].every(raw=>raw && ['_nx','_ny','_nw','_nh'].every(key=>Number.isFinite(raw[key])) && raw._nw>0 && raw._nh>0)) return;
      const dist = Math.abs(cx(d) - cx(r)) + Math.abs(cy(d) - cy(r));
      if (dist > AI_PAIR_POS_HARD) return;
      const wr = Math.min(d.raw._nw, r.raw._nw) / Math.max(d.raw._nw, r.raw._nw, 1e-6);
      const hr = Math.min(d.raw._nh, r.raw._nh) / Math.max(d.raw._nh, r.raw._nh, 1e-6);
    if (wr < AI_PAIR_SIZE_MIN || hr < AI_PAIR_SIZE_MIN) return;
    pairs.push({designNode: d, runtimeNode: r, centerDist: dist});
    });
});
  // 距离近的优先, 便于必要时截断上限(防极端页面候选仍过多)。
  pairs.sort((a, b) => a.centerDist - b.centerDist);
  return pairs; // The scheduler batches all candidates; no silent 120-pair truncation.
}

// 阶段二: AI 语义配对。读【几何预筛后的候选对】文本, 从中挑出"确实是同一个UI元素"的。
// 不看图、不出数字。输入是候选对而非全组合 → 文本量小、推理聚焦、不超时。
async function aiSemanticPair(candidatePairs, cfg) {
  if(cfg.provider==='jev')return {__error:'Jev 配对由组件身份流程处理，旧入口不发送请求'};
  // 候选对里涉及的节点去重后序列化(AI 靠 id 回指)。
  const nodeMap = new Map();
  candidatePairs.forEach(p => { nodeMap.set(p.designNode.id, p.designNode); nodeMap.set(p.runtimeNode.id, p.runtimeNode); });
  const nodes = Array.from(nodeMap.values()).map(serializeNodeForAi);
  const pairList = candidatePairs.map(p => ({d: p.designNode.id, r: p.runtimeNode.id}));
  const prompt =
    '你是UI走查的"语义配对器"。下面给出若干UI节点(含角色role、文字text、名称name、归一化位置box(0~1)、层级depth), '
    + '以及一批"几何上位置接近、待判定"的候选配对(每项 d=设计稿节点id, r=前端节点id)。\n'
    + '任务: 对每个候选对, 判断这两个节点"语义上是不是同一个UI元素"(同样的文字/功能/角色)。是→ 收进结果。\n'
    + '判定纪律(必须遵守):\n'
    + '1. 语义优先: 看"这俩在讲同一件事吗", 不要只看name字面(name可能是乱码)。\n'
    + '2. 位置已预筛过(都较接近), 但位置只是佐证; 语义不符仍要判否。\n'
    + '3. 宁可漏配不可错配: 拿不准就不收。错配比漏配代价大得多。\n'
    + '4. 一对一: 一个设计稿节点最多配一个前端节点, 反之亦然(从候选里择优)。\n'
    + '5. 只输出配对, 不判断差异、不测量任何数字。\n'
    + `共${pairList.length}个候选对。严格输出JSON: {"pairs":[{"designId":"...","runtimeId":"...","confidence":0.0,"reason":"一句中文"}]}\n\n`
    + '节点:\n' + JSON.stringify(nodes) + '\n\n候选对:\n' + JSON.stringify(pairList);
  try {
    const {value}=await KimiClient.completeJSON({cfg,messages:[{role:'user',content:prompt}],maxTokens:6000});
    return {pairs:Array.isArray(value.pairs)?value.pairs:[]};
  }catch(error){return {__error:error.message};}

}

// 阶段三: 引擎几何验证。AI 说要配的每一对, 必须过位置/尺寸/角色三关。
// 返回 'accept'(高置信+校验过) / 'review'(中置信+校验过) / 'reject'(校验不过或低置信)。
function verifyPairGeometry(dNode, rNode, confidence) {
  const db = dNode.raw, rb = rNode.raw;
  if (![db,rb].every(raw=>raw && ['_nx','_ny','_nw','_nh'].every(key=>Number.isFinite(raw[key])) && raw._nw>0 && raw._nh>0)) return 'reject';
  // ① 位置硬约束: 归一化中心距。AI 说配但位置差远 → 直接否决(幻觉高发区)。
  const dcx = (db._nx || 0) + (db._nw || 0) / 2, dcy = (db._ny || 0) + (db._nh || 0) / 2;
  const rcx = (rb._nx || 0) + (rb._nw || 0) / 2, rcy = (rb._ny || 0) + (rb._nh || 0) / 2;
  if (Math.abs(dcx - rcx) + Math.abs(dcy - rcy) > AI_PAIR_POS_HARD) return 'reject';
  // ② 尺寸合理性: 宽比、高比不能过于悬殊(防大卡配小图标)。
  const wr = Math.min(db._nw, rb._nw) / Math.max(db._nw, rb._nw, 1e-6);
  const hr = Math.min(db._nh, rb._nh) / Math.max(db._nh, rb._nh, 1e-6);
  if (wr < AI_PAIR_SIZE_MIN || hr < AI_PAIR_SIZE_MIN) return 'reject';
  // ③ 角色相容: 同一可配类别(structureRoleCategory)才放行; 跨类别需极高置信。
  const dc = structureRoleCategory(dNode.role), rc = structureRoleCategory(rNode.role);
  const sameCat = dc === rc;
  if (!sameCat && Number(confidence) < 0.9) return 'reject';
// ④ 置信度分级(用户拍板: 中置信进 review)。
  const c = Number(confidence) || 0;
  if (c >= 0.85) return 'accept';
  if (c >= 0.6) return 'review';
  return 'reject';
}

// 阶段编排: 残差→AI配对→几何验证→通过的对补进 structureMatches → 重算筛选区留白/间距 → 补进 checks。
// 任何异常/超时/关闭 → 静默跳过(fail-safe), 走查照常出引擎结果。
async function aiSemanticPairFallback() {
  const ctx = aiFallbackContext, current = report;
  if (!ctx || !current || !ctx.designStructure || !ctx.runtimeStructure) return;
  if (current.semanticReview?.running || current.semanticReview?.completed) return;
  const state = {version:2,running:true,completed:false,matches:[],unresolved:[],decisions:[],batches:[],candidateCount:0};
  current.semanticReview = state;
  const isCurrent = () => report === current && aiFallbackContext === ctx;
  const safe = value => typeof KimiClient !== 'undefined' && KimiClient.sanitizeError
    ? KimiClient.sanitizeError(String(value || ''),aiConfig.apiKey) : String(value || '').split(aiConfig.apiKey || '\u0000').join('[redacted]');
  const pairKey = (d,r) => JSON.stringify([d,r]);
  const acceptedMatches = [], outcomes = new Map();
  let residual = null, candidatePairs = [];
  const mark = (pair,code,reason) => {
    const key=pairKey(pair.designNode.id,pair.runtimeNode.id);
    outcomes.set(key,{code,reason:safe(reason)});
  };
  try {
    residual = collectFilterRegionResidual(ctx.designStructure,ctx.runtimeStructure,ctx.structureMatches);
    if (!residual) return;
    // Each pair is confined to one already matched filter component.
    residual.buckets.forEach(bucket => {
      prefilterSemanticCandidates(bucket.designResidual,bucket.runtimeResidual).forEach(pair => {
        candidatePairs.push({...pair,bucketId:bucket.id,parentPair:bucket.parentPair});
      });
    });
    state.candidateCount=candidatePairs.length;
    candidatePairs.forEach(pair=>mark(pair,'not-processed','自动对应关系检查尚未完成'));
    if (!aiConfig.apiKey || aiConfig.requestSession?.blocked) {
      const reason=!aiConfig.apiKey?'模型连接尚未配置':'本轮模型连接已停止';
      candidatePairs.forEach(pair=>mark(pair,'connection-unavailable',reason));
      state.connection=reason;
      return;
    }
    const batches=[];
    for (const bucket of residual.buckets) {
      const pairs=candidatePairs.filter(pair=>pair.bucketId===bucket.id);
      for (let i=0;i<pairs.length;i+=8) batches.push(pairs.slice(i,i+8));
    }
    let cursor=0;
    const worker=async()=>{
      while(cursor<batches.length && isCurrent()) {
        const batch=batches[cursor++];
        const record={id:state.batches.length+1,bucketId:batch[0].bucketId,candidateIds:batch.map(p=>pairKey(p.designNode.id,p.runtimeNode.id)),attempts:[]};
        state.batches.push(record);
        if(aiConfig.requestSession?.blocked) {
          batch.forEach(pair=>mark(pair,'connection-stopped','本轮模型连接已停止，该组尚未检查'));record.status='not-processed';continue;
        }
        let result;
        for(let attempt=0;attempt<2;attempt++) {
          try { result=await aiSemanticPair(batch,aiConfig); }
          catch(error) { result={__error:safe(error.message)}; }
          if(!isCurrent())return;
          record.attempts.push(result.__error?{error:safe(result.__error)}:{pairs:(result.pairs||[]).map(pair=>({designId:safe(pair.designId),runtimeId:safe(pair.runtimeId),confidence:Number(pair.confidence),reason:safe(pair.reason)}))});
          if(!result.__error || aiConfig.requestSession?.blocked)break;
        }
        if(result.__error) {
          record.status='failed';batch.forEach(pair=>mark(pair,'call-failed',result.__error));continue;
        }
        record.status='received';
        batch.forEach(pair=>mark(pair,'not-selected','模型未确认这组对象的对应关系'));
        const allowed=new Map(batch.map(pair=>[pairKey(pair.designNode.id,pair.runtimeNode.id),pair]));
        (result.pairs||[]).forEach(proposal=>{
          const pair=allowed.get(pairKey(proposal.designId,proposal.runtimeId));
          if(!pair) {
            state.decisions.push({designId:String(proposal.designId||''),runtimeId:String(proposal.runtimeId||''),status:'rejected',code:'outside-candidate-batch',reason:'模型返回了当前候选范围之外的对象'});
            return;
          }
          const confidence=Number(proposal.confidence);
          const verdict=Number.isFinite(confidence)&&confidence>=0&&confidence<=1?verifyPairGeometry(pair.designNode,pair.runtimeNode,confidence):'reject';
          const decision={pair,confidence,verdict,reason:safe(proposal.reason||'')};
          record.acceptable=record.acceptable||[];record.acceptable.push(decision);
        });
        if(isCurrent())$('#status').textContent=`正在自动确认组件对应关系 ${state.batches.filter(b=>b.status).length}/${batches.length}`;
      }
    };
    await Promise.all(Array.from({length:Math.min(2,batches.length)},worker));
    if(!isCurrent())return;
    const usedD=new Set(ctx.structureMatches.map(m=>m.designNode.id)),usedR=new Set(ctx.structureMatches.map(m=>m.runtimeNode.id));
    // Resolve one-to-one across batch boundaries before accepting any geometry.
    state.batches.flatMap(b=>b.acceptable||[]).sort((a,b)=>b.confidence-a.confidence).forEach(choice=>{
      const {pair,confidence,verdict,reason}=choice,d=pair.designNode,r=pair.runtimeNode;
      let code=verdict==='accept'?'accepted':verdict==='review'?'uncertain':'geometry-rejected';
      if(usedD.has(d.id)||usedR.has(r.id))code='candidate-conflict';
      state.decisions.push({designId:d.raw.id,runtimeId:r.raw.id,bucketId:pair.bucketId,confidence,status:code==='accepted'?'accepted':'unverified',code,reason});
      if(code!=='accepted') {
        mark(pair,code,code==='candidate-conflict'?'候选对象与已确认关系冲突':code==='geometry-rejected'?'对应关系未通过位置、尺寸或角色验证':'对应关系尚未可靠确认');return;
      }
      usedD.add(d.id);usedR.add(r.id);mark(pair,'accepted',reason);
      acceptedMatches.push({designNode:d,runtimeNode:r,score:150,basis:['已匹配筛选组件内的语义对应关系'],unique:true,source:'ai-semantic-pair',aiConfidence:confidence,aiReason:reason,
        designParentId:pair.parentPair.designNode.raw.id,runtimeParentId:pair.parentPair.runtimeNode.raw.id});
    });
    state.batches.forEach(batch=>{delete batch.acceptable;});
    if(acceptedMatches.length) {
      ctx.structureMatches.push(...acceptedMatches);
      const checks=current.checks,known=new Set(checks.map(c=>c.item+'|'+c.design+'|'+c.runtime));
      const measured=[...layoutPaddingChecks(ctx.structureMatches),...matchedSiblingSpacingChecks(ctx.structureMatches,ctx.designStructure,ctx.runtimeStructure)];
      measured.forEach(check=>{
        const key=check.item+'|'+check.design+'|'+check.runtime;if(known.has(key))return;
        known.add(key);check.source='ai-semantic-pair';checks.push(check);
      });
    }
  } catch(error) {
    state.error=safe(error.message);
  } finally {
    state.batches.forEach(batch=>{delete batch.acceptable;});
    state.running=false;
    if(isCurrent()) {
      // Every residual object remains represented, even if no candidate, no reply,
      // a rejected proposal or a failed request prevented matching it.
      currentSemanticCoverage(current,ctx,state,residual,candidatePairs,outcomes,acceptedMatches);
      state.completed=true;refreshInspectionSummary(current);
    }
  }
}

function currentSemanticCoverage(current,ctx,state,residual,candidates,outcomes,accepted) {
  const ids=side=>new Set(accepted.map(match=>match[side+'Node'].id));
  const acceptedD=ids('design'),acceptedR=ids('runtime');
  state.matches=accepted.map(m=>({designId:m.designNode.raw.id,runtimeId:m.runtimeNode.raw.id,basis:m.basis,
    designParentId:m.designParentId,runtimeParentId:m.runtimeParentId}));
  for(const side of ['design','runtime']) {
    const consumed=side==='design'?acceptedD:acceptedR;
    for(const node of residual?.[side+'Residual']||[]) {
      if(consumed.has(node.id))continue;
      const relevant=candidates.filter(pair=>pair[side+'Node']===node);
      const reasons=relevant.map(pair=>outcomes.get(JSON.stringify([pair.designNode.id,pair.runtimeNode.id]))).filter(Boolean);
      state.unresolved.push({side,[side+'Id']:node.raw.id,status:'unverified',
        code:reasons[0]?.code||'no-compatible-candidate',
        reason:state.error||state.connection||[...new Set(reasons.map(value=>value.reason))].join('；')||'对应筛选组件内没有通过几何预筛的候选对象',
        candidates:relevant.map(pair=>({designId:pair.designNode.raw.id,runtimeId:pair.runtimeNode.raw.id,...outcomes.get(JSON.stringify([pair.designNode.id,pair.runtimeNode.id]))}))});
    }
  }
  current.technical=current.technical||{};current.technical.structure=current.technical.structure||{matches:[]};
  current.technical.structure.matches=current.technical.structure.matches||[];
  current.technical.structure.matches.push(...state.matches);
  current.technical.structure.matched=ctx.structureMatches.length;
  current.technical.coverage=current.technical.coverage||{};
  current.technical.coverage.semantic={matched:state.matches.length,unresolved:state.unresolved.length,candidates:state.candidateCount};
}

function textInkLineChecks(matches) {
  const checks=[],seen=new Set();
  for(const match of matches) {
    const d=match.designNode.raw,r=match.runtimeNode.raw;
    if(d.type!=='TEXT'||!match.unique||scopeText(d)!==scopeText(r)||seen.has(d.id))continue;
    seen.add(d.id);
    const a=d.geometry?.textInk,b=r.geometry?.textInk;
    if(a?.status!=='measured'||b?.status!=='measured')continue;
    if(a.lines.length!==b.lines.length){
      checks.push({key:`ink-lines:${d.id}`,item:`${elementLabel(r,d)} · 可见文字行数`,property:'text.visible-lines',category:'layout',design:`${a.lines.length}行`,runtime:`${b.lines.length}行`,status:'different',judgment:'相同文字的可见换行不同',visual:{design:{nodeIds:[d.id],boxes:a.lines},runtime:{nodeIds:[r.id],boxes:b.lines}},measurementEvidence:{policy:'visible-text-ink-v1'}});
      continue;
    }
    if(a.lines.length<2)continue;
    for(let i=1;i<a.lines.length;i++) {
      const gap=ls=>rounded(ls[i].y-ls[i-1].y-ls[i-1].height),x=gap(a.lines),y=gap(b.lines);
      checks.push({key:`ink-line-gap:${d.id}:${i}`,item:`${elementLabel(r,d)} · 第${i}与${i+1}行可见间距`,property:'text.ink-line-gap',category:'layout',
        design:`${x}px`,runtime:`${y}px`,status:Math.abs(x-y)<=1.5?'same':'different',judgment:Math.abs(x-y)<=1.5?'一致':`前端${y>x?'多':'少'} ${rounded(Math.abs(y-x))}px`,
        visual:{design:{nodeIds:[d.id],boxes:a.lines.slice(i-1,i+1)},runtime:{nodeIds:[r.id],boxes:b.lines.slice(i-1,i+1)}},
        measurementEvidence:{metric:'visible-line-gap',policy:'visible-text-ink-v1',lineIndex:i,includesLineHeight:false,values:{design:x,runtime:y}}});
    }
  }return checks;
}

function prepareComparisonContext() {
  const scope = scopeAssessment();
  if (!scope) throw Error('请先选择前端组件并导入 Figma ZIP');
  if (scope.blocked) throw Error(`已停止走查：${scope.blockers.join('；')}`);

  const page = design.pages[$('#page').selectedIndex];
  const runtimeRoot = runtime._meta?.rootElement?.box || {};
  const designRaw = flatten(page);
  const runtimeRaw = runtime.elements || [];
  const designNodes = prepareNodes(designRaw, {width: page.width, height: page.height});
  const runtimeNodes = prepareNodes(runtimeRaw, runtimeRoot);
  const designRootIndex = Math.max(0, designNodes.findIndex(node => node.id === page.rootId || !node.parentId));
  const runtimeRootIndex = Math.max(0, runtimeNodes.findIndex(node => !node.parentId));
  if (!designNodes.length || !runtimeNodes.length) throw Error('选区中没有可比较节点');
  const designStructure = buildSemanticStructure(designNodes, 'design', designRootIndex, page.structure);
  const runtimeStructure = buildSemanticStructure(runtimeNodes, 'runtime', runtimeRootIndex, runtime.structure);
  const structureMatching = matchSemanticStructures(designStructure, runtimeStructure);
  let structureMatches = structureMatching.matches;
  // Bottom-Up 容器传播: 从已配后代向上传播, 补配 Top-Down 遗漏的 layout 容器。
  const bottomUpMatches = bottomUpPropagate(designStructure, runtimeStructure, structureMatches);
  structureMatches.push(...bottomUpMatches);
  const inspectionContext = typeof InspectionContracts !== 'undefined' ? InspectionContracts.makeContext(designNodes, runtimeNodes, {
    measure: layoutMeasurement, measureText: textLayoutMeasurement, contentGeometry: measureContentGeometry, edgesComparable: geometryEdgesComparable,
    resolveStyle: resolveVisualProperty, compareStyle, judgment,
    measureBackground: (d,r) => measureVisibleBackground(d,r,{designNodes,runtimeNodes})
  }) : null;
  if (inspectionContext) structureMatches = InspectionContracts.reconcile(inspectionContext, designStructure, runtimeStructure, structureMatches);

  return {scope,page,designNodes,runtimeNodes,designRootIndex,runtimeRootIndex,designStructure,runtimeStructure,structureMatching,structureMatches,inspectionContext};
}

function initializeComparisonDraft(context) {
  aiFallbackContext = context;
  backgroundMeasurements = {design:null,runtime:null};
  report = {kind:'ui-review-report',schemaVersion:'3.17.8',generatorVersion:REVIEW_RELEASE,createdAt:new Date().toISOString(),
    designPage:context.page.name,runtime:{title:runtime._meta?.title,url:runtime._meta?.url},scope:context.scope,
    checks:[],summary:{needsAdjustment:0,behavior:0,needsReview:0,consistent:0,uncovered:0},technical:{coverage:{}},pipeline:inspectionExecution,
    visuals:{design:designPreviews.get(context.page.nodeId || context.page.rootId || $('#page').selectedIndex) || null,runtime:null}};
}

function compare(prepared = null) {
  const previous = report;
  const context = prepared || prepareComparisonContext();
  const {scope,page,designNodes,runtimeNodes,designRootIndex,runtimeRootIndex,designStructure,runtimeStructure,structureMatching,inspectionContext} = context;
  let structureMatches = context.structureMatches;
  if (prepared && inspectionContext) {
    structureMatches = InspectionContracts.applyAcceptedPairs(inspectionContext,designStructure,runtimeStructure,structureMatches);
    context.structureMatches = structureMatches;
  }
  prepareImageSlotReview(context);
  // R1 影子对比: 并行跑递归锚定配对, 只做统计对比, 不接管配对/测量/展示。
  let shadowRecursive = null;
  try { shadowRecursive = recursiveShadowMatch(designStructure, runtimeStructure); } catch (e) { shadowRecursive = {error: String(e && e.message || e)}; }
  const matches = matchNodes(
    designNodes,
    runtimeNodes,
    designRootIndex,
    runtimeRootIndex,
    structureMatches,
    designStructure,
    runtimeStructure
  );

  const technicalResults = [];
  const checks = [];
  const comparedVisualOwners = new Set();
  const radiusOwnerPairs = resolveRadiusOwnerPairs(matches, designNodes, runtimeNodes);

  styleMeasurementMatches(matches, structureMatches, inspectionContext).forEach(match => {
    const designNode = designNodes[match.designIndex];
    const runtimeNode = runtimeNodes[match.runtimeIndex];
    if (!inspectionVisible(designNode) || !inspectionVisible(runtimeNode)) return;
    const designRole = nodeRole(designNode, 'design');
    const runtimeRole = nodeRole(runtimeNode, 'runtime');
    if (designRole === 'icon' || runtimeRole === 'icon') return;
    const contentDifferent = Boolean(designNode._text && runtimeNode._text && designNode._text !== runtimeNode._text);
    const diffs = [];
    const label = elementLabel(runtimeNode, designNode);

    if (contentDifferent) {
      diffs.push({property: 'text.direct', design: designNode.text?.direct, runtime: runtimeNode.text?.direct, category: 'content'});
    }
    if (!contentDifferent || inspectionContext && InspectionContracts.approvedIdentity(inspectionContext, designNode, runtimeNode)) {
      const properties = STYLE_PROPERTIES.filter(property => !/padding|gap|line-height/.test(property));

      properties.forEach(property => {
        if (!propertyEligibleForMatch(property, match, designNode, runtimeNode)) return;
        if (property==='background-color' && measureVisibleBackground(designNode,runtimeNode,context)) {
          const ownerKey=[property,designNode.id,runtimeNode.id].join('|');
          if(comparedVisualOwners.has(ownerKey))return;
          comparedVisualOwners.add(ownerKey);
          checks.push({key:ownerKey,item:`${label} · 可见背景`,property,status:'review',category:'style',
            judgment:'正在测量对应位置的可见背景',visual:visualTarget(designNode,runtimeNode)});
          return;
        }
        const radiusPair = property === 'border-radius' ? radiusOwnerPairs.get(match) : null;
        if (property === 'border-radius' && !radiusPair) return;
        const designProperty = radiusPair?.designProperty || resolveVisualProperty(designNode, 'design', property);
        const runtimeProperty = radiusPair?.runtimeProperty || resolveVisualProperty(runtimeNode, 'runtime', property);
        if (!designProperty.resolved || !runtimeProperty.resolved
          || designProperty.value == null || runtimeProperty.value == null) return;
        const ownerKey = [property, designProperty.node?.id, runtimeProperty.node?.id].join('|');
        if (comparedVisualOwners.has(ownerKey)) return;
        comparedVisualOwners.add(ownerKey);
        const comparison = compareStyle(
          property,
          designProperty.value,
          runtimeProperty.value,
          designProperty.styles,
          runtimeProperty.styles
        );
        const category = /padding|gap/.test(property) ? 'layout' : 'style';
        const unresolvedLineHeight = property === 'line-height'
          && (explicitLineHeight(designProperty.styles) == null || explicitLineHeight(runtimeProperty.styles) == null);
        checks.push({
          item: checkName(label, property),
          property,
          design: comparison.left.display,
          runtime: comparison.right.display,
          status: unresolvedLineHeight ? 'review' : comparison.same ? 'same' : /overflow/.test(property) ? 'behavior' : 'different',
          judgment: unresolvedLineHeight ? '行高未明确为可比较的像素值，需要确认实际排版' : judgment(property, comparison),
          category,
          matchBasis: [...(match.basis || []), ...(designProperty.evidence || []), ...(runtimeProperty.evidence || [])],
          propertyEvidence: ['font-weight', 'line-height'].includes(property) ? {
            design: {nodeId: designProperty.node.id, source: 'design-style', raw: designProperty.value,
              normalized: comparison.left.display},
            runtime: {nodeId: runtimeProperty.node.id, selector: runtimeProperty.node.selector,
              text: runtimeProperty.node.text?.direct, source: 'getComputedStyle', raw: runtimeProperty.value,
              normalized: comparison.right.display, captured: property === 'font-weight' ? runtimeProperty.node.styleEvidence?.fontWeight : undefined,
              captureTime: runtime.createdAt || null, contentVersion: runtime._meta?.contentVersion || null}
          } : undefined,
          visual: propertyVisualTarget(property, designProperty.node, runtimeProperty.node)
        });
        if (!comparison.same && !unresolvedLineHeight) diffs.push({property, design: comparison.left.display, runtime: comparison.right.display, category});
      });

      if (match.designIndex === designRootIndex && match.runtimeIndex === runtimeRootIndex) {
        ['width', 'height'].forEach(dimension => {
          const designValue = designNode._box[dimension] ?? (dimension === 'width' ? page.width : page.height);
          const runtimeValue = runtimeNode._box[dimension] ?? runtimeRoot[dimension];
          if (designValue == null || runtimeValue == null) return;
          const property = `box.local.${dimension}`;
          const same = Math.abs(designValue - runtimeValue) <= 1;
          const comparison = {
            same,
            left: {kind: 'number', value: designValue, unit: 'px'},
            right: {kind: 'number', value: runtimeValue, unit: 'px'}
          };
          checks.push({
            item: checkName(scope.label || '选中模块', property),
            property,
            design: `${designValue}px`,
            runtime: `${runtimeValue}px`,
            status: same ? 'same' : dimension === 'height' ? 'review' : 'different',
            judgment: same ? '一致' : dimension === 'height' ? '受内容与数据量影响' : judgment(property, comparison),
            category: 'layout',
            visual: visualTarget(designNode, runtimeNode)
          });
          if (!same) diffs.push({property, design: designValue, runtime: runtimeValue, category: 'style'});
        });
      }
    }

    technicalResults.push({
      type: contentDifferent ? 'content' : diffs.length ? 'style' : 'ok',
      score: Math.round(match.score),
      design: {name: designNode.name || designNode.type, text: designNode.text?.direct},
      runtime: {name: runtimeNode.selector || runtimeNode.tag, text: runtimeNode.text?.direct},
      diffs
    });
  });

  const paddingChecks = layoutPaddingChecks(structureMatches);
  const relationChecks = matchedSiblingSpacingChecks(structureMatches, designStructure, runtimeStructure);
  const tableRowChecks = tableRowStyleChecks(matches, designNodes, runtimeNodes);
  const uncoveredChecks = uncoveredRegionChecks(structureMatches, designStructure, runtimeStructure);
  checks.push(...paddingChecks);
  checks.push(...relationChecks);
  checks.push(...tableRowChecks);
  checks.push(...uncoveredChecks);

  // ── 表格 cell 旁路: 已配对的表格, 按网格位置(gridRow,gridCol)一一配对内部 cell, 喂给 padding 检测 ──
  // 背景: data-cell 内容数据驱动(不可当身份), structurePairScore 要求 areaKey 完全相同(含card号)才配,
  //   但两侧 card 号本就不同(设计card#14↔前端card#28)→ cell 逐对配不上; 归一化card号又会跨表错配。
  // 正解: cell 配对由"父表已配对"驱动——表格层配对成功后(card#14↔card#28), 在这对表内按 gridRow/gridCol
  //   一一配 cell(两侧几何重建/DOM都已标网格坐标), 构造成 structureMatches 同构格式喂 layoutPaddingChecks,
  //   复用其成熟的单元格padding 逻辑。安全: 只在已配对表内配, 网格位置锚定, 绝不跨表。
  try {
    const cellsUnder = (structure, tableNode) => {
      const out = [];
      const prefix = tableNode.areaKey + '/';
      (structure.nodes || []).forEach(nd => {
        if ((nd.role === 'head-cell' || nd.role === 'data-cell')
          && (nd.areaKey === tableNode.areaKey || nd.areaKey.startsWith(prefix))
          && nd.raw._gridRow != null && nd.raw._gridCol != null) out.push(nd);
      });
      return out;
    };
    const before = new Set(checks.map(c => (c.item || '') + '|' + (c.design || '') + '|' + (c.runtime || '')));
    const cellMatches = [];
    structureMatches.forEach(match => {
      if (!match.unique || match.designNode.role !== 'table' || match.runtimeNode.role !== 'table') return;
      const dCells = cellsUnder(designStructure, match.designNode);
      const rCells = cellsUnder(runtimeStructure, match.runtimeNode);
      if (!dCells.length || !rCells.length) return;
      const rByPos = new Map(rCells.map(c => [c.raw._gridRow + ',' + c.raw._gridCol, c]));
      dCells.forEach(dc => {
        const rc = rByPos.get(dc.raw._gridRow + ',' + dc.raw._gridCol);
        if (!rc || dc.role !== rc.role) return; // 网格位置对应 + 同为head/data-cell
        cellMatches.push({designNode: dc, runtimeNode: rc, unique: true, basis: ['表格网格位置'], source: 'table-cell'});
      });
    });
    if (cellMatches.length) {
      const merged = structureMatches.concat(cellMatches);
      layoutPaddingChecks(merged).forEach(chk => {
        const k = (chk.item || '') + '|' + (chk.design || '') + '|' + (chk.runtime || '');
        if (before.has(k)) return; // 只补新增(主检测已产出的不重复)
        chk.source = 'table-cell';
        checks.push(chk);
      });
    }
  } catch (e) { /* 表格cell旁路失败不影响主流程 */ }

  // ── 递归引擎配对接入间距检测(复刻 AI 语义配对范式: 合并→重算→只补新增) ──
  // 取阈值内配对(score<=THRESHOLD 0.30, 含指标卡坑位对这类正分对), 转成structureMatches 同构格式,
  // 合并后重跑 padding/sibling-spacing, 用 before去重【只补主引擎原本没测出的间距 check】, 不覆盖不污染。
  try {
    if (shadowRecursive && Array.isArray(shadowRecursive.rawPairs)) {
      const usedD = new Set(structureMatches.map(m => m.designNode?.rawIndex));
      const usedR = new Set(structureMatches.map(m => m.runtimeNode?.rawIndex));
      const recurMatches = [];
      // 表格内部的节点(areaKey 含 /table#): 【padding 照测】(顶/底/左右留白该报), 但【不进 gapBypass】
      //   ——gapBypass 会把表格单元格当普通卡片测横向/纵向间距, 表格不该出"模块内卡片间距"。
      //   所以这里保留表格内节点进recurMatches(供layoutPaddingChecks 测 padding),仅在下方 gapBypass 分组时排除。
      const inTable = node => /\/table#/.test(node?.areaKey || '');
      shadowRecursive.rawPairs
        .filter(p => p.score <= 0.30 && p.d && p.r)
        .forEach(p => {
          if (usedD.has(p.d.rawIndex) || usedR.has(p.r.rawIndex)) return; // 不与主引擎撞
          usedD.add(p.d.rawIndex); usedR.add(p.r.rawIndex);
          recurMatches.push({designNode: p.d, runtimeNode: p.r, score: 150,
            basis: ['递归配对'], unique: true, source: 'recursive-pair'});
        });
      if (recurMatches.length) {
        const merged = structureMatches.concat(recurMatches);
        const before = new Set(checks.map(c => (c.item || '') + '|' + (c.design || '') + '|' + (c.runtime || '')));
        const extraPadding = layoutPaddingChecks(merged);
        const extraRelation = matchedSiblingSpacingChecks(merged, designStructure, runtimeStructure);
        [...extraPadding, ...extraRelation].forEach(chk => {
          const k = (chk.item || '') + '|' + (chk.design || '') + '|' + (chk.runtime || '');
          if (before.has(k)) return; // 只补新增
          chk.source = 'recursive-pair';
          checks.push(chk);
        });
        // ── 递归卡对间距旁路 ──
        // 背景: matchedSiblingSpacingChecks 用【父的原始直接children +父direction】判兄弟。
        //   核心转化概览这类"第一层已配上的父", 其原始直接子是 container 壳分组、且前端 direction=none,
        //   → 上面重跑照样被 2870 行的方向/children关卡死, 补不出内部卡间距。
        // 解法(不碰主检测函数): 对递归配对的兄弟卡, 用它们扒壳后的 structure parent 分组, 直接按坐标算相邻间距,
        //   复刻投影相邻+走廊护栏。仅作用于 recurMatches, 完全不影响第一层。
        try {
          // 分组只按 designParent.id: 设计侧才是"同一模块内所有卡"的可靠依据。
          //   前端常把行/组分别包进不同 container(如行1在rs29、行2在rs55), 若按 dParent|rParent 分组
          //   会把同模块的两行拆开→纵向(行间)间距跨组算不出。只按 designParent 分组则10 张卡同组。
          const groups = new Map(); // key: dParentId -> [{d, r}]
          recurMatches.forEach(rm => {
            if (inTable(rm.designNode) || inTable(rm.runtimeNode)) return; // 表格内节点不当卡片测间距
            // 该旁路只负责“模块内卡片间距”，普通 text/button/icon 不能进入。
            // report86 曾把“整段提示文字↔查看”两个文本端点当卡片，产生 2px↔318.41px 假差异。
            if (!recursiveCardGapEligible(rm.designNode, rm.runtimeNode)) return;
            const dp = rm.designNode.parent;
            if (!dp || !rm.runtimeNode.parent) return;
            const key = dp.id;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({d: rm.designNode, r: rm.runtimeNode});
          });
          const gapBypass = (pairs) => {
            if (pairs.length < 2) return;
            // 横向(同行相邻卡)和纵向(同列相邻卡)都测: 对两个轴各跑一次。
            const measureAxis = (axis) => {
              const start = axis === 'horizontal' ? 'x' : 'y';
              const size = axis === 'horizontal' ? 'width' : 'height';
              const cross = axis === 'horizontal' ? 'y' : 'x';
              // 同一行/列(cross 坐标相近)才比, 避免跨行算横向间距(或跨列算纵向)。按 cross 分带。
              const bandKey = p => Math.round(p.d.raw._box[cross] / 10);
              const bands = new Map();
              pairs.forEach(p => { const b = bandKey(p); if (!bands.has(b)) bands.set(b, []); bands.get(b).push(p); });
              bands.forEach(band => {
                if (band.length < 2) return;
                const sorted = [...band].sort((a, b) => (a.d.raw._box[start] || 0) - (b.d.raw._box[start] || 0));
                for (let i = 1; i < sorted.length; i += 1) {
                  const bD = sorted[i - 1].d, aD = sorted[i].d, bR = sorted[i - 1].r, aR = sorted[i].r;
                  // 前端顺序须一致(不颠倒)
                  if ((aR.raw._box[start] || 0) <= (bR.raw._box[start] || 0)) continue;
                  const designGap = (aD.raw._box[start] || 0) - ((bD.raw._box[start] || 0) + (bD.raw._box[size] || 0));
                  const runtimeGap = (aR.raw._box[start] || 0) - ((bR.raw._box[start] || 0) + (bR.raw._box[size] || 0));
                  if (designGap < -1 || runtimeGap < -1) continue;
                  // 走廊护栏: 间隙内不能夹别的已配卡(band内相邻已保证, 但跨带的卡可能落入区间 -> 检查所有 pairs)
                  const gapStart = (bD.raw._box[start] || 0) + (bD.raw._box[size] || 0);
                  const gapEnd = aD.raw._box[start] || 0;
                  const dirty = pairs.some(p => {
                    if (p.d.id === bD.id || p.d.id === aD.id) return false;
                    if (Math.round(p.d.raw._box[cross] / 10) !== bandKey(sorted[i])) return false; // 只看同带
                    const cs = p.d.raw._box[start] || 0, ce = cs + (p.d.raw._box[size] || 0);
                    return Math.min(ce, gapEnd) - Math.max(cs, gapStart) > 2;
                  });
                  if (dirty) continue;
                  const property = `layout.${axis}-gap`;
                  const comparison = compareStyle(property, `${Math.max(0, designGap)}px`, `${Math.max(0, runtimeGap)}px`);
                  const dDisp = comparison.left.display, rDisp = comparison.right.display;
                  const item = `模块内卡片 · ${axis === 'horizontal' ? '横向' : '纵向'}间距`;
                  const k = item + '|' + dDisp + '|' + rDisp;
                  if (before.has(k)) continue;
                  before.add(k);
                  checks.push({
                    key: `recur-gap|${axis}|${bD.id}|${aD.id}`,
                    item,
                    property,
                    design: dDisp,
                    runtime: rDisp,
                    status: comparison.same ? 'same' : 'different',
                    judgment: comparison.same ? '模块内相邻卡片间距与设计一致'
                      : '模块内相邻卡片间距与设计不一致(仅比间距)',
                    category: 'layout',
                    source: 'recursive-pair',
                    visual: visualTarget([bD.raw, aD.raw], [bR.raw, aR.raw])
                  });
                }
              });
            };
            measureAxis('horizontal');
            measureAxis('vertical');
          };
          groups.forEach(pairs => gapBypass(pairs));
        } catch (e2) { /* 旁路失败不影响主流程 */ }
      }
    }
  } catch (e) { /* 接入失败不影响主流程 */ }

  // 数字两侧留白跨侧对比：无条件执行，不依赖 recurMatches。
  // 小选区可能只有主配对、recursivePairs=0；原来放在 if(recurMatches.length) 内会导致永远不执行。
  try {
    const numMatches = structureMatches.slice();
    if (shadowRecursive && Array.isArray(shadowRecursive.rawPairs)) {
      shadowRecursive.rawPairs.filter(p => p.score <= 0.30 && p.d && p.r).forEach(p => {
        numMatches.push({designNode: p.d, runtimeNode: p.r, unique: true});
      });
    }
    const seenNumeric = new Set(checks.map(c => (c.item || '') + '|' + (c.design || '') + '|' + (c.runtime || '')));
    numericSpacingChecks(numMatches, designStructure).forEach(chk => {
      const key = (chk.item || '') + '|' + (chk.design || '') + '|' + (chk.runtime || '');
      if (seenNumeric.has(key)) return;
      seenNumeric.add(key);
      checks.push(chk);
    });
  } catch (e) { /* 数字留白失败不影响主流程 */ }

  if (inspectionContext) checks.push(...InspectionContracts.propertyTasks(inspectionContext), ...InspectionContracts.relationChecks(inspectionContext));
  checks.push(...textInkLineChecks(structureMatches));
  const readableChecks = dedupeChecks(inspectionContext ? InspectionContracts.publish(inspectionContext, checks) : checks).map((check, index) => ({...check, id: `check-${index + 1}`}));
  const summary = {
    needsAdjustment: readableChecks.filter(check => check.status === 'different').length,
    behavior: readableChecks.filter(check => check.status === 'behavior').length,
    needsReview: readableChecks.filter(check => check.status === 'review').length,
    consistent: readableChecks.filter(check => check.status === 'same').length,
    uncovered: readableChecks.filter(check => check.status === 'uncovered').length,
    ignoredContent: technicalResults.filter(result => result.type === 'content').length,
    ignoredUnmatched: designNodes.length + runtimeNodes.length - matches.length * 2
  };

  report = {
    schemaVersion: '3.17.8',
    generatorVersion: REVIEW_RELEASE,
    kind: 'ui-review-report',
    createdAt: new Date().toISOString(),
    designPage: page.name,
    runtime: {title: runtime._meta?.title, url: runtime._meta?.url},
    scope,
    summary,
    checks: readableChecks,
    visuals: {
      design: designPreviews.get(page.nodeId || page.rootId || $('#page').selectedIndex) || null,
      runtime: null
    },
    technical: {
      visibility: visibilityCoverage(designNodes,runtimeNodes),
      captureState: runtime._meta?.captureState || null,
      inspection: inspectionContext ? InspectionContracts.summary(inspectionContext) : null,
      matched: matches.length,
      structure: {
        schemaVersion: '2.0.0',
        matched: structureMatches.length,
        ambiguous: structureMatching.ambiguous.length,
        designNodes: designStructure.nodes.length,
        runtimeNodes: runtimeStructure.nodes.length,
        templatesCollapsed: {
          design: designStructure.templatesCollapsed,
          runtime: runtimeStructure.templatesCollapsed
        },
        matches: structureMatches.map(match => ({
          designId: match.designNode.raw.id,
          runtimeId: match.runtimeNode.raw.id,
          designKey: match.designNode.structureKey,
          runtimeKey: match.runtimeNode.structureKey,
          basis: match.basis,
          score: Math.round(match.score)
        }))
      },
      shadowRecursive: shadowRecursive ? {
        groupKeyUnique: structureMatches.filter(m => m.unique).length,
        recursivePairs: shadowRecursive.pairs,
        recursiveDesignOnly: shadowRecursive.designOnly,
        recursiveRuntimeOnly: shadowRecursive.runtimeOnly,
        topPairs: shadowRecursive.topPairs,
        topDesignOnly: shadowRecursive.topDesignOnly,
        topRuntimeOnly: shadowRecursive.topRuntimeOnly,
        error: shadowRecursive.error
      } : null,
      coverage: {
        layout: readableChecks.filter(check => check.category === 'layout').length,
        visualAlignment: {status: 'not-measured', reason: '已采集文字字形边界；独立的文字与图标对齐关系尚未自动生成检查'},
        visualRelations: relationChecks.length,
        radiusOwners: radiusOwnerPairs.size,
        visualOwners: readableChecks.filter(check => check.matchBasis?.some(basis => /所有者|裁剪容器|视觉轮廓/.test(basis))).length
      },
      comparisonPolicy: {
        version: '3.17.8',
        executionOrder: 'collect-identify-measure-repair-icons-layout-publish',
        aiLayoutReview: 'automatic-collection-candidate-validation-v2',
        aiIconFallback: 'shared-slot-and-property-checks-v1',
        uncertainResultsHidden: true,
        crossRoleFallback: false,
        repeatedTableRows: 'first-template-only',
        spacing: 'visible-text-ink-v1',
        verticalTextBoundary: 'visible-glyph',
        horizontalTextBoundary: 'visible-glyph',
        lineHeight: 'diagnostic-only-visible-spacing-checked',
        visualAlignment: 'not-inferred-from-layout',
        uncertainGeometry: 'review',
        semanticScope: 'component-visible-outer-property-carrier-v2',
        cardDetection: 'visual-feature-v1',
        geometryHardConstraint: 'text-pos0.28,control-pos0.28-size0.45', cardDetection: 'visual-feature-v2.1-exclude-table-container', cardSizeGuard: 'width-ratio0.35', contentDepth: '24-deep-nested-table', runtimeCapture: 'prime-and-drift-correct-v1', crossUniqueAnchor: 'v1-region-only', backfillPass: 'dom-order-interval-fingerprint', stickyHandling: 'scroll-top+hide-overlay', radiusVisibleCarrier: 'runtime-only-v1', paddingContentBoundary: 'exclude-fill-background-v1', cardInnerTextMatch: 'v1-owner-mapped+weak-geo-guard', bgOwnerBoundary: 'stop-at-region-ancestor', tableCellTextCheck: 'head-data-cell-eligible',
        borderRadius: 'visual-owner-v1.1-visible-only'
      },
      results: technicalResults
    }
  };
  // The draft stays private until the orchestrator finishes all review stages.
  if (prepared && previous) {
    for (const key of ['visuals','pipeline','identityReview','captureDiagnostics']) if (previous[key]) report[key]=previous[key];
    if(previous.technical?.backgroundCapture)report.technical.backgroundCapture=previous.technical.backgroundCapture;
    report.technical.measurementCompletion=previous.technical?.measurementCompletion;
    report.technical.textInk=previous.technical?.textInk;
  }
  aiFallbackContext = {
    ...context, designNodes, runtimeNodes, designStructure, runtimeStructure, inspectionContext,
    structureMatches, checks: readableChecks, technicalResults, page,
    candidates: aiConfig.enabled ? collectAiIconCandidates(designStructure, runtimeStructure, structureMatches) : []
  };
  render();
}

async function prepareTextInkMeasurements() {
  const ctx=aiFallbackContext;
  if(!ctx) return;
  const stats={};
  for(const side of ['design','runtime']) {
    stats[side]=await TextInk.collect(ctx[side+'Nodes'],side,report.visuals?.[side]);
    const raw=side==='design'?flatten(ctx.page):runtime.elements||[];
    const byId=new Map(raw.map(n=>[n.id,n]));
    ctx[side+'Nodes'].forEach(n=>{if(n.geometry?.textInk&&byId.has(n.id))byId.get(n.id).geometry={...byId.get(n.id).geometry,textInk:n.geometry.textInk,...(n.geometry.numericSegments?{numericSegments:n.geometry.numericSegments}:{})};});
  }
  report.technical.textInk=stats;
  return stats;
}

async function prepareRuntimeMeasurements() {
  return {policy:'visible-text-ink-v1',requested:0,measured:0,unresolved:0,reason:'文字从本轮截图采集可见字形，无需还原行高框'};
}

async function collectLayoutReviewEvidence(current) {
  if(report!==current||!aiFallbackContext)return {diagnostics:{reason:'report-replaced'}};
  const nodes=aiFallbackContext.runtimeNodes,needed=new Set();
  const byId=new Map(nodes.map(n=>[n.id,n]));
  for(const check of current.checks.filter(c=>c.status==='review'&&/^layout[.]/.test(c.property||''))) {
    for(const id of check.visual?.runtime?.nodeIds||[]) {
      const node=byId.get(id);if(!node)continue;
      [node,...descendantNodes(node,10000)].forEach(n=>needed.add(n.id));
    }
  }
  const diagnostics={policy:'visible-text-ink-v1',source:'current-capture',requested:0};
  if(report!==current)return {diagnostics:{reason:'report-replaced'}};
  return {evidence:LayoutReview.buildEvidence(current,{design:aiFallbackContext.designNodes,runtime:nodes},layoutMeasurement,
    LayoutReview.identityEvidence(aiFallbackContext.inspectionContext,InspectionContracts)),diagnostics};
}

function updateCoverageLedger(current,ctx){
  if(!ctx)return;
  const ledger=[];
  for(const check of current.checks.filter(c=>c.category==='coverage'&&c.coverageNodeId)){
    const side=check.uncoveredSide==='设计'?'design':'runtime',node=ctx.maps[side].get(check.coverageNodeId);
    if(!node)continue;
    const contained=id=>{const n=ctx.maps[side].get(id);return n&&InspectionContracts.within(n,node);};
    const checked=current.checks.filter(c=>c!==check&&c.publication?.status==='validated'
      &&(c.visual?.[side]?.nodeIds||c.publication?.[side+'Ids']||[]).some(contained));
    const pending=current.checks.filter(c=>c!==check&&c.status==='review'
      &&c.visual?.[side]?.nodeIds?.some(contained));
    const properties=[...new Set(checked.map(c=>c.property))];
    const record={nodeId:node.id,side,status:checked.length?'partial':'unmatched',
      checkedProperties:properties,checkedIds:checked.map(c=>c.id||c.key),
      pendingIds:pending.map(c=>c.id||c.key),remaining:['component-correspondence','unverified-outer-and-relations']};
    check.coverage=record;
    check.item=check.item.replace(/ · (未纳入对比|部分检查未完成)$/,'')+(checked.length?' · 部分检查未完成':' · 未纳入对比');
    check.judgment=checked.length?`内部已完成 ${checked.length} 项检查；完整区域的对应关系与未验证的外框、间距仍需完成`
      :`${check.uncoveredSide}侧该区域尚未建立对应关系，未完成属性与间距检查`;
    ledger.push(record);
  }
  current.technical ||= {};
  current.technical.coverageLedger={partial:ledger.filter(x=>x.status==='partial').length,
    unmatched:ledger.filter(x=>x.status==='unmatched').length,regions:ledger};
}

function refreshInspectionSummary(current = report) {
  if(!current)return;
  updateCoverageLedger(current,aiFallbackContext?.inspectionContext);
  if(aiFallbackContext?.inspectionContext)current.technical.inspection=InspectionContracts.summary(aiFallbackContext.inspectionContext);
  const counts=status=>current.checks.filter(c=>c.status===status).length;
  current.summary={...current.summary,needsAdjustment:counts('different'),behavior:counts('behavior'),needsReview:counts('review'),consistent:counts('same'),uncovered:counts('uncovered')};
  const used=new Set();
  current.checks.forEach((check,index)=>{
    if(!check.id||used.has(check.id))check.id=`inspection-${index+1}-${String(check.key||check.property||'check').replace(/[^a-z0-9]/gi,'-')}`;
    used.add(check.id);
  });
  if(current.technical?.coverage)current.technical.coverage.layout=current.checks.filter(c=>c.category==='layout').length;
}

function prepareImageSlotReview(context) {
  if(!context||typeof ImageGroupReview==='undefined')return null;
  const ctx=context.inspectionContext;
  if(ctx)InspectionContracts.clearImageSlots(ctx);
  const pairs=ctx?[...ctx.pairs].map(([d,r])=>({design:ctx.maps.design.get(d),runtime:ctx.maps.runtime.get(r)})):context.structureMatches;
  const result=ImageGroupReview.review({design:context.designNodes,runtime:context.runtimeNodes,pairs});
  if(ctx){
    result.registration=InspectionContracts.registerImageSlots(ctx,result.slotPairs);
    const rejected=new Map(result.registration.rejected.map(p=>[p.designId,p.reason]));
    if(rejected.size){
      result.checks=result.checks.map(c=>{
        const reason=(c.visual?.design?.nodeIds||[]).map(id=>rejected.get(id)).find(Boolean);
        return reason?{...c,status:'review',design:'待确认',runtime:'待确认',judgment:reason,
          publication:{status:'pending',reason,reasonCode:'image-slot-registration-rejected'}}:c;
      });
      result.coverage=result.coverage.map(c=>{
        const reason=(c.designIds||[]).map(id=>rejected.get(id)).find(Boolean);
        return reason?{...c,status:'unverified',reason}:c;
      });
      result.summary.checked=result.coverage.filter(c=>c.status==='checked').length;
      result.summary.unverified=result.coverage.filter(c=>c.status==='unverified').length;
    }
  }
  context.imageGroupReview=result;
  return result;
}

function reviewImageGroups() {
  if(!report||!aiFallbackContext||typeof ImageGroupReview==='undefined')return;
  const result=aiFallbackContext.imageGroupReview||prepareImageSlotReview(aiFallbackContext);
  report.imageGroupReview=result;
  report.checks.push(...result.checks);
  report.technical.coverage.imageGroups=result.summary;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('截图读取失败'));
    image.src = source;
  });
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, {format: 'png'}, dataUrl => {
      const error = chrome.runtime.lastError;
      if (error || !dataUrl) reject(new Error(error?.message || '无法截取当前网页'));
      else resolve(dataUrl);
    });
  });
}

function capturePositions(size, viewportSize) {
  if (!(size > 0) || !(viewportSize > 1)) throw new Error('选区所在的滚动区域不可见，无法生成截图');
  if (size <= viewportSize) return [0];
  const step = Math.max(1, viewportSize - 2);
  const positions = [];
  for (let offset = 0; offset < size - viewportSize; offset += step) positions.push(rounded(offset));
  positions.push(rounded(size - viewportSize));
  return [...new Set(positions)];
}

// Measure coverage in the same output pixel grid used by the canvas. A subpixel
// CSS remainder is not a missing raster row; a real missing output pixel is.
function captureUncoveredRegions(rectangles, width, height, scale = 1) {
  const pixelWidth = Math.max(1, Math.round(width * scale));
  const pixelHeight = Math.max(1, Math.round(height * scale));
  const clamp = (n, max) => Math.max(0, Math.min(max, Math.round(n * scale)));
  const rects = rectangles.map(r => ({left: clamp(r.left, pixelWidth), right: clamp(r.right, pixelWidth),
    top: clamp(r.top, pixelHeight), bottom: clamp(r.bottom, pixelHeight)})).filter(r => r.right > r.left && r.bottom > r.top);
  const ys = [...new Set([0, pixelHeight, ...rects.flatMap(r => [r.top, r.bottom])])].sort((a,b) => a-b);
  const missing = [];
  for (let i = 0; i < ys.length - 1; i += 1) {
    const top = ys[i], bottom = ys[i + 1];
    const intervals = rects.filter(r => r.top <= top && r.bottom >= bottom).sort((a,b) => a.left-b.left);
    let covered = 0;
    const addGap = (left, right) => missing.push({left:left/scale, right:right/scale, top:top/scale, bottom:bottom/scale});
    for (const r of intervals) {
      if (r.left > covered) addGap(covered,r.left);
      covered = Math.max(covered,r.right);
    }
    if (covered < pixelWidth) addGap(covered,pixelWidth);
  }
  return missing;
}

function captureCoverageComplete(rectangles, width, height, scale = 1) {
  return captureUncoveredRegions(rectangles, width, height, scale).length === 0;
}

// Preserve already captured pixels. A later viewport must not paste its sticky
// navigation over content captured at its real document coordinates.
function uncoveredTilePieces(rect, covered) {
  let pieces=[rect];
  for(const c of covered)pieces=pieces.flatMap(p=>{
    const l=Math.max(p.left,c.left),t=Math.max(p.top,c.top),r=Math.min(p.right,c.right),b=Math.min(p.bottom,c.bottom);
    if(r<=l||b<=t)return [p];
    return [{left:p.left,top:p.top,right:p.right,bottom:t},{left:p.left,top:b,right:p.right,bottom:p.bottom},
      {left:p.left,top:t,right:l,bottom:b},{left:r,top:t,right:p.right,bottom:b}].filter(q=>q.right>q.left&&q.bottom>q.top);
  });
  return pieces;
}

async function captureRuntimePreview(onProgress = () => {}) {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id) throw new Error('找不到当前测试页面');
  if (runtime?._meta?.frame?.isTop === false) throw new Error('局部截图暂不支持 iframe 内的组件');
  const rootId = runtime?._meta?.rootElement?.id || runtime?.elements?.find(node => !node.parentId)?.id;
  // The picker/rebind is frame-specific. Every subsequent capture operation must use
  // that same frame; broadcasting allows unrelated iframes to answer 'root missing'.
  const frameId = runtime?._meta?.frame?.id ?? 0;
  const sendCapture = async message => {
    const entry = {type: message.type, tabId: tab.id, frameId, rootId};
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message, {frameId});
      entry.ok = Boolean(response?.ok);
      entry.code = response?.code || null;
      entry.error = response?.error || null;
      entry.context = response?.captureContext || null;
      entry.requested = {x: message.x ?? null, y: message.y ?? null};
      entry.geometry = response ? {root: response.root || response.rootViewport || null,
        clip: response.clip || null, viewport: response.viewport || null, tileViewport: response.tileViewport || null} : null;
      entry.captureState = response?.captureState || null;
      return response;
    } catch (error) {
      entry.ok = false;
      entry.code = 'CAPTURE_TRANSPORT_ERROR';
      entry.error = error.message;
      throw error;
    } finally {
      if (captureDiagnostics) captureDiagnostics.events.push(entry);
    }
  };
  const info = await sendCapture({type: 'CAPTURE_ROOT_INFO', rootId});
  if (!info?.ok) throw new Error(info?.error || '前端选区已失效，请刷新页面后重新选择');

  let overlaysHidden = false;
  try {
    let baseRoot = info.root;
    const plan = (root, captureInfo) => {
      const clip = captureInfo.tileViewport || captureInfo.viewport;
      const xs = capturePositions(root.width, clip.width);
      const ys = capturePositions(root.height, clip.height);
      const tiles = xs.flatMap(x => ys.map(y => ({x, y})));
      if (tiles.length > 32) throw new Error('选区过大，请选择更小的完整模块后生成局部图');
      return tiles;
    };
    let tiles = plan(baseRoot, info);
    const primed = await sendCapture({type: 'CAPTURE_PRIME', rootId, positions: tiles});
    if (!primed?.ok) throw new Error(primed?.error || '页面预热失败');
    baseRoot = primed.root;
    tiles = plan(baseRoot, primed);

    const maxPreviewDimension = 5000;
    const outputScale = Math.min(1, maxPreviewDimension / Math.max(baseRoot.width, baseRoot.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(baseRoot.width * outputScale));
    canvas.height = Math.max(1, Math.round(baseRoot.height * outputScale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const covered = [];
    const captureStates = [];
    const correctionTargets = new Set();

    await sendCapture({type: 'CAPTURE_HIDE_OVERLAYS', rootId}).catch(() => {});
    overlaysHidden = true;
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if(index===1)await sendCapture({type:'CAPTURE_HIDE_OVERLAYS',rootId,includeCapturedDescendants:true});
      onProgress(index + 1, tiles.length);
      const positioned = await sendCapture({type: 'CAPTURE_SCROLL', x: tile.x, y: tile.y, rootId});
      if (!positioned?.ok) throw new Error(positioned?.error || '网页滚动定位失败');
      captureStates.push(positioned.captureState);
      if(index>0 && typeof CaptureState!=='undefined'){
        const contentChanges=CaptureState.compare(runtime._meta?.captureState,positioned.captureState).differences
          .filter(d=>d.kind==='content-changed');
        if(contentChanges.length){
          if(captureDiagnostics)captureDiagnostics.contentChanges={tile:index,nodeIds:contentChanges.map(d=>d.nodeId)};
          throw new Error('采集状态变化：分块截图之间文字或图片内容已改变，正在重新采集');
        }
      }
      if(index===0 && typeof CaptureState!=='undefined') {
        const validation=CaptureState.compare(runtime._meta?.captureState,positioned.captureState);
        if(captureDiagnostics)captureDiagnostics.stateValidation=validation;
        if(validation.status==='mismatch')throw new Error('采集状态变化：截图与测量时的文字、图片、视口、内部滚动或固定元素位置不同，请重新采集');
      }
      if (index > 0) await wait(520);
      const screenshot = await captureVisibleTab(tab.windowId);
      const image = await loadImage(screenshot);
      const verified = await sendCapture({type: 'CAPTURE_POSITION', rootId});
      if (!verified?.ok) throw new Error(verified?.error || '前端选区已失效，请重新选择组件');
      if(typeof CaptureState!=='undefined' && CaptureState.compare(positioned.captureState,verified.captureState).status==='mismatch')
        throw new Error('采集状态变化：截图期间文字、图片、内部滚动或固定元素发生变化，请重新采集');
      const before = positioned.rootViewport;
      const after = verified.rootViewport;
      if (!before || !after || ['x', 'y', 'width', 'height'].some(key => Math.abs(before[key] - after[key]) > 2)) {
        throw new Error('截图期间页面布局发生变化，请重新采集');
      }
      const liveRoot = positioned.rootViewport;
      if (!liveRoot) throw new Error('前端选区已失效，请重新选择组件');
      if (Math.abs(liveRoot.width - baseRoot.width) > 2 || Math.abs(liveRoot.height - baseRoot.height) > 2) {
        throw new Error('截图期间页面布局发生变化，请重新采集');
      }
      const clip = positioned.clip;
      const actualViewport = positioned.viewport || info.viewport;
      const intersection = {
        left: Math.max(liveRoot.x, clip.left),
        top: Math.max(liveRoot.y, clip.top),
        right: Math.min(liveRoot.x + liveRoot.width, clip.right),
        bottom: Math.min(liveRoot.y + liveRoot.height, clip.bottom)
      };
      if (intersection.right > intersection.left && intersection.bottom > intersection.top) {
        const sourceScaleX = image.naturalWidth / actualViewport.width;
        const sourceScaleY = image.naturalHeight / actualViewport.height;
        const destination = {
          left: intersection.left - liveRoot.x,
          top: intersection.top - liveRoot.y,
          right: intersection.right - liveRoot.x,
          bottom: intersection.bottom - liveRoot.y
        };
        for(const piece of uncoveredTilePieces(destination,covered)) {
          context.drawImage(image,(piece.left+liveRoot.x)*sourceScaleX,(piece.top+liveRoot.y)*sourceScaleY,
            (piece.right-piece.left)*sourceScaleX,(piece.bottom-piece.top)*sourceScaleY,
            piece.left*outputScale,piece.top*outputScale,(piece.right-piece.left)*outputScale,(piece.bottom-piece.top)*outputScale);
        }
        covered.push(destination);
      }
      // Scrollports can change size while scrolling (sticky headers, nested panes).
      // Use measured gaps for a bounded repair pass instead of trusting the initial grid.
      if (index === tiles.length - 1) {
        const missing = captureUncoveredRegions(covered, baseRoot.width, baseRoot.height, outputScale);
        if (missing.length && correctionTargets.size < 8 && tiles.length < 40) {
          const gap = missing[0];
          const target = {x: rounded(gap.left), y: rounded(gap.top)};
          const key = `${target.x}:${target.y}`;
          if (!correctionTargets.has(key)) {
            correctionTargets.add(key);
            tiles.push(target);
          }
        }
      }
    }
    const missing = captureUncoveredRegions(covered, baseRoot.width, baseRoot.height, outputScale);
    if (captureDiagnostics) captureDiagnostics.coverage = {width:baseRoot.width, height:baseRoot.height,
      outputScale, rectangles:covered, missingRegions:missing, correctionCount:correctionTargets.size};
    if(captureDiagnostics && typeof CaptureState!=='undefined')captureDiagnostics.positionedElements=CaptureState.observe(captureStates);
    if (missing.length) {
      const first = missing[0];
      throw new Error(`截图仍有未覆盖区域（x=${rounded(first.left)}, y=${rounded(first.top)}, ${rounded(first.right-first.left)}×${rounded(first.bottom-first.top)}px），详细坐标已写入诊断记录`);
    }
    return {dataUrl: canvas.toDataURL('image/png'), width: baseRoot.width, height: baseRoot.height, scale: outputScale, stitchPolicy:'preserve-first-tile-v1'};
  } finally {
    if (overlaysHidden) await sendCapture({type: 'CAPTURE_RESTORE_OVERLAYS'}).catch(() => {});
    await sendCapture({type: 'CAPTURE_RESTORE_SCROLL', scroll: info.scroll}).catch(() => {});
  }
}

async function attachRuntimePreview() {
  if (!report) return;
  captureDiagnostics = {extensionVersion: chrome.runtime?.getManifest?.().version || 'unknown', startedAt: new Date().toISOString(), events: []};
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        report.visuals.runtime = await captureRuntimePreview((current, total) => {
          $('#status').textContent = `正在生成局部对比图（${current}/${total}）…`;
        });
        break;
      } catch (error) {
        if (attempt || !/选区已失效|布局发生变化|采集状态变化/.test(error.message)) throw error;
        $('#status').textContent = '页面已重绘，正在重新采集前端选区…';
        await rebindRuntimeSelection();
        const measurementCompletion=await prepareRuntimeMeasurements();
        if (typeof inspectionExecution !== 'undefined' && inspectionExecution?.status === 'running') initializeComparisonDraft(prepareComparisonContext());
        else compare();
        report.technical.measurementCompletion=measurementCompletion;
      }
    }
    $('#status').textContent = report.visuals.design ? '走查完成；点击报告项目查看局部对比图。' : '走查完成；前端截图已生成，Figma ZIP 缺少预览图。';
  } catch (error) {
    if (report) report.visuals.runtime = {error: error.message};
    $('#status').textContent = report ? runtimePreviewErrorStatus(error.message) : error.message;
  } finally {
    if (report) report.captureDiagnostics = captureDiagnostics;
  }
}

function runtimePreviewErrorStatus(message) {
  if (message === '局部截图暂不支持 iframe 内的组件') {
    return '走查完成；iframe 内组件已完成属性走查，暂不生成前端局部图。';
  }
  return `走查完成；局部图暂不可用：${message}`;
}

function unionBoxes(boxes) {
  const usable = (boxes || []).filter(box => box && box.width >= 0 && box.height >= 0);
  if (!usable.length) return null;
  const left = Math.min(...usable.map(box => box.x));
  const top = Math.min(...usable.map(box => box.y));
  const right = Math.max(...usable.map(box => box.x + box.width));
  const bottom = Math.max(...usable.map(box => box.y + box.height));
  return {x: left, y: top, width: right - left, height: bottom - top};
}

async function drawLocalPreview(canvas, source, boxes, contentBoxes = []) {
  if (!source?.dataUrl) throw new Error(source?.error || '缺少截图');
  const focus = unionBoxes([...(boxes || []), ...(contentBoxes || [])]);
  if (!focus) throw new Error('缺少定位坐标');
  const image = await loadImage(source.dataUrl);
  const rootWidth = number(source.width) || image.naturalWidth;
  const rootHeight = number(source.height) || image.naturalHeight;
  const padding = Math.max(24, Math.min(72, Math.max(focus.width, focus.height) * 0.32));
  const crop = {
    x: Math.max(0, focus.x - padding),
    y: Math.max(0, focus.y - padding),
    width: Math.min(rootWidth, focus.x + focus.width + padding) - Math.max(0, focus.x - padding),
    height: Math.min(rootHeight, focus.y + focus.height + padding) - Math.max(0, focus.y - padding)
  };
  canvas.width = 640;
  canvas.height = 420;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f5f6f8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const fit = Math.min((canvas.width - 20) / crop.width, (canvas.height - 20) / crop.height);
  const drawWidth = crop.width * fit;
  const drawHeight = crop.height * fit;
  const offsetX = (canvas.width - drawWidth) / 2;
  const offsetY = (canvas.height - drawHeight) / 2;
  const sourceScaleX = image.naturalWidth / rootWidth;
  const sourceScaleY = image.naturalHeight / rootHeight;
  context.drawImage(
    image,
    crop.x * sourceScaleX,
    crop.y * sourceScaleY,
    crop.width * sourceScaleX,
    crop.height * sourceScaleY,
    offsetX,
    offsetY,
    drawWidth,
    drawHeight
  );
  context.strokeStyle = '#f04438';
  context.lineWidth = 4;
  context.fillStyle = 'rgba(240,68,56,.10)';
  (boxes || []).forEach(box => {
    const x = offsetX + (box.x - crop.x) * fit;
    const y = offsetY + (box.y - crop.y) * fit;
    const width = Math.max(4, box.width * fit);
    const height = Math.max(4, box.height * fit);
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
  });
  context.strokeStyle = '#1677ff';
  context.lineWidth = 3;
  context.fillStyle = 'rgba(22,119,255,.08)';
  (contentBoxes || []).forEach(box => {
    const x = offsetX + (box.x - crop.x) * fit;
    const y = offsetY + (box.y - crop.y) * fit;
    const width = Math.max(4, box.width * fit);
    const height = Math.max(4, box.height * fit);
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
  });
}

async function openPreview(checkId) {
  const check = report?.checks?.find(item => item.id === checkId);
  if (!check) return;
  const modal = $('#previewModal');
  modal.hidden = false;
  $('#previewTitle').textContent = check.item;
  $('#previewValues').textContent = `Figma ${check.design} / 前端 ${check.runtime}${check.visual?.measurementSide ? ' · 红框为外框，蓝框为可见内容边界（文字按字形）' : ''}`;
  const sides = [
    {key: 'design', canvas: $('#previewDesign'), empty: $('#previewDesignEmpty')},
    {key: 'runtime', canvas: $('#previewRuntime'), empty: $('#previewRuntimeEmpty')}
  ];
  await Promise.all(sides.map(async side => {
    side.canvas.hidden = false;
    side.empty.hidden = true;
    try {
      await drawLocalPreview(
        side.canvas,
        report.visuals?.[side.key],
        check.visual?.[side.key]?.boxes,
        check.visual?.[side.key]?.contentBoxes
      );
    } catch (error) {
      side.canvas.hidden = true;
      side.empty.hidden = false;
      side.empty.textContent = side.key === 'design' && !report.visuals?.design
        ? 'Figma ZIP 缺少预览图，请用新版插件重新导出'
        : error.message;
    }
  }));
}

function inspectionCoverageHtml(current) {
  const icon=current.iconReview,records=icon?.coverage||[];
  const incomplete=records.filter(r=>r.status==='unverified'),unsupported=[...new Set(records.filter(r=>r.status==='unsupported').map(r=>r.reason))];
  const semantic=current.semanticReview?.unresolved||[];
  const auxiliary=current.technical?.coverage?.auxiliary||[];
  const text=current.technical?.measurementCompletion;
  const repair=current.targetedCompletion;
  const imageGroups=current.imageGroupReview?.summary;
  const visibility=current.technical?.visibility;
  const asymmetric=visibility?.asymmetric||[];
  return `<details class="inspection-coverage"><summary>检查范围与完成情况</summary><p>文字样式、背景色、圆角和布局关系按已对应对象检查；一致项与未完成项分别记录。</p>
    ${repair?`<p>局部补测：重新检查 ${repair.pixelRetries||0} 处文字边界，完成 ${repair.resolved||0} 项对象与测量补全；仍缺少可见证据的项目保留为未完成。</p>`:''}
    ${text?`<p>自动补测文字：完成 ${text.measured||0} / ${text.requested||0} 个文字节点。</p>`:''}
    ${icon?`<p>图标：${icon.matches.length} 个功能位置已对应；${incomplete.length} 项属性检查未完成。配对成功不计为问题。</p>`:''}
    ${imageGroups?`<p>图片区域：${imageGroups.checked} 组已核对尺寸和排列，${imageGroups.unverified} 组尚未确认对应模块。图片内容可能随数据变化，本项不比较图案。</p>`:''}
    ${visibility?`<p>本次按父容器的可见范围检查。范围外文字：Figma ${visibility.excluded.design.length} 处，前端 ${visibility.excluded.runtime.length} 处；未计为一致或样式检查失败。</p>`:''}
    ${asymmetric.length?`<p>存在单侧可见的同名内容候选：${esc([...new Set(asymmetric.map(a=>a.hidden.text))].join('、'))}。这些位置的可见范围或滚动状态不同，未作为已对应文字比较样式。</p>`:''}
    ${semantic.length?`<p>${semantic.length} 组组件对应关系尚未完成自动验证。</p>`:''}
    ${auxiliary.length?`<p>${auxiliary.length} 项附属内容检查未完成（如代码行号）；对应容器的布局测量独立记录。</p>`:''}
    ${unsupported.length?`<p>${esc(unsupported.join('；'))}。</p>`:''}
    <p>复杂背景仅比较标注的共同采样范围。字形视觉对齐和阴影的独立检查尚未覆盖；表格按首行模板检查。未覆盖内容不计为一致。</p></details>`;
}

function rowHtml(check) {
  const className = check.status === 'same' ? 'same' : check.status;
  const previewAttrs = check.visual ? ` data-check-id="${esc(check.id)}" tabindex="0"` : '';
  return `<tr class="${className}"${previewAttrs}><td><div class="${check.visual ? 'report-item' : ''}">${esc(check.item)}</div></td><td><code>${esc(check.design)}</code></td><td><code>${esc(check.runtime)}</code></td><td><span class="pill ${className}">${esc(check.judgment)}</span></td></tr>`;
}

function reportTable(checks) {
  return `<div class="table-wrap"><table><thead><tr><th>项目</th><th>Figma</th><th>前端</th><th>判断</th></tr></thead><tbody>${checks.map(rowHtml).join('')}</tbody></table></div>`;
}

function render() {
  if (!report) return;
  if (inspectionExecution?.status === 'running') {
    $('#summary').hidden=true;
    $('#results').innerHTML='<div class="result-note">正在完成自动走查，结果将在测量和复核结束后显示。</div>';
    $('#exports').hidden=true;
    $('#status').textContent=inspectionExecution.label || '正在走查…';
    return;
  }
  if(report.pipeline?.status==='failed'){
    $('#summary').hidden=true;$('#results').innerHTML=inspectionPublicationNotice(report);$('#exports').hidden=false;return;
  }
  const summary = report.summary;
  $('#summary').hidden = false;
  $('#summary').innerHTML = [
    ['需要调整', summary.needsAdjustment, 'bad'],
    ['行为差异', summary.behavior, 'warn'],
    ['检查未完成', summary.needsReview, 'muted-card'],
    ['一致', summary.consistent, 'good'],
    ['未覆盖', summary.uncovered || 0, 'muted-card']
  ].map(([label, value, className]) => `<div class="metric ${className}"><b>${value}</b>${label}</div>`).join('');

  const important = report.checks.filter(check => ['different','behavior'].includes(check.status));
  const pending = report.checks.filter(check => check.status === 'review');
  const consistent = report.checks.filter(check => check.status === 'same');
  const uncovered = report.checks.filter(check => check.status === 'uncovered');
  const coverage = report.technical?.coverage || {};
  $('#results').innerHTML = `
    <div class="result-note">布局检查 ${coverage.layout || 0} 项；图片区域 ${coverage.imageGroups?.checked || 0} 组。点击项目可查看对应的局部对比图。</div>
    ${inspectionPublicationNotice(report)}
    ${typeof layoutReviewSection === 'function' ? layoutReviewSection(report.layoutReview) : ''}${typeof inspectionReviewSection === 'function' ? inspectionReviewSection(report.inspectionReview) : ''}
    <h2>需要调整</h2>
    ${important.length ? reportTable(important) : '<div class="empty">已完成的检查中未发现需调整项。</div>'}
    ${pending.length ? `<details><summary>自动检查未完成（${pending.length}）</summary>${reportTable(pending)}</details>` : ''}
    ${inspectionCoverageHtml(report)}
    <details><summary>查看一致项（${consistent.length}）</summary>${consistent.length ? reportTable(consistent) : '<div class="empty">暂无可确认的一致项。</div>'}</details>
    <details><summary>未覆盖区域（${uncovered.length}）· 因结构差异未纳入对比</summary>${uncovered.length ? reportTable(uncovered) : '<div class="empty">本次所有可识别区域均已纳入对比。</div>'}</details>`;
  $('#exports').hidden = false;
  if (report.visuals?.runtime?.dataUrl && report.visuals?.design?.dataUrl) $('#status').textContent = '走查完成；点击报告项目查看局部对比图。';
  else if (report.visuals?.runtime?.dataUrl) $('#status').textContent = '走查完成；Figma ZIP 缺少预览图，请重新导出。';
  else if (report.visuals?.runtime?.error) $('#status').textContent = runtimePreviewErrorStatus(report.visuals.runtime.error);
  else $('#status').textContent = '走查完成；正在生成局部对比图…';
  if (report.inspectionReview) $('#status').textContent = report.inspectionReview.completed ? '走查完成；对象与状态复核结果已更新' : '正在复核组件对象与状态…';
  else if (report.layoutReview) $('#status').textContent = report.layoutReview.status;
  if(report.pipeline) $('#status').textContent=report.pipeline.status==='complete'
    ?(report.technical?.disabledStages?.finalAdjudication?'走查完成；两轮配对与程序测量已结束':'走查完成；测量与复核已结束')
    :report.pipeline.status==='failed'?`走查中断：${report.pipeline.error?.message || '执行失败'}；可导出 Runtime 诊断`:'走查已结束；部分检查未完成，详见报告';
}

function inspectionPublicationNotice(current) {
  if (!current?.pipeline) return '';
  const p=current.pipeline;
  const experiment=current.technical?.disabledStages?.finalAdjudication?'本次采用两轮配对后统一测量，测量后的 AI 复核已关闭。':'';
  if(p.status==='complete'&&!experiment)return '';
  const status=p.status==='complete'?'':p.status==='failed'?'本次走查中断，不能作为完整走查结论。':p.status==='running'?'走查进行中，尚未发布结论。':'本次为部分完成的报告；未完成检查不计入一致。';
  return `<div class="result-note">${esc([status,experiment].filter(Boolean).join(' '))}${p.error?` ${esc(p.error.message)}`:''}</div>`;
}

function standaloneHtml() {
  const important = report.checks.filter(check => ['different','behavior'].includes(check.status));
  const pending = report.checks.filter(check => check.status === 'review');
  const consistent = report.checks.filter(check => check.status === 'same');
  const uncovered = report.checks.filter(check => check.status === 'uncovered');
  const metric = (label, value, className) => `<div class="metric ${className}"><b>${value}</b>${label}</div>`;
  const exportRow = check => {
    const className = check.status === 'same' ? 'same' : check.status;
    const hasVisual = Boolean(check.visual);
    const main = `<tr class="${className}" data-row-id="${esc(check.id)}"><td><span class="item-name" contenteditable="true" spellcheck="false">${esc(check.item)}</span></td><td><code>${esc(check.design)}</code></td><td><code>${esc(check.runtime)}</code></td><td><span class="pill ${className}">${esc(check.judgment)}</span></td><td class="col-op"><button class="row-del" title="删除此项" aria-label="删除此项" data-del="${esc(check.id)}">×</button></td></tr>`;
    if (!hasVisual) return main;
    const valsHint = check.visual && check.visual.measurementSide ? ' · 红框为外框，蓝框为可见内容边界（文字按字形）' : '';
    const preview = `<tr class="preview-row" data-preview-for="${esc(check.id)}"><td colspan="5"><details open data-check-id="${esc(check.id)}"><summary>局部对比图</summary><div class="inline-vals">Figma ${esc(check.design)} / 前端 ${esc(check.runtime)}${valsHint}</div><div class="inline-grid"><figure><figcaption>Figma</figcaption><canvas data-canvas="${esc(check.id)}-design"></canvas><div class="inline-empty" data-empty="${esc(check.id)}-design" hidden></div></figure><figure><figcaption>前端</figcaption><canvas data-canvas="${esc(check.id)}-runtime"></canvas><div class="inline-empty" data-empty="${esc(check.id)}-runtime" hidden></div></figure></div></details></td></tr>`;
    return main + preview;
  };
  const table = checks => `<div class="table-wrap"><table><thead><tr><th>项目</th><th>Figma</th><th>前端</th><th>判断</th><th class="col-op"></th></tr></thead><tbody>${checks.map(exportRow).join('')}</tbody></table></div>`;
  const scope = report.scope;
  const coverage = report.technical?.coverage || {};
  const scopeHtml = `<div class="scope"><div><small>Figma</small><b>${esc(scope.figma.title || scope.figma.name)}</b><span>${esc(`${scope.figma.width} × ${scope.figma.height}px · ${scope.figma.nodes} 个节点`)}</span></div><div><small>前端</small><b>${esc(scope.frontend.title || scope.frontend.name)}</b><span>${esc(`${scope.frontend.width} × ${scope.frontend.height}px · ${scope.frontend.nodes} 个节点`)}</span></div></div>`;
  const previewData = JSON.stringify({checks: report.checks, visuals: report.visuals}).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI 走查报告</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#1f2329;font:14px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}.page{max-width:1080px;margin:0 auto;padding:40px 24px 64px}h1{font-size:28px;margin:0 0 4px}.meta{color:#646a73;margin-bottom:24px}.scope{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.scope>div{display:grid;gap:3px;padding:14px;border:1px solid #e5e6eb;border-radius:10px;background:#fff}.scope small,.scope span{color:#646a73}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:20px 0 30px}.metric{padding:18px;border-radius:12px;background:#fff;border:1px solid #e5e6eb}.metric b{display:block;font-size:28px;line-height:1.2}.bad b{color:#d92d20}.warn b{color:#dc6803}.good b{color:#16803c}.muted-card b{color:#576b95}.note{padding:12px 16px;border-radius:9px;background:#edf4ff;color:#345a9c;margin:0 0 24px}h2{font-size:18px;margin:26px 0 10px}.table-wrap{overflow:auto;border:1px solid #e5e6eb;border-radius:12px;background:#fff}table{width:100%;border-collapse:collapse;min-width:680px}th,td{padding:13px 16px;border-bottom:1px solid #eceef1;text-align:left;vertical-align:top}th{background:#fafbfc;color:#646a73;font-weight:600}tr:last-child td{border-bottom:0}tr[data-check-id]{cursor:pointer}tr[data-check-id]:hover td{background:#f4f7ff}tr[data-check-id]:focus{outline:2px solid #6555df;outline-offset:-2px}.report-item{display:flex;justify-content:space-between;gap:8px}.report-item:after{content:'查看局部图';color:#6555df;font-size:12px;white-space:nowrap}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#30343b}.pill{display:inline-block;padding:2px 8px;border-radius:99px;background:#f2f3f5}.pill.different{background:#ffebe9;color:#b42318}.pill.behavior{background:#fff3e0;color:#9a5b00}.pill.review{background:#edf4ff;color:#345a9c}.pill.same{background:#e9f7ef;color:#16803c}.pill.uncovered{background:#f2f3f5;color:#646a73}tr.uncovered td{background:#fafbfc}details{margin-top:24px}summary{cursor:pointer;font-weight:600}.empty{padding:24px;background:#fff;border:1px solid #e5e6eb;border-radius:12px;color:#646a73}.preview-modal{position:fixed;z-index:20;inset:0;display:grid;place-items:center;padding:20px;background:rgba(20,22,28,.52)}.preview-modal[hidden]{display:none}.preview-panel{width:min(1080px,100%);max-height:calc(100vh - 40px);overflow:auto;border-radius:14px;background:#fff;box-shadow:0 18px 60px rgba(0,0,0,.3)}.preview-head{position:sticky;z-index:2;top:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 18px;border-bottom:1px solid #e5e6eb;background:#fff}.preview-head>div{display:grid}.preview-head span{color:#646a73}.preview-head button{width:34px;height:34px;border:0;border-radius:8px;background:#f2f3f5;font-size:24px;cursor:pointer}.preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:18px}.preview-grid figure{min-width:0;margin:0}.preview-grid figcaption{margin-bottom:7px;font-weight:700}.preview-grid canvas{display:block;width:100%;height:360px;border:1px solid #e5e6eb;border-radius:10px;background:#f5f6f8}.preview-empty{display:grid;place-items:center;height:360px;padding:24px;border:1px dashed #d0d3d8;border-radius:10px;color:#646a73;text-align:center;background:#fafafa}@media(max-width:720px){.summary,.scope,.preview-grid{grid-template-columns:1fr}.page{padding:24px 14px}.preview-grid canvas,.preview-empty{height:260px}}h1[contenteditable]{outline:none;border-radius:6px;padding:2px 6px;margin-left:-6px;transition:background .15s}h1[contenteditable]:hover{background:#eef0f3}h1[contenteditable]:focus{background:#fff;box-shadow:0 0 0 2px #6555df}h1[contenteditable]:empty:before{content:'请输入项目名称';color:#a8adb5}.item-name{display:inline-block;min-width:40px;outline:none;border-radius:5px;padding:1px 5px;margin-left:-5px;transition:background .12s}.item-name:hover{background:#eef0f3}.item-name:focus{background:#fff;box-shadow:0 0 0 2px #6555df}.toolbar{display:flex;justify-content:flex-end;margin-bottom:8px}#exportNow{border:0;border-radius:8px;background:#6555df;color:#fff;font-size:13px;font-weight:500;padding:8px 16px;cursor:pointer}#exportNow:hover{background:#5646c9}#exportNow:active{transform:translateY(1px)}#exportNow.done{background:#16803c}.title-hint{font-size:12px;color:#a8adb5;margin:2px 0 20px}th.col-op,td.col-op{width:44px;text-align:center}.row-del{width:26px;height:26px;border:0;border-radius:6px;background:#f2f3f5;color:#8a9099;font-size:16px;line-height:1;cursor:pointer;padding:0}.row-del:hover{background:#ffebe9;color:#d92d20}tr.preview-row>td{padding:0 16px 14px;background:#fbfcfd}tr.preview-row[hidden]{display:none}tr.preview-row details{margin:0}tr.preview-row summary{list-style:none;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:#6555df;padding:6px 0;user-select:none}tr.preview-row summary::-webkit-details-marker{display:none}tr.preview-row summary:before{content:'▾';font-size:10px;transition:transform .15s}tr.preview-row details:not([open]) summary:before{transform:rotate(-90deg)}.inline-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:4px 0 6px}.inline-grid figure{min-width:0;margin:0}.inline-grid figcaption{margin-bottom:6px;font-size:12px;font-weight:600;color:#646a73}.inline-grid canvas{display:block;width:100%;height:300px;border:1px solid #e5e6eb;border-radius:10px;background:#f5f6f8}.inline-grid canvas[hidden]{display:none}.inline-empty{display:grid;place-items:center;height:300px;padding:16px;border:1px dashed #d0d3d8;border-radius:10px;color:#646a73;text-align:center;background:#fafafa;font-size:12px}.inline-empty[hidden]{display:none}.inline-vals{font-size:12px;color:#646a73;padding:2px 0 8px}@media(max-width:720px){.inline-grid{grid-template-columns:1fr}.inline-grid canvas,.inline-empty{height:220px}}
  </style></head><body><main class="page"><div class="toolbar"><button id="exportNow" type="button">导出当前报告</button></div><h1 contenteditable="true" spellcheck="false">${esc(report.designPage || 'UI 走查报告')}</h1><div class="title-hint">点击标题可编辑项目名称</div><div class="meta">${esc(new Date(report.createdAt).toLocaleString('zh-CN'))}</div>${scopeHtml}${inspectionPublicationNotice(report)}<div class="summary">${metric('需要调整', report.summary.needsAdjustment, 'bad')}${metric('行为差异', report.summary.behavior, 'warn')}${metric('检查未完成', report.summary.needsReview, 'muted-card')}${metric('一致', report.summary.consistent, 'good')}${metric('未覆盖', report.summary.uncovered || 0, 'muted-card')}</div><div class="note">已生成 ${coverage.layout || 0} 条布局检查，核对 ${coverage.imageGroups?.checked || 0} 组图片区域。展开项目可查看局部对比图。</div>${typeof layoutReviewSection === 'function' ? layoutReviewSection(report.layoutReview) : ''}${typeof inspectionReviewSection === 'function' ? inspectionReviewSection(report.inspectionReview) : ''}<h2>需要调整</h2>${important.length ? table(important) : '<div class="empty">已完成的检查中未发现需调整项。</div>'}${pending.length ? `<details><summary>自动检查未完成（${pending.length}）</summary>${table(pending)}</details>` : ''}${inspectionCoverageHtml(report)}<details><summary>查看一致项（${consistent.length}）</summary>${consistent.length ? table(consistent) : '<div class="empty">暂无可确认的一致项。</div>'}</details><details><summary>未覆盖区域（${uncovered.length}）· 因结构差异未纳入对比</summary>${uncovered.length ? table(uncovered) : '<div class="empty">本次所有可识别区域均已纳入对比。</div>'}</details></main><script>
  const previewData=${previewData};
  const imageFrom=source=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('截图读取失败'));image.src=source});
  const union=boxes=>{if(!boxes||!boxes.length)return null;const left=Math.min(...boxes.map(box=>box.x));const top=Math.min(...boxes.map(box=>box.y));const right=Math.max(...boxes.map(box=>box.x+box.width));const bottom=Math.max(...boxes.map(box=>box.y+box.height));return{x:left,y:top,width:right-left,height:bottom-top}};
  async function draw(canvas,source,boxes,contentBoxes){if(!source||!source.dataUrl)throw new Error(source&&source.error||'缺少截图');const focus=union([...(boxes||[]),...(contentBoxes||[])]);if(!focus)throw new Error('缺少定位坐标');const image=await imageFrom(source.dataUrl);const rootWidth=Number(source.width)||image.naturalWidth;const rootHeight=Number(source.height)||image.naturalHeight;const padding=Math.max(24,Math.min(72,Math.max(focus.width,focus.height)*.32));const x=Math.max(0,focus.x-padding);const y=Math.max(0,focus.y-padding);const crop={x,y,width:Math.min(rootWidth,focus.x+focus.width+padding)-x,height:Math.min(rootHeight,focus.y+focus.height+padding)-y};canvas.width=800;canvas.height=520;const context=canvas.getContext('2d');context.fillStyle='#f5f6f8';context.fillRect(0,0,canvas.width,canvas.height);const fit=Math.min((canvas.width-24)/crop.width,(canvas.height-24)/crop.height);const width=crop.width*fit;const height=crop.height*fit;const offsetX=(canvas.width-width)/2;const offsetY=(canvas.height-height)/2;const sx=image.naturalWidth/rootWidth;const sy=image.naturalHeight/rootHeight;context.drawImage(image,crop.x*sx,crop.y*sy,crop.width*sx,crop.height*sy,offsetX,offsetY,width,height);context.strokeStyle='#f04438';context.fillStyle='rgba(240,68,56,.10)';context.lineWidth=4;(boxes||[]).forEach(box=>{const bx=offsetX+(box.x-crop.x)*fit;const by=offsetY+(box.y-crop.y)*fit;const bw=Math.max(4,box.width*fit);const bh=Math.max(4,box.height*fit);context.fillRect(bx,by,bw,bh);context.strokeRect(bx,by,bw,bh)});context.strokeStyle='#1677ff';context.fillStyle='rgba(22,119,255,.08)';context.lineWidth=3;(contentBoxes||[]).forEach(box=>{const bx=offsetX+(box.x-crop.x)*fit;const by=offsetY+(box.y-crop.y)*fit;const bw=Math.max(4,box.width*fit);const bh=Math.max(4,box.height*fit);context.fillRect(bx,by,bw,bh);context.strokeRect(bx,by,bw,bh)})}
  async function renderInline(check){const both=[['design','Design'],['runtime','Runtime']];for(const[key]of both){const canvas=document.querySelector('[data-canvas="'+check.id+'-'+key+'"]');const empty=document.querySelector('[data-empty="'+check.id+'-'+key+'"]');if(!canvas)continue;const vis=check.visual&&check.visual[key];try{await draw(canvas,previewData.visuals&&previewData.visuals[key],vis&&vis.boxes,vis&&vis.contentBoxes);canvas.hidden=false;empty.hidden=true}catch(error){canvas.hidden=true;empty.hidden=false;empty.textContent=key==='design'&&!(previewData.visuals&&previewData.visuals.design)?'Figma ZIP 缺少预览图，请用新版插件重新导出':error.message}}}
  function renderAllInline(){(previewData.checks||[]).forEach(check=>{if(check.visual&&document.querySelector('[data-preview-for="'+check.id+'"]'))renderInline(check)})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderAllInline);else renderAllInline();
  document.addEventListener('click',event=>{const del=event.target.closest&&event.target.closest('[data-del]');if(del){const id=del.getAttribute('data-del');const main=document.querySelector('[data-row-id="'+id+'"]');const prev=document.querySelector('[data-preview-for="'+id+'"]');if(main)main.remove();if(prev)prev.remove()}});
  (function(){var btn=document.getElementById('exportNow');if(!btn)return;btn.addEventListener('click',function(){var clone=document.documentElement.cloneNode(true);var cb=clone.querySelector('#exportNow');if(cb&&cb.classList)cb.classList.remove('done');clone.querySelectorAll('canvas').forEach(function(c){c.removeAttribute('width');c.removeAttribute('height')});var title=(document.querySelector('h1')&&document.querySelector('h1').textContent||'ui-review-report').trim().replace(/[\\/:*?"<>|]/g,'_').slice(0,60)||'ui-review-report';var html='<!doctype html>'+clone.outerHTML;var blob=new Blob([html],{type:'text/html'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=title+'.html';document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(url)},5000);var old=btn.textContent;btn.textContent='已导出 ✓';btn.classList.add('done');setTimeout(function(){btn.textContent=old;btn.classList.remove('done')},1800)})})();
  </script></body></html>`;
}

function download(name, type, data) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  chrome.downloads.download({url, filename: name, saveAs: true}, () => setTimeout(() => URL.revokeObjectURL(url), 5000));
}

function scopeMeta(item) {
  const size = item.width != null && item.height != null ? `${item.width} × ${item.height}px` : '尺寸未知';
  return `${size} · ${item.nodes} 个节点`;
}

function renderScopePreview() {
  const scope = scopeAssessment();
  $('#scope').hidden = !scope;
  if (!scope) return null;
  $('#scopeFigmaName').textContent = scope.figma.title || scope.figma.name;
  $('#scopeFigmaMeta').textContent = scopeMeta(scope.figma);
  $('#scopeRuntimeName').textContent = scope.frontend.title || scope.frontend.name;
  $('#scopeRuntimeMeta').textContent = scopeMeta(scope.frontend);
  const badge = $('#scopeBadge');
  const message = $('#scopeMessage');
  badge.className = 'scope-badge';
  message.className = 'scope-message';
  if (scope.blocked) {
    badge.textContent = '范围不一致';
    badge.classList.add('blocked');
    message.textContent = `已停止：${scope.blockers.join('；')}`;
    message.classList.add('blocked');
  } else if (scope.warnings.length) {
    badge.textContent = '范围可比';
    badge.classList.add('warning');
    message.textContent = scope.warnings.join('；');
  } else {
    badge.textContent = '范围一致';
    message.textContent = '两边模块层级基本一致，可以开始走查。';
  }
  return scope;
}

function runtimeRootFingerprint() {
  const rootId = runtime?._meta?.rootElement?.id || runtime?.elements?.find(node => !node.parentId)?.id;
  const rootNode = runtime?.elements?.find(node => node.id === rootId) || runtime?.elements?.find(node => !node.parentId) || {};
  const rootMeta = runtime?._meta?.rootElement || {};
  return {
    rootId,
    selector: rootMeta.selector || rootNode.selector || '',
    reviewId: rootMeta.reviewId || rootNode.reviewId || null,
    tag: rootMeta.tag || rootNode.tag || '',
    role: rootMeta.role || rootNode.role || null,
    ariaLabel: rootMeta.ariaLabel || rootNode.ariaLabel || null,
    title: rootMeta.title || rootNode.title || null,
    text: rootMeta.text || rootNode.text || {direct: '', descendant: ''},
    box: rootMeta.box || rootNode.box?.local || {},
    frameId: runtime?._meta?.frame?.id ?? (runtime?._meta?.frame?.isTop === true ? 0 : null),
    url: runtime?._meta?.url || ''
  };
}

async function sendRebindMessage(tabId, fingerprint) {
  const message = {type: 'REBIND_CAPTURE_ROOT', fingerprint};
  const frameId = fingerprint.frameId !== null && fingerprint.frameId !== undefined && Number.isInteger(Number(fingerprint.frameId))
    ? Number(fingerprint.frameId)
    : 0;
  const options = {frameId};
  let response = null;
  try {
    response = await chrome.tabs.sendMessage(tabId, message, options);
  } catch (_error) {
    response = null;
  }
  if (response?.runtime?._meta?.contentVersion === '3.3.6') return response;
  const target = {tabId, frameIds: [frameId]};
  await chrome.scripting.executeScript({target, files: ['content.js']});
  await wait(40);
  return chrome.tabs.sendMessage(tabId, message, options);
}

async function invalidateRuntimeSelection(message) {
  runtime = null;
  report = null;
  await chrome.storage.local.remove('uiReviewRuntime');
  $('#picked').textContent = '选区已失效，请重新选择';
  $('#summary').hidden = true;
  $('#results').innerHTML = '';
  $('#exports').hidden = true;
  $('#scope').hidden = true;
  $('#status').textContent = message;
  ready();
}

async function rebindRuntimeSelection() {
  if (!runtime) throw new Error('请先选择前端组件');
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('当前页面不支持重新绑定前端选区');
  const fingerprint = runtimeRootFingerprint();
  if (runtime._meta?.frame?.isTop === false && fingerprint.frameId == null) {
    throw new Error('当前 iframe 选区来自旧版本，请重新选择一次组件以记录 frameId');
  }
  try {
    if (runtime._meta?.frame?.isTop !== false) {
      const previousUrl = new URL(fingerprint.url || tab.url);
      const currentUrl = new URL(tab.url);
      if (previousUrl.origin !== currentUrl.origin || previousUrl.pathname !== currentUrl.pathname) {
        throw new Error('当前页面与选择组件时的页面不同，请重新选择组件');
      }
    }
    const response = await sendRebindMessage(tab.id, fingerprint);
    if (!response?.ok || !response.runtime) throw new Error(response?.error || '无法重新绑定前端选区');
    runtime = response.runtime;
    await chrome.storage.local.set({uiReviewRuntime: runtime});
    $('#picked').textContent = runtime._meta?.rootElement?.selector || '已重新绑定组件';
    renderScopePreview();
    return response;
  } catch (error) {
    await invalidateRuntimeSelection(error.message);
    throw error;
  }
}

function ready() {
  const scope = renderScopePreview();
  $('#compare').disabled = !(design && runtime) || Boolean(scope?.blocked);
  if (scope?.blocked) $('#status').textContent = '请重新选择同一层级的 Figma 模块或前端组件。';
  else if (scope) $('#status').textContent = scope.warnings.length ? '范围可比；报告会把高度差标记为需要确认。' : '范围确认完成，可以开始走查。';
}

chrome.storage.local.get('uiReviewRuntime', stored => {
  runtime = stored.uiReviewRuntime || null;
  if (runtime) $('#picked').textContent = runtime._meta?.rootElement?.selector || '已选组件';
  ready();
});

// Jev credentials are held by the local service, never by page scripts or report exports.
const aiConfig = {enabled: true, provider: 'jev', configured: false, apiKey: '', model: 'jev-1.13.0'};
function syncAiConfigFromUI() {
  aiConfig.enabled = true;
}
async function refreshJevConnection() {
  if(aiConfig.provider!=='jev')return;
  const label=$('#aiConnection'),modelEl=$('#aiModel');
  try{
    const connection=await JevClient.health();
    aiConfig.configured=connection.configured===true;
    aiConfig.model=connection.model||'jev-1.13.0';
    aiConfig.connectionError=aiConfig.configured?'':'本机 Jev 服务尚未配置密钥';
  }catch(error){
    aiConfig.configured=false;
    aiConfig.connectionError=JevClient.sanitizeError(error.message);
  }
  if(modelEl)modelEl.value=aiConfig.model;
  if(label)label.textContent=aiConfig.configured?'Jev 已连接，开始走查时自动使用':aiConfig.connectionError;
  return {provider:'jev',model:aiConfig.model,configured:aiConfig.configured,error:aiConfig.connectionError};
}
function bindAiConnectionTest() {
  const btn=$('#aiTest'),out=$('#aiTestResult');
  if(!btn||!out)return;
  const show=(cls,text)=>{out.hidden=false;out.className='ai-test-result '+cls;out.textContent=text;};
  btn.onclick=async()=>{
    btn.disabled=true;show('','正在测试 Jev 配对接口…');
    try{
      await refreshJevConnection();
      if(!aiConfig.configured)throw Error(aiConfig.connectionError||'本机 Jev 服务未连接');
      const result=await JevClient.request({cfg:{provider:'jev',configured:true,model:aiConfig.model},totalMs:15000,
        state:{target:{role:'button',text:'保存'},candidates:{save:{role:'button',text:'保存'},cancel:{role:'button',text:'取消'}}},
        questions:{connection:{type:'choice',instructions:'Which candidate corresponds to the target Save button? Choose no_match if neither corresponds. The Chinese label 保存 means Save and 取消 means Cancel.',criteria:{save:'The Save button in state.candidates.save',cancel:'The Cancel button in state.candidates.cancel',no_match:'Neither candidate corresponds'}}}});
      if(result.value.answers?.connection?.choice!=='save')throw Error('接口返回成功，但配对测试未通过');
      show('ok',`Jev 连接成功 · ${result.model} · ${(result.diagnostics.elapsedMs/1000).toFixed(1)} 秒。配对接口已验证。`);
    }catch(error){show('err',`Jev 测试未通过：${JevClient.sanitizeError(error.message)}`);}
    finally{btn.disabled=false;}
  };
}
bindAiConnectionTest();
void refreshJevConnection();

$('#pick').onclick = async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  try {
    const sessionId = `picker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await chrome.storage.local.set({uiReviewPickerSession: {id: sessionId, active: true, at: Date.now()}});
    const frames = await chrome.webNavigation.getAllFrames({tabId: tab.id});
    const results = await Promise.allSettled(frames.map(frame => chrome.tabs.sendMessage(tab.id, {type: 'START_PICKER', sessionId, frameId: frame.frameId}, {frameId: frame.frameId})));
    if (!results.some(result => result.status === 'fulfilled')) throw Error('no supported frame');
    window.close();
  } catch {
    await chrome.storage.local.set({uiReviewPickerSession: {active: false, at: Date.now()}});
    $('#status').textContent = '当前页面不支持选择；请刷新 http/https 测试页面后重试。';
  }
};

$('#zip').onchange = async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = zip.file('design.json') || Object.values(zip.files).find(item => /(^|\/)design\.json$/i.test(item.name));
    if (!entry) throw Error('ZIP 中没有 design.json');
    design = JSON.parse(await entry.async('string'));
    if (!Array.isArray(design.pages)) throw Error('design.json 缺少 pages');
    designPreviews = new Map();
    for (let index = 0; index < design.pages.length; index += 1) {
      const page = design.pages[index];
      const previewPath = page.preview?.path || `previews/page-${String(index + 1).padStart(3, '0')}.png`;
      const previewEntry = zip.file(previewPath) || Object.values(zip.files).find(item => item.name.endsWith(`/${previewPath}`));
      if (!previewEntry) continue;
      const preview = {
        dataUrl: `data:image/png;base64,${await previewEntry.async('base64')}`,
        width: number(page.width) || number(page.preview?.width),
        height: number(page.height) || number(page.preview?.height),
        scale: number(page.preview?.scale) || 1,
        path: previewPath
      };
      designPreviews.set(page.nodeId || page.rootId || index, preview);
    }
    $('#zipName').textContent = file.name;
    $('#page').innerHTML = design.pages.map(page => `<option>${esc(page.name)}</option>`).join('');
    $('#page').hidden = design.pages.length < 2;
    ready();
  } catch (error) {
    design = null;
    designPreviews = new Map();
    $('#status').textContent = error.message;
    ready();
  }
};

$('#page').onchange = () => {
  report = null;
  $('#summary').hidden = true;
  $('#results').innerHTML = '';
  $('#exports').hidden = true;
  ready();
};

$('#compare').onclick = async () => {
  if (inspectionExecution?.status === 'running') return;
  inspectionExecution={version:'3.17.8',status:'running',phase:'collect',stages:[],startedAt:new Date().toISOString()};
  report=null;aiFallbackContext=null;
  const step=async(phase,label,work)=>{
    inspectionExecution.phase=phase;inspectionExecution.label=label;
    const record={phase,status:'running',startedAt:new Date().toISOString()};inspectionExecution.stages.push(record);
    $('#status').textContent=label;
    try {
      const result=await work();
      const phaseStatus=phase==='identify'?report?.identityReview?.status:phase==='verify'?report?.inspectionReview?.status:phase==='repair'?report?.targetedCompletion?.status:null;
      record.status=phaseStatus==='partial'?'partial':'complete';return result;
    }
    catch(error){record.status='failed';throw error;}
    finally {record.finishedAt=new Date().toISOString();}
  };
  const skip=(phase,reason)=>inspectionExecution.stages.push({phase,status:'skipped',reason});
  try {
    for(const id of ['compare','html','json','zip','page','pick']) $('#'+id).disabled=true;
    $('#summary').hidden=true;$('#results').innerHTML='';$('#exports').hidden=true;
    syncAiConfigFromUI();await refreshJevConnection();aiConfig.requestSession=(aiConfig.provider==='jev'?JevClient:KimiClient).createSession(InspectionReview.routing.LIMITS);
    await step('collect','正在采集选区、文字布局和截图…',async()=>{
      await rebindRuntimeSelection();
      const measurementCompletion=await prepareRuntimeMeasurements();
      initializeComparisonDraft(prepareComparisonContext());
      report.technical.measurementCompletion=measurementCompletion;
      await attachRuntimePreview();
      await prepareTextInkMeasurements();
      await prepareBackgroundMeasurements();
    });
    if(REVIEW_STAGE_POLICY.identityReview)await step('identify','正在验证对应对象，自动复核有歧义的范围…',runInspectionIdentity);
    else skip('identify','本轮对照测试已禁用 AI 身份歧义处理');
    await step('measure','正在按已确认对象测量样式与间距…',async()=>compare(aiFallbackContext));
    await step('repair','正在补齐测量中发现的局部证据…',runTargetedCompletion);
    await step('icons','正在核对图标对象与样式…',aiIconFallback);
    await step('layout','正在补测复杂排版…',runLayoutReview);
    prepareImageSlotReview(aiFallbackContext);
    if(REVIEW_STAGE_POLICY.finalAdjudication)await step('verify','正在复核差异、校正对象并复测…',runInspectionAdjudication);
    else {
      skip('verify','两轮配对方案跳过测量后的 AI 复核，发布前仅做程序校验');
      const ctx=aiFallbackContext?.inspectionContext;
      if(ctx){
        InspectionReview.routing.identities(ctx);
        report.checks=InspectionReview.routing.routeChecks(ctx,InspectionContracts.publish(ctx,report.checks));
        report.technical.routing=InspectionReview.routing.summary(ctx);
      }
    }
    await step('image-groups','正在核对图片区域的尺寸和排列…',reviewImageGroups);
    refreshInspectionSummary();
    report.technical.modelConnection={provider:aiConfig.provider||'kimi',model:aiConfig.model,configured:aiConfig.provider==='jev'?aiConfig.configured:Boolean(aiConfig.apiKey),capabilities:{structuredMatching:true,images:aiConfig.provider!=='jev'},error:aiConfig.connectionError||null};
    report.technical.disabledStages={identityReview:!REVIEW_STAGE_POLICY.identityReview,finalAdjudication:!REVIEW_STAGE_POLICY.finalAdjudication};
    report.technical.requestBudget=aiConfig.requestSession?.budget?{...aiConfig.requestSession.budget,fingerprints:undefined}:null;
    if(aiConfig.requestSession.blocked)report.aiRequestStop={reason:aiConfig.requestSession.blocked.message,diagnostics:aiConfig.requestSession.blocked.diagnostics};
    const incomplete=report.checks.some(c=>['review','uncovered'].includes(c.status))
      || (REVIEW_STAGE_POLICY.identityReview&&report.identityReview?.status!=='complete')
      || (REVIEW_STAGE_POLICY.finalAdjudication&&report.inspectionReview?.status!=='complete');
    inspectionExecution.status=incomplete?'partial':'complete';inspectionExecution.phase='published';
    inspectionExecution.finishedAt=new Date().toISOString();
    render();
  } catch (error) {
    inspectionExecution.status='failed';inspectionExecution.finishedAt=new Date().toISOString();
    inspectionExecution.error=(aiConfig.provider==='jev'?JevClient:KimiClient).errorDetails(error,aiConfig.apiKey);
    if(report){report.pipeline=inspectionExecution;render();$('#exports').hidden=false;}
    $('#status').textContent=`走查中断：${inspectionExecution.error.message}；可导出 Runtime 诊断`;
  } finally {
    const exportable=Boolean(report)&&['complete','partial'].includes(inspectionExecution.status);
    $('#html').disabled=$('#json').disabled=!exportable;
    for(const id of ['zip','page','pick']) $('#'+id).disabled=false;
    $('#compare').disabled=Boolean(scopeAssessment()?.blocked)||!(design&&runtime);
  }
};

$('#results').addEventListener('click', event => {
  const row = event.target.closest?.('tr[data-check-id]');
  if (row) void openPreview(row.dataset.checkId);
});

$('#results').addEventListener('keydown', event => {
  const row = event.target.closest?.('tr[data-check-id]');
  if (row && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    void openPreview(row.dataset.checkId);
  }
});

$('#previewClose').onclick = () => { $('#previewModal').hidden = true; };
$('#previewModal').onclick = event => {
  if (event.target === $('#previewModal')) $('#previewModal').hidden = true;
};

$('#json').onclick = () => {if(inspectionExecution && !['complete','partial'].includes(inspectionExecution.status))return;download('ui-review-report.json', 'application/json', JSON.stringify(report, null, 2));};
$('#html').onclick = () => {if(inspectionExecution && !['complete','partial'].includes(inspectionExecution.status))return;download('ui-review-report.html', 'text/html', standaloneHtml());};
$('#runtime').onclick = () => {
  if (!runtime) {
    $('#status').textContent = '请先选择前端组件后再导出 Runtime。';
    return;
  }
  const page = design?.pages?.[$('#page').selectedIndex] || null;
  const designPage = page
    ? {name: page.name, width: page.width, height: page.height, rootId: page.rootId, nodeId: page.nodeId, elements: page.elements, structure: page.structure}
    : null;
  const bundle = {
    kind: 'ui-review-debug-bundle',
    exportedAt: new Date().toISOString(),
    captureDiagnostics,
    runtime,
    designPage,
    pipeline: report?.pipeline || inspectionExecution,
    identityReview: report?.identityReview || null,
    inspectionReview: report?.inspectionReview || null,
    layoutReviewEvidence: report?.layoutReview?.evidence || null
  };
  download('ui-review-runtime.json', 'application/json', JSON.stringify(bundle));
};
