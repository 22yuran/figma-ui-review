(() => {
  const CONTENT_VERSION = '3.3.14';
  if (window.__UI_REVIEW_PICKER_VERSION__ === CONTENT_VERSION) return;
  window.__UI_REVIEW_PICKER_VERSION__ = CONTENT_VERSION;
  window.__UI_REVIEW_PICKER__ = true;

  const STYLE_PROPS = [
    'font-family','font-size','font-weight','font-style','font-variation-settings','font-synthesis','vertical-align','writing-mode','line-height','letter-spacing','text-align','white-space','overflow-wrap','word-break','text-overflow',
    'color','background-color','background-image','background-clip','-webkit-background-clip','-webkit-text-fill-color','background-origin','background-size','background-position','background-repeat','opacity','box-shadow','text-shadow','filter','clip-path','box-sizing','width','height','min-width','min-height','max-width','max-height',
    'margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-right-width','border-bottom-width','border-left-width',
    'border-top-color','border-right-color','border-bottom-color','border-left-color','border-top-style','border-right-style','border-bottom-style','border-left-style',
    'border-radius','border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius','display','visibility','content-visibility','position','top','right','bottom','left','z-index','isolation','mix-blend-mode','background-blend-mode','overflow-x','overflow-y','object-fit','aspect-ratio',
    'flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','justify-content','align-items','align-content','align-self','gap','row-gap','column-gap','order','grid-template-columns','grid-template-rows','transform','cursor',
    'fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','mask-image','-webkit-mask-image'
  ];
  const IGNORED_TAGS = new Set(['SCRIPT','STYLE','META','LINK','NOSCRIPT','TEMPLATE']);
  const VECTOR_TAGS = new Set(['svg','path','use','g','circle','ellipse','rect','line','polyline','polygon']);
  const VECTOR_STYLE_PROPS = new Set(['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin']);
  let capturedElements = new Map();
  let capturedBoxes = new Map();
  let capturedInlineSnapshots = new WeakMap();
  let capturedRootId = null;
  let capturedFrameId = window === window.top ? 0 : null;
  const round = n => Math.round(n * 100) / 100;
  const validFrameId = value => value !== null && value !== undefined && Number.isInteger(Number(value));
  const text = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const directText = el => text([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));
  // textContent includes CSS, scripts and hidden variants inside an otherwise
  // visible component. Identity evidence must describe what is rendered.
  const visibleText = (element, cache = new WeakMap()) => {
    const visit = node => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (cache.has(node)) return cache.get(node);
      if (IGNORED_TAGS.has(node.tagName)) return '';
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) return '';
      const ownTextVisible = !['hidden','collapse'].includes(style.visibility);
      const parts = [];
      for (const child of [...node.childNodes, ...[...(node.shadowRoot?.childNodes || [])]]) {
        if (parts.join(' ').length >= 300) break;
        if (child.nodeType === Node.TEXT_NODE && !ownTextVisible) continue;
        const part = visit(child);
        if (part) parts.push(part);
      }
      const value = parts.join(' ').slice(0, 300);
      cache.set(node, value);
      return value;
    };
    return text(visit(element));
  };
  const composedParent = el => el.parentElement || (el.getRootNode?.() instanceof ShadowRoot ? el.getRootNode().host : null);
  const selector = el => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${CSS.escape(el.id)}` : '';
    const classes = [...el.classList].slice(0, 3).map(x => `.${CSS.escape(x)}`).join('');
    return `${tag}${id}${classes}`;
  };
  const localBox = (rect, rootRect) => ({
    x: round(rect.left - rootRect.left),
    y: round(rect.top - rootRect.top),
    width: round(rect.width),
    height: round(rect.height)
  });
  const directTextBoxes = (el, rootRect) => {
    const boxes = [];
    [...el.childNodes].forEach(node => {
      if (node.nodeType !== Node.TEXT_NODE || !String(node.textContent || '').trim()) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      [...range.getClientRects()].forEach(rect => {
        if (rect.width > 0 && rect.height > 0 && boxes.length < 24) boxes.push({...localBox(rect, rootRect), source: 'range', boxKind: 'text-fragment'});
      });
      range.detach?.();
    });
    return boxes;
  };
  // The gradient positioning box belongs to the painted element, which can be
  // an ancestor of the direct text run. Keep it separate from the Range box.
  function textPaintEvidence(el, root, rootRect, ids) {
    const ownStyle = getComputedStyle(el);
    const foreground = ownStyle.getPropertyValue('-webkit-text-fill-color') || ownStyle.color;
    for (let owner = el; owner; owner = composedParent(owner)) {
      const style = owner === el ? ownStyle : getComputedStyle(owner);
      const clip = style.getPropertyValue('background-clip') || style.getPropertyValue('-webkit-background-clip');
      const css = style.getPropertyValue('background-image');
      if (String(clip).split(',').some(value => value.trim() === 'text') && /gradient\(/i.test(css)) {
        const origin = style.getPropertyValue('background-origin') || 'padding-box';
        const size = style.getPropertyValue('background-size') || 'auto';
        const position = style.getPropertyValue('background-position') || '0% 0%';
        const paintBox = localBox(owner.getBoundingClientRect(), rootRect);
        const px = key => parseFloat(style.getPropertyValue(key)) || 0;
        if (origin === 'padding-box' || origin === 'content-box') {
          const left = px('border-left-width'), top = px('border-top-width');
          paintBox.x += left; paintBox.y += top;
          paintBox.width -= left + px('border-right-width'); paintBox.height -= top + px('border-bottom-width');
        }
        if (origin === 'content-box') {
          const left = px('padding-left'), top = px('padding-top');
          paintBox.x += left; paintBox.y += top;
          paintBox.width -= left + px('padding-right'); paintBox.height -= top + px('padding-bottom');
        }
        const supportedPositioning = ['border-box', 'padding-box', 'content-box'].includes(origin)
          && /^(auto(?: auto)?|100% 100%)$/.test(size)
          && /^(0% 0%|0px 0px|50% 50%)$/.test(position)
          && style.transform === 'none';
        return {kind: 'css-gradient', css, clip: 'text', foregroundColor: foreground,
          source: 'css-background-clip-text', ownerNodeId: ids.get(owner) || null,
          box: Object.fromEntries(Object.entries(paintBox).map(([key,value]) => [key, round(value)])),
          backgroundOrigin: origin, backgroundSize: size, backgroundPosition: position,
          status: supportedPositioning ? 'captured' : 'unresolved',
          ...(!supportedPositioning ? {reason: 'unsupported-gradient-positioning'} : {})};
      }
      if (owner === root) break;
    }
    return null;
  }
  const inlineSnapshot = (el, style) => JSON.stringify([
    [...el.childNodes].map(n=>n.nodeType===Node.TEXT_NODE?['text',n.textContent]:[n.nodeType,n.nodeName]),
    [...STYLE_PROPS,'font-kerning','font-feature-settings','font-optical-sizing','font-stretch','font-variant',
      'font-variant-ligatures','font-variant-caps','font-variant-numeric','word-spacing','tab-size','text-transform',
      'text-indent','text-align-last','direction','unicode-bidi','zoom','text-box-trim','text-combine-upright']
      .map(key=>style.getPropertyValue(key))
  ]);
  // Resolve the layout contribution of an inline text run, not the containing line box.
  // A same-font browser probe calibrates Range metrics; a full local context clone
  // must reproduce the live fragments before the calibrated offsets can be trusted.
  function measureTextRunLayout(rootId, nodeIds) {
    const root = capturedElements.get(rootId || capturedRootId);
    if (!root?.isConnected) throw Error('补测选区已失效，请重新选择组件');
    if (!Array.isArray(nodeIds) || nodeIds.length > 48) throw Error('文字补测节点范围无效');
    const rootRect = root.getBoundingClientRect();
    const fontState = {status: document.fonts?.status || 'unavailable', ready: document.fonts?.status === 'loaded'};
    const close = (a,b,tolerance=.35) => a && b && ['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<=tolerance);
    const rawRect = r => ({x:r.left,y:r.top,width:r.width,height:r.height});
    const sameRects = (a,b,dx,dy) => a.length===b.length && a.every((r,i)=>close(rawRect(r),{...rawRect(b[i]),x:b[i].left+dx,y:b[i].top+dy}));
    const merge = boxes => {
      if(!boxes.length)return null;
      const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
      return {x:round(x),y:round(y),width:round(Math.max(...boxes.map(b=>b.x+b.width))-x),height:round(Math.max(...boxes.map(b=>b.y+b.height))-y)};
    };
    const ranges = node => {const range=document.createRange();range.selectNodeContents(node);return [...range.getClientRects()].filter(r=>r.width>0&&r.height>0);};
    const output=[];
    for(const nodeId of [...new Set(nodeIds)]) {
      const el=capturedElements.get(nodeId), originalBox=el?.isConnected?localBox(el.getBoundingClientRect(),rootRect):null;
      const result={nodeId,originalBox,capturedBox:capturedBoxes.get(nodeId)||null,status:'unresolved',reason:'',geometry:{}};
      const data={version:'1.0.0',status:'unresolved',source:'calibrated-inline-runs',coordinateSpace:'selection-local-css-px',
        axes:{horizontal:'text-fragment',vertical:'text-fragment'},axisSources:{horizontal:'range-advance-width',vertical:'unresolved-inline-layout'},fontState,runs:[],fragments:[],validation:{verified:false}};
      result.geometry.textRunLayout=data;
      let host;
      try {
        if(!el?.isConnected || !(root===el||root.contains(el)))throw Error('补测文字节点已脱离选区');
        const textChildren=[...el.childNodes].map((node,childIndex)=>({node,childIndex})).filter(x=>x.node.nodeType===Node.TEXT_NODE&&x.node.textContent.length);
        // Preserve the source evidence even when this layout needs a later measurement strategy.
        data.runs=textChildren.map(({node,childIndex})=>({childIndex,text:node.textContent,start:0,end:node.textContent.length,
          fragments:ranges(node).map(r=>localBox(r,rootRect))}));
        if(capturedInlineSnapshots.get(el)!==inlineSnapshot(el,getComputedStyle(el)))throw Error('采集后文字内容或样式已变化，不能复用原报告证据');
        if(!close(localBox(rootRect,rootRect),capturedBoxes.get(rootId||capturedRootId),.5))throw Error('采集后选区尺寸已变化，不能复用原报告坐标');
        if(!close(originalBox,result.capturedBox,.5))throw Error('采集后文字布局已变化，不能复用原报告坐标');
        if(!fontState.ready)throw Error('字体尚未加载完成，无法校准文字度量');
        const cs=getComputedStyle(el),lineHeight=parseFloat(cs.lineHeight);
        if(cs.display!=='inline'||!Number.isFinite(lineHeight)||!cs.lineHeight.endsWith('px')||lineHeight<=0)throw Error('仅支持显式行高的普通行内文字');
        if(!textChildren.length||[...el.children].some(n=>getComputedStyle(n).display!=='none'))throw Error('需要完整直接文字 run，不能用父容器代替');
        if(textChildren.reduce((n,x)=>n+x.node.textContent.length,0)>1200)throw Error('单个文字 run 超出补测预算');
        let owner=el;
        while(owner&&getComputedStyle(owner).display==='inline')owner=composedParent(owner);
        if(!owner||!['block','flow-root'].includes(getComputedStyle(owner).display))throw Error('尚不支持此文字格式化上下文');
        const originals=[owner,...owner.querySelectorAll('*')];
        if(originals.length>100||(owner.textContent||'').length>4000)throw Error('局部行内上下文超出补测预算');
        const unsafe=originals.find(n=>{
          const s=getComputedStyle(n),display=s.display;
          if(display==='none'||s.visibility==='hidden')return false;
          return (n!==owner&&display!=='inline')||s.writingMode!=='horizontal-tb'||s.direction!=='ltr'
            || !['normal','isolate'].includes(s.unicodeBidi) || s.verticalAlign!=='baseline'
            || s.transform!=='none'||s.position!=='static'||s.float!=='none'||s.textTransform!=='none'
            || s.textShadow!=='none'||s.filter!=='none'||s.clipPath!=='none'
            || (s.zoom&&Number(s.zoom)!==1)||s.animationName!=='none'||n.shadowRoot
            || (s.textBoxTrim&&s.textBoxTrim!=='none') || (s.textCombineUpright&&s.textCombineUpright!=='none')
            || ['BR','IMG','SVG','INPUT','TEXTAREA','SELECT','BUTTON','IFRAME','CANVAS'].includes(n.tagName)
            || hasVisiblePseudoContent(n);
        });
        if(unsafe)throw Error('上下文包含非普通基线、独立行内盒或不支持的排版样式');
        if(originals.some(n=>capturedInlineSnapshots.has(n)&&capturedInlineSnapshots.get(n)!==inlineSnapshot(n,getComputedStyle(n))))throw Error('采集后行内上下文已变化，不能复用原报告证据');
        for(let ancestor=composedParent(owner);ancestor;ancestor=composedParent(ancestor)){
          const s=getComputedStyle(ancestor);
          if(s.transform!=='none'||(s.zoom&&Number(s.zoom)!==1))throw Error('祖先变换或缩放影响字体校准');
        }
        const fontSpec=`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        if(!document.fonts.check(fontSpec,textChildren.map(x=>x.node.textContent).join('')))throw Error('使用中的字体尚未可用');
        data.fontState={...fontState,checkedFont:fontSpec,checked:true};
        host=document.createElement('div');
        host.setAttribute('data-ui-review-measurement','');
        host.style.cssText='all:initial!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;overflow:hidden!important;opacity:0!important;pointer-events:none!important;contain:strict!important;z-index:-2147483648!important;';
        const shadow=host.attachShadow({mode:'closed'});
        const copies=new Map();
        function clone(node){
          if(node.nodeType===Node.TEXT_NODE){const copy=document.createTextNode(node.textContent);copies.set(node,copy);return copy;}
          if(node.nodeType!==Node.ELEMENT_NODE)return document.createTextNode('');
          const copy=document.createElement('span'),style=getComputedStyle(node);
          for(const key of style)copy.style.setProperty(key,style.getPropertyValue(key),'important');
          copies.set(node,copy);
          for(const child of node.childNodes)copy.appendChild(clone(child));
          return copy;
        }
        const context=clone(owner);context.style.setProperty('margin','0','important');
        shadow.appendChild(context);document.documentElement.appendChild(host);
        const liveOwner=owner.getBoundingClientRect(),cloneOwner=context.getBoundingClientRect(),dx=liveOwner.left-cloneOwner.left,dy=liveOwner.top-cloneOwner.top;
        if(!close({x:0,y:0,width:liveOwner.width,height:liveOwner.height},{x:0,y:0,width:cloneOwner.width,height:cloneOwner.height}))throw Error('离屏上下文尺寸未复现');
        let checkedFragments=0;
        for(const [live,copy] of copies){
          if(live.nodeType!==Node.TEXT_NODE)continue;
          const a=ranges(live),b=ranges(copy);
          if(!sameRects(a,b,dx,dy))throw Error('离屏上下文未复现原始文字片段');
          checkedFragments+=a.length;
        }
        const probe=document.createElement('div');
        probe.style.cssText='all:initial;display:block;position:static;box-sizing:content-box;margin:0;padding:0;border:0;width:max-content;height:auto;white-space:pre;';
        // Copy typography including spacing and variation, while removing external boxes.
        for(const key of ['font-family','font-size','font-weight','font-style','font-stretch','font-kerning','font-feature-settings','font-variation-settings','font-optical-sizing','font-synthesis','font-variant','font-variant-ligatures','font-variant-caps','font-variant-numeric','line-height','letter-spacing','word-spacing','tab-size','white-space'])probe.style.setProperty(key,cs.getPropertyValue(key));
        shadow.appendChild(probe);
        const calibrated=[];
        for(const {node,childIndex} of textChildren){
          const raw=ranges(node);if(!raw.length)continue;
          const segments=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(node.textContent)];
          const offsets=raw.map(()=>({start:Infinity,end:0}));
          for(const seg of segments){
            const r=document.createRange();r.setStart(node,seg.index);r.setEnd(node,seg.index+seg.segment.length);
            for(const rect of r.getClientRects()){
              const at=raw.findIndex(b=>Math.abs(b.top-rect.top)<.35&&Math.abs(b.height-rect.height)<.35&&rect.left>=b.left-.35&&rect.right<=b.right+.35);
              if(at>=0){offsets[at].start=Math.min(offsets[at].start,seg.index);offsets[at].end=Math.max(offsets[at].end,seg.index+seg.segment.length);}
            }
          }
          for(let i=0;i<raw.length;i++){
            const {start,end}=offsets[i];if(!Number.isFinite(start)||end<=start)throw Error('文字片段字符归属不明确');
            const selected=document.createRange();selected.setStart(node,start);selected.setEnd(node,end);
            const selectedRects=[...selected.getClientRects()].filter(r=>r.width>0&&r.height>0);
            if(selectedRects.length!==1||!sameRects([raw[i]],selectedRects,0,0))throw Error('文字片段包含复杂换行或双向排版');
            // Exact substring allows a font fallback affecting one line to invalidate calibration.
            const substring=node.textContent.slice(start,end);
            if(/[\r\n\t]/.test(substring))throw Error('保留制表符或强制换行需独立校准');
            probe.textContent=substring;
            const probeBox=probe.getBoundingClientRect(),probeRects=ranges(probe.firstChild);
            if(probeRects.length!==1||Math.abs(probeBox.height-lineHeight)>.35||Math.abs(probeRects[0].height-raw[i].height)>.35)throw Error('字体行高与实际片段度量未通过校准');
            // Width equality also validates shaping, spacing and fallback for this substring.
            if(Math.abs(probeRects[0].width-raw[i].width)>.35)throw Error('字体整形或空白折叠与实际片段不一致');
            const topOffset=probeRects[0].top-probeBox.top;
            const fragment={childIndex,start,end,text:substring,rawBox:localBox(raw[i],rootRect),
              box:{x:round(raw[i].left-rootRect.left),y:round(raw[i].top-topOffset-rootRect.top),width:round(raw[i].width),height:round(lineHeight)},
              calibration:{topOffset:round(topOffset),probeLineHeight:round(probeBox.height),probeRangeHeight:round(probeRects[0].height)}};
            calibrated.push(fragment);
          }
        }
        if(!calibrated.length)throw Error('没有可校准的可见文字片段');
        // No DOM writes occurred within the live selection; still guard against a concurrent reflow.
        if(!close(originalBox,localBox(el.getBoundingClientRect(),root.getBoundingClientRect()),.5))throw Error('补测期间页面布局发生变化');
        data.status='measured';data.axes={horizontal:'layout',vertical:'layout'};
        data.axisSources={horizontal:'verified-text-advance-width',vertical:'calibrated-run-line-height'};
        data.fragments=calibrated;data.box=merge(calibrated.map(f=>f.box));
        data.validation={verified:true,contextFragmentsMatched:true,checkedFragments,calibratedFragments:calibrated.length,tolerance:.35,
          kind:'text-run-layout-contribution',notContainingLineBox:true};
        result.status='measured';result.reason='局部上下文与文字片段复现通过，行高已按每个 run 校准';
      }catch(error){result.reason=error.message;data.reason=error.message;}
      finally{host?.remove();}
      output.push(result);
    }
    return {rootId:rootId||capturedRootId,coordinateSpace:'selection-local-css-px',contentVersion:CONTENT_VERSION,measurements:output};
  }

  // ── 数字子串测量(方案 v1) ──
  // 背景: 设计师常把数字单独成图层(为配色/强调),前端却把整句写成一个文本节点(数字是字符,无独立节点)。
  //   这类"文字/数字/文字"或"数字/文字/数字"结构里,数字两侧的间距是设计规范(实测常见2px),该走查。
  //   但前端数字无独立节点无法配对 → 用 Range.setStart/setEnd 精确测出数字子串在文本节点内的像素框,
  //   供 popup.js 与设计侧独立数字图层比对"数字两侧留白"。
  // 允许数字与文字之间有空格(前端常用空格分隔,如"拥有 3 件"):空格宽度会自然计入留白(测的是
  //   左侧文字右缘 → 数字左缘,中间的空格就在这段距离里),从而能与设计侧的像素间距(如2px)对比。
  // 只在满足结构 + 护栏时输出,避免误纳日期/时间/版本号/价格及排版拉伸导致的假间距。
  const CJK_OR_LETTER = '[\\u4e00-\\u9fa5a-zA-Z]'; // "文字"=汉字或字母(不含 - / : . 等,防日期/版本号)
  // 排除模式: 日期(2026-07-27 / 2025.08 / 8/20)、时间(12:30)、版本号(v1.2.3 / 1.2)、价格(¥50 / 50%)、千分位(1,000)
  const NUMERIC_EXCLUDE = /\d[\d]*([-/.:,%]|\s*[-/.:])\d|[¥$￥]\s*\d|\d\s*%|\d{4}/;
  const numericSegments = (el, rootRect) => {
    const segs = [];
    try {
      // 仅处理"自身直接文字构成的单一文本节点"(数字未被前端拆成子元素才需要此机制)
      const kids = [...el.childNodes];
      const textNodes = kids.filter(n => n.nodeType === Node.TEXT_NODE && String(n.textContent || '').trim());
      // 必须是"纯文本叶子"(无元素子节点),否则数字可能已是独立元素,走常规配对
      if (textNodes.length !== 1 || kids.some(n => n.nodeType === Node.ELEMENT_NODE)) return segs;
      const style = getComputedStyle(el);
      // 护栏: 字距非默认 / 两端对齐 → 字符间距被排版改变,数字两侧"间距"非设计意图,跳过
      if (style.letterSpacing && style.letterSpacing !== 'normal') return segs;
      if (style.textAlign === 'justify') return segs;
      const node = textNodes[0];
      const full = node.textContent;
      // 不再因句中任意位置出现日期/年份而排除整句。例：
      // "共完成 9 个攻略、达成 1 个足迹，2026年…" 中 2026 是日期，但前面的 9/1 仍是应测数字。
      // 日期/时间/版本/价格等改为在每个候选数字处做局部排除（见循环内）。
      // 结构匹配: 文字[空格?]数字[空格?]文字。允许数字与文字间有 0~1 个空格(空格计入留白)。
      const reNumMid = new RegExp(`(${CJK_OR_LETTER})(\\s?)(\\d+)(\\s?)(${CJK_OR_LETTER})`, 'g');
      // 用 Range 精确测 [s,e) 子串框(要求单行, 跨行返回 null)
      const measure = (s, e) => {
        const rg = document.createRange();
        rg.setStart(node, s); rg.setEnd(node, e);
        const rects = [...rg.getClientRects()];
        rg.detach?.();
        if (!rects.length || rects.length > 1) return null;
        return rects[0];
      };
      let m;
      let guard = 0;
      while ((m = reNumMid.exec(full)) && guard < 12) {
        guard += 1;
        const leftChar = m[1], leftSpace = m[2], num = m[3], rightSpace = m[4], rightChar = m[5];
        // 各段在文本节点内的字符下标
        const leftCharStart = m.index;                       // 左侧文字(1字)
        const numStart = leftCharStart + 1 + leftSpace.length;
        const numEnd = numStart + num.length;
        const rightCharStart = numEnd + rightSpace.length;   // 右侧文字(1字)
        // 只排除当前数字附近的日期/时间/版本/价格/百分比，不污染同句其它数字。
        const localContext = full.slice(Math.max(0, numStart - 3), Math.min(full.length, numEnd + 3));
        const isYear = /^\d{4}$/.test(num) && rightChar === '年';
        if (isYear || NUMERIC_EXCLUDE.test(localContext)) { reNumMid.lastIndex = numEnd; continue; }
        const numRect = measure(numStart, numEnd);
        const leftRect = measure(leftCharStart, leftCharStart + 1);
        const rightRect = measure(rightCharStart, rightCharStart + 1);
        if (!numRect || !leftRect || !rightRect) { reNumMid.lastIndex = numEnd; continue; }
        // 同行校验: 三者 top 相近(否则换行处,跳过)
        if (Math.abs(numRect.top - leftRect.top) > 2 || Math.abs(numRect.top - rightRect.top) > 2) { reNumMid.lastIndex = numEnd; continue; }
        // 留白 = 左侧文字右缘→数字左缘(含中间空格) / 数字右缘→右侧文字左缘(含中间空格)
        const leftGap = round(numRect.left - leftRect.right);
        const rightGap = round(rightRect.left - numRect.right);
        segs.push({
          text: num,
          index: numStart,
          box: localBox(numRect, rootRect),
          leftBox: localBox(leftRect, rootRect),
          rightBox: localBox(rightRect, rootRect),
          leftGap,
          rightGap,
          leftChar,
          rightChar,
          hasLeftSpace: leftSpace.length > 0,
          hasRightSpace: rightSpace.length > 0
        });
        reNumMid.lastIndex = numEnd; // 从数字末尾继续,允许相邻结构
      }
    } catch (e) { /* 测量失败不影响主流程 */ }
    return segs.slice(0, 8);
  };
  let textMeasureCanvas = null;
  const cssPixels = value => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const controlText = el => {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'select') return text(el.selectedOptions?.[0]?.textContent || '');
    if (tag !== 'input' && tag !== 'textarea') return '';
    const type = String(el.type || 'text').toLowerCase();
    if (tag === 'input' && ['hidden','checkbox','radio','button','submit','reset','range','color','file','image'].includes(type)) return '';
    if (type === 'password' && el.value) return '•'.repeat(String(el.value).length);
    return text(el.value || el.placeholder || '');
  };
  const controlTextBoxes = (el, rootRect) => {
    const value = controlText(el);
    if (!value) return [];
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const borderLeft = cssPixels(style.borderLeftWidth);
    const borderRight = cssPixels(style.borderRightWidth);
    const borderTop = cssPixels(style.borderTopWidth);
    const borderBottom = cssPixels(style.borderBottomWidth);
    const paddingLeft = cssPixels(style.paddingLeft);
    const paddingRight = cssPixels(style.paddingRight);
    const paddingTop = cssPixels(style.paddingTop);
    const paddingBottom = cssPixels(style.paddingBottom);
    const contentLeft = rect.left + borderLeft + paddingLeft;
    const contentRight = rect.right - borderRight - paddingRight;
    const contentTop = rect.top + borderTop + paddingTop;
    const contentBottom = rect.bottom - borderBottom - paddingBottom;
    const contentWidth = Math.max(0, contentRight - contentLeft);
    const contentHeight = Math.max(0, contentBottom - contentTop);
    if (contentWidth <= 0 || contentHeight <= 0) return [];

    textMeasureCanvas ||= document.createElement('canvas');
    const context = textMeasureCanvas.getContext('2d');
    if (!context) return [];
    const fontSize = Math.max(1, cssPixels(style.fontSize) || 16);
    context.font = style.font && style.font !== 'normal' ? style.font : `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${fontSize}px ${style.fontFamily || 'sans-serif'}`;
    const letterSpacing = style.letterSpacing === 'normal' ? 0 : cssPixels(style.letterSpacing);
    const measuredWidth = context.measureText(value).width + Math.max(0, value.length - 1) * letterSpacing;
    const width = Math.max(1, Math.min(contentWidth, measuredWidth));
    const lineHeight = style.lineHeight === 'normal' ? fontSize * 1.2 : (cssPixels(style.lineHeight) || fontSize * 1.2);
    const height = Math.max(1, Math.min(contentHeight, lineHeight));
    const direction = String(style.direction || 'ltr').toLowerCase();
    const alignment = String(style.textAlign || 'start').toLowerCase();
    const alignsRight = alignment === 'right' || alignment === 'end' || (alignment === 'start' && direction === 'rtl');
    const alignsCenter = alignment === 'center';
    const textIndent = cssPixels(style.textIndent);
    let left = alignsRight ? contentRight - width : alignsCenter ? contentLeft + (contentWidth - width) / 2 : contentLeft + textIndent;
    left = Math.max(contentLeft, Math.min(contentRight - width, left - (Number(el.scrollLeft) || 0)));
    const top = el.tagName?.toLowerCase() === 'textarea'
      ? contentTop
      : contentTop + (contentHeight - height) / 2;
    return [{
      x: round(left - rootRect.left),
      y: round(top - rootRect.top),
      width: round(width),
      height: round(height),
      source: 'control-text', boxKind: 'layout-estimate'
    }];
  };
  const pseudoContentEvidence = (el, rootRect) => ['::before', '::after'].flatMap(pseudo => {
    let style;
    try { style = getComputedStyle(el, pseudo); } catch (_error) { return []; }
    const content = String(style.content || '').trim();
    if (!content || content === 'none' || content === 'normal' || style.display === 'none'
      || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0) return [];
    const paintedColor = value => {
      const color = String(value || '').trim().toLowerCase();
      if (!color || color === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color)
        || /^rgba?\([^)]*\/\s*0(?:\.0+)?\s*\)$/.test(color)
        || /^#[0-9a-f]{4}$/.test(color) && color[4] === '0'
        || /^#[0-9a-f]{8}$/.test(color) && color.slice(7) === '00') return false;
      return true;
    };
    const border = ['top', 'right', 'bottom', 'left'].some(side =>
      parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0
      && style.getPropertyValue(`border-${side}-style`) !== 'none'
      && paintedColor(style.getPropertyValue(`border-${side}-color`)));
    const generatedImage = /^url\(/i.test(content);
    const textPaint = !/^(\"|')\s*\1$/.test(content) && paintedColor(style.color);
    const background = paintedColor(style.backgroundColor) || (style.backgroundImage && style.backgroundImage !== 'none');
    const shadow = style.boxShadow && style.boxShadow !== 'none';
    if (!textPaint && !generatedImage && !background && !border && !shadow) return [{pseudo, status: 'unpainted'}];
    // CSS has no DOM node for a pseudo-element. Only an explicitly sized,
    // absolutely positioned box in this element's containing block can be
    // reconstructed without guessing from its siblings' layout.
    // The containing block may be a positioned ancestor of a text span.
    let hostElement=el;
    while(hostElement&&getComputedStyle(hostElement).position==='static'
      &&getComputedStyle(hostElement).transform==='none')hostElement=composedParent(hostElement);
    hostElement ||= el;
    const hostStyle = getComputedStyle(hostElement);
    const pureTranslation = transform => /^matrix\(\s*1\s*,\s*0\s*,\s*0\s*,\s*1\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)$/.test(transform);
    let ancestorsSafe = true;
    for (let owner = el; owner; owner = composedParent(owner)) {
      const ownerStyle = getComputedStyle(owner);
      if (ownerStyle.transform !== 'none' && !pureTranslation(ownerStyle.transform)
        || ownerStyle.zoom && Number(ownerStyle.zoom) !== 1) { ancestorsSafe = false; break; }
    }
    const px = value => /^-?\d+(?:\.\d+)?px$/.test(String(value || '').trim()) ? Number.parseFloat(value) : null;
    const width = px(style.width), height = px(style.height);
    const left = px(style.left), right = px(style.right), top = px(style.top), bottom = px(style.bottom);
    const extraWidth = style.boxSizing === 'border-box' ? 0 :
      cssPixels(style.paddingLeft) + cssPixels(style.paddingRight) + cssPixels(style.borderLeftWidth) + cssPixels(style.borderRightWidth);
    const extraHeight = style.boxSizing === 'border-box' ? 0 :
      cssPixels(style.paddingTop) + cssPixels(style.paddingBottom) + cssPixels(style.borderTopWidth) + cssPixels(style.borderBottomWidth);
    const host=hostElement.getBoundingClientRect();
    const containingWidth=host.width-cssPixels(hostStyle.borderLeftWidth)-cssPixels(hostStyle.borderRightWidth);
    const containingHeight=host.height-cssPixels(hostStyle.borderTopWidth)-cssPixels(hostStyle.borderBottomWidth);
    // An absolutely stretched box has a resolved extent even when CSS width/height is auto.
    const actualWidth = width == null ? left!=null&&right!=null
      ?containingWidth-left-right-cssPixels(style.marginLeft)-cssPixels(style.marginRight):null : width+extraWidth;
    const actualHeight = height == null ? top!=null&&bottom!=null
      ?containingHeight-top-bottom-cssPixels(style.marginTop)-cssPixels(style.marginBottom):null : height+extraHeight;
    const exact = ancestorsSafe && style.position === 'absolute' && hostStyle.position !== 'static'
      && actualWidth > 0 && actualHeight > 0 && (left != null || right != null)
      && (top != null || bottom != null) && style.transform === 'none'
      && hostElement.getClientRects().length===1
      && style.filter === 'none' && style.textShadow === 'none' && !shadow
      && (!style.clipPath || style.clipPath === 'none')
      && (!style.maskImage || style.maskImage === 'none')
      && (!style.getPropertyValue('-webkit-mask-image') || style.getPropertyValue('-webkit-mask-image') === 'none')
      && !String(content).includes('counter(') && !String(content).includes('attr(');
    if (!exact) return [{pseudo, status: 'unresolved', reason: 'pseudo-box-not-locatable'}];
    const borderLeft = cssPixels(hostStyle.borderLeftWidth), borderRight = cssPixels(hostStyle.borderRightWidth);
    const borderTop = cssPixels(hostStyle.borderTopWidth), borderBottom = cssPixels(hostStyle.borderBottomWidth);
    const x = left != null ? host.left + borderLeft + left + cssPixels(style.marginLeft)
      : host.left + borderLeft + containingWidth - right - actualWidth - cssPixels(style.marginRight);
    const y = top != null ? host.top + borderTop + top + cssPixels(style.marginTop)
      : host.top + borderTop + containingHeight - bottom - actualHeight - cssPixels(style.marginBottom);
    return [{pseudo, status: 'bounded', box: {
      x: round(x - rootRect.left), y: round(y - rootRect.top),
      width: round(actualWidth), height: round(actualHeight)
    }}];
  });
  const hasVisiblePseudoContent = el => pseudoContentEvidence(el, el.getBoundingClientRect())
    .some(item => item.status !== 'unpainted');

  const semanticText = value => text(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  const compactSemanticText = value => semanticText(value)
    .replace(/[，。！？：；、,.!?:;\-—_()（）\[\]【】{}]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  const numericStyle = value => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  function buildRuntimeStructure(elements, rootId) {
    const byId = new Map(elements.map(node => [node.id, node]));
    const children = new Map(elements.map(node => [node.id, []]));
    elements.forEach(node => {
      if (node.parentId && children.has(node.parentId)) children.get(node.parentId).push(node);
    });
    const roles = new Map();

    const descendantNodes = node => {
      const output = [];
      const queue = [...(children.get(node.id) || [])];
      while (queue.length && output.length < 240) {
        const current = queue.shift();
        output.push(current);
        queue.push(...(children.get(current.id) || []));
      }
      return output;
    };
    const direction = node => {
      const display = String(node.styles?.display || '').toLowerCase();
      if (!/flex|grid/.test(display)) return 'none';
      if (/grid/.test(display)) return 'grid';
      return String(node.styles?.['flex-direction'] || 'row').toLowerCase().startsWith('column') ? 'vertical' : 'horizontal';
    };
    const baseRole = node => {
      if (node.id === rootId) return 'root';
      const tag = String(node.tag || '').toLowerCase();
      const source = [node.selector, node.role, node.ariaLabel, node.title, node.name, node.placeholder, node.text?.direct]
        .filter(Boolean).join(' ').toLowerCase();
      const corpus = `${source} ${String(node.text?.descendant || '').toLowerCase()}`;
      if (tag === 'table') return 'table';
      if (tag === 'thead') return 'table-head';
      if (tag === 'tbody') return 'table-body';
      if (tag === 'th') return 'head-cell';
      if (tag === 'td') return 'data-cell';
      if (tag === 'tr') return 'table-row';
      if (/pagination|pager|page-number|分页/.test(source) || (/条\/页|跳转至/.test(corpus) && corpus.length < 180)) return 'pagination';
      if (/(?:^|[.\s_-])(?:ai[\s_-]?module|ai模块)(?:[.\s_-]|$)|^(?:卡片|card)$/i.test(source.trim())) return 'card';
      if (/^h[1-6]$/.test(tag) || /(?:^|[._-])(title|heading)(?:[._-]|$)/.test(source)) return 'title';
      if (/(?:^|[.\s_-])(checkbox|check-box|radio|switch|toggle)(?:[.\s_-]|$)/.test(source) && !node.text?.direct) return 'icon';
      const explicitRole = String(node.role || '').toLowerCase();
      const inputType = String(node.inputType || 'text').toLowerCase();
      if (tag === 'button' || explicitRole === 'button'
        || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType))) return 'button';
      if (tag === 'input') {
        if (/date|日期|时间|开始|结束/.test(`${node.inputType || ''} ${node.placeholder || ''} ${source}`)) return 'date-input';
        return 'input';
      }
      if (tag === 'select' || ['combobox', 'listbox'].includes(explicitRole)
        || /listbox/.test(String(node.ariaHasPopup || '').toLowerCase())) return 'select';
      if (tag === 'textarea') return 'textarea';
      if (tag === 'a' || explicitRole === 'link') return 'link';
      const selectorClasses = String(node.selector || '').toLowerCase().split('.').slice(1);
      const customSelect = selectorClasses.some(token => token === 'weui-desktop-form__dropdown'
        || /(?:^|[-_])(?:dropdown|select|combobox|picker)$/.test(token));
      const popupPanel = /(?:menu|popper|popup|option-list|dropdown-menu|select-menu)/.test(source);
      if (customSelect && !popupPanel && (children.get(node.id) || []).length > 0) return 'select';
      if (['img', 'picture'].includes(tag)) return 'image';
      if (['svg', 'path', 'use', 'g', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'i'].includes(tag)) return 'icon';
      if (/form_item_content|form-item|filter-control|date-range/.test(source)) return 'filter-control';
      if (node.text?.direct) return 'text';
      return 'container';
    };

    elements.forEach(node => roles.set(node.id, baseRole(node)));
    elements.forEach(node => {
      const parentRole = roles.get(node.parentId);
      if (roles.get(node.id) === 'table-row') roles.set(node.id, parentRole === 'table-head' ? 'head-row' : 'data-row-template');
    });
    elements.forEach(node => {
      if (roles.get(node.id) !== 'container') return;
      const nodeDirection = direction(node);
      const descendants = descendantNodes(node);
      const descendantRoles = descendants.map(item => roles.get(item.id));
      const corpus = compactSemanticText(node.text?.descendant);
      const hasAction = /(查询|筛选|搜索|重置|search|filter|reset)/.test(corpus);
      const fieldCount = descendantRoles.filter(role => ['filter-control', 'date-input', 'input', 'select', 'textarea'].includes(role)).length;
      const actionCount = descendantRoles.filter(role => ['button', 'link'].includes(role)).length;
      if (nodeDirection === 'horizontal' && hasAction && fieldCount >= 1 && (fieldCount >= 2 || actionCount >= 1)) roles.set(node.id, 'filter-row');
      else if (nodeDirection === 'horizontal' && descendants.some(item => roles.get(item.id) === 'title') && descendants.filter(item => item.text?.direct).length <= 2) roles.set(node.id, 'title-region');
    });

    const anchorList = node => {
      const values = [];
      const candidates = [node, ...descendantNodes(node)];
      for (const item of candidates) {
        const value = semanticText(item.text?.direct || item.placeholder || item.ariaLabel || item.title || '');
        const compact = compactSemanticText(value);
        if (!compact || compact.length > 32 || /^\d{5,}$/.test(compact) || values.some(entry => entry.compact === compact)) continue;
        values.push({value, compact});
        if (values.length >= 16) break;
      }
      return values.map(entry => entry.value);
    };
    const keep = new Set();
    elements.forEach(node => {
      const role = roles.get(node.id);
      const nodeChildren = children.get(node.id) || [];
      const styles = node.styles || {};
      const nonzeroPadding = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].some(property => Math.abs(numericStyle(styles[property])) > 0.01);
      const ownGap = Math.max(Math.abs(numericStyle(styles['row-gap'])), Math.abs(numericStyle(styles['column-gap'])));
      const meaningfulLayout = direction(node) !== 'none' && (nodeChildren.length >= 2 || nonzeroPadding) && (ownGap > 0 || nonzeroPadding || !['container'].includes(role));
      if (node.id === rootId || role !== 'container' || meaningfulLayout) keep.add(node.id);
    });

    const nearestKeptParent = node => {
      let parent = byId.get(node.parentId);
      while (parent && !keep.has(parent.id)) parent = byId.get(parent.parentId);
      return parent?.id || null;
    };
    const structureNodes = elements.filter(node => keep.has(node.id)).map(node => {
      const styles = node.styles || {};
      const ownSpacing = {
        padding: [styles['padding-top'], styles['padding-right'], styles['padding-bottom'], styles['padding-left']].map(value => value || '0px'),
        rowGap: styles['row-gap'] || '0px',
        columnGap: styles['column-gap'] || '0px'
      };
      const controlSequence = descendantNodes(node).map(item => roles.get(item.id))
        .filter(role => ['filter-control', 'date-input', 'input', 'select', 'textarea', 'button', 'link'].includes(role)).slice(0, 16);
      return {
        id: `s:${node.id}`,
        sourceId: node.id,
        parentId: nearestKeptParent(node) ? `s:${nearestKeptParent(node)}` : null,
        role: roles.get(node.id),
        direction: direction(node),
        anchors: anchorList(node),
        controls: controlSequence,
        ownSpacing
      };
    });
    return {schemaVersion: '1.0.0', rootId: `s:${rootId}`, nodes: structureNodes};
  }

  function deepDescendants(root) {
    const out = [];
    const visit = el => {
      if (!(el instanceof Element) || IGNORED_TAGS.has(el.tagName)) return;
      out.push(el);
      [...el.children].forEach(visit);
      if (el.shadowRoot) [...el.shadowRoot.children].forEach(visit);
    };
    visit(root);
    return out;
  }

  const textSimilarity = (leftValue, rightValue) => {
    const left = compactSemanticText(leftValue);
    const right = compactSemanticText(rightValue);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
    const grams = value => {
      if (value.length < 2) return new Set([value]);
      return new Set([...Array(value.length - 1)].map((_, index) => value.slice(index, index + 2)));
    };
    const leftGrams = grams(left);
    const rightGrams = grams(right);
    let common = 0;
    leftGrams.forEach(value => {
      if (rightGrams.has(value)) common += 1;
    });
    return common / Math.max(1, leftGrams.size + rightGrams.size - common);
  };

  const candidateReviewId = el => el.getAttribute('data-review-id') || el.getAttribute('data-testid') || null;

  function scoreRebindCandidate(el, fingerprint) {
    if (!(el instanceof Element) || IGNORED_TAGS.has(el.tagName)) return -Infinity;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || (rect.width <= 0 && rect.height <= 0)) return -Infinity;
    const expectedTag = String(fingerprint.tag || '').toLowerCase();
    if (expectedTag && el.tagName.toLowerCase() !== expectedTag) return -Infinity;

    let score = expectedTag ? 12 : 0;
    const actualSelector = selector(el);
    if (fingerprint.selector && actualSelector === fingerprint.selector) score += 68;
    const actualReviewId = candidateReviewId(el);
    if (fingerprint.reviewId && actualReviewId === fingerprint.reviewId) score += 140;
    if (fingerprint.role && el.getAttribute('role') === fingerprint.role) score += 16;
    if (fingerprint.ariaLabel && el.getAttribute('aria-label') === fingerprint.ariaLabel) score += 20;
    if (fingerprint.title && el.getAttribute('title') === fingerprint.title) score += 10;

    const directSimilarity = textSimilarity(directText(el), fingerprint.text?.direct);
    const descendantSimilarity = textSimilarity(visibleText(el), fingerprint.text?.descendant);
    score += directSimilarity * 34;
    score += descendantSimilarity * 64;

    const expectedBox = fingerprint.box || {};
    if (Number(expectedBox.width) > 0 && Number(expectedBox.height) > 0) {
      const widthDelta = Math.abs(rect.width - Number(expectedBox.width)) / Math.max(rect.width, Number(expectedBox.width), 1);
      const heightDelta = Math.abs(rect.height - Number(expectedBox.height)) / Math.max(rect.height, Number(expectedBox.height), 1);
      score += Math.max(0, 30 - (widthDelta + heightDelta) * 36);
    }
    return score;
  }

  function findRebindCandidate(fingerprint) {
    const candidates = deepDescendants(document.documentElement).slice(0, 20000);
    const ranked = candidates.map(element => ({element, score: scoreRebindCandidate(element, fingerprint)}))
      .filter(candidate => Number.isFinite(candidate.score))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best || best.score < 72) throw new Error('当前页面找不到与原选区足够相似的组件，请重新选择组件');
    const second = ranked[1];
    const exactSelectorCount = fingerprint.selector
      ? ranked.filter(candidate => selector(candidate.element) === fingerprint.selector).length
      : 0;
    const exactReviewIdCount = fingerprint.reviewId
      ? ranked.filter(candidate => candidateReviewId(candidate.element) === fingerprint.reviewId).length
      : 0;
    const uniquelyIdentified = exactReviewIdCount === 1
      || exactSelectorCount === 1
      || !second
      || best.score - second.score >= 14;
    if (!uniquelyIdentified) throw new Error('当前页面存在多个相似组件，无法可靠重新绑定，请手动重新选择组件');
    return {
      element: best.element,
      score: round(best.score),
      basis: exactReviewIdCount === 1
        ? '测试标识'
        : exactSelectorCount === 1
          ? '唯一选择器'
          : '结构、文案与尺寸'
    };
  }

  function collect(root, frameId = capturedFrameId) {
    const rootRect = root.getBoundingClientRect();
    const all = deepDescendants(root);
    if (all.length > 20000) throw new Error(`组件包含 ${all.length} 个节点，请按 ↑/↓ 选择更小一层。`);
    const renderedCache = new Map();
    const styleCache = new Map();
    const visibleTextCache = new WeakMap();
    capturedInlineSnapshots = new WeakMap();
    const styleFor = el => {
      if (!styleCache.has(el)) {
        const style = getComputedStyle(el);
        styleCache.set(el, style);
        capturedInlineSnapshots.set(el,inlineSnapshot(el,style));
      }
      return styleCache.get(el);
    };
    const treeRendered = el => {
      if (renderedCache.has(el)) return renderedCache.get(el);
      const style = styleFor(el);
      const parent = composedParent(el);
      const visible = style.display !== 'none'
        && style.contentVisibility !== 'hidden' && Number(style.opacity) > 0
        && (!parent || treeRendered(parent));
      renderedCache.set(el, visible);
      return visible;
    };
    const painted = all.filter(el => {
      const r = el.getBoundingClientRect();
      // visibility is inherited but a descendant can explicitly override it.
      // display:none, opacity:0 and content-visibility:hidden still block the tree.
      return !['hidden','collapse'].includes(styleFor(el).visibility) && treeRendered(el) && (r.width > 0 || r.height > 0);
    });
    const allSet = new Set(all), included = new Set(painted);
    // Keep the structural ancestors of an exposed descendant, including hidden
    // wrappers, so its clipping/scrolling context never becomes a false root.
    for (const el of painted) for (let parent = composedParent(el); parent && allSet.has(parent); parent = composedParent(parent)) included.add(parent);
    const visible = all.filter(el => included.has(el));
    if (visible.length > 2500) throw new Error(`组件包含 ${visible.length} 个可见节点，请按 ↑/↓ 选择更小一层。`);
    const ids = new Map(visible.map((el, i) => [el, `e${i + 1}`]));
    capturedElements = new Map([...ids].map(([element, id]) => [id, element]));
    capturedRootId = ids.get(root) || null;
    capturedBoxes = new Map([...ids].map(([element,id])=>[id,localBox(element.getBoundingClientRect(),rootRect)]));
    const elements = visible.map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const pseudoElements = pseudoContentEvidence(el, rootRect);
      // A placeholder paints through its own pseudo style, not the style of a
      // future input value. Preserve the source for property measurement.
      let controlTextStyle = null;
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) {
        const mode = el.value ? 'value' : el.placeholder ? 'placeholder' : 'empty';
        const textStyles = {};
        if (mode !== 'empty') {
          const paintedStyle = mode === 'placeholder' ? getComputedStyle(el, '::placeholder') : cs;
          for (const property of ['color','font-size','font-weight','font-family','line-height','letter-spacing','opacity','-webkit-text-fill-color']) {
            const value = paintedStyle.getPropertyValue(property);
            if (value) textStyles[property] = value;
          }
        }
        controlTextStyle = {mode, source: mode === 'placeholder' ? 'getComputedStyle(::placeholder)' : 'getComputedStyle', styles: textStyles};
      }
      const textPaint = directText(el) ? textPaintEvidence(el, root, rootRect, ids) : null;
      const styles = {};
      const vectorElement = VECTOR_TAGS.has(el.tagName.toLowerCase());
      STYLE_PROPS.forEach(p => {
        if (VECTOR_STYLE_PROPS.has(p) && !vectorElement) return;
        const v = cs.getPropertyValue(p);
        if (v) styles[p] = v;
      });
      return {
        id: ids.get(el),
        parentId: el === root ? null : (ids.get(composedParent(el)) || null),
        tag: el.tagName.toLowerCase(),
        selector: selector(el),
        reviewId: el.getAttribute('data-review-id') || el.getAttribute('data-testid') || null,
        role: el.getAttribute('role') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        ariaHasPopup: el.getAttribute('aria-haspopup') || null,
        ariaExpanded: el.getAttribute('aria-expanded') || null,
        ariaControls: el.getAttribute('aria-controls') || null,
        stateEvidence: {
          valueNow: el.getAttribute('aria-valuenow'), valueMin: el.getAttribute('aria-valuemin'),
          valueMax: el.getAttribute('aria-valuemax'), selected: el.getAttribute('aria-selected'),
          checked: el.getAttribute('aria-checked'), current: el.getAttribute('aria-current'),
          describedBy: el.getAttribute('aria-describedby'), dataState: el.getAttribute('data-state')
        },
        title: el.getAttribute('title') || null,
        alt: el.getAttribute('alt') || null,
        inputType: el.getAttribute('type') || null,
        placeholder: el.getAttribute('placeholder') || null,
        ...(controlTextStyle ? {controlTextStyle} : {}),
        name: el.getAttribute('name') || null,
        tabIndex: Number.isInteger(el.tabIndex) ? el.tabIndex : null,
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        text: {direct: directText(el), descendant: visibleText(el, visibleTextCache)},
        box: {local: localBox(r, rootRect)},
        geometry: {
          coordinateSpace: 'selection-local-css-px',
          viewportBox: viewportBox(r),
          textBoxKind: controlText(el) ? 'control-text-estimate' : 'range-fragment',
          textBoxes: [...directTextBoxes(el, rootRect), ...controlTextBoxes(el, rootRect)],
          numericSegments: numericSegments(el, rootRect),
          ...(textPaint ? {textPaint} : {}),
          hasPseudoContent: pseudoElements.length > 0,
          pseudoElements
        },
        styleEvidence: directText(el) ? {fontWeight: {
          source: 'getComputedStyle', nodeId: ids.get(el), selector: selector(el),
          computed: cs.fontWeight, inlineDeclared: el.style.fontWeight || null,
          parentComputed: composedParent(el) ? getComputedStyle(composedParent(el)).fontWeight : null,
          fontFamily: cs.fontFamily, variationSettings: cs.fontVariationSettings,
          fontSynthesis: cs.fontSynthesis
        }} : null,
        styles
      };
    });
    const rootId = ids.get(root) || null;
    const rootEntry = elements.find(node => node.id === rootId) || null;
    return {
      schemaVersion: '2.4.0',
      kind: 'ui-review-runtime',
      createdAt: new Date().toISOString(),
      _meta: {
        contentVersion: CONTENT_VERSION,
        title: document.title,
        url: location.href,
        frame: {isTop: window === window.top, id: validFrameId(frameId) ? Number(frameId) : null},
        viewport: {width: innerWidth, height: innerHeight},
        captureState: captureState(root),
        backgroundContext: backgroundContext(root),
        rootElement: {
          id: capturedRootId,
          selector: selector(root),
          reviewId: rootEntry?.reviewId || null,
          tag: rootEntry?.tag || root.tagName.toLowerCase(),
          role: rootEntry?.role || null,
          ariaLabel: rootEntry?.ariaLabel || null,
          title: rootEntry?.title || null,
          text: rootEntry?.text || {direct: directText(root), descendant: visibleText(root, visibleTextCache)},
          box: {width: round(rootRect.width), height: round(rootRect.height)}
        }
      },
      elements,
      structure: buildRuntimeStructure(elements, rootId)
    };
  }

  const afterPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  // 等待布局稳定：连续多帧页面高度 + 指定 root 的矩形都不再变化，才认为懒加载/重排已结束。
  async function afterLayoutStable(rootId, {maxWait = 1500, stableFrames = 3} = {}) {
    const doc = document.scrollingElement || document.documentElement;
    const snapshot = () => {
      const root = capturedElements.get(rootId || capturedRootId);
      const rect = (root && root.isConnected) ? root.getBoundingClientRect() : null;
      return [doc.scrollHeight, doc.scrollWidth, rect ? Math.round(rect.top + scrollY) : -1,
        rect ? Math.round(rect.height) : -1].join(':');
    };
    const start = Date.now();
    let last = snapshot();
    let stable = 0;
    await afterPaint();
    while (Date.now() - start < maxWait) {
      await sleep(80);
      const now = snapshot();
      if (now === last) {
        stable += 1;
        if (stable >= stableFrames) break;
      } else {
        stable = 0;
        last = now;
      }
    }
    await afterPaint();
  }

  const captureHostIds = new WeakMap();
  const captureHostsById = new Map();
  let nextCaptureHostId = 1;

  function viewportBox(rect) {
    return {x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height)};
  }
  function captureHostId(element) {
    let id = captureHostIds.get(element);
    if (!id) { id = nextCaptureHostId++; captureHostIds.set(element, id); }
    captureHostsById.set(id, element);
    return id;
  }
  function captureState(root) {
    const doc = document.scrollingElement || document.documentElement;
    const rootRect = root.getBoundingClientRect();
    const nodeIds = new Map([...capturedElements].map(([id, element]) => [element, id]));
    const ancestors = [];
    for (let parent = composedParent(root); parent; parent = composedParent(parent)) ancestors.push(parent);
    const candidates = [...new Set([root, ...capturedElements.values(), ...ancestors])];
    const scrollContainers = [], positionedElements = [];
    for (const element of candidates) {
      if (!element.isConnected) continue;
      const relation = element === root ? 'root' : ancestors.includes(element) ? 'ancestor' : 'descendant';
      const style = getComputedStyle(element);
      const clips = /^(auto|scroll|hidden|clip)$/.test(style.overflowX) || /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
      const scrollable = clips && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
      const positioned = style.position === 'fixed' || style.position === 'sticky';
      if (!scrollable && !element.scrollTop && !element.scrollLeft && !positioned) continue;
      const rect = element.getBoundingClientRect(), nodeId = nodeIds.get(element) || null;
      const entry = {id: nodeId || `ancestor-${captureHostId(element)}`, nodeId, selector: selector(element), relation,
        viewportBox: viewportBox(rect), box: localBox(rect, rootRect)};
      if (element !== doc && (scrollable || element.scrollTop || element.scrollLeft)) scrollContainers.push({...entry,
        scrollTop: round(element.scrollTop), scrollLeft: round(element.scrollLeft),
        clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
        overflowX: style.overflowX, overflowY: style.overflowY});
      if (positioned) positionedElements.push({...entry, position: style.position,
        top: style.top, right: style.right, bottom: style.bottom, left: style.left,
        visibility: style.visibility, captureSuppressed: __overlayHidden.some(item => item.el === element),
        repeatedCaptureCandidate: __captureRepeatedOverlays.includes(element)});
    }
    // Compare actual content as well as geometry: carousel hints can change
    // without resizing their box between DOM collection and screenshot capture.
    const contentEntries=[];
    for(const node of deepDescendants(root)){
      const id=nodeIds.get(node);if(!id)continue;
      const own=[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('');
      const value=String(node.value||''),image=node.tagName==='IMG'?node.currentSrc||node.src:'';
      if(!own&&!value&&!image)continue;
      const st=getComputedStyle(node);
      if(st.display==='none'||Number(st.opacity)===0)continue;
      let hash=2166136261;
      for(const c of own+'\0'+value+'\0'+image)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
      contentEntries.push({nodeId:id,signature:hash.toString(16)});
    }
    const vv = window.visualViewport;
    return {version: 2,contentEntries, rootId: nodeIds.get(root) || capturedRootId, coordinateSpace: 'selection-local-css-px',
      viewport: {width: innerWidth, height: innerHeight, devicePixelRatio: window.devicePixelRatio,
        visualViewport: vv ? {width: round(vv.width), height: round(vv.height), offsetLeft: round(vv.offsetLeft), offsetTop: round(vv.offsetTop), scale: vv.scale} : null},
      window: {scrollX: round(scrollX), scrollY: round(scrollY), scrollWidth: doc.scrollWidth, scrollHeight: doc.scrollHeight,
        clientWidth: doc.clientWidth, clientHeight: doc.clientHeight},
      rootViewport: viewportBox(rootRect), scrollContainers, positionedElements};
  }
  function backgroundContext(root) {
    const rootRect = root.getBoundingClientRect();
    const properties = ['background-color','background-image','background-clip','background-origin','background-position','background-size','background-repeat',
      'opacity','display','visibility','position','top','right','bottom','left','z-index','isolation','mix-blend-mode','background-blend-mode',
      'filter','backdrop-filter','transform','overflow-x','overflow-y'];
    const describe = element => {
      if (!element) return null;
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return {id: `ancestor-${captureHostId(element)}`, selector: selector(element), tag: element.tagName.toLowerCase(),
        box: {local: localBox(rect, rootRect), viewport: viewportBox(rect)},
        styles: Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)]).filter(([, value]) => value))};
    };
    const ancestors = [];
    for (let parent = composedParent(root); parent; parent = composedParent(parent)) ancestors.push(describe(parent));
    return {version: 1, coordinateSpace: 'selection-local-css-px', rootViewport: viewportBox(rootRect),
      ancestors, canvas: {html: describe(document.documentElement), body: describe(document.body)}};
  }

  function captureRoot(rootId) {
    const root = capturedElements.get(rootId || capturedRootId);
    if (!root || !root.isConnected) {
      const error = new Error('前端选区已失效，请重新选择组件');
      error.code = root ? 'CAPTURE_ROOT_DETACHED' : 'CAPTURE_ROOT_MISSING';
      throw error;
    }
    if (window !== window.top) throw new Error('局部截图暂不支持 iframe 内的组件');
    return root;
  }

  function captureAncestors(root) {
    const ancestors = [];
    const doc = document.scrollingElement || document.documentElement;
    for (let parent = composedParent(root); parent; parent = composedParent(parent)) {
      if (parent === doc) continue;
      const style = getComputedStyle(parent);
      const clipsX = style.overflowX !== 'visible';
      const clipsY = style.overflowY !== 'visible';
      const scrollsX = clipsX && style.overflowX !== 'clip' && parent.scrollWidth > parent.clientWidth + 1;
      const scrollsY = clipsY && style.overflowY !== 'clip' && parent.scrollHeight > parent.clientHeight + 1;
      if (!clipsX && !clipsY && !scrollsX && !scrollsY) continue;
      const id = captureHostId(parent);
      ancestors.push({element: parent, id, clipsX, clipsY, scrollsX, scrollsY});
    }
    return ancestors;
  }

  function captureClip(ancestors) {
    const clip = {left: 0, top: 0, right: innerWidth, bottom: innerHeight};
    ancestors.forEach(({element, clipsX, clipsY}) => {
      const rect = element.getBoundingClientRect();
      if (clipsX) {
        clip.left = Math.max(clip.left, rect.left + element.clientLeft);
        // clientWidth/Height round to integer CSS pixels. Preserve the fractional
        // painted edge, subtracting only the border/scrollbar inset on that side.
        clip.right = Math.min(clip.right, rect.right - (element.offsetWidth - element.clientWidth - element.clientLeft));
      }
      if (clipsY) {
        clip.top = Math.max(clip.top, rect.top + element.clientTop);
        clip.bottom = Math.min(clip.bottom, rect.bottom - (element.offsetHeight - element.clientHeight - element.clientTop));
      }
    });
    return clip;
  }

  function capturePosition(rootId) {
    const root = captureRoot(rootId);
    const rect = root.getBoundingClientRect();
    return {
      rootViewport: {x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height)},
      clip: captureClip(captureAncestors(root)),
      viewport: {width: innerWidth, height: innerHeight},
      captureState: captureState(root)
    };
  }

  async function scrollCaptureTo(rootId, localX, localY) {
    const root = captureRoot(rootId);
    const ancestors = captureAncestors(root);
    for (const host of ancestors) {
      if (!host.scrollsX && !host.scrollsY) continue;
      const rootRect = root.getBoundingClientRect();
      const hostRect = host.element.getBoundingClientRect();
      const left = hostRect.left + host.element.clientLeft;
      const top = hostRect.top + host.element.clientTop;
      if (host.scrollsX) host.element.scrollLeft += rootRect.left + localX - left;
      if (host.scrollsY) host.element.scrollTop += rootRect.top + localY - top;
    }
    const rect = root.getBoundingClientRect();
    window.scrollTo({left: scrollX + rect.left + localX, top: scrollY + rect.top + localY, behavior: 'instant'});
    await afterLayoutStable(rootId, {maxWait: 1200, stableFrames: 3});
    return capturePosition(rootId);
  }

  // Prewarm root tiles by moving only the window and the root's scrollable
  // ancestors. A nested sidebar keeps the same independent scroll position.
  async function primeCapture(rootId, positions) {
    const tiles = Array.isArray(positions) ? positions : [];
    prepareCaptureOverlays(rootId);
    for (const pos of tiles) {
      await scrollCaptureTo(rootId, Number(pos.x) || 0, Number(pos.y) || 0);
    }
    // Sticky elements may be pinned at the last prewarm tile. Discover the
    // repeated paint owners after returning to the actual first tile, so its
    // natural layout position is the one preserved by later tile suppression.
    if (tiles.length) await scrollCaptureTo(rootId, Number(tiles[0].x) || 0, Number(tiles[0].y) || 0);
    prepareCaptureOverlays(rootId);
    return captureRootInfo(rootId);
  }

  // 截图期间隐藏脱离文档流的悬浮层(position:fixed / sticky)，避免分块滚动截图时它们在每块顶部重复出现造成重影。
  // 用 visibility:hidden(不改 position→不触发重排，只是不绘制)，且不动选区 root 自身及其祖先(它们可能是sticky但要截)。
  let __overlayHidden = [];
  let __captureRepeatedOverlays = [];
  let __captureOverlaysPrepared = false;
  function prepareCaptureOverlays(rootId) {
    const root = capturedElements.get(rootId || capturedRootId);
    __captureRepeatedOverlays = [];
    if (root?.isConnected) for (const element of deepDescendants(root)) {
      if (element === root) continue;
      const style = getComputedStyle(element);
      if (!['fixed','sticky'].includes(style.position) || style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      if ((element.textContent?.trim() || element.querySelector('img,svg,canvas,button,input,[role=button]'))
        && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0
        && rect.bottom <= innerHeight && rect.right <= innerWidth) __captureRepeatedOverlays.push(element);
    }
    __captureOverlaysPrepared = true;
  }
  function hideCaptureOverlays(rootId, includeCapturedDescendants = false) {
    const root = capturedElements.get(rootId || capturedRootId);
    if (!__captureOverlaysPrepared) prepareCaptureOverlays(rootId);
    const insideRoot = el => root && (el === root || root.contains(el) || el.contains(root));
    document.querySelectorAll('*').forEach(el => {
      const pos = getComputedStyle(el).position;
      if (pos !== 'fixed' && pos !== 'sticky') return;
      if ((!insideRoot(el) || includeCapturedDescendants && __captureRepeatedOverlays.includes(el)) && !__overlayHidden.some(entry=>entry.el===el)) {
        __overlayHidden.push({el, value: el.style.getPropertyValue('visibility'), priority:el.style.getPropertyPriority('visibility')});
        el.style.setProperty('visibility','hidden','important');
      }
    });
    return {hidden: __overlayHidden.length};
  }
  function restoreCaptureOverlays() {
    __overlayHidden.forEach(({el, value, priority}) => { if(value)el.style.setProperty('visibility',value,priority);else el.style.removeProperty('visibility'); });
    __captureRepeatedOverlays = [];
    __captureOverlaysPrepared = false;
    __overlayHidden = [];
    return {ok: true};
  }

  function captureRootInfo(rootId) {
    const root = captureRoot(rootId);
    const rect = root.getBoundingClientRect();
    const doc = document.scrollingElement || document.documentElement;
    const ancestors = captureAncestors(root);
    const clip = captureClip(ancestors);
    return {
      rootId: rootId || capturedRootId,
      root: {
        x: round(rect.left + scrollX),
        y: round(rect.top + scrollY),
        width: round(rect.width),
        height: round(rect.height)
      },
      viewport: {width: innerWidth, height: innerHeight},
      tileViewport: {width: Math.max(0, clip.right - clip.left), height: Math.max(0, clip.bottom - clip.top)},
      captureState: captureState(root),
      scroll: {x: scrollX, y: scrollY, hosts: ancestors.map(({element, id}) => ({id, x: element.scrollLeft, y: element.scrollTop}))},
      maxScroll: {
        x: Math.max(0, doc.scrollWidth - innerWidth),
        y: Math.max(0, doc.scrollHeight - innerHeight)
      }
    };
  }

  function restoreCaptureScroll(saved) {
    for (const host of saved?.hosts || []) {
      const element = captureHostsById.get(host.id);
      if (element?.isConnected) {
        element.scrollLeft = host.x;
        element.scrollTop = host.y;
      }
    }
    window.scrollTo({left: saved?.x || 0, top: saved?.y || 0, behavior: 'instant'});
    captureHostsById.clear();
    return {ok: true};
  }

  async function rebindCaptureRoot(fingerprint = {}) {
    capturedFrameId = validFrameId(fingerprint.frameId) ? Number(fingerprint.frameId) : capturedFrameId;
    let root = capturedElements.get(fingerprint.rootId || capturedRootId);
    let rebound = false;
    let match = null;
    if (!root || !root.isConnected) {
      match = findRebindCandidate(fingerprint);
      root = match.element;
      rebound = true;
    }
    // 采集前滚到顶并等稳定，让 sticky 元素回归文档流原位；采集后恢复原滚动位置。
    const savedScroll = {x: scrollX, y: scrollY};
    window.scrollTo({left: 0, top: 0, behavior: 'instant'});
    await afterLayoutStable(fingerprint.rootId || capturedRootId, {maxWait: 1000, stableFrames: 2});
    let runtime;
    try {
      if (!root.isConnected) {
        match = findRebindCandidate(fingerprint);
        root = match.element;
        rebound = true;
      }
      runtime = collect(root, capturedFrameId);
    } finally {
      window.scrollTo({left: savedScroll.x, top: savedScroll.y, behavior: 'instant'});
    }
    chrome.storage.local.set({uiReviewRuntime: runtime});
    return {
      runtime,
      rebound,
      match: match ? {score: match.score, basis: match.basis} : {score: 100, basis: '原节点仍有效'}
    };
  }

  function startPicker(sessionId, frameId) {
    window.__UI_REVIEW_PICKER_STOP__?.();
    window.__UI_REVIEW_PICKER_ACTIVE__ = true;
    capturedFrameId = validFrameId(frameId) ? Number(frameId) : capturedFrameId;

    const ui = document.createElement('div');
    ui.setAttribute('data-ui-review-picker', '');
    const shadow = ui.attachShadow({mode: 'open'});
    shadow.innerHTML = `
      <style>
        :host{all:initial;position:fixed;z-index:2147483647;inset:0;pointer-events:none;color-scheme:light}
        *{box-sizing:border-box}
        #box{position:fixed;display:none;border:2px solid #4389ff;background:rgba(67,137,255,.10);box-shadow:0 0 0 1px rgba(255,255,255,.75) inset;transition:width .06s,height .06s,left .06s,top .06s}
        #name{position:fixed;display:none;max-width:min(580px,calc(100vw - 16px));padding:4px 7px;border-radius:4px;background:#4389ff;color:#fff;font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.18)}
        #bar{position:fixed;left:50%;top:14px;transform:translateX(-50%);display:flex;align-items:center;gap:7px;max-width:calc(100vw - 20px);padding:8px 12px;border:1px solid rgba(0,0,0,.10);border-radius:8px;background:rgba(255,255,255,.98);color:#3f454d;font:12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.18)}
        kbd{min-width:22px;padding:2px 5px;border:1px solid #d5dae2;border-bottom-width:2px;border-radius:4px;background:#f7f8fa;color:#353a42;font:11px/1.1 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:center}
        .sep{width:1px;height:14px;background:#dde1e7;margin:0 1px}
        #state{color:#1769d1;font-weight:600}
      </style>
      <div id="box"></div>
      <div id="name"></div>
      <div id="bar"><span>单击或</span><kbd>Enter</kbd><span>确认</span><span class="sep"></span><kbd>↑</kbd><kbd>↓</kbd><span>微调层级</span><span class="sep"></span><kbd>Esc</kbd><span>取消</span><span id="state"></span></div>`;
    document.documentElement.append(ui);

    const box = shadow.querySelector('#box');
    const name = shadow.querySelector('#name');
    const state = shadow.querySelector('#state');
    let candidates = [];
    let index = 0;
    let current = null;
    let lastPoint = null;
    let cleaned = false;

    const usable = el => {
      if (!(el instanceof Element) || el === ui || el.closest?.('[data-ui-review-picker]')) return false;
      if (['HTML','BODY','SCRIPT','STYLE'].includes(el.tagName)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };

    const deepestAtPoint = (root, x, y) => {
      const hit = root.elementFromPoint?.(x, y);
      if (!usable(hit)) return null;
      if (hit.shadowRoot) return deepestAtPoint(hit.shadowRoot, x, y) || hit;
      return hit;
    };

    const pathFrom = el => {
      const path = [];
      let cursor = el;
      while (usable(cursor)) {
        if (!path.includes(cursor)) path.push(cursor);
        cursor = composedParent(cursor);
      }
      return path;
    };

    const pathForEvent = e => {
      const composed = e.composedPath?.().find(usable);
      const deepest = composed || deepestAtPoint(document, e.clientX, e.clientY);
      return deepest ? pathFrom(deepest) : [];
    };

    const paint = () => {
      current = candidates[index] || null;
      if (!current) {
        box.style.display = 'none';
        name.style.display = 'none';
        state.textContent = '';
        return;
      }
      const r = current.getBoundingClientRect();
      Object.assign(box.style, {display:'block', left:`${r.left}px`, top:`${r.top}px`, width:`${r.width}px`, height:`${r.height}px`});
      name.textContent = `${selector(current)}  ${round(r.width)} × ${round(r.height)}`;
      const labelWidth = 260;
      const labelTop = r.top >= 29 ? r.top - 25 : Math.min(innerHeight - 25, r.bottom + 4);
      Object.assign(name.style, {display:'block', left:`${Math.max(4, Math.min(innerWidth - labelWidth, r.left))}px`, top:`${Math.max(4, labelTop)}px`});
      state.textContent = `第 ${index + 1}/${candidates.length} 层`;
    };

    const move = e => {
      lastPoint = {x:e.clientX, y:e.clientY};
      const previous = current;
      const next = pathForEvent(e);
      candidates = next;
      index = previous && next.includes(previous) ? next.indexOf(previous) : 0;
      paint();
    };

    const cycle = delta => {
      if (!candidates.length) return;
      index = Math.max(0, Math.min(candidates.length - 1, index + delta));
      paint();
    };

    const hide = () => {
      box.style.display = 'none';
      name.style.display = 'none';
    };

    const clean = () => {
      if (cleaned) return;
      cleaned = true;
      window.__UI_REVIEW_PICKER_ACTIVE__ = false;
      window.__UI_REVIEW_PICKER_STOP__ = null;
      removeEventListener('pointermove', move, true);
      removeEventListener('click', click, true);
      removeEventListener('keydown', key, true);
      removeEventListener('wheel', wheel, true);
      removeEventListener('blur', hide, true);
      ui.remove();
    };

    const finishSession = extra => chrome.storage.local.set({
      uiReviewPickerSession: {id:sessionId, active:false, at:Date.now(), ...extra}
    });

    const confirm = async e => {
      e?.preventDefault();
      e?.stopImmediatePropagation();
      if (!current) return;
      try {
        // 采集前先滚到顶并等布局稳定，让 sticky 元素回归文档流原位（吸顶态会污染其绝对坐标）。
        const savedScroll = {x: scrollX, y: scrollY};
        window.scrollTo({left: 0, top: 0, behavior: 'instant'});
        await afterLayoutStable(null, {maxWait: 1000, stableFrames: 2});
        let data;
        try {
          data = collect(current);
        } finally {
          window.scrollTo({left: savedScroll.x, top: savedScroll.y, behavior: 'instant'});
        }
        chrome.storage.local.set({
          uiReviewRuntime: data,
          uiReviewPickerSession: {id:sessionId, active:false, selected:true, at:Date.now()}
        }, () => clean());
      } catch (err) {
        state.textContent = err.message;
        state.style.color = '#b42318';
      }
    };

    const click = e => confirm(e);
    const wheel = e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      cycle(e.deltaY > 0 ? 1 : -1);
    };
    const key = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finishSession({canceled:true});
        clean();
      } else if (e.key === 'ArrowUp' || e.key === '[') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cycle(1);
      } else if (e.key === 'ArrowDown' || e.key === ']') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cycle(-1);
      } else if (e.key === 'Enter') {
        confirm(e);
      }
    };

    window.__UI_REVIEW_PICKER_STOP__ = clean;
    addEventListener('pointermove', move, true);
    addEventListener('click', click, true);
    addEventListener('keydown', key, true);
    addEventListener('wheel', wheel, {capture:true, passive:false});
    addEventListener('blur', hide, true);

    if (lastPoint) {
      const target = deepestAtPoint(document, lastPoint.x, lastPoint.y);
      candidates = target ? pathFrom(target) : [];
      paint();
    }
  }

  chrome.storage.onChanged.addListener(changes => {
    const session = changes.uiReviewPickerSession?.newValue;
    if (session && session.active === false) window.__UI_REVIEW_PICKER_STOP__?.();
  });

  if (window.__UI_REVIEW_MESSAGE_LISTENER__) {
    chrome.runtime.onMessage.removeListener(window.__UI_REVIEW_MESSAGE_LISTENER__);
  }
  const messageListener = (m, _s, reply) => {
    if (window.__UI_REVIEW_PICKER_VERSION__ !== CONTENT_VERSION) return;
    if (m?.type?.startsWith('CAPTURE_')) {
      const respond = reply;
      reply = result => {
        const root = capturedElements.get(m.rootId || capturedRootId);
        let state = result.captureState;
        if (result.ok && !state && root?.isConnected) {
          try { state = captureState(root); } catch (_) { /* Preserve the original capture response. */ }
        }
        respond({...result, ...(state ? {captureState: state} : {}), captureContext: {
          contentVersion: CONTENT_VERSION, isTop: window === window.top,
          frameId: capturedFrameId, rootId: m.rootId || capturedRootId,
          rootKnown: Boolean(root), rootConnected: Boolean(root?.isConnected)
        }});
      };
    }
    if (m?.type === 'START_PICKER') {
      startPicker(m.sessionId, m.frameId);
      reply({ok:true, frameUrl:location.href});
    } else if (m?.type === 'STOP_PICKER') {
      window.__UI_REVIEW_PICKER_STOP__?.();
      reply({ok:true});
    } else if (m?.type === 'MEASURE_TEXT_RUN_LAYOUT') {
      try { reply({ok:true,...measureTextRunLayout(m.rootId,m.nodeIds)}); } catch(error) { reply({ok:false,error:error.message}); }
    } else if (m?.type === 'CAPTURE_ROOT_INFO') {
      try {
        reply({ok:true, ...captureRootInfo(m.rootId)});
      } catch (error) {
        reply({ok:false, error:error.message, code:error.code || null});
      }
    } else if (m?.type === 'REBIND_CAPTURE_ROOT') {
      rebindCaptureRoot(m.fingerprint || {})
        .then(result => reply({ok: true, ...result}))
        .catch(error => reply({ok: false, error: error.message, code: error.code || null}));
      return true;
    } else if (m?.type === 'CAPTURE_PRIME') {
      primeCapture(m.rootId, m.positions)
        .then(info => reply({ok: true, ...info}))
        .catch(error => reply({ok: false, error: error.message, code: error.code || null}));
      return true;
    } else if (m?.type === 'CAPTURE_HIDE_OVERLAYS') {
      try { reply({ok: true, ...hideCaptureOverlays(m.rootId, Boolean(m.includeCapturedDescendants))}); } catch (e) { reply({ok: false, error: e.message}); }
    } else if (m?.type === 'CAPTURE_RESTORE_OVERLAYS') {
      try { reply({ok: true, ...restoreCaptureOverlays()}); } catch (e) { reply({ok: false, error: e.message}); }
    } else if (m?.type === 'CAPTURE_RESTORE_SCROLL') {
      try { reply(restoreCaptureScroll(m.scroll)); } catch (e) { reply({ok: false, error: e.message}); }
    } else if (m?.type === 'CAPTURE_POSITION') {
      try { reply({ok: true, ...capturePosition(m.rootId)}); } catch (e) { reply({ok: false, error: e.message, code: e.code || null}); }
    } else if (m?.type === 'CAPTURE_SCROLL') {
      scrollCaptureTo(m.rootId, Number(m.x) || 0, Number(m.y) || 0)
        .then(position => reply({ok: true, ...position}))
        .catch(error => reply({ok: false, error: error.message, code: error.code || null}));
      return true;
    }
  };
  window.__UI_REVIEW_MESSAGE_LISTENER__ = messageListener;
  chrome.runtime.onMessage.addListener(messageListener);
})();
