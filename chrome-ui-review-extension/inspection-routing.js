/* Routing uses object evidence, never the size of a reported style difference. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./inspection-contracts.js'):root.InspectionContracts);if(typeof module==='object'&&module.exports)module.exports=api;else root.InspectionRouting=api;})(globalThis,function(C){
  'use strict';
  const VERSION='3.17.8';
  const LIMITS=Object.freeze({maxNodesPerSide:96,maxTextBytes:96000,maxRequestBytes:2400000,maxCalls:72,maxIdentityCalls:64,maxIdentityMs:100000,maxIconCalls:2,maxLayoutCalls:2,maxPreVerifyCalls:72,maxPreVerifyAiMs:120000,maxAiMs:120000,maxAttempts:2,idleMs:20000,totalMs:45000});
  const RULES=Object.freeze({
    'capture-incomplete':{action:'collect',reason:'当前检查所需的节点或几何数据不完整'},
    'outside-capture':{action:'unresolved',reason:'对象位于当前裁切范围外，不生成本次可见样式结论'},
    'background-evidence-incomplete':{action:'collect',reason:'对应区域的可见背景尚未完成采集'},
    'selected-scope':{action:'measure',reason:'用户选定的两侧范围'},
    'unique-content':{action:'measure',reason:'同一对应范围内的唯一内容对象'},
    'context-disambiguated':{action:'measure',reason:'重复内容已由独立的邻近字段区分'},
    'validated-ai-identity':{action:'measure',reason:'功能对象已确认，按具体属性定位测量对象'},
    'equivalent-wrapper':{action:'measure',reason:'完整内容对应，布局包装层允许不同'},
    'candidate-ambiguity':{action:'ai',reason:'同一功能范围内仍有多个合理候选'},
    'scope-conflict':{action:'ai',reason:'候选与所属模块的对应关系冲突'},
    'owner-unresolved':{action:'ai',reason:'文字已定位，但完整组件或属性对象尚未确定'},
    'unmatched-content':{action:'ai',reason:'可见内容尚未找到对应的功能对象'},
    'line-box-missing':{action:'collect',reason:'本项所需的文字布局边界尚未完成采集'},
    'edge-boundary-incomparable':{action:'ai',reason:'两侧边缘属于不同内容对象，需确认对应的可见对象'},
    'transparent-wrapper':{action:'unresolved',reason:'透明包装层没有可见外框，原留白指标不成立'},
    'state-role-unresolved':{action:'ai',reason:'状态组件中的角色关系尚未确定'},
    'state-policy-missing':{action:'collect',reason:'缺少验证数值与状态位置关系的依据'},
    'unsupported-measurement':{action:'unresolved',reason:'本项尚无可验证的测量方法'},
    'measurement-validated':{action:'measure',reason:'对应对象与本项测量口径均已验证'}
  });
  const finiteBox=n=>{const b=C.box(n);return b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0;};
  const visible=n=>C.visible(n);
  const template=s=>C.norm(s).replace(/\d+(?:[,.]\d+)*/g,'#');
  const related=(a,b)=>C.within(a,b)||C.within(b,a);
  function result(code,extra={}){return {version:VERSION,code,...RULES[code],...extra};}
  function init(ctx){
    if(!ctx.routing)ctx.routing={version:VERSION,decisions:[],jobs:[],limits:{...LIMITS}};
    return ctx.routing;
  }
  function record(ctx,key,decision){
    const routing=init(ctx),entry={key,...decision};
    const index=routing.decisions.findIndex(d=>d.key===key);
    if(index<0)routing.decisions.push(entry);else routing.decisions[index]=entry;
    return entry;
  }
  function scopeFor(ctx,d,r){
    for(const parent of d?._ancestors||[]){
      const target=ctx.maps.runtime.get(ctx.pairs.get(parent.id));
      if(target&&C.within(r,target)&&(C.control(parent)||C.paint(parent)||C.labels(parent).length>1||!parent._parent))return {design:parent,runtime:target};
    }
    const root=ctx.nodes.design.find(n=>!n._parent),target=root&&ctx.maps.runtime.get(ctx.pairs.get(root.id));
    return root&&target?{design:root,runtime:target}:null;
  }
  // Nested nodes carrying the same content can represent one object. Separate
  // siblings never become equivalent merely because their text/rectangles match.
  function groups(nodes){
    const out=[];
    for(const n of nodes){const g=out.find(g=>g.some(p=>related(n,p)));if(g)g.push(n);else out.push([n]);}
    return out;
  }
  function contextKeys(n,scope,own){
    return (n._ancestors||[]).filter(a=>C.within(a,scope)).map(a=>C.labels(a).filter(v=>v!==own&&!C.numeric(v)).sort().join('|')).filter(Boolean);
  }
  function localAnchors(ctx,d,r,scope,designGroups,runtimeGroups){
    // A repeated label belongs to the row containing a separately matched,
    // unique stable field. The rest of the row may contain dynamic or truncated
    // copy, so equality of the whole ancestor text is not required.
    for(const a of d._ancestors||[]){
      if(a.id===scope.design.id)break;
      if(designGroups.some(g=>!g.some(n=>C.within(d,n)||C.within(n,d))&&g.some(n=>C.within(n,a))))continue;
      const anchors=C.descendants(a).filter(n=>n.type==='TEXT'&&!C.within(n,d)&&C.text(n)&&!C.numeric(C.text(n)))
        .map(n=>({design:n,runtime:ctx.maps.runtime.get(ctx.pairs.get(n.id))}))
        .filter(p=>p.runtime&&C.text(p.design)===C.text(p.runtime)
          &&C.descendants(scope.design).filter(n=>n.type==='TEXT'&&C.text(n)===C.text(p.design)).length===1
          &&C.descendants(scope.runtime).filter(n=>C.text(n)===C.text(p.runtime)).length===1);
      if(!anchors.length)continue;
      for(const owner of [r,...(r._ancestors||[])]){
        if(owner.id===scope.runtime.id)break;
        if(runtimeGroups.some(g=>!g.some(n=>C.within(r,n)||C.within(n,r))&&g.some(n=>C.within(n,owner))))continue;
        if(anchors.some(p=>C.within(p.runtime,owner)))return true;
      }
    }
    return false;
  }
  function pair(ctx,d,r){
    if(!d||!r||!finiteBox(d)||!finiteBox(r))return result('capture-incomplete');
    const ids={designIds:[d.id],runtimeIds:[r.id]};
    if(!visible(d)||!visible(r))return result('outside-capture',ids);
    if(!d._parent&&!r._parent)return result('selected-scope',ids);
    const carrier=C.measurementCarrier?.(ctx,d,r);
    if(carrier&&carrier.design===d&&carrier.runtime===r)return result('validated-ai-identity',
      {...ids,role:carrier.identity.role,componentIdentity:carrier.identity,measurementOwner:true});
    if(ctx.instancePairs.some(p=>C.within(d,p.designNode.raw)!==C.within(r,p.runtimeNode.raw)))return result('scope-conflict',ids);
    const approved=C.approvedIdentity?.(ctx,d,r)||ctx.statePairs.find(p=>p.designId===d.id&&p.runtimeId===r.id&&p.source==='ai-role-with-structural-validation');
    if(approved&&C.pairValid(ctx,d,r))return result('validated-ai-identity',{...ids,role:approved.role});
    const scope=scopeFor(ctx,d,r);
    if(!scope||!C.within(r,scope.runtime))return result('scope-conflict',ids);
    const leaf=d.type==='TEXT',own=leaf?C.text(d):C.full(d),other=leaf?C.text(r):C.full(r);
    const dynamic=C.numeric(own)&&C.numeric(other);
    const same=own&&own===other;
    const sameTemplate=own&&other&&template(own)===template(other);
    if(!same&&!dynamic&&!sameTemplate){
      const mapped=C.descendants(d).filter(n=>n.type==='TEXT'&&C.text(n));
      const complete=mapped.length&&mapped.every(n=>{const rr=ctx.maps.runtime.get(ctx.pairs.get(n.id));return rr&&C.within(rr,r);});
      if(!leaf&&C.pairValid(ctx,d,r)&&(complete||C.componentIdentity(d,r)))
        return result('equivalent-wrapper',{...ids,anchors:mapped.map(n=>n.id),basis:complete?'complete-content':'stable-component-fields'});
      return result(leaf?'candidate-ambiguity':'owner-unresolved',ids);
    }
    const matches=(n,s)=>visible(n)&&(leaf?(s==='design'?n.type==='TEXT':Boolean(C.text(n))):Boolean((n._children||[]).length||C.full(n)))
      &&(same?(leaf?C.text(n):C.full(n))===own:dynamic?C.numeric(C.text(n)):template(C.full(n))===template(own));
    const dd=groups(C.descendants(scope.design).filter(n=>matches(n,'design'))),rr=groups(C.descendants(scope.runtime).filter(n=>matches(n,'runtime')));
    if(dd.length===1&&rr.length===1)return result(leaf?'unique-content':'equivalent-wrapper',{...ids,scopeIds:{design:scope.design.id,runtime:scope.runtime.id}});
    if(localAnchors(ctx,d,r,scope,dd,rr))return result('context-disambiguated',{...ids,anchorKind:'unique-matched-sibling'});
    // Context equality is evaluated independently of position, font, and size.
    const dk=contextKeys(d,scope.design,own);
    const candidates=rr.filter(g=>g.some(n=>contextKeys(n,scope.runtime,own).some(k=>dk.includes(k)&&k!==C.labels(scope.runtime).filter(v=>v!==own).sort().join('|'))));
    if(candidates.length===1&&candidates[0].some(n=>related(n,r)))return result('context-disambiguated',ids);
    return result('candidate-ambiguity',{...ids,candidateIds:rr.map(g=>g[0].id)});
  }
  function identities(ctx){
    init(ctx);const out=[],seen=new Set();
    for(const [did,rid] of ctx.pairs){
      const d=ctx.maps.design.get(did),r=ctx.maps.runtime.get(rid);if(!d||!r||!visible(d))continue;
      // Graphic-only identities use the icon-slot contract, not text matching.
      if(!C.full(d)&&!C.control(d)&&!C.stateRole(d))continue;
      const decision=record(ctx,'identity:'+did,pair(ctx,d,r));
      if(decision.action==='ai'){out.push({...decision,designId:did,runtimeId:rid});seen.add(did);}
    }
    for(const a of ctx.ambiguities){
      if(seen.has(a.designId)||ctx.pairs.has(a.designId))continue;
      const d=ctx.maps.design.get(a.designId);if(!visible(d))continue;
      const decision=record(ctx,'identity:'+d.id,result(a.candidates?.length?'candidate-ambiguity':'unmatched-content',{designIds:[d.id],runtimeIds:(a.candidates||[]).map(c=>c.runtimeId)}));
      out.push({...decision,designId:d.id,candidates:a.candidates||[]});seen.add(d.id);
    }
    for(const e of ctx.events.filter(e=>e.type==='owner-rejected')){
      if(seen.has(e.designId))continue;
      const d=ctx.maps.design.get(e.designId);if(!d||!visible(d)||!C.full(d)&&!C.control(d)&&!C.stateRole(d))continue;
      const decision=record(ctx,'identity:'+d.id,result('owner-unresolved',{designIds:[d.id],runtimeIds:e.runtimeId?[e.runtimeId]:[]}));
      out.push({...decision,designId:d.id,runtimeId:e.runtimeId});seen.add(d.id);
    }
    return out;
  }
  function check(ctx,c){
    const ids=c.visual?.design?.nodeIds||[],rids=c.visual?.runtime?.nodeIds||[];
    const published=c.publication;
    if(published?.reasonCode==='property-carrier-missing')return result('capture-incomplete',
      {checkId:c.id,reason:published.reason,reasonCode:published.reasonCode,identityStatus:'confirmed'});
    if(c.property==='layout.scope' && C.compareScopes) {
      const scope=C.compareScopes(ctx.maps.design.get(ids[0]),ctx.maps.runtime.get(rids[0]),ctx);
      if(scope.status!=='compatible')return result(scope.status==='conflict'?'scope-conflict':'owner-unresolved',
        {checkId:c.id,reason:scope.reason,reasonCode:scope.reasonCode,scopeDecision:scope});
    }
    if(c.property==='background-color' && published?.reasonCode?.startsWith('background-'))
      return result('background-evidence-incomplete',{checkId:c.id,reason:published.reason,reasonCode:published.reasonCode});
    // Per-edge inset publication has already verified the outer pair and its
    // exact content edge. Reuse that identity instead of requiring identical
    // dynamic product copy for the entire card again.
    const inset=/^padding-(top|right|bottom|left)$/.test(c.property)&&ids.length===1&&rids.length===1
      &&C.pairValid(ctx,ctx.maps.design.get(ids[0]),ctx.maps.runtime.get(rids[0]));
    if(inset&&published?.status==='validated'&&published.metric==='outer-to-content'
      &&published.designIds?.[0]===ids[0]&&published.runtimeIds?.[0]===rids[0])
      return result('measurement-validated',{checkId:c.id,metric:published.metric,edge:published.edge});
    if(inset&&['edge-pixels-missing','edge-geometry-missing','edge-identity-missing'].includes(published?.reasonCode)){
      const code=published.reasonCode==='edge-identity-missing'?'edge-boundary-incomparable':'line-box-missing';
      return {...result(code,{checkId:c.id}),reason:published.reason};
    }
    if(published?.status==='validated'&&['same','different','behavior'].includes(c.status)){
      const ds=published.designIds||[],rs=published.runtimeIds||[];
      if(published.ownerRole&&ds.length===1&&rs.length===1
        &&C.propertyOwnerValid(ctx,ctx.maps.design.get(ds[0]),ctx.maps.runtime.get(rs[0]),published.ownerRole))
        return result('measurement-validated',{checkId:c.id,metric:published.metric,ownerRole:published.ownerRole});
      if(published.metric==='validated-layout-review'&&ds.length&&ds.length===rs.length&&ds.every((id,i)=>C.pairValid(ctx,ctx.maps.design.get(id),ctx.maps.runtime.get(rs[i]))))
        return result('measurement-validated',{checkId:c.id,metric:published.metric});
      if(['same-slot-appearance','same-slot-geometry','numeric-segment-gap','state-invariant','same-state-variant'].includes(published.metric))
        return result('measurement-validated',{checkId:c.id,metric:published.metric});
    }
    if(['uncovered','content'].includes(c.status))return result('unmatched-content',{checkId:c.id});
    const sharedGap=/^layout\.(horizontal|vertical)-gap$/.test(c.property)
      &&published?.status==='validated'&&['content-to-content','text-frame-gap-with-ink-guard'].includes(published.metric)
      &&published.designIds?.length===2&&published.runtimeIds?.length===2;
    const verifiedGapEndpoint=i=>{
      const claim=published?.endpointIdentity?.[i];
      if(!sharedGap||!claim||ids[i]!==published.designIds[i]||rids[i]!==published.runtimeIds[i])return false;
      const d=ctx.maps.design.get(ids[i]),r=ctx.maps.runtime.get(rids[i]);
      const current=C.gapEndpointIdentity(ctx,d,r);
      return Boolean(current&&['kind','scopeIds','designIds','runtimeIds'].every(key=>
        JSON.stringify(current[key])===JSON.stringify(claim[key])));
    };
    for(let i=0;i<ids.length;i++){
      if(verifiedGapEndpoint(i))continue;
      const d=ctx.maps.design.get(ids[i]),r=ctx.maps.runtime.get(ctx.pairs.get(ids[i])||rids[i]);
      const p=pair(ctx,d,r);
      if(p.action!=='measure')return {...p,checkId:c.id};
    }
    if(published?.status==='validated'&&['same','different','behavior'].includes(c.status))return result('measurement-validated',{checkId:c.id,metric:published.metric});
    const reason=c.publication?.reason||c.judgment||'';
    if(/透明包装层/.test(reason))return result('transparent-wrapper',{checkId:c.id});
    if(/留白必须|外框|内容组/.test(reason))return result('owner-unresolved',{checkId:c.id});
    if(c.property==='layout.content-inset'){
      const edges=c.measurementEvidence;
      const groups=[edges?.design,edges?.runtime].flatMap(v=>v&&typeof v==='object'?Object.values(v):[]);
      const incomplete=groups.some(v=>v?.confidence&&v.confidence!=='high'||v?.boundaryKinds?.some(kind=>!['layout','ink'].includes(kind)));
      return incomplete?{...result('line-box-missing',{checkId:c.id}),code:'text-ink-missing',reason:'本项边缘贡献对象的可见边界尚未完成采集'}
        :result('edge-boundary-incomparable',{checkId:c.id});
    }
    if(/字形|可见内容边界/.test(reason))return {...result('line-box-missing',{checkId:c.id}),code:'text-ink-missing',reason:'本项可见文字像素边界尚未确定'};
    if(/行框|行高|布局边界.*(?:未|不)|边界.*(?:未|不).*测量|几何.*(?:缺|无效)/.test(reason))return result('line-box-missing',{checkId:c.id});
    if(/^state\./.test(c.property))return result('state-policy-missing',{checkId:c.id});
    if(/外框|内容组|属性所在节点|属性载体|端点|完整内容留白/.test(reason))return result('owner-unresolved',{checkId:c.id});
    return result('unsupported-measurement',{checkId:c.id});
  }
  function routeChecks(ctx,checks){
    return checks.filter(Boolean).filter(c => ['uncovered','content'].includes(c.status)
      || !['design','runtime'].some(side => (c.visual?.[side]?.nodeIds||[]).some(id => {
        const node=ctx.maps[side].get(id);return node&&!visible(node);
      }))).map(c=>{
      const decision=record(ctx,'check:'+c.id,check(ctx,c));
      const next={...c,routing:decision};
      if(decision.action!=='measure'&&['same','different','behavior'].includes(c.status)){
        next.candidateVerdict={status:c.status,design:c.design,runtime:c.runtime};next.status='review';next.judgment=decision.reason;
      }
      if(decision.action!=='measure'&&next.publication?.status==='validated')
        next.publication={version:VERSION,status:'pending',reason:decision.reason};
      return next;
    });
  }
  function summary(ctx){
    const routing=init(ctx),counts={measure:0,collect:0,ai:0,unresolved:0};
    for(const d of routing.decisions)counts[d.action]=(counts[d.action]||0)+1;
    return {version:VERSION,counts,decisions:routing.decisions,jobs:routing.jobs,limits:routing.limits};
  }
  return {VERSION,LIMITS,RULES,result,record,init,pair,identities,check,routeChecks,scopeFor,summary};
});
