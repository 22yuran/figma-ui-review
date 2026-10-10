/* Apply only complete, verified layout measurements to the report's final checks. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LayoutReviewDecisions = api;
})(globalThis, function () {
  'use strict';
  const VERSION = '1.0.0';
  const SIDES = ['design', 'runtime'];
  const EDGES = ['top', 'right', 'bottom', 'left'];
  const EDGE_NAMES = {top: '上', right: '右', bottom: '下', left: '左'};
  // Match popup.js compareStyle: layout gaps 1px, geometry.padding-* 1.5px.
  const TOLERANCE = {vertical_gap: 1, content_insets: 1.5};
  const clone = value => JSON.parse(JSON.stringify(value));
  const round = value => Math.round(value * 100) / 100;
  const idsValid = ids => Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length;
  const sameIds = (a, b) => idsValid(a) && idsValid(b) && a.length === b.length && a.every((id, i) => id === b[i]);
  const boxValid = b => b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k])) && b.width > 0 && b.height > 0;
  const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.011;
  const sameBox = (a, b) => boxValid(a) && boxValid(b) && ['x', 'y', 'width', 'height'].every(k => close(a[k], b[k]));
  function measuredUnion(ids, nodes, side, gap, outer, measuredEdges = EDGES) {
    const boxes = ids.map(id => {
      const n = nodes.get(id), m = n.measurement;
      const block = side === 'design' ? n.type && n.type !== 'TEXT' : ['block', 'flow-root', 'flex', 'grid', 'inline-block'].includes(n.styles?.display);
      if (outer) return n.box;
      const axes=gap?['vertical']:[...new Set(measuredEdges.map(edge=>['left','right'].includes(edge)?'horizontal':'vertical'))];
      return axes.every(axis=>['layout','ink'].includes(m?.axes?.[axis])) ? m.box : null;
    });
    assert(boxes.every(boxValid), '所选对象缺少与指标一致的完整布局边界');
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    return {x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y};
  }
  const ignored = check => ['ignored', 'deleted', 'dismissed', 'userIgnored', 'userDeleted'].some(k => check[k] === true);
  const signed = n => `${n > 0 ? '+' : ''}${round(n)}px`;
  const edgeValues = values => EDGES.map(edge => `${EDGE_NAMES[edge]} ${round(values[edge])}px`).join(' / ');
  const edgeDeltas = values => EDGES.map(edge => `${EDGE_NAMES[edge]} ${signed(values[edge])}`).join(' / ');
  const under = (id, ancestorId, nodes) => {
    const seen = new Set();
    for (let node = nodes.get(id); node && !seen.has(node.id); node = nodes.get(node.parentId)) {
      if (node.id === ancestorId) return true;
      seen.add(node.id);
    }
    return false;
  };
  function assert(condition, reason) { if (!condition) throw Error(reason); }
  function codeGroupChecks(check, packet, validation) {
    const definitions=[...['top','left','right'].map(side=>({key:`header-${side}`,group:'header',side})),
      ...['left','right','bottom'].map(side=>({key:`body-${side}`,group:'body',side})),{key:'header-body-gap'}];
    const measurements=validation.groupMeasurements;
    assert(Array.isArray(measurements)&&measurements.length===definitions.length,'代码布局缺少逐组相邻边与组间距测量');
    const units={};
    for(const side of SIDES){
      const ix=new Map(packet.sides[side].nodes.map(n=>[n.id,n])),objects=validation.objects[side];
      const ordered=objects.contentNodeIds.map(id=>ix.get(id)).sort((a,b)=>a.box.y-b.box.y);
      assert(ordered.length===2&&ordered.every(n=>boxValid(n.box)),'代码布局必须包含工具栏和完整正文');
      units[side]={outer:ix.get(objects.outerNodeIds[0]),header:ordered[0],body:ordered[1]};
    }
    return definitions.map(def=>{
      const matches=measurements.filter(m=>m.key===def.key);
      assert(matches.length===1,'代码分组测量缺失或重复');
      const m=matches[0],gap=!def.group,values={},visual={};
      assert(m.metric===(gap?'layout-group-gap':'layout-group-inset')&&(!def.side||m.side===def.side),'代码分组测量类型不一致');
      for(const side of SIDES){
        const a=units[side][gap?'header':'outer'],b=units[side][gap?'body':def.group],ab=gap?a.measurement?.box:a.box,bb=b.measurement?.box;
        assert(Array.isArray(m.boxes?.[side])&&m.boxes[side].length===2&&sameBox(m.boxes[side][0],ab)&&sameBox(m.boxes[side][1],bb),'分组测量框未对应已验证对象');
        const expected=gap?{startNodeIds:[a.id],endNodeIds:[b.id]}:{outerNodeIds:[a.id],contentNodeIds:[b.id]};
        assert(Object.keys(expected).every(key=>sameIds(m.objects?.[side]?.[key],expected[key])),'分组测量对象发生变化');
        values[side]=round(gap?bb.y-ab.y-ab.height:({top:bb.y-ab.y,left:bb.x-ab.x,right:ab.x+ab.width-bb.x-bb.width,bottom:ab.y+ab.height-bb.y-bb.height})[def.side]);
        assert(values[side]>=-0.5&&close(m.values?.[side],values[side]),'分组数值与布局框不一致');
        visual[side]={nodeIds:[a.id,b.id],boxes:gap?[clone(ab),clone(bb)]:[clone(ab)],contentBoxes:gap?[]:[clone(bb)],measurements:[]};
      }
      const delta=round(values.runtime-values.design),tolerance=gap?TOLERANCE.vertical_gap:TOLERANCE.content_insets;
      assert(close(m.delta,delta),'分组差值与布局框不一致');
      const status=Math.abs(delta)<=tolerance?'same':'different';
      if(!gap)visual.measurementSide=def.side;
      return {id:`${check.id}:code:${def.key}`,key:`code-layout-group:${check.key||check.id}:${def.key}`,
        item:gap?'代码块 · 工具栏与正文 · 纵向间距':`代码块 · ${def.group==='header'?'工具栏':'正文布局组'} · ${EDGE_NAMES[def.side]}侧可见留白`,
        property:gap?'layout.vertical-gap':'layout.group-inset',category:'layout',status,
        design:`${values.design}px`,runtime:`${values.runtime}px`,judgment:status==='same'?'布局距离一致':`前端${delta>0?'多':'少'} ${Math.abs(delta)}px`,visual,
        metrics:{measurement:m.metric,side:def.side||null,values,delta,tolerancePx:tolerance},
        measurementEvidence:{source:'verified-code-layout-group',parentCheckId:check.id,metric:m.metric,objects:clone(m.objects),boxes:clone(m.boxes),values,delta},
        derivedFrom:{checkId:check.id,packetId:packet.id,contract:'code-layout-group-insets'}};
    });
  }
  function patchFor(check, packet, row) {
    const v = row.validation, contract = v.resolutionContract;
    const gap = check.property === 'layout.vertical-gap';
    assert(gap || check.property === 'layout.content-inset', '原检查类型不支持自动裁决');
    const measurement = gap ? 'vertical_gap' : 'content_insets';
    assert(v.measurement === measurement, '复测类型不完整或与原检查不一致');
    const partial = !gap && contract?.metric === 'partial-content-insets';
    const codeMetric = !gap && contract?.metric === 'code-layout-group-insets';
    const measuredEdges = gap ? [] : partial ? v.measuredEdges : EDGES;
    assert(gap || (Array.isArray(measuredEdges) && measuredEdges.length > 0 && measuredEdges.length <= 4 && new Set(measuredEdges).size === measuredEdges.length && measuredEdges.every(edge=>EDGES.includes(edge))), '缺少有效的独立边界范围');
    assert(!partial || measuredEdges.length < 4 && sameIds(measuredEdges, contract.measuredEdges), '部分测量的边界契约不一致');
    assert(contract && contract.checkId === check.id && contract.metric === (gap ? 'complete-block-gap' : partial ? 'partial-content-insets' : codeMetric ? 'code-layout-group-insets' : 'complete-content-insets'), '缺少与原检查对应的完整测量契约');
    if(codeMetric)assert(contract.identityEvidence?.kind==='numbered-code-layout-groups' && contract.identityEvidence.headerMatched===true && contract.identityEvidence.bodyMatched===true
      && contract.identityEvidence.completeLayoutGroups===true && Array.isArray(contract.auxiliaryCoverage) && contract.auxiliaryCoverage.length>0
      && contract.auxiliaryCoverage.every(item=>item.status==='not-measured' && item.checkId===check.id), '代码布局组缺少完整身份验证或生成行号独立覆盖记录');
    assert(typeof v.boundaries === 'string' && v.boundaries.trim(), '未说明测量边界');
    const source = packet.checks?.find(c => c.id === check.id);
    assert(source && source.property === check.property, '原检查不属于本证据包或类型已变化');
    const objects = v.objects || contract.objects || row.proposal;
    const fields = gap ? ['startNodeIds', 'endNodeIds'] : ['outerNodeIds', 'contentNodeIds'];
    const visual = clone(check.visual || {}), numeric = {}, boxes = {};
    for (const side of SIDES) {
      const original = contract.originalTargets?.[side];
      assert(sameIds(original, source.targets?.[side]) && sameIds(original, check.visual?.[side]?.nodeIds), '原测量对象已变化，不能采用过期复核');
      assert(original.length === (gap ? 2 : 1), '原测量端点数量不明确');
      const selected = objects?.[side];
      assert(selected && fields.every(field => idsValid(selected[field])), '缺少已验证测量对象的节点 ID');
      const nodes = new Map((packet.sides?.[side]?.nodes || []).map(n => [n.id, n]));
      const allIds = fields.flatMap(field => selected[field]);
      assert(new Set(allIds).size === allIds.length && allIds.every(id => nodes.has(id)), '测量对象重复或超出证据范围');
      if (gap) {
        fields.forEach((field, i) => assert(selected[field].some(id => under(original[i], id, nodes)), '新对象未覆盖原测量端点'));
        assert(!selected.startNodeIds.some(a => selected.endNodeIds.some(b => under(a, b, nodes) || under(b, a, nodes))), '测量两端不能互相包含');
      } else {
        assert(sameIds(selected.outerNodeIds, original), '内部留白必须保留原始外框');
        assert(selected.contentNodeIds.every(id => id !== original[0] && under(id, original[0], nodes)), '内容节点不属于原外框');
      }
      const pair = v.boxes?.[side];
      assert(Array.isArray(pair) && pair.length === 2 && pair.every(boxValid), '缺少完整的两端测量框');
      fields.forEach((field, i) => assert(sameBox(pair[i], measuredUnion(selected[field], nodes, side, gap, i === 0, measuredEdges)), '测量框与证据包中的对象不一致'));
      boxes[side] = clone(pair);
      const [a, b] = pair;
      if (gap) {
        assert(Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x), '间距两端不在同一列');
        numeric[side] = round(b.y - a.y - a.height);
        assert(numeric[side] >= -0.5 && close(v.values?.[side], numeric[side]), '间距数值与测量框不一致');
      } else {
        const all = {top: round(b.y - a.y), right: round(a.x + a.width - b.x - b.width), bottom: round(a.y + a.height - b.y - b.height), left: round(b.x - a.x)};
        numeric[side] = Object.fromEntries(measuredEdges.map(edge=>[edge,all[edge]]));
        assert(v.values?.[side] && Object.keys(v.values[side]).length === measuredEdges.length && measuredEdges.every(edge => numeric[side][edge] >= -0.5 && close(v.values[side][edge], numeric[side][edge])), '内部留白必须包含与测量框一致的全部约定边界');
      }
      visual[side] = {...visual[side], nodeIds: allIds, boxes: gap ? clone(pair) : [clone(a)], contentBoxes: gap ? [] : [clone(b)], measurements: []};
    }
    const delta = gap ? round(numeric.runtime - numeric.design) : Object.fromEntries(measuredEdges.map(edge => [edge, round(numeric.runtime[edge] - numeric.design[edge])]));
    assert(gap ? close(v.delta, delta) : v.delta && Object.keys(v.delta).length === measuredEdges.length && measuredEdges.every(edge => close(v.delta[edge], delta[edge])), '差值与复测数值不一致');
    // Supplemental evidence may add axes, but must not silently remove a measured
    // difference or replace it with a contradictory value in the same report.
    const previous=check.partialMeasurements;
    if(previous)for(const edge of previous.measuredEdges||[]){
      assert(!gap&&measuredEdges.includes(edge),'补充测量遗漏已确认边界，保留此前测量与差异');
      assert(SIDES.every(side=>close(previous.values?.[side]?.[edge],numeric[side]?.[edge])),
        '补充测量与已确认边界矛盾，保留此前测量与差异');
    }
    const tolerance = TOLERANCE[measurement];
    const same = gap ? Math.abs(delta) <= tolerance : measuredEdges.every(edge => Math.abs(delta[edge]) <= tolerance);
    const status = same ? 'same' : 'different';
    const metrics = {measurement, values: numeric, delta, tolerancePx: tolerance, boundaries: v.boundaries};
    const judgment = gap
      ? `${same ? '完整段落间距一致' : `完整段落间距：前端${delta > 0 ? '多' : '少'} ${Math.abs(delta)}px`}（容差 ${tolerance}px）`
      : `完整可见留白${same ? '一致' : '有差异'}；前端差值：${edgeDeltas(delta)}（各边容差 ${tolerance}px）`;
    const initial = check.reviewHistory?.find(entry=>entry.source==='pre-partial-layout-review')?.original;
    const original = clone(initial || Object.fromEntries(Object.entries(check).filter(([key]) => !['adjudication', 'reviewHistory'].includes(key))));
    const resolution = clone(contract);
    const evidence = {metric: gap ? 'layout-gap' : 'layout-insets', source: 'verified-layout-candidate', resolutionContract: resolution, boundaries: v.boundaries, values: clone(numeric), delta: clone(delta), boxes: clone(boxes), objects: clone(Object.fromEntries(SIDES.map(side => [side, objects[side]])))};
    if(partial){
      const display = side=>EDGES.map(edge=>`${EDGE_NAMES[edge]} ${measuredEdges.includes(edge)?`${numeric[side][edge]}px`:'待确认'}`).join(' / ');
      return {status:'review',design:display('design'),runtime:display('runtime'),
        judgment:`${measuredEdges.map(edge=>`${EDGE_NAMES[edge]}侧${Math.abs(delta[edge])<=tolerance?'一致':`前端${delta[edge]>0?'多':'少'} ${Math.abs(delta[edge])}px`}`).join('；')}；其余边界待补充行框证据`,
        partialMeasurements:{version:VERSION,packetId:packet.id,measuredEdges:clone(measuredEdges),values:clone(numeric),delta:clone(delta),tolerancePx:tolerance,
          edgeStatus:Object.fromEntries(measuredEdges.map(edge=>[edge,Math.abs(delta[edge])<=tolerance?'same':'different'])),evidence},
        reviewHistory:check.reviewHistory||[{source:'pre-partial-layout-review',original}]};
    }
    if (!gap) delete visual.measurementSide;
    return {status, ...(codeMetric?{item:'代码块 · 内容布局组整体留白',derivedChecks:codeGroupChecks(check,packet,v)}:{}), design: gap ? `${numeric.design}px` : edgeValues(numeric.design), runtime: gap ? `${numeric.runtime}px` : edgeValues(numeric.runtime), judgment,
      visual, measurementEvidence: evidence, metrics,
      adjudication: {version: VERSION, packetId: packet.id, contract: resolution, original, decision: {status, metrics: clone(metrics)}, source: 'verified-layout-candidate'}};
  }
  function apply(report, packet, rows) {
    const result = {applied: [], partial: [], skipped: []};
    if (!Array.isArray(rows)) return result;
    const occurrences = new Map();
    rows.forEach(row => occurrences.set(row?.checkId, (occurrences.get(row?.checkId) || 0) + 1));
    for (const row of rows) {
      const checkId = row?.checkId;
      const skip = reason => result.skipped.push({checkId: checkId || null, reason});
      try {
        assert(row?.validation?.status === 'measured' && row.validation.contractVerified === true, '复测尚未通过完整契约验证');
        assert(occurrences.get(checkId) === 1, '同一检查有多个裁决建议');
        const check = report?.checks?.find(c => c.id === checkId);
        assert(check && !ignored(check), '原检查已被删除或忽略');
        assert(check.status === 'review' && !check.adjudication, '该检查已有结论，未重复裁决');
        const patch=patchFor(check, packet, row);
        if(patch.partialMeasurements && JSON.stringify(patch.partialMeasurements)===JSON.stringify(check.partialMeasurements))throw Error('相同的独立边界结果已记录，未重复写入');
        const derived=patch.derivedChecks||[];
        delete patch.derivedChecks;
        Object.assign(check, patch);
        for(const child of derived)if(!report.checks.some(existing=>existing.id===child.id||existing.key===child.key))report.checks.push(child);
        if(!patch.partialMeasurements)delete check.partialMeasurements;
        if(patch.adjudication?.contract.auxiliaryCoverage){
          report.technical=report.technical||{};
          report.technical.coverage=report.technical.coverage||{};
          const existing=report.technical.coverage.auxiliary||[];
          for(const entry of patch.adjudication.contract.auxiliaryCoverage)
            if(!existing.some(item=>item.checkId===entry.checkId&&item.property===entry.property))existing.push(clone(entry));
          report.technical.coverage.auxiliary=existing;
        }
        (patch.partialMeasurements?result.partial:result.applied).push(checkId);
      } catch (error) { skip(error.message); }
    }
    if (result.applied.length) {
      report.summary = {...report.summary, ...Object.fromEntries(Object.entries({needsAdjustment: 'different', behavior: 'behavior', needsReview: 'review', consistent: 'same', uncovered: 'uncovered'}).map(([key, status]) => [key, report.checks.filter(c => c.status === status).length]))};
    }
    return result;
  }
  return {VERSION, apply};
});
