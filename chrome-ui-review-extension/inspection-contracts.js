/* Instance identity, property owners and publication contracts. Pure snapshot code. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.InspectionContracts=api;})(globalThis,function(){
  'use strict';
  const VERSION='3.17.8';
  const norm=s=>String(s||'').normalize('NFKC').replace(/[\s\u200b\ufeff]+/g,'').toLowerCase();
  const text=n=>norm(n?.text?.direct), full=n=>norm(n?.text?.descendant||n?.text?.direct);
  const box=n=>n?._box||n?.box?.local;
  const children=n=>n?._children||[];
  const within=(n,p)=>Boolean(n&&p&&(n.id===p.id||(n._ancestors||[]).some(a=>a.id===p.id)));
  const descendants=n=>{const out=[],seen=new Set();function visit(p){if(!p||seen.has(p.id))return;seen.add(p.id);out.push(p);children(p).forEach(visit);}visit(n);return out;};
  const numeric=s=>/^[¥￥$€+-]?[\d,.]+(?:%|万|亿|元|点|件|人|次)?$/.test(norm(s));
  const valueTemplate=s=>norm(s).replace(/\d+(?:[,.]\d+)*/g,'#');
  const stable=s=>numeric(s)?'':norm(s);
  const jaccard=(a,b)=>{const aa=new Set(a),bb=new Set(b),u=new Set([...aa,...bb]);return u.size?[...aa].filter(v=>bb.has(v)).length/u.size:0;};
  const num=v=>Number.parseFloat(v)||0;
  const visible=n=>{
    const b=box(n);
    if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.width<=0||b.height<=0
      ||n.styles?.display==='none'||n.styles?.visibility==='hidden'||n.styles?.visibility==='collapse'
      ||n.styles?.opacity!=null&&Number(n.styles.opacity)===0)return false;
    let left=b.x,right=b.x+b.width,top=b.y,bottom=b.y+b.height;
    // Unlike display:none or opacity:0, visibility can be restored by a child.
    // Runtime values are computed; sparse design styles inherit the nearest
    // specified visibility encountered while walking outwards.
    let visibilityResolved=['visible','initial'].includes(n.styles?.visibility);
    for(const ancestor of n._ancestors||[]){
      const a=box(ancestor),s=ancestor.styles||{};
      if(s.display==='none'||s.opacity!=null&&Number(s.opacity)===0)return false;
      if(!visibilityResolved&&(s.visibility==='hidden'||s.visibility==='collapse'))return false;
      if(s.visibility==='visible'||s.visibility==='initial')visibilityResolved=true;
      if(!a)continue;
      if(/^(hidden|clip|scroll|auto)$/.test(s['overflow-x']||s.overflow||'')){
        left=Math.max(left,a.x);right=Math.min(right,a.x+a.width);
      }
      if(/^(hidden|clip|scroll|auto)$/.test(s['overflow-y']||s.overflow||'')){
        top=Math.max(top,a.y);bottom=Math.min(bottom,a.y+a.height);
      }
      if(right<=left||bottom<=top)return false;
    }
    // Selected root is a capture boundary even when its CSS overflow is visible.
    const rb=n._captureScope;
    if(rb&&(right<=rb.x||left>=rb.x+rb.width||bottom<=rb.y||top>=rb.y+rb.height))return false;
    return true;
  };
  function textClippedBackground(n){
    const s=n?.styles||{};
    const clips=String(s['background-clip']||s['-webkit-background-clip']||'').split(',').map(v=>v.trim());
    if(clips.length>1)return clips.every(v=>v==='text');
    return n?.geometry?.textPaint?.clip==='text'||['linear-gradient','css-gradient'].includes(n?.geometry?.textPaint?.kind)
      ||[s['background-clip'],s['-webkit-background-clip']].some(v=>String(v||'').trim()==='text');
  }
  function backgroundPaint(n){
    const s=n?.styles||{},bg=String(s['background-color']||s.background||'').trim().toLowerCase();
    if(textClippedBackground(n))return false;
    if(s['background-image']&&s['background-image']!=='none')return true;
    if(!bg||bg==='none'||bg==='transparent'||/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(bg))return false;
    if(/^#[\da-f]{8}$/.test(bg)&&bg.slice(-2)==='00')return false;
    return true;
  }
  function paint(n){
    const s=n?.styles||{};
    return Boolean(['img','svg','canvas','video'].includes(n?.tag)||n?.asset?.type==='image'&&n?.type!=='TEXT'
      ||backgroundPaint(n)
      ||['top','right','bottom','left'].some(e=>num(s[`border-${e}-width`])>0&&s[`border-${e}-style`]!=='none'||num(s[`border-${e}`]||s.border)>0&&!/\bnone\b/.test(s[`border-${e}`]||s.border||''))
      ||s['box-shadow']&&s['box-shadow']!=='none');
  }
  function visibleSurface(n){
    if(!n)return false;
    if(backgroundPaint(n)||['img','svg','canvas','video'].includes(n.tag)||n.asset?.type==='image'&&n.type!=='TEXT')return true;
    const st=n.styles||{};
    // A bottom divider establishes one edge, not a four-sided component surface.
    return ['top','right','bottom','left'].every(e=>
      (num(st[`border-${e}-width`])>0&&st[`border-${e}-style`]!=='none'
       ||num(st[`border-${e}`]||st.border)>0&&!/\bnone\b/.test(st[`border-${e}`]||st.border||''))
      &&!['transparent','rgba(0, 0, 0, 0)'].includes(st[`border-${e}-color`]));
  }
  function omitTask(ctx,check,reason){
    ctx.taskExclusions ||= new Map();
    ctx.taskExclusions.set(check.key||check.id||JSON.stringify(check.visual),{
      key:check.key,property:check.property,reason,designIds:check.visual?.design?.nodeIds,runtimeIds:check.visual?.runtime?.nodeIds});
    return null;
  }
  function singleTextRepresentation(d,r){
    const leaves=n=>descendants(n).filter(x=>visible(x)&&text(x));
    const dl=leaves(d),rl=leaves(r);
    return !control(d)&&!control(r)&&!paint(d)&&!paint(r)&&dl.length===1&&rl.length===1
      &&!descendants(d).some(graphicLeaf)&&!descendants(r).some(graphicLeaf);
  }
  function control(n){return ['button','input','select','textarea'].includes(n?.tag)||['button','tab','option','slider','progressbar','textbox','combobox'].includes(n?.role);}
  const collectionRoles=new Set(['tablist','listbox','menu','radiogroup']);
  const itemRoles=new Set(['tab','option','menuitem','menuitemcheckbox','menuitemradio','radio']);
  function describeScope(node){
    const result={nodeId:node?.id||null,kind:'unknown',role:node?.role||null,members:[],wrapperIds:[]};
    if(!node||!visible(node))return result;
    const content=n=>visible(n)&&Boolean(text(n)||full(n)||control(n)||itemRoles.has(n.role)
      ||graphicLeaf(n)||children(n).some(content));
    const member=n=>({id:n.id,label:full(n)||text(n),role:n.role||null});
    const atomic=n=>n.type==='TEXT'||Boolean(text(n))||control(n)||itemRoles.has(n.role);
    const explicit=collectionRoles.has(node.role);
    let cursor=node;
    const seen=new Set();
    while(cursor&&!seen.has(cursor.id)){
      seen.add(cursor.id);
      if(atomic(cursor)){
        return {...result,kind:explicit?'collection':'single',members:[member(cursor)]};
      }
      const units=children(cursor).filter(content);
      if(units.length>1){
        const disjoint=units.every((a,i)=>units.slice(i+1).every(b=>{
          const x=box(a),y=box(b);
          return x&&y&&(x.x+x.width<=y.x+1||y.x+y.width<=x.x+1||x.y+x.height<=y.y+1||y.y+y.height<=x.y+1);
        }));
        const independent=units.filter(n=>full(n)||control(n)||itemRoles.has(n.role));
        // An icon next to its label is one composite object, not evidence of
        // two independently selectable collection members.
        return {...result,kind:explicit||disjoint&&independent.length>=2?'collection':'unknown',members:units.map(member)};
      }
      if(units.length!==1)return {...result,kind:explicit?'collection':full(cursor)?'single':'unknown',members:full(cursor)?[member(cursor)]:[]};
      // Descend for membership only. The original node and its painted outer
      // box remain the property owner and measurement target.
      const child=units[0];
      if(full(cursor)&&full(child)&&full(cursor)!==full(child))return {...result,members:[member(child)]};
      if(cursor!==node)result.wrapperIds.push(cursor.id);
      cursor=child;
    }
    return result;
  }
  function compareScopes(designNode,runtimeNode,ctx=null){
    const design=describeScope(designNode),runtime=describeScope(runtimeNode);
    const finish=(status,reasonCode,reason)=>({status,reasonCode,reason,design,runtime});
    const nodeFor=(side,id)=>ctx?.maps?.[side]?.get(id)
      ||descendants(side==='design'?designNode:runtimeNode).find(n=>n.id===id);
    const equivalent=(a,b)=>{
      if(a.label&&a.label===b.label)return true;
      if(!ctx)return false;
      const d=nodeFor('design',a.id),r=nodeFor('runtime',b.id),mapped=ctx.maps.runtime.get(ctx.pairs.get(a.id));
      if(mapped&&within(mapped,r)&&full(d)&&full(mapped)===full(d))return true;
      const dl=descendants(d).filter(n=>visible(n)&&n.type==='TEXT'&&text(n));
      const rl=descendants(r).filter(n=>visible(n)&&text(n));
      return dl.length>0&&rl.length>0&&dl.every(n=>{
        const rr=ctx.maps.runtime.get(ctx.pairs.get(n.id));return rr&&within(rr,r);
      })&&rl.every(n=>dl.some(dn=>ctx.pairs.get(dn.id)===n.id));
    };
    const dm=design.members,rm=runtime.members;
    if(!dm.length||!rm.length)return finish('unresolved','scope-members-unresolved','尚未完整识别两侧对象包含的可见成员');
    const cover=(left,right,reverse=false)=>{
      const assigned=new Map();
      const assign=(i,seen)=>{
        for(let j=0;j<right.length;j++){
          if(seen.has(j)||!(reverse?equivalent(right[j],left[i]):equivalent(left[i],right[j])))continue;
          seen.add(j);
          if(!assigned.has(j)||assign(assigned.get(j),seen)){assigned.set(j,i);return true;}
        }
        return false;
      };
      return left.every((_,i)=>assign(i,new Set()));
    };
    const sameMembers=dm.length===rm.length&&cover(dm,rm)&&cover(rm,dm,true);
    if(sameMembers)return finish('compatible','scope-members-correspond','两侧包含相同范围的可见成员，布局包装层允许不同');
    const singleConflict=design.kind==='single'&&runtime.kind==='collection'&&rm.length>1&&cover(dm,rm)
      ||runtime.kind==='single'&&design.kind==='collection'&&dm.length>1&&cover(rm,dm,true);
    if(singleConflict)return finish('conflict','scope-item-vs-collection','单个成员与包含其他独立成员的集合不能直接比较');
    const explicit=collectionRoles.has(design.role)||collectionRoles.has(runtime.role);
    if(explicit&&design.kind==='collection'&&runtime.kind==='collection'&&dm.length!==rm.length
      &&(dm.length<rm.length?cover(dm,rm):cover(rm,dm,true)))
      return finish('conflict','scope-collection-members-differ','两侧集合包含的可见成员数量或范围不同');
    if(ctx&&approvedIdentity(ctx,designNode,runtimeNode))
      return finish('compatible','contextual-scope-correspond','功能范围已由局部上下文确认，显示内容允许不同');
    return finish('unresolved','scope-members-unresolved','两侧可见成员的完整对应关系尚未确定');
  }
  // Candidate generation only rejects a demonstrated item/collection conflict.
  // Unknown metadata is not proof that an object is a single collection member.
  function semanticScopesCompatible(d,r,ctx=null){return compareScopes(d,r,ctx).status!=='conflict';}
  function ownsLayout(n){
    if(children(n).length||control(n)||paint(n))return true;
    // A block containing direct text is a real layout object even without an
    // extra span. Figma INSTANCE -> TEXT and DOM div(text) may be equivalent.
    if(text(n)&&['block','flex','grid','inline-block','inline-flex','flow-root'].includes(n.styles?.display)&&box(n)?.height>0)return true;
    const b=box(n),runs=n?.geometry?.textBoxes||[];
    return Boolean(b&&runs.length&&['top','right','bottom','left'].some(e=>num(n.styles?.[`padding-${e}`])>0)
      &&runs.every(r=>r.x>=b.x-.5&&r.y>=b.y-.5&&r.x+r.width<=b.x+b.width+.5&&r.y+r.height<=b.y+b.height+.5)
      &&runs.some(r=>r.width<b.width-1||r.height<b.height-1));
  }
  function labels(n){return [...new Set(descendants(n).map(e=>stable(e.text?.direct)).filter(Boolean))];}
  function componentIdentity(d,r){
    const dl=labels(d),rl=labels(r);
    if(!ownsLayout(d)||!ownsLayout(r))return false;
    if(full(d)&&full(d)===full(r)&&dl.length===1&&rl.length===1)return true;
    return children(d).length>0&&children(r).length>0&&dl.length>=2&&jaccard(dl,rl)>=.6;
  }
  // Algorithmic text evidence stays conservative. An explicit contextual AI
  // decision is a separate identity contract; paint and text equality are not
  // prerequisites for that decision to remain valid.
  function approvedIdentity(ctx,d,r){
    if(!d||!r||ctx.pairs.get(d.id)!==r.id)return null;
    return ctx.statePairs.find(p=>p.designId===d.id&&p.runtimeId===r.id
      &&p.source==='ai-role-with-structural-validation'
      &&p.identityContract==='contextual-functional-v1'
      &&within(d,ctx.maps.design.get(p.designScopeId))&&within(r,ctx.maps.runtime.get(p.runtimeScopeId))
      &&ctx.pairs.get(p.designScopeId)===p.runtimeScopeId)||null;
  }
  function componentOuter(node,scope){
    if(!node||node.type==='TEXT')return null;
    if(paint(node)||control(node))return node;
    // Only a single-child envelope can transfer a component's identity to an
    // ancestor. A nearby card/header containing other independent content cannot.
    let cursor=node;
    while(cursor._parent&&cursor._parent!==scope){
      const parent=cursor._parent,units=children(parent).filter(visible);
      if(units.length!==1||units[0]!==cursor)break;
      if(paint(parent)||control(parent))return parent;
      cursor=parent;
    }
    const painted=paintedWithin(node).filter(n=>!paintedWithin(node).some(p=>p!==n&&within(n,p)));
    if(painted.length===1)return painted[0];
    cursor=node;
    while(children(cursor).filter(visible).length===1){
      cursor=children(cursor).filter(visible)[0];
      if(cursor.type==='TEXT'||text(cursor)&&!children(cursor).length&&!paint(cursor)&&!control(cursor))break;
      if(paint(cursor)||control(cursor))return cursor;
    }
    return null;
  }
  function measurementCarrier(ctx,d,r){
    if(!d||!r)return null;
    const matches=[];
    for(const p of ctx.statePairs){
      if(!['component','content-group','button'].includes(p.role))continue;
      const dn=ctx.maps.design.get(p.designId),rn=ctx.maps.runtime.get(p.runtimeId);
      // The paint owner can only be an ancestor/descendant of its component.
      // Eliminate unrelated components before walking their full paint trees.
      if(!dn||!rn||!(within(d,dn)||within(dn,d))||!(within(r,rn)||within(rn,r)))continue;
      if(!approvedIdentity(ctx,dn,rn))continue;
      const design=componentOuter(dn,ctx.maps.design.get(p.designScopeId));
      const runtime=componentOuter(rn,ctx.maps.runtime.get(p.runtimeScopeId));
      if(!design||!runtime||!visible(design)||!visible(runtime))continue;
      if((d===dn||d===design)&&(r===rn||r===runtime))matches.push({design,runtime,
        identity:{designId:dn.id,runtimeId:rn.id,role:p.role},source:'contextual-component-paint-owner'});
    }
    const unique=[...new Map(matches.map(p=>[p.design.id+'|'+p.runtime.id,p])).values()];
    return unique.length===1?unique[0]:null;
  }
  function completeTextCarrier(ctx,d,r){
    if(!d||!r||d.type!=='TEXT'||!text(d))return null;
    const selected=ctx.maps.runtime.get(ctx.pairs.get(d.id)),identity=approvedIdentity(ctx,d,selected);
    if(!identity||!['text','value','unit'].includes(identity.role)||!selected||!within(selected,r))return null;
    const target=text(d),part=full(selected);
    if(!part||part===target||!target.includes(part))return null;
    const scope=ctx.maps.runtime.get(identity.runtimeScopeId);
    for(const owner of selected._ancestors||[]){
      if(!within(owner,scope))break;
      // A split DOM text run may omit the number/link suffix from the AI's
      // chosen anchor. Reconstruct only a proven complete text group; do not
      // enlarge a text measurement into a card containing unrelated controls.
      if(full(owner)!==target)continue;
      const visibleNodes=descendants(owner).filter(visible);
      if(visibleNodes.some(n=>n!==owner&&(control(n)||graphicLeaf(n))))continue;
      const runs=visibleNodes.filter(n=>text(n));
      if(runs.length<2||norm(runs.map(n=>n.text.direct).join(''))!==target)continue;
      if(r!==selected&&r!==owner)return null;
      return {design:d,runtime:owner,anchor:selected,identity};
    }
    return null;
  }
  const sameFootprint=(a,b)=>{
    const x=box(a),y=box(b);
    return Boolean(x&&y&&Math.abs(x.x-y.x)<=2&&Math.abs(x.y-y.y)<=2
      &&Math.abs(x.width-y.width)<=2&&Math.abs(x.height-y.height)<=2);
  };
  // A component and the layer painting it are different identities. A transparent
  // DOM wrapper may still be the correct component when a child paints its shape.
  function paintedWithin(n){
    return descendants(n).filter(p=>p!==n&&paint(p)&&sameFootprint(p,n));
  }
  function sharedCarrier(ctx,aId,bId,r){
    const a=ctx.maps.design.get(aId),b=ctx.maps.design.get(bId);
    return Boolean(a&&b&&r&&(within(a,b)||within(b,a))&&full(a)&&full(a)===full(b)
      &&(full(a)===full(r)||approvedIdentity(ctx,a,r)||approvedIdentity(ctx,b,r)));
  }
  function contexts(n){
    const own=text(n),out=[];let last='';
    for(const a of n._ancestors||[]){
      const ls=labels(a).filter(s=>s!==own),key=ls.slice().sort().join('|');
      if(ls.length&&key!==last){out.push({node:a,labels:ls});last=key;}
      if(out.length===3)break;
    }return out;
  }
  function contextScore(d,r){
    const dc=d._inspectionContexts||contexts(d),rc=r._inspectionContexts||contexts(r);
    if(!dc.length||!rc.length)return 0;
    return dc.reduce((sum,c,i)=>sum+Math.max(...rc.map((v,j)=>jaccard(c.labels,v.labels)/(1+Math.abs(i-j)*.4)))/(i+1),0)/dc.reduce((sum,_,i)=>sum+1/(i+1),0);
  }
  function relative(n){
    const b=box(n),a=(n._inspectionContexts||contexts(n))[0]?.node,ab=box(a);
    return ab?{x:(b.x-ab.x)/Math.max(ab.width,1),y:(b.y-ab.y)/Math.max(ab.height,1)}:{x:n._nx||0,y:n._ny||0};
  }
  function leafScore(d,r){
    const same=text(d)===text(r),dynamic=numeric(text(d))&&numeric(text(r));
    if(!same&&!dynamic)return null;
    const context=contextScore(d,r),dp=relative(d),rp=relative(r);
    if(dynamic&&context<.75)return null;
    const local=Math.abs(dp.x-rp.x)+Math.abs(dp.y-rp.y);
    const absolute=Math.abs((d._nx||0)-(r._nx||0))+Math.abs((d._ny||0)-(r._ny||0));
    return {score:context*100+Math.max(0,24-local*24)+Math.max(0,8-absolute*16),context,dynamic};
  }
  function stateRole(n){
    const role=n?.role||n?.inspectionRole;
    if(['slider','progressbar','tooltip'].includes(role))return role;
    // Names are proposals, not proof of a state exemption.
    return null;
  }
  function makeContext(designNodes,runtimeNodes,hooks={}){
    const maps={design:new Map(designNodes.map(n=>[n.id,n])),runtime:new Map(runtimeNodes.map(n=>[n.id,n]))};
    const ctx={version:VERSION,nodes:{design:designNodes,runtime:runtimeNodes},maps,hooks,pairs:new Map(),reverse:new Map(),events:[],ambiguities:[],statePairs:[],instancePairs:[]};
    for(const nodes of [designNodes,runtimeNodes])for(const n of nodes)n._inspectionContexts=contexts(n);
    return ctx;
  }
  function clearImageSlots(ctx){
    // These edges are derived from current group evidence. A later review must
    // not consume them as independent proof or retain a revoked image identity.
    for(const [d,r] of ctx._imageSlotOwned||[]){
      if(ctx.pairs.get(d)===r)ctx.pairs.delete(d);
      if(ctx.reverse.get(r)===d)ctx.reverse.delete(r);
    }
    ctx._imageSlotOwned=new Map();ctx.imageSlotPairs=[];
  }
  function registerImageSlots(ctx,slots){
    clearImageSlots(ctx);
    const accepted=[],rejected=[],groups=new Map();
    for(const slot of slots||[]){
      const e=slot.identity,key=JSON.stringify([e?.scope,e?.designIds,e?.runtimeIds]);
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(slot);
    }
    for(const batch of groups.values()){
      const e=batch[0].identity,dd=e?.designIds||[],rr=e?.runtimeIds||[];
      const ds=ctx.maps.design.get(e?.scope?.designId),rs=ctx.maps.runtime.get(e?.scope?.runtimeId);
      const da=ctx.maps.design.get(e?.anchor?.designId),ra=ctx.maps.runtime.get(e?.anchor?.runtimeId);
      let reason='';
      if(!ds||!rs||e?.kind!=='ordered-image-slot'||!e.scopeUnique||dd.length!==rr.length||dd.length!==batch.length
        ||!dd.length||new Set(dd).size!==dd.length||new Set(rr).size!==rr.length)reason='图片槽位组或所属范围不完整';
      else if(e.basis==='stable-text-anchor'
        ?!da||!ra||!within(da,ds)||!within(ra,rs)||!text(da)||text(da)!==text(ra)||ctx.pairs.get(da.id)!==ra.id
        :e.basis!=='matched-parent'||!pairValid(ctx,ds,rs))reason='图片槽位的模块依据已失效';
      if(!reason)for(let i=0;i<dd.length;i++){
        const d=ctx.maps.design.get(dd[i]),r=ctx.maps.runtime.get(rr[i]);
        const slot=batch.find(p=>p.identity?.slotIndex===i);
        if(!slot||slot.status!=='validated'||slot.source!=='verified-image-group'
          ||slot.designId!==dd[i]||slot.runtimeId!==rr[i]
          ||!d||!r||d.type==='TEXT'||d.asset?.type!=='image'||r.tag!=='img'||!within(d,ds)||!within(r,rs)
          ||!visible(d)||!visible(r)){reason='图片槽位对象或顺序无效';break;}
        if(ctx.pairs.has(d.id)&&ctx.pairs.get(d.id)!==r.id||ctx.reverse.has(r.id)&&ctx.reverse.get(r.id)!==d.id){reason='图片槽位与已有对应关系冲突';break;}
      }
      if(reason){rejected.push(...batch.map(p=>({...p,reason})));continue;}
      for(const slot of batch){
        if(!ctx.pairs.has(slot.designId))ctx._imageSlotOwned.set(slot.designId,slot.runtimeId);
        ctx.pairs.set(slot.designId,slot.runtimeId);ctx.reverse.set(slot.runtimeId,slot.designId);accepted.push(slot);
      }
    }
    ctx.imageSlotPairs=accepted;
    return {accepted,rejected};
  }
  function matchInstances(ctx,ds,rs){
    const candidate=n=>children(n).length&&labels(n).length>=2&&(paint(n)||['dialog','navigation','banner','region','table'].includes(n.role)||['dialog','header','nav','aside','section'].includes(n.tag));
    const get=nodes=>nodes.filter(n=>n._parent&&candidate(n)&&!((n._ancestors||[]).some(a=>a._parent&&candidate(a)&&jaccard(labels(n),labels(a))===1)));
    const dd=get(ctx.nodes.design),rr=get(ctx.nodes.runtime),rank=[];
    for(const d of dd)for(const r of rr){
      const sim=jaccard(labels(d),labels(r));if(sim<.6)continue;
      rank.push({d,r,score:sim*100+contextScore(d,r)*20});
    }
    const usedD=new Set(),usedR=new Set();
    for(const p of rank.sort((a,b)=>b.score-a.score)){
      if(usedD.has(p.d.id)||usedR.has(p.r.id))continue;
      const other=rank.filter(q=>(q.d===p.d||q.r===p.r)&&q!==p);
      if(other.some(q=>p.score-q.score<6))continue;
      if(ctx.instancePairs.some(q=>CROSS(p.d,q.designNode.raw)!==CROSS(p.r,q.runtimeNode.raw)))continue;
      usedD.add(p.d.id);usedR.add(p.r.id);ctx.pairs.set(p.d.id,p.r.id);ctx.reverse.set(p.r.id,p.d.id);
      ctx.instancePairs.push({designNode:structureNode(ds,p.d),runtimeNode:structureNode(rs,p.r),score:p.score,unique:true,basis:['组件稳定字段集合','父模块实例约束'],inspectionIdentity:{kind:'component-instance'}});
    }
    function CROSS(a,b){return within(a,b)?'inside':within(b,a)?'outside':'separate';}
  }
  function structureNode(structure,raw){
    let node=structure.nodes.find(n=>n.raw.id===raw.id);if(node)return node;
    const parent=(raw._ancestors||[]).map(a=>structure.nodes.find(n=>n.raw.id===a.id)).find(Boolean)||null;
    const role=raw.type==='TEXT'||text(raw)?'text':control(raw)?'button':'container';
    node={id:raw.id,raw,rawIndex:raw._index,role,direction:raw.styles?.['flex-direction']==='column'?'vertical':'horizontal',parent,children:[],anchors:[{compact:full(raw),text:raw.text?.descendant}],primaryAnchor:full(raw),areaKey:parent?.areaKey||'root',structureKey:`inspection:${raw.id}`,controls:[],childRoles:[],childShapes:[]};
    structure.nodes.push(node);return node;
  }
  function pairLeaves(ctx,ds,rs){
    const d=ctx.nodes.design.filter(n=>n.type==='TEXT'&&text(n)&&visible(n));
    const r=ctx.nodes.runtime.filter(n=>text(n)&&visible(n));
    const candidates=[];
    for(const dn of d)for(const rn of r){
      if(ctx.instancePairs.some(p=>within(dn,p.designNode.raw)!==within(rn,p.runtimeNode.raw)))continue;
      const score=leafScore(dn,rn);if(score)candidates.push({d:dn,r:rn,...score});
    }
    const usedD=new Set(),usedR=new Set(),pairs=[];
    candidates.sort((a,b)=>b.score-a.score);
    for(const c of candidates){
      if(usedD.has(c.d.id)||usedR.has(c.r.id))continue;
      // Compare against ALL alternatives, including claimed ones. Assignment order
      // must never turn a repeated label into an apparently unique label.
      const da=candidates.filter(p=>p.d===c.d&&p.r!==c.r),ra=candidates.filter(p=>p.r===c.r&&p.d!==c.d);
      const margin=Math.min(c.score-Math.max(-Infinity,...da.map(p=>p.score)),c.score-Math.max(-Infinity,...ra.map(p=>p.score)));
      if(margin<6||(c.dynamic&&c.context<.75))continue;
      usedD.add(c.d.id);usedR.add(c.r.id);ctx.pairs.set(c.d.id,c.r.id);ctx.reverse.set(c.r.id,c.d.id);
      pairs.push({designNode:structureNode(ds,c.d),runtimeNode:structureNode(rs,c.r),unique:true,score:c.score,basis:[c.dynamic?'同字段动态数值':'文字功能位置','邻近内容与实例上下文','双向候选分离'],inspectionIdentity:{kind:c.dynamic?'data-slot':'text-slot',context:c.context,margin:Number.isFinite(margin)?margin:null}});
    }
    for(const n of d)if(!usedD.has(n.id))ctx.ambiguities.push({designId:n.id,reason:'功能位置尚未唯一对应',candidates:candidates.filter(c=>c.d===n).sort((a,b)=>b.score-a.score).slice(0,6).map(c=>({runtimeId:c.r.id,score:c.score}))});
    return pairs;
  }
  function resolveOwner(ctx,d,original){
    if(d.type==='TEXT')return ctx.maps.runtime.get(ctx.pairs.get(d.id))||original;
    const leaves=descendants(d).filter(n=>n.type==='TEXT'&&text(n));
    const mapped=leaves.map(n=>ctx.maps.runtime.get(ctx.pairs.get(n.id))).filter(Boolean);
    if(!mapped.length)return original;
    const dText=full(d),candidates=[mapped[0],...(mapped[0]._ancestors||[])].filter(n=>mapped.every(m=>within(m,n)));
    const dPaint=paint(d)||control(d),db=box(d);
    const exact=leaves.length===mapped.length;
    const options=candidates.filter(n=>{
      if(!visible(n))return false;
      if(!ownsLayout(n)&&!singleTextRepresentation(d,n))return false;
      if(!visibleSurface(d)&&visibleSurface(n))return false;
      if(!control(d)&&control(n)&&!visibleSurface(d))return false;
      if(compareScopes(d,n,ctx).status==='conflict')return false;
      if(!descendants(d).some(graphicLeaf)&&descendants(n).some(graphicLeaf))return false;
      if(dPaint&&!paint(n)&&!control(n)&&!paintedWithin(n).length)return false;
      // Do not climb into another independent component just to find padding.
      const rt=descendants(n).filter(e=>text(e));
      if(exact&&rt.some(e=>!mapped.some(m=>m.id===e.id)&&!numeric(text(e))))return false;
      return full(n)===dText||exact;
    }).map(n=>{
      const rb=box(n),size=Math.abs(Math.log(Math.max(db.width,1)/Math.max(rb.width,1)))+Math.abs(Math.log(Math.max(db.height,1)/Math.max(rb.height,1)));
      // A painted design outer must prefer a painted runtime ancestor even if
      // its own direct text list is incomplete (e.g. a divider plus content).
      return {n,score:(dPaint&&paint(n)?2:0)+(dPaint&&control(n)?1:0)-size};
    }).sort((a,b)=>b.score-a.score);
    if(!options.length)return null;
    // Wrappers with identical rectangles are equivalent for geometry, but the
    // actual painted/control owner wins for a visible component.
    let owner=options[0].n;
    // A margin wrapper may own external spacing, but it cannot replace the
    // visible paint owner of a painted design component. Keep that relation
    // separate from any later adjacent-gap measurement.
    for(const {n} of options){
      const a=box(owner),b=box(n);
      if(n!==owner&&within(owner,n)&&full(owner)===full(n)
        &&(!dPaint||paint(n)||control(n))
        &&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<.01)
        &&['top','right','bottom','left'].some(e=>num(n.styles?.[`margin-${e}`])!==0))owner=n;
    }
    return owner;
  }
  function reconcile(ctx,ds,rs,legacy){
    matchInstances(ctx,ds,rs);
    const leafPairs=pairLeaves(ctx,ds,rs),leafIds=new Set(ctx.nodes.design.filter(n=>n.type==='TEXT').map(n=>n.id));
    const result=[...ctx.instancePairs],instances=new Set(result.map(m=>m.designNode.id));
    for(const m of legacy){
      const d=m.designNode.raw,r=m.runtimeNode.raw;if(leafIds.has(d.id)||instances.has(d.id))continue;
      const owner=m.designNode.role==='root'?r:resolveOwner(ctx,d,r);
      if(!owner){ctx.events.push({type:'owner-rejected',designId:d.id,runtimeId:r.id});continue;}
      const next={...m,runtimeNode:structureNode(rs,owner),layoutOnly:Boolean(m.layoutOnly),basis:[...(m.basis||[]).filter(b=>!b.includes('共用 DOM')), '属性外框与内容分别定位']};
      if(owner.id!==r.id){next.layoutOnly=false;ctx.events.push({type:'owner-repaired',designId:d.id,from:r.id,to:owner.id});}
      next.inspectionIdentity={kind:'layout-owner',contentMapped:descendants(d).filter(n=>ctx.pairs.has(n.id)).length};result.push(next);
    }
    result.push(...leafPairs);
    // Previously missing wrappers are rebuilt from their mapped content, rather
    // than relying on the old matcher to have produced a padding check already.
    const present=new Set(result.map(m=>m.designNode.raw.id));
    for(const d of ctx.nodes.design){
      if(present.has(d.id)||!children(d).length||d.type==='TEXT')continue;
      if(!paint(d)&&!['top','right','bottom','left'].some(e=>num(d.styles?.[`padding-${e}`])>0))continue;
      const owner=resolveOwner(ctx,d,null);if(!owner)continue;
      const sn=structureNode(ds,d),rn=structureNode(rs,owner);
      result.push({designNode:sn,runtimeNode:rn,unique:true,score:100,layoutOnly:true,basis:['完整对应内容定位属性外框'],inspectionIdentity:{kind:'layout-owner'}});
    }
    for(const m of result){const d=m.designNode.raw,r=m.runtimeNode.raw;ctx.pairs.set(d.id,r.id);if(!ctx.reverse.has(r.id))ctx.reverse.set(r.id,d.id);}
    ctx.structureMatches=result;
    return result;
  }
  function canonicalEndpoint(n){
    let p=n;
    while(p&&!paint(p)&&!control(p)&&!text(p)&&!p.geometry?.hasPseudoContent){
      const cc=children(p).filter(visible);if(cc.length!==1)break;p=cc[0];
    }return p;
  }
  function measured(ctx,n,side,axis,forceText=false){
    if(n?._compound){
      const mm=n._compound.map(p=>measured(ctx,p,side,axis));
      if(mm.some(m=>!m))return null;
      const bb=mm.map(m=>m.box),x=Math.min(...bb.map(b=>b.x)),y=Math.min(...bb.map(b=>b.y));
      return {box:{x,y,width:Math.max(...bb.map(b=>b.x+b.width))-x,height:Math.max(...bb.map(b=>b.y+b.height))-y},
        axes:{horizontal:'layout',vertical:'layout'},source:'verified-member-union'};
    }
    const m=(forceText&&ctx.hooks.measureText?ctx.hooks.measureText(n,side):ctx.hooks.measure?.(n,side))||{box:box(n),axes:{horizontal:'layout',vertical:'layout'},source:'element-layout'};
    return m?.box&&(!axis||['layout','ink'].includes(m.axes?.[axis]))?m:null;
  }
  function visual(ds,rs,db,rb){const groups=ns=>ns.filter(n=>n._compound).map(n=>({id:n.id,memberIds:n._compound.map(m=>m.id)}));return {design:{groups:groups(ds),nodeIds:ds.map(n=>n.id),boxes:db||ds.map(box),measurements:[]},runtime:{groups:groups(rs),nodeIds:rs.map(n=>n.id),boxes:rb||rs.map(box),measurements:[]}};}
  function value(v){return `${Math.round(v*100)/100}px`;}
  function compoundNode(ctx,check,side,id){
    const record=check.visual?.[side]?.groups?.find(g=>g.id===id);
    if(!record||!record.memberIds?.length||new Set(record.memberIds).size!==record.memberIds.length)return null;
    const members=record.memberIds.map(x=>ctx.maps[side].get(x));
    if(members.some(n=>!n||!visible(n)))return null;
    const boxes=members.map(box),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
    return {id,_compound:members,_children:[],_ancestors:[],styles:{},
      _box:{x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y}};
  }
  function pairValid(ctx,d,r){
    if(!d||!r)return false;
    if(d._compound||r._compound){
      if(!d._compound||!r._compound)return false;
      const dd=d._compound,rr=r._compound;
      return dd.length===rr.length&&dd.every(a=>rr.some(b=>pairValid(ctx,a,b)))
        &&rr.every(b=>dd.some(a=>pairValid(ctx,a,b)));
    }
    if(approvedIdentity(ctx,d,r))return true;
    const textCarrier=completeTextCarrier(ctx,d,r);
    if(textCarrier&&textCarrier.runtime===r)return true;
    const carrier=measurementCarrier(ctx,d,r);
    if(carrier&&carrier.design===d&&carrier.runtime===r)return true;
    const expected=ctx.pairs.get(d.id);if(expected&&expected!==r.id)return false;
    if(!expected&&ctx.reverse.has(r.id)&&ctx.reverse.get(r.id)!==d.id&&!sharedCarrier(ctx,d.id,ctx.reverse.get(r.id),r))return false;
    if(d.type==='TEXT')return expected===r.id;
    const dl=descendants(d).filter(n=>n.type==='TEXT'&&ctx.pairs.has(n.id));
    if(dl.length&&!dl.every(n=>within(ctx.maps.runtime.get(ctx.pairs.get(n.id)),r)))return false;
    // Component identity comes from its structure and stable content. The visible
    // background can live on a child/ancestor on one side; resolveStyle verifies
    // that property's carrier separately. Do not apply this exception to buttons.
    const component=ctx.statePairs.find(p=>p.role==='component'&&p.designId===d.id&&p.runtimeId===r.id
      &&p.source==='ai-role-with-structural-validation'
      &&within(d,ctx.maps.design.get(p.designScopeId))&&within(r,ctx.maps.runtime.get(p.runtimeScopeId))
      &&ctx.pairs.get(p.designScopeId)===p.runtimeScopeId
      &&componentIdentity(d,r));
    if((paint(d)||control(d))&&!paint(r)&&!control(r)&&!component
      &&!(expected===r.id&&componentIdentity(d,r)&&paintedWithin(r).length))return false;
    if(children(d).length&&!ownsLayout(r)&&!singleTextRepresentation(d,r))return false;
    return Boolean(expected===r.id||dl.length);
  }
  const graphicLeaf=n=>Boolean(n&&(n.role==='icon'||['VECTOR','IMAGE'].includes(n.type)
    ||n.asset?.type==='image'||['path','img','canvas'].includes(n.tag)
    ||n.tag==='svg'&&!descendants(n).some(p=>p!==n&&p.tag==='path')));
  function gapEndpointIdentity(ctx,d,r){
    if(!d||!r||!pairValid(ctx,d,r))return null;
    const scope=(d._ancestors||[]).map(a=>({design:a,runtime:ctx.maps.runtime.get(ctx.pairs.get(a.id))}))
      .find(p=>p.runtime&&within(r,p.runtime)
        &&(pairValid(ctx,p.design,p.runtime)||!p.design._parent&&!p.runtime._parent));
    if(!scope)return null;
    const scopeIds={design:scope.design.id,runtime:scope.runtime.id};
    const textCarrier=completeTextCarrier(ctx,d,r);
    if(textCarrier&&textCarrier.runtime===r)return {kind:'complete-split-text-slot',scopeIds,
      designIds:[d.id],runtimeIds:[r.id],anchorRuntimeId:textCarrier.anchor.id};
    const contextual=approvedIdentity(ctx,d,r);
    if(contextual)return {kind:'contextual-functional-slot',scopeIds,designIds:[d.id],runtimeIds:[r.id]};
    if(graphicLeaf(d)||graphicLeaf(r)){
      if(!scope.design._parent||!graphicLeaf(d)||!graphicLeaf(r)||ctx.pairs.get(d.id)!==r.id)return null;
      const designGraphics=descendants(scope.design).filter(graphicLeaf);
      const runtimeGraphics=descendants(scope.runtime).filter(graphicLeaf);
      // A single slot may have a wrapper (SVG) and one path. Count only the
      // innermost rendered graphic, never the SVG wrapper as a second icon.
      const leaves=ns=>ns.filter(n=>!ns.some(p=>p!==n&&within(p,n)));
      if(leaves(designGraphics).length!==1||leaves(runtimeGraphics).length!==1
        ||leaves(designGraphics)[0].id!==d.id||leaves(runtimeGraphics)[0].id!==r.id)return null;
      return {kind:'unique-graphic-slot',scopeIds,designIds:[d.id],runtimeIds:[r.id]};
    }
    if(d.type==='TEXT'||!children(d).length||!children(r).length)return null;
    const mapped=descendants(d).filter(n=>n.type==='TEXT'&&text(n)&&ctx.pairs.has(n.id));
    if(mapped.some(n=>!within(ctx.maps.runtime.get(ctx.pairs.get(n.id)),r)))return null;
    const count=(root,side)=>{const result=new Map();for(const n of descendants(root)){
      if(side==='design'&&n.type!=='TEXT'||side==='runtime'&&!text(n))continue;
      const label=text(n);if(label)result.set(label,(result.get(label)||0)+1);
    }return result;};
    const designCounts=count(scope.design,'design'),runtimeCounts=count(scope.runtime,'runtime');
    const anchors=mapped.filter(n=>{
      const label=text(n),other=ctx.maps.runtime.get(ctx.pairs.get(n.id));
      return !numeric(label)&&label===text(other)&&designCounts.get(label)===1&&runtimeCounts.get(label)===1;
    });
    if(anchors.length<2)return null;
    return {kind:'unique-content-anchors',scopeIds,designIds:anchors.map(n=>n.id),
      runtimeIds:anchors.map(n=>ctx.pairs.get(n.id))};
  }
  function propertyOwnerValid(ctx,d,r,property){
    if(!d||!r||!['border-radius','background-color'].includes(property))return false;
    if(pairValid(ctx,d,r))return true;
    if(ctx.pairs.has(d.id)&&ctx.pairs.get(d.id)!==r.id)return false;
    if(ctx.reverse.has(r.id)&&ctx.reverse.get(r.id)!==d.id)return false;
    if(!visible(d)||!visible(r))return false;
    const designScope=[d,...(d._ancestors||[])].find(a=>{
      const other=ctx.maps.runtime.get(ctx.pairs.get(a.id));
      return other&&within(r,other)&&pairValid(ctx,a,other)
        &&(a._parent||a.id===d.id);
    });
    if(!designScope)return false;
    const runtimeScope=ctx.maps.runtime.get(ctx.pairs.get(designScope.id));
    if(!within(d,designScope)||!within(r,runtimeScope))return false;
    const db=box(d),rb=box(r),sb=box(designScope),tb=box(runtimeScope);
    if(!db||!rb||!sb||!tb)return false;
    const center=(b,p)=>({x:(b.x+b.width/2-p.x)/Math.max(1,p.width),y:(b.y+b.height/2-p.y)/Math.max(1,p.height)});
    const a=center(db,sb),b=center(rb,tb);
    // This is an identity guard, not a demand for equal final geometry.
    return Math.abs(a.x-b.x)<=.22&&Math.abs(a.y-b.y)<=.22
      &&Math.min(db.width,rb.width)/Math.max(db.width,rb.width)>=.45
      &&Math.min(db.height,rb.height)/Math.max(db.height,rb.height)>=.45;
  }
  function hold(check,reason,reasonCode){return {...check,status:'review',judgment:reason,publication:{version:VERSION,status:'pending',reason,...(reasonCode?{reasonCode}:{})}};}
  function complete(check,ds,rs,metric,extra={}){return {...check,publication:{version:VERSION,status:'validated',metric,designIds:ds.map(n=>n.id),runtimeIds:rs.map(n=>n.id),...extra}};}
  function verifiedLayout(ctx,check){
    const evidence=check.measurementEvidence,adjudication=check.adjudication;
    if(adjudication?.source!=='verified-layout-candidate')return null;
    const contract=adjudication.contract,objects=evidence?.objects;
    if(!contract||contract.checkId!==check.id||JSON.stringify(contract)!==JSON.stringify(evidence.resolutionContract)||!objects||!['same','different'].includes(adjudication.decision?.status))
      return hold(check,'已验证排版契约缺失或与测量证据不一致');
    const gap=contract.metric==='complete-block-gap',inset=['complete-content-insets','code-layout-group-insets'].includes(contract.metric);
    if(!gap&&!inset)return hold(check,'排版指标与已验证契约不一致');
    const field=gap?['startNodeIds','endNodeIds']:['outerNodeIds','contentNodeIds'];
    const nodes={};
    for(const side of ['design','runtime']){
      const selected=objects[side],ids=field.flatMap(key=>selected?.[key]||[]),snapshot=check.visual?.[side]?.nodeIds||[];
      const original=contract.originalTargets?.[side]||[];
      const originsValid=gap?original.length===2&&field.every((key,i)=>selected?.[key]?.some(id=>within(ctx.maps[side].get(original[i]),ctx.maps[side].get(id))))
        :original.length===1&&selected?.outerNodeIds?.length===1&&selected.outerNodeIds[0]===original[0];
      if(!field.every(key=>selected?.[key]?.length)||ids.length!==snapshot.length||ids.some((id,i)=>id!==snapshot[i])||!originsValid)
        return hold(check,'排版对象与已验证契约不一致');
      nodes[side]=field.map(key=>selected[key].map(id=>ctx.maps[side].get(id)));
      if(nodes[side].flat().some(n=>!n))return hold(check,'已验证排版对象在当前快照中缺失');
    }
    const covers=(d,r)=>{
      const mapped=descendants(d).filter(n=>n.type==='TEXT'&&ctx.pairs.has(n.id));
      return mapped.every(n=>within(ctx.maps.runtime.get(ctx.pairs.get(n.id)),r));
    };
    if(inset&&nodes.design[0].length===1&&nodes.runtime[0].length===1){
      const d=nodes.design[0][0],r=nodes.runtime[0][0];
      // The model may select a transparent layout wrapper on one side and a
      // painted component on the other. Their text insets are arithmetically
      // valid but describe different visual objects. Re-select the unique
      // matched painted child and let the ordinary measurement path recompute.
      const normalize=(outer,opposite,side)=>{
        if(visibleSurface(outer))return outer;
        const candidates=descendants(outer).filter(n=>n!==outer&&visible(n)
          &&visibleSurface(n)
          &&(side==='design'?ctx.pairs.get(n.id)===opposite.id:ctx.pairs.get(opposite.id)===n.id));
        return candidates.length===1?candidates[0]:null;
      };
      const dn=normalize(d,r,'design'),rn=normalize(r,d,'runtime');
      if(!dn||!rn)return hold(check,'两侧可见外框未对应，复核留白不能直接发布');
      if(dn!==d||rn!==r){
        if(!pairValid(ctx,dn,rn))return hold(check,'重选后的可见外框尚未配对');
        return remeasure(ctx,{...check,adjudication:null,measurementEvidence:null,
          visual:visual([dn],[rn])});
      }
    }
    for(let i=0;i<field.length;i++){
      const dd=nodes.design[i],rr=nodes.runtime[i];
      if(dd.length===1&&rr.length===1){
        if(!pairValid(ctx,dd[0],rr[0]))return hold(check,'已验证排版对象的对应关系已变化');
      }else if(!dd.every(d=>rr.some(r=>covers(d,r))))return hold(check,'完整内容组的对应关系已变化');
    }
    const status=adjudication.decision.status;
    return complete({...check,status,judgment:check.judgment},nodes.design[0],nodes.runtime[0],'validated-layout-review',
      {contractId:contract.checkId,measurementSource:evidence.source});
  }
  function adjacentVisibleGap(ctx,check,d,r,edge){
    if(!d?._parent||!r?._parent||!['top','right','bottom','left'].includes(edge)||!pairValid(ctx,d,r))return null;
    const axis=['top','bottom'].includes(edge)?'vertical':'horizontal',vertical=axis==='vertical';
    const opposite={top:'bottom',bottom:'top',left:'right',right:'left'};
    const boxFor=(node,side,boundary,preferContent)=>{
      if(!preferContent&&(paint(node)||control(node)))return box(node);
      const g=ctx.hooks.contentGeometry?.(node,side);
      if(!g?.content)return null;
      if(g.edges?.[boundary]?.confidence!=='high')return null;
      return g.content;
    };
    const ownContent=!(paint(d)||control(d))||!(paint(r)||control(r));
    const own=boxFor(d,'design',edge,ownContent),runtimeOwn=boxFor(r,'runtime',edge,ownContent);if(!own||!runtimeOwn)return null;
    const position=(a,b)=>edge==='bottom'?b.y-a.y-a.height:edge==='top'?a.y-b.y-b.height:edge==='right'?b.x-a.x-a.width:a.x-b.x-b.width;
    const overlaps=(a,b)=>vertical?Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x):Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
    const candidates=children(d._parent).filter(n=>n!==d&&visible(n)).map(n=>{
      const runtime=ctx.maps.runtime.get(ctx.pairs.get(n.id)),content=!(paint(n)||control(n))||runtime&&!(paint(runtime)||control(runtime));
      const designBox=boxFor(n,'design',opposite[edge],content),runtimeBox=boxFor(runtime,'runtime',opposite[edge],content);
      if(!runtime||!pairValid(ctx,n,runtime)||!designBox||!runtimeBox||overlaps(own,designBox)<=1||overlaps(runtimeOwn,runtimeBox)<=1)return null;
      const designGap=position(own,designBox),runtimeGap=position(runtimeOwn,runtimeBox);
      return designGap>=-0.5&&runtimeGap>=-0.5?{n,runtime,designBox,runtimeBox,designGap,runtimeGap}:null;
    }).filter(Boolean).sort((a,b)=>a.designGap-b.designGap);
    if(!candidates.length||candidates[1]&&candidates[1].designGap-candidates[0].designGap<2)return null;
    const next=candidates[0],same=Math.abs(next.designGap-next.runtimeGap)<=1;
    const comparison=ctx.hooks.compareStyle?.(`layout.${axis}-gap`,value(next.designGap),value(next.runtimeGap));
    const visualPair=visual([d,next.n],[r,next.runtime],[own,next.designBox],[runtimeOwn,next.runtimeBox]);
    return complete({...check,item:`${String(check.item||'透明包装层').replace(/ · .*/, '')}与相邻可见内容 · ${vertical?'纵向':'横向'}间距`,
      property:`layout.${axis}-gap`,design:value(next.designGap),runtime:value(next.runtimeGap),status:comparison?(comparison.same?'same':'different'):(same?'same':'different'),
      judgment:comparison?ctx.hooks.judgment?.(`layout.${axis}-gap`,comparison)||'相邻可见对象间距已复测':'相邻可见对象间距已复测',visual:visualPair,
      measurementEvidence:{metric:'adjacent-visible-gap',edge,source:'transparent-wrapper-conversion',values:{design:next.designGap,runtime:next.runtimeGap},
        objects:{design:[d.id,next.n.id],runtime:[r.id,next.runtime.id]}}},[d,next.n],[r,next.runtime],'adjacent-visible-gap',{axis,edge});
  }
  function pairedVisibleEdges(ctx,designOuter,runtimeOuter,designGeometry,runtimeGeometry,onlyEdge=null){
    if(!designGeometry?.entries?.length||!runtimeGeometry?.entries?.length)return null;
    const edges=onlyEdge?[onlyEdge]:['top','right','bottom','left'],outer={design:box(designOuter),runtime:box(runtimeOuter)};
    if(!outer.design||!outer.runtime||!pairValid(ctx,designOuter,runtimeOuter))return null;
    const result={design:{...designGeometry,insets:{...designGeometry.insets},edges:{...designGeometry.edges}},
      runtime:{...runtimeGeometry,insets:{...runtimeGeometry.insets},edges:{...runtimeGeometry.edges}}};
    const coordinate=(entry,edge)=>edge==='top'?entry.box.y:edge==='bottom'?entry.box.y+entry.box.height
      :edge==='left'?entry.box.x:entry.box.x+entry.box.width;
    const extreme=(entries,edge)=>Math[edge==='top'||edge==='left'?'min':'max'](...entries.map(e=>coordinate(e,edge)));
    const role=(entry,axis)=>entry.source==='paint'?'paint':entry.source==='screenshot-ink'&&entry.kind==='text'&&entry.axes?.[axis]==='ink'?'text-ink':['icon','image','graphic'].includes(entry.kind)?'graphic-slot':entry.kind;
    const edgeMeta=(entry,pairedOwnerId)=>({confidence:'high',boundaryKinds:[entry.axes?.horizontal||'unknown',entry.axes?.vertical||'unknown'],
      sources:[entry.source],ownerIds:[entry.ownerId||entry.node.id,...(pairedOwnerId?[pairedOwnerId]:[])],kinds:[entry.kind],anchors:entry.anchor?[entry.anchor]:[],nodeIds:[entry.node.id]});
    const graphicCarrier=n=>Boolean(n&&(['svg','img','canvas'].includes(n.tag)||['VECTOR','IMAGE'].includes(n.type)||n.asset?.type==='image'));
    const sameGraphicSlot=(d,r,mapped)=>{
      if(!d?.node||!r?.node||!mapped||!['icon','graphic','image'].includes(d.kind)||d.kind!==r.kind)return false;
      if(ctx.pairs.get(d.node.id)!==mapped.id||!within(d.node,designOuter)||!within(r.node,runtimeOuter)
        ||mapped.id===r.node.id||!within(mapped,r.node)||!sameFootprint(mapped,r.node))return false;
      if(ctx.reverse.has(r.node.id)&&ctx.reverse.get(r.node.id)!==d.node.id)return false;
      // This allowance is only for one graphic wrapped by an otherwise empty
      // runtime icon slot. A nearby or second icon cannot inherit its identity.
      if(r.node.role!=='img'||text(r.node)||children(r.node).filter(visible).length!==1)return false;
      const carriers=descendants(r.node).filter(n=>n!==r.node&&visible(n)&&graphicCarrier(n));
      return carriers.length===1&&carriers[0].id===mapped.id;
    };
    const graphics=g=>g.entries.filter(e=>['icon','image','graphic'].includes(e.kind));
    const localGraphicPair=(d,r)=>{
      if(graphics(designGeometry).length!==1||graphics(runtimeGeometry).length!==1
        ||graphics(designGeometry)[0]!==d||graphics(runtimeGeometry)[0]!==r)return false;
      const known=ctx.pairs.get(d.node.id);if(known&&known!==r.node.id)return false;
      const anchors=designGeometry.entries.filter(e=>e.kind==='text').flatMap(de=>{
        const re=runtimeGeometry.entries.find(e=>e.kind==='text'&&ctx.pairs.get(de.node.id)===e.node.id);
        return re?[[de,re]]:[];
      });
      const relative=(graphic,label)=>{
        const dx=graphic.box.x+graphic.box.width/2-label.box.x-label.box.width/2;
        const dy=graphic.box.y+graphic.box.height/2-label.box.y-label.box.height/2;
        return Math.abs(dx)>Math.abs(dy)?(dx<0?'left':'right'):(dy<0?'above':'below');
      };
      return anchors.length>0&&anchors.every(([de,re])=>relative(d,de)===relative(r,re));
    };
    for(const edge of edges){
      if(ctx.hooks.edgesComparable?.(designGeometry,runtimeGeometry,edge,false,ctx.pairs))continue;
      const axis=['top','bottom'].includes(edge)?'vertical':'horizontal';
      const a=extreme(designGeometry.entries,edge),b=extreme(runtimeGeometry.entries,edge);
      const pairs=[];
      for(const d of designGeometry.entries){
        const runtimeId=ctx.pairs.get(d.node?.id);
        for(const r of runtimeGeometry.entries){
          const mapped=ctx.maps.runtime.get(runtimeId),sameNode=r.node?.id===runtimeId;
          const localSlot=localGraphicPair(d,r);
          if(!sameNode&&!sameGraphicSlot(d,r,mapped)&&!localSlot)continue;
          if(d.axes?.[axis]!==r.axes?.[axis]||!['ink','layout'].includes(d.axes?.[axis])||role(d,axis)!==role(r,axis))continue;
          if(Math.abs(coordinate(d,edge)-a)>1.5||Math.abs(coordinate(r,edge)-b)>1.5)continue;
          pairs.push({d,r,localSlot,pairedOwnerId:sameNode||localSlot?null:mapped.id,priority:d.source==='paint'?2:d.source==='screenshot-ink'?1:0});
        }
      }
      pairs.sort((a,b)=>b.priority-a.priority);
      if(!pairs.length)return null;
      const chosen=pairs[0];
      for(const [side,entry] of [['design',chosen.d],['runtime',chosen.r]]){
        const boundary=coordinate(entry,edge),o=outer[side];
        result[side].insets[edge]=edge==='top'?boundary-o.y:edge==='bottom'?o.y+o.height-boundary
          :edge==='left'?boundary-o.x:o.x+o.width-boundary;
        const meta=edgeMeta(entry,side==='runtime'?chosen.pairedOwnerId:null);meta.boundaryKinds=[entry.axes[axis]];
        if(chosen.localSlot){meta.kinds=['graphic'];meta.slotIdentity={kind:'unique-graphic-relative-to-matched-text',
          designId:chosen.d.node.id,runtimeId:chosen.r.node.id,designScopeId:designOuter.id,runtimeScopeId:runtimeOuter.id};}
        result[side].edges[edge]=meta;
      }
      if(!ctx.hooks.edgesComparable?.(result.design,result.runtime,edge,false,ctx.pairs))return null;
    }
    return result;
  }
  function unresolvedInsetEdge(check,dg,rg,edge){
    const name={top:'顶部',right:'右侧',bottom:'底部',left:'左侧'}[edge];
    const evidence={...check.measurementEvidence,metric:'layout-inset',side:edge,
      design:dg?.edges?.[edge],runtime:rg?.edges?.[edge],
      candidateValues:{design:dg?.insets?.[edge],runtime:rg?.insets?.[edge]}};
    const edges=[dg?.edges?.[edge],rg?.edges?.[edge]];
    const pixels=edges.some(e=>e?.boundaryKinds?.includes('unknown')&&e?.kinds?.includes('text'));
    const measured=edges.every(e=>e?.confidence==='high')
      &&[dg?.insets?.[edge],rg?.insets?.[edge]].every(Number.isFinite);
    return hold({...check,design:'待确认',runtime:'待确认',measurementEvidence:evidence},
      pixels?`${name}参与测量的文字字形尚未提取成功`:
        measured?`${name}内容边界已测得，对应关系尚未验证`:`${name}可见内容边界尚未测准`,
      pixels?'edge-pixels-missing':measured?'edge-identity-missing':'edge-geometry-missing');
  }
  function remeasure(ctx,check,proposal=null){
    if(/^(padding-|layout\.content-inset)/.test(check.property)){
      const dd=ctx.maps.design.get(check.visual?.design?.nodeIds?.[0]);
      const rr=ctx.maps.runtime.get(check.visual?.runtime?.nodeIds?.[0]);
      if(dd?._parent&&rr?._parent&&(!visibleSurface(dd)||!visibleSurface(rr))){
        const carrier=measurementCarrier(ctx,dd,rr);
        if((!visibleSurface(dd)&&!visibleSurface(rr))&&(!carrier||!visibleSurface(carrier.design)||!visibleSurface(carrier.runtime)))
          return (check.property.startsWith('padding-')?adjacentVisibleGap(ctx,check,dd,rr,check.property.slice(8)):null)
            ||omitTask(ctx,check,'no-corresponding-visible-surfaces: compare content relationships instead of wrapper insets');
      }
    }
    if(!proposal&&check.adjudication?.source==='verified-layout-candidate')return verifiedLayout(ctx,check);
    if(/^state\./.test(check.property)){
      const fresh=stateRelationChecks(ctx).find(c=>c.key===check.key);
      if(fresh)return {...check,...fresh};
      return stateDecision(ctx,check)||hold(check,'状态关系尚未通过结构验证');
    }
    if(check.source==='numeric-segment'){
      const e=check.measurementEvidence,d=ctx.maps.design.get(e?.designNumberId),l=ctx.maps.design.get(e?.designLeftId),r=ctx.maps.design.get(e?.designRightId),rt=ctx.maps.runtime.get(e?.runtimeTextId),ds=ctx.maps.design.get(e?.designScopeId),rs=ctx.maps.runtime.get(e?.runtimeScopeId);
      const seg=rt?.geometry?.numericSegments?.find(s=>s.index===e.segmentIndex);
      if(!d||!l||!r||!ds||!rs||!seg||!pairValid(ctx,ds,rs)||![d,l,r].every(n=>within(n,ds))||!within(rt,rs)||!text(l).endsWith(norm(seg.leftChar))||!text(r).startsWith(norm(seg.rightChar)))return hold(check,'数字片段的所属模块或邻接文字尚未验证');
      const di=d.geometry?.textInk,li=l.geometry?.textInk,ri=r.geometry?.textInk,si=seg.textInk;
      if([di,li,ri,si].some(m=>m?.status!=='measured'||m.policy!=='visible-text-ink-v1'))return hold(check,'数字与相邻文字的可见字形尚未测量完成');
      const left=e.side==='left',a=left?di.box.x-li.box.x-li.box.width:ri.box.x-di.box.x-di.box.width;
      const b=left?si.box.x-si.leftBox.x-si.leftBox.width:si.rightBox.x-si.box.x-si.box.width;
      if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0)return hold(check,'数字片段的几何测量无效');
      const cmp=ctx.hooks.compareStyle(check.property,value(a),value(b));
      return complete({...check,design:value(a),runtime:value(b),status:cmp.same?'same':'different',judgment:ctx.hooks.judgment(check.property,cmp),visual:visual([d],[rt],left?[li.box,di.box]:[di.box,ri.box],left?[si.leftBox,si.box]:[si.box,si.rightBox])},[d],[rt],'numeric-segment-ink-gap');
    }
    const get=(side,ids)=>(ids||[]).map(id=>ctx.maps[side].get(id)||compoundNode(ctx,check,side,id));
    let ds=get('design',proposal?.designIds||check.visual?.design?.nodeIds),rs=get('runtime',proposal?.runtimeIds||check.visual?.runtime?.nodeIds);
    if(!ds.length||!rs.length||ds.some(n=>!n)||rs.some(n=>!n))return hold(check,'测量对象未完整定位，自动复核尚未完成');
    if(/^icon\./.test(check.property)&&check.source==='verified-icon-review'){
      const e=check.measurementEvidence,dp=ctx.maps.design.get(e?.slot?.designParentId),rp=ctx.maps.runtime.get(e?.slot?.runtimeParentId);
      if(!e?.slot?.verified||!dp||!rp||!pairValid(ctx,dp,rp)||!Covers(ds,dp)||!Covers(rs,rp))return hold(check,'图标所属组件实例尚未通过统一验证');
      if(check.property==='icon.appearance'&&e.identity?.verdict==='different'&&e.identity.confidence>=.8)return complete(check,ds,rs,'same-slot-appearance');
      if(/^icon\.(width|height)$/.test(check.property)&&e.boundaries?.design?.kind===e.boundaries?.runtime?.kind)return complete(check,ds,rs,'same-slot-geometry');
      return hold(check,'图标属性证据尚未完成验证');
    }
    // Use the established identity, not whatever the legacy check chose.
    if(!proposal)rs=ds.map((d,i)=>ctx.maps.runtime.get(ctx.pairs.get(d.id))||rs[i]).filter(Boolean);
    const prop=check.property;
    if(/^layout\.(horizontal|vertical)-gap$/.test(prop)&&ds.length===rs.length){
      const resolutions=[];
      rs=rs.map((r,i)=>{
        const carrier=completeTextCarrier(ctx,ds[i],r);
        if(!carrier)return r;
        resolutions.push({designId:ds[i].id,runtimeAnchorId:r.id,runtimeContentId:carrier.runtime.id});
        return carrier.runtime;
      });
      if(resolutions.length)check={...check,measurementEvidence:{...check.measurementEvidence,
        textExtentResolution:resolutions}};
    }
    // Identity may have been proposed for an inner Figma wrapper and the outer
    // DOM control. Resolve the real property carriers before comparing numbers.
    if(ds.length===1&&rs.length===1&&(/^(?:box\.local\.(?:width|height)|padding-(?:top|right|bottom|left)|layout\.content-inset)$/.test(prop)
      ||['background-color','border-radius'].includes(prop))){
      const carrier=measurementCarrier(ctx,ds[0],rs[0]);
      if(carrier&&(carrier.design!==ds[0]||carrier.runtime!==rs[0])){
        check={...check,measurementEvidence:{...check.measurementEvidence,carrierResolution:{...carrier.identity,
          designOwnerId:carrier.design.id,runtimeOwnerId:carrier.runtime.id,source:carrier.source}}};
        ds=[carrier.design];rs=[carrier.runtime];
      }
      if(!carrier&&ds[0]._parent&&approvedIdentity(ctx,ds[0],rs[0])
        &&Boolean(paint(ds[0])||control(ds[0]))!==Boolean(paint(rs[0])||control(rs[0])))
        return hold(check,'组件身份已确认，本项对应的实际外框尚未定位','property-carrier-missing');
    }
    // Fully clipped or hidden objects are outside this visual inspection.
    // Partially visible objects remain inspectable.
    if([...ds,...rs].some(n=>!visible(n)))return proposal
      ?hold(check,'提议对象不在当前可见范围，原检查保留','proposal-outside-visible-scope'):null;
    if(prop==='layout.scope'){
      if(ds.length!==1||rs.length!==1)return hold(check,'范围诊断需要明确的两侧对象','scope-members-unresolved');
      const scope=compareScopes(ds[0],rs[0],ctx);
      if(scope.status==='compatible')return null;
      return hold({...check,scopeEvidence:scope},scope.reason,scope.reasonCode);
    }
    const ownerStyle=['background-color','border-radius'].includes(prop)&&ds.length===1;
    const selectedGeometry=/^box\.local\.(?:width|height)$/.test(prop)&&ds.length===1&&rs.length===1
      &&!ds[0]._parent&&!rs[0]._parent&&ctx.pairs.get(ds[0].id)===rs[0].id;
    if(ds.length!==rs.length||!ds.every((d,i)=>pairValid(ctx,d,rs[i])
      ||ownerStyle&&propertyOwnerValid(ctx,d,rs[i],prop)||selectedGeometry))return hold(check,'两侧对象的功能位置或外框尚未通过验证');
    if(prop==='text.visible-lines') {
      const a=ds[0]?.geometry?.textInk,b=rs[0]?.geometry?.textInk;
      if(ds.length!==1||full(ds[0])!==full(rs[0])||a?.status!=='measured'||b?.status!=='measured')return hold(check,'可见文字行数尚未确定');
      return complete({...check,design:`${a.lines.length}行`,runtime:`${b.lines.length}行`,status:a.lines.length===b.lines.length?'same':'different',judgment:a.lines.length===b.lines.length?'一致':'相同文字的可见换行不同',visual:visual(ds,rs,a.lines,b.lines)},ds,rs,'visible-text-lines');
    }
    if(prop==='text.ink-line-gap') {
      const index=check.measurementEvidence?.lineIndex,a=ds[0]?.geometry?.textInk,b=rs[0]?.geometry?.textInk;
      if(ds.length!==1||full(ds[0])!==full(rs[0])||a?.status!=='measured'||b?.status!=='measured'||a.lines.length!==b.lines.length||!Number.isInteger(index)||index<1||index>=a.lines.length)return hold(check,'对应文字行的可见边界尚未确定');
      const gap=ink=>ink.lines[index].y-ink.lines[index-1].y-ink.lines[index-1].height,x=gap(a),y=gap(b),same=Math.abs(x-y)<=1.5;
      return complete({...check,design:value(x),runtime:value(y),status:same?'same':'different',judgment:same?'一致':`可见行间距相差 ${value(Math.abs(y-x))}`,visual:visual(ds,rs,a.lines.slice(index-1,index+1),b.lines.slice(index-1,index+1))},ds,rs,'visible-line-gap');
    }
    if(/^(font-size|font-weight|line-height|letter-spacing|color|background-color|border-radius|overflow-[xy])$/.test(prop)){
      if(ds.length!==1)return hold(check,'聚合属性需要逐对象验证');
      if(prop==='background-color'){
        const background=ctx.hooks.measureBackground?.(ds[0],rs[0]);
        if(background){
          const next={...check,measurementEvidence:{...check.measurementEvidence,background},visual:visual(ds,rs)};
          if(!['same','different'].includes(background.status))
            return hold(next,background.reason||'可见背景尚未完成测量',background.reasonCode||'background-evidence-incomplete');
          const count=Array.isArray(background.samples)?background.samples.length:0;
          const solid=background.mode==='solid-color';
          const display=color=>Array.isArray(color)?`rgb(${color.slice(0,3).map(Math.round).join(',')})`:'已测底色';
          const label=ds[0]._parent?String(check.item||'组件').split(' · ')[0]:'选中区域';
          const detail=background.status==='same'?(solid?'可见底色一致':'已采样范围内背景一致')
            :`可见背景有色差${Number.isFinite(background.maxDelta)?`，最大 ${background.maxDelta} 色阶`:''}`;
          return complete({...next,item:`${label} · 可见背景${solid?'':'（已采样范围）'}`,status:background.status,
            design:solid?display(background.designColor):`已测 ${count} 处背景`,runtime:solid?display(background.runtimeColor):`已测 ${count} 处背景`,
            judgment:detail},ds,rs,'visible-background');
        }
      }
      const a=ctx.hooks.resolveStyle?.(ds[0],'design',prop),b=ctx.hooks.resolveStyle?.(rs[0],'runtime',prop);
      if(!a?.resolved||!b?.resolved||a.value==null||b.value==null)return hold(check,'属性所在节点尚未可靠定位');
      if(!pairValid(ctx,a.node,b.node)&&!propertyOwnerValid(ctx,a.node,b.node,prop))return hold(check,'属性载体与组件身份不一致');
      const cmp=ctx.hooks.compareStyle(prop,a.value,b.value,a.styles,b.styles);
      const next={...check,design:cmp.left.display,runtime:cmp.right.display,status:cmp.same?'same':'different',judgment:ctx.hooks.judgment(prop,cmp),visual:visual([a.node],[b.node])};
      return complete(next,[a.node],[b.node],'computed-style',
        ['background-color','border-radius'].includes(prop)?{ownerRole:prop,componentBoundary:'matched-scope'}:{});
    }
    if(/^padding-(top|right|bottom|left)$/.test(prop)||prop==='layout.content-inset'){
      if(ds.length!==1||!ownsLayout(rs[0]))return hold(check,'留白必须在对应外框和内容之间测量');
      if(ds[0]._parent&&!paint(ds[0])&&!control(ds[0])){
        const adjacent=prop.startsWith('padding-')?adjacentVisibleGap(ctx,check,ds[0],rs[0],prop.slice('padding-'.length)):null;
        return adjacent||hold(check,'透明包装层没有可见外框；未找到两侧均已对应的相邻可见对象','transparent-wrapper-no-visible-edge');
      }
      let dg=ctx.hooks.contentGeometry(ds[0],'design'),rg=ctx.hooks.contentGeometry(rs[0],'runtime');
      const edge=prop.replace('padding-','');
      let explicitContent=false;
      if(proposal?.designContentIds?.length&&proposal?.runtimeContentIds?.length){
        const dc=get('design',proposal.designContentIds),rc=get('runtime',proposal.runtimeContentIds);
        if([...dc,...rc].some(n=>!n)||dc.some(n=>n===ds[0]||!within(n,ds[0]))||rc.some(n=>n===rs[0]||!within(n,rs[0])))return hold(check,'内容必须是外框内的真实布局对象');
        if(dc.some(d=>!rc.some(r=>pairValid(ctx,d,r))))return hold(check,'指定内容组尚未对应到相同功能对象');
        const covered=(outer,groups)=>descendants(outer).filter(n=>n!==outer&&visible(n)&&(text(n)||control(n)||['IMAGE','VECTOR'].includes(n.type)||['img','svg'].includes(n.tag))).every(n=>groups.some(g=>within(n,g)));
        if(!covered(ds[0],dc)||!covered(rs[0],rc))return hold(check,'指定内容组遗漏了外框内的文字、控件或图形');
        const dl=dc.flatMap(descendants).filter(n=>n.type==='TEXT'&&text(n)&&visible(n)),rl=rc.flatMap(descendants).filter(n=>text(n)&&visible(n));
        if(!dl.length||dl.some(n=>!ctx.pairs.has(n.id)||!rc.some(p=>within(ctx.maps.runtime.get(ctx.pairs.get(n.id)),p)))||rl.some(n=>!dl.some(d=>ctx.pairs.get(d.id)===n.id)))return hold(check,'内容组包含未对应或遗漏的文字');
        for(const [side,ns,outer] of [['design',dc,ds[0]],['runtime',rc,rs[0]]]){
          const mm=ns.map(n=>{
            if(prop!=='layout.content-inset'||paint(n)||control(n)||n.type==='TEXT'||text(n))
              return measured(ctx,n,side,['top','bottom'].includes(edge)?'vertical':'horizontal');
            const group=ctx.hooks.contentGeometry?.(n,side);
            return group?.content&&['top','right','bottom','left'].every(e=>group.edges?.[e]?.confidence==='high')
              ?{box:group.content,axes:{horizontal:'ink',vertical:'ink'},source:'visible-content-group'}:null;
          });
          if(mm.some(m=>!m))return hold(check,'指定内容组的布局边界不可测');
          const bb=mm.map(m=>m.box),x=Math.min(...bb.map(b=>b.x)),y=Math.min(...bb.map(b=>b.y)),right=Math.max(...bb.map(b=>b.x+b.width)),bottom=Math.max(...bb.map(b=>b.y+b.height)),ob=box(outer);
          const geom={content:{x,y,width:right-x,height:bottom-y},insets:{top:y-ob.y,right:ob.x+ob.width-right,bottom:ob.y+ob.height-bottom,left:x-ob.x}};
          if(side==='design')dg=geom;else rg=geom;
        }explicitContent=true;
      }
      if(prop==='layout.content-inset'){
        const edges=['top','right','bottom','left'];
        if(!explicitContent&&!edges.every(e=>ctx.hooks.edgesComparable(dg,rg,e,false,ctx.pairs))){
          const selected=pairedVisibleEdges(ctx,ds[0],rs[0],dg,rg);
          if(selected){dg=selected.design;rg=selected.runtime;}
        }
        if(!edges.every(e=>(explicitContent||ctx.hooks.edgesComparable(dg,rg,e,false,ctx.pairs))
          &&Number.isFinite(dg.insets?.[e])&&Number.isFinite(rg.insets?.[e])))return hold(check,'可见内容边界尚未完成测量');
        const same=edges.every(e=>Math.abs(dg.insets[e]-rg.insets[e])<=1.5);
        const fmt=g=>edges.map(e=>`${({top:'上',right:'右',bottom:'下',left:'左'})[e]} ${value(g.insets[e])}`).join(' / '),v=visual(ds,rs);
        v.design.contentBoxes=[dg.content];v.runtime.contentBoxes=[rg.content];
        return complete({...check,design:fmt(dg),runtime:fmt(rg),status:same?'same':'different',judgment:same?'一致':'可见内容四边留白有差异',visual:v,
          measurementEvidence:{metric:'visible-content-insets',policy:'visible-text-ink-v1',includesLineHeight:false,values:{design:dg.insets,runtime:rg.insets},
            ...(explicitContent?{contentIds:{design:proposal.designContentIds,runtime:proposal.runtimeContentIds}}:{})}},ds,rs,'visible-content-insets');
      }
      // A transparent wrapper around a visible child owns spacing OUTSIDE that
      // child. Its content is the button/card, not the label inside that child.
      const paintedChild=children(ds[0]).filter(visible).length===1?canonicalEndpoint(children(ds[0]).filter(visible)[0]):null;
      const envelope=!paint(ds[0])&&!control(ds[0])&&paintedChild&&(paint(paintedChild)||control(paintedChild))&&ctx.pairs.get(paintedChild.id)===rs[0].id;
      if(envelope){
        const ob=box(ds[0]),cb=box(paintedChild);dg={...dg,content:cb,insets:{top:cb.y-ob.y,left:cb.x-ob.x,right:ob.x+ob.width-cb.x-cb.width,bottom:ob.y+ob.height-cb.y-cb.height}};
        rg={...rg,content:box(rs[0]),insets:{top:0,right:0,bottom:0,left:0}};
      }
      if(!explicitContent&&!envelope&&!ctx.hooks.edgesComparable(dg,rg,edge,false,ctx.pairs)){
        const selected=pairedVisibleEdges(ctx,ds[0],rs[0],dg,rg,edge);
        if(selected){dg=selected.design;rg=selected.runtime;}
      }
      if((!explicitContent&&!envelope&&!ctx.hooks.edgesComparable(dg,rg,edge,false,ctx.pairs))||![dg.insets?.[edge],rg.insets?.[edge]].every(Number.isFinite))return unresolvedInsetEdge(check,dg,rg,edge);
      // Transparent spacing wrappers have no visible outer. Compare their
      // occupied layout space, including external margins, on BOTH sides.
      // Never apply this to a painted button/card boundary.
      const allocated=envelope||!paint(ds[0])&&!control(ds[0])&&!paint(rs[0])&&!control(rs[0]);
      const margin=(n,e)=>0; // CSS allocation is diagnostic, not a visible whitespace measurement.
      const a=dg.insets[edge]+margin(ds[0],edge),b=rg.insets[edge]+margin(rs[0],edge),cmp=ctx.hooks.compareStyle('geometry.'+prop,value(a),value(b));
      const occupied=n=>{const z=box(n),l=margin(n,'left'),t=margin(n,'top');return {x:z.x-l,y:z.y-t,width:z.width+l+margin(n,'right'),height:z.height+t+margin(n,'bottom')};};
      const v=visual(ds,rs,[occupied(ds[0])],[occupied(rs[0])]);v.design.contentBoxes=dg.content?[dg.content]:[];v.runtime.contentBoxes=rg.content?[rg.content]:[];v.measurementSide=edge;
      return complete({...check,design:value(a),runtime:value(b),status:cmp.same?'same':'different',judgment:ctx.hooks.judgment(prop,cmp),visual:v,measurementEvidence:{...check.measurementEvidence,policy:'visible-text-ink-v1',includesLineHeight:false,values:{design:a,runtime:b}}},ds,rs,allocated?'allocated-space-to-content':'outer-to-content',{edge,...(explicitContent?{contentIds:{design:proposal.designContentIds,runtime:proposal.runtimeContentIds}}:{})});
    }
    if(/^layout\.(horizontal|vertical)-gap$/.test(prop)){
      if(ds.length!==2)return hold(check,'间距检查需要明确的两个布局端点');
      const axis=prop.includes('horizontal')?'horizontal':'vertical',start=axis==='horizontal'?'x':'y',size=axis==='horizontal'?'width':'height';
      // Preserve a verified component pair before unwrapping layout shells.
      // Canonicalizing each side independently can turn a valid pair into two
      // unrelated descendants (for example, a Figma frame and a DOM div whose
      // only child is a content group). Its content edge is chosen below.
      const endpoints=ds.map((d,i)=>pairValid(ctx,d,rs[i])
        ?[d,rs[i]]:[canonicalEndpoint(d),canonicalEndpoint(rs[i])]);
      ds=endpoints.map(pair=>pair[0]);rs=endpoints.map(pair=>pair[1]);
      if(!ds.every((d,i)=>pairValid(ctx,d,rs[i])))return hold(check,'间距端点没有对应到相同的内容或组件');
      const endpointIdentity=ds.map((d,i)=>gapEndpointIdentity(ctx,d,rs[i]));
      if(ds.some((d,i)=>(graphicLeaf(d)||graphicLeaf(rs[i]))&&!endpointIdentity[i]))
        return hold(check,'图形间距端点缺少同模块内唯一的图形槽位');
      let pairs=ds.map((d,i)=>{
        const r=rs[i],edge=axis==='vertical'?(i===0?'bottom':'top'):(i===0?'right':'left');
        const contentMode=(children(d).length||children(r).length)&&!(d.type==='TEXT'||text(d))
          &&(!(paint(d)||control(d))||!(paint(r)||control(r)));
        if(!contentMode)return [measured(ctx,d,'design',axis),measured(ctx,r,'runtime',axis,d.type==='TEXT')];
        const dg=ctx.hooks.contentGeometry?.(d,'design'),rg=ctx.hooks.contentGeometry?.(r,'runtime');
        if(!dg?.content||!rg?.content||dg.edges?.[edge]?.confidence!=='high'||rg.edges?.[edge]?.confidence!=='high')return [null,null];
        return [{box:dg.content,axes:{[axis]:'layout'},source:'visible-content-boundary'},
          {box:rg.content,axes:{[axis]:'layout'},source:'visible-content-boundary'}];
      });
      const stored=(side,ns)=>{
        const snapshots=check.visual?.[side]?.measurements||[];
        if(snapshots.length!==2)return null;
        return snapshots.map((m,i)=>{
          const original=box(ns[i]),prior=m.originalBox;
          if(m.nodeId!==ns[i].id||m.policy!=='visible-text-ink-v1'||m.measuredAxis!==axis
            ||!['ink','layout'].includes(m.axes?.[axis])||!m.box||!prior||!original
            ||['x','y','width','height'].some(k=>Math.abs(prior[k]-original[k])>.5))return null;
          return m;
        });
      };
      let dm=pairs.map(p=>p[0]),rm=pairs.map(p=>p[1]);
      if([...dm,...rm].some(m=>!m)){
        const priorDesign=stored('design',ds),priorRuntime=stored('runtime',rs);
        if(priorDesign?.every(Boolean)&&priorRuntime?.every(Boolean)){
          dm=priorDesign;rm=priorRuntime;
        }
      }
      if([...dm,...rm].some(m=>!m))return hold(check,'端点的布局边界尚未测量完成');
      const gap=ms=>ms[1].box[start]-ms[0].box[start]-ms[0].box[size],a=gap(dm),b=gap(rm);
      if(a < -1||b < -1)return hold(check,'端点顺序或重叠关系需要复核');
      if(axis==='horizontal'&&ds.every(n=>n.type==='TEXT')&&rs.every(n=>text(n)&&!paint(n)&&!control(n))){
        const layoutGap=ns=>{const x=ns.map(box);return x.every(Boolean)?x[1].x-x[0].x-x[0].width:null;};
        const la=layoutGap(ds),lb=layoutGap(rs);
        const uncertainty=2.5;
        // Font side bearings may move the ink edge by one or two pixels while
        // both text frames and their spacing remain unchanged. A larger glyph
        // shift still reports a visual difference.
        if(Number.isFinite(la)&&Number.isFinite(lb)&&la>=-1&&lb>=-1&&Math.abs(la-lb)<=1.5&&Math.abs(a-b)<=uncertainty){
          return complete({...check,design:value(la),runtime:value(lb),status:'same',judgment:'对应文字框间距一致；可见字形差异在字体侧边留白范围内',
            visual:visual(ds,rs,ds.map(box),rs.map(box)),measurementEvidence:{...check.measurementEvidence,metric:'text-frame-gap',inkValues:{design:a,runtime:b},uncertaintyPx:uncertainty}},
          ds,rs,'text-frame-gap-with-ink-guard',{axis,endpointIdentity});
        }
      }
      if(axis==='horizontal'&&ds.every(n=>n.type!=='TEXT'&&descendants(n).some(graphicLeaf))
        &&rs.every(n=>children(n).length&&descendants(n).some(graphicLeaf))){
        // An icon-and-label module may have a transparent layout frame, while
        // its facing visible edge belongs to the label. Compare the matched
        // labels' frames only when BOTH content edges are that same text slot.
        // One-pixel glyph side bearings must not turn equal module spacing into
        // a defect; a moved label frame or a graphic at the edge still does.
        const facing=['right','left'],owners=ds.map((d,i)=>{
          const r=rs[i],edge=facing[i];
          const get=(n,side)=>{
            const e=ctx.hooks.contentGeometry?.(n,side)?.edges?.[edge];
            if(e?.confidence!=='high'||e.boundaryKinds?.length!==1||e.boundaryKinds[0]!=='ink'
              ||e.kinds?.length!==1||e.kinds[0]!=='text'||e.ownerIds?.length!==1)return null;
            return ctx.maps[side].get(e.ownerIds[0]);
          };
          const dt=get(d,'design'),rt=get(r,'runtime');
          const family=n=>norm(n.styles?.['font-family']).replace(/['"]/g,'');
          const sizeD=num(dt?.styles?.['font-size']),sizeR=num(rt?.styles?.['font-size']);
          if(!dt||!rt||dt.type!=='TEXT'||!text(dt)||!text(rt)||paint(rt)||control(rt)
            ||!within(dt,d)||!within(rt,r)||ctx.pairs.get(dt.id)!==rt.id||text(dt)!==text(rt)
            ||dt.geometry?.textInk?.status!=='measured'||rt.geometry?.textInk?.status!=='measured'
            ||dt.geometry.textInk.lines?.length!==1||rt.geometry.textInk.lines?.length!==1
            ||sizeD<=0||sizeD!==sizeR||!family(dt)||family(dt)!==family(rt)
            ||num(dt.styles?.['font-weight'])!==num(rt.styles?.['font-weight']))return null;
          return [dt,rt];
        });
        if(owners.every(Boolean)){
          const td=owners.map(p=>p[0]),tr=owners.map(p=>p[1]);
          const frameGap=ns=>box(ns[1]).x-box(ns[0]).x-box(ns[0]).width;
          const da=frameGap(td),rb=frameGap(tr),outerDesign=frameGap(ds),outerRuntime=frameGap(rs);
          const bearing=(owner,edge)=>{
            const frame=box(owner),ink=owner.geometry.textInk.box;
            return edge==='right'?frame.x+frame.width-ink.x-ink.width:ink.x-frame.x;
          };
          const sideBearing=facing.every((edge,i)=>{
            const x=bearing(td[i],edge),y=bearing(tr[i],edge);
            return [x,y].every(v=>v>=-.5&&v<=2.5)&&Math.abs(x-y)<=1.25;
          });
          if([da,rb,outerDesign,outerRuntime].every(Number.isFinite)&&da>=-1&&rb>=-1
            &&Math.abs(da-rb)<=1&&Math.abs(outerDesign-outerRuntime)<=1
            &&ds.every((d,i)=>sameFootprint(d,rs[i]))&&sideBearing&&Math.abs(a-b)<=2.5){
            return complete({...check,design:value(da),runtime:value(rb),status:'same',
              judgment:'对应文字框间距一致；可见字形差异在字体侧边留白范围内',
              visual:visual(ds,rs,td.map(box),tr.map(box)),
              measurementEvidence:{...check.measurementEvidence,metric:'matched-label-frame-gap',
                inkValues:{design:a,runtime:b},uncertaintyPx:2.5}},
            ds,rs,'matched-label-frame-gap-with-ink-guard',{axis,endpointIdentity,
              textIds:{design:td.map(n=>n.id),runtime:tr.map(n=>n.id)}});
          }
        }
      }
      const cmp=ctx.hooks.compareStyle(prop,value(a),value(b));
      // Changed data text can move its visible right edge while the two slots
      // stay at exactly the same relative positions. Keep that observation as
      // content-dependent; never publish it as equal spacing or a padding bug.
      if(!cmp.same&&axis==='horizontal'&&Math.abs((box(ds[1]).x-box(ds[0]).x)-(box(rs[1]).x-box(rs[0]).x))<=1.5){
        const changed=ds.some((d,i)=>{
          if(!ctx.structureMatches?.some(m=>m.designNode.raw.id===d.id&&m.runtimeNode.raw.id===rs[i].id
            &&m.inspectionIdentity?.kind==='complete-content-group'))return false;
          const edge=i===0?'right':'left',dg=ctx.hooks.contentGeometry(d,'design'),rg=ctx.hooks.contentGeometry(rs[i],'runtime');
          const ids=dg.edges?.[edge]?.nodeIds||[],rids=rg.edges?.[edge]?.nodeIds||[];
          return ids.length>0&&ids.every(id=>{
            const dn=ctx.maps.design.get(id),rn=ctx.maps.runtime.get(ctx.pairs.get(id));
            return dn?.type==='TEXT'&&rn&&rids.includes(rn.id)&&text(dn)!==text(rn)
              &&['font-size','font-weight'].every(k=>dn.styles?.[k]!=null&&rn.styles?.[k]!=null&&ctx.hooks.compareStyle(k,dn.styles[k],rn.styles[k]).same)
              &&num(dn.styles?.['letter-spacing'])===num(rn.styles?.['letter-spacing']);
          });
        });
        if(changed)return complete({...check,design:value(a),runtime:value(b),status:'content',
          judgment:'文案长度不同改变了可见文字末端；对应内容组与控件的相对位置一致，本项不判为样式差异',
          visual:visual(ds,rs,dm.map(m=>m.box),rm.map(m=>m.box))},ds,rs,'content-dependent-gap',{axis,endpointIdentity,
            allocationGap:{design:box(ds[1]).x-box(ds[0]).x-box(ds[0]).width,runtime:box(rs[1]).x-box(rs[0]).x-box(rs[0]).width}});
      }
      return complete({...check,design:value(a),runtime:value(b),status:cmp.same?'same':'different',judgment:ctx.hooks.judgment(prop,cmp),visual:visual(ds,rs,dm.map(m=>m.box),rm.map(m=>m.box))},ds,rs,'content-to-content',{axis,endpointIdentity});
    }
    // Other measured properties still need identity verification. No bypass can
    // publish a result without recording exactly which objects it compares.
    if(check.resolutionContract||check.layoutReview?.contractVerified)return complete({...check,visual:check.visual},ds,rs,'validated-layout-review');
    if(/^box\.local\.(width|height)$/.test(prop)&&ds.length===1){
      const dim=prop.split('.').pop(),a=box(ds[0])[dim],b=box(rs[0])[dim];
      if(check.status==='review'&&!selectedGeometry&&!measurementCarrier(ctx,ds[0],rs[0]))
        return hold(check,check.judgment||'尺寸对应的实际外框尚未完成验证');
      return complete({...check,...(selectedGeometry?{item:`选中区域 · ${dim==='width'?'宽度':'高度'}`}:{ }),design:value(a),runtime:value(b),status:Math.abs(a-b)<=1?'same':'different',visual:visual(ds,rs)},ds,rs,selectedGeometry?'selected-scope-geometry':'layout-dimension');
    }
    return hold(check,'此属性尚未接入可验证的同口径测量方法');
  }
  function Covers(ns,p){return ns.every(n=>within(n,p));}
  function coveredTransparentInset(ctx,check,published){
    if(!/^padding-(top|right|bottom|left)$/.test(check.property)
      ||check.publication?.status!=='pending'
      ||check.publication.reasonCode!=='transparent-wrapper-no-visible-edge')return false;
    const designIds=check.visual?.design?.nodeIds||[],runtimeIds=check.visual?.runtime?.nodeIds||[];
    if(designIds.length!==1||runtimeIds.length!==1)return false;
    const wrapper=ctx.maps.design.get(designIds[0]),runtime=ctx.maps.runtime.get(runtimeIds[0]);
    if(!wrapper||!runtime||paint(wrapper)||control(wrapper)||!paint(runtime)&&!control(runtime))return false;
    const owners=descendants(wrapper).filter(n=>n!==wrapper&&(paint(n)||control(n))
      &&ctx.pairs.get(n.id)===runtime.id&&sameFootprint(n,runtime));
    if(owners.length!==1)return false;
    // The wrapper is not a visible edge. Its legacy padding task compares a
    // different object on each side. Drop it only after the actual painted
    // child has a verified four-sided inset check, so real defects remain.
    const aggregate=published.some(c=>c!==check&&c.property==='layout.content-inset'
      &&c.publication?.status==='validated'&&c.publication.metric==='visible-content-insets'
      &&c.publication.designIds?.length===1&&c.publication.designIds[0]===owners[0].id
      &&c.publication.runtimeIds?.length===1&&c.publication.runtimeIds[0]===runtime.id);
    return aggregate||['top','right','bottom','left'].every(edge=>published.some(c=>c!==check
      &&c.property==='padding-'+edge&&c.publication?.status==='validated'
      &&c.publication.designIds?.length===1&&c.publication.designIds[0]===owners[0].id
      &&c.publication.runtimeIds?.length===1&&c.publication.runtimeIds[0]===runtime.id));
  }
  function expandInsetEdges(ctx,check){
    if(check.property!=='layout.content-inset'||['uncovered','content'].includes(check.status)
      ||check.adjudication?.source==='verified-layout-candidate')return [check];
    const did=check.visual?.design?.nodeIds,rid=check.visual?.runtime?.nodeIds;
    if(did?.length!==1||rid?.length!==1)return [check];
    const d=ctx.maps.design.get(did[0]),r=ctx.maps.runtime.get(ctx.pairs.get(did[0])||rid[0]);
    if(!d||!r||!paint(d)&&!control(d))return [check];
    const label=String(check.item||d.name||'组件').replace(/ · 可见留白.*$/,'');
    return ['top','right','bottom','left'].map(edge=>{
      const name={top:'顶部',right:'右侧',bottom:'底部',left:'左侧'}[edge];
      return remeasure(ctx,{...check,id:check.id?`${check.id}-${edge}`:undefined,
        key:`visible-inset:${d.id}:${r.id}:${edge}`,item:`${label} · ${name}可见留白`,
        property:'padding-'+edge,design:'待确认',runtime:'待确认',status:'review',
        visual:visual([d],[r]),publication:undefined,insetGroup:{designId:d.id,runtimeId:r.id,edge,sourceCheckId:check.id},
        measurementEvidence:{metric:'layout-inset',side:edge}});
    }).filter(Boolean);
  }
  function mergeInsetEdges(checks){
    const out=[],seen=new Map();
    for(const c of checks){
      const d=c.visual?.design?.nodeIds,r=c.visual?.runtime?.nodeIds;
      if(!/^padding-(top|right|bottom|left)$/.test(c.property)||d?.length!==1||r?.length!==1){out.push(c);continue;}
      const key=[c.property,d[0],r[0]].join('|');
      if(!seen.has(key)){seen.set(key,out.length);out.push(c);continue;}
      const i=seen.get(key),prior=out[i],a=prior.publication?.status==='validated',b=c.publication?.status==='validated';
      if(prior.publication?.reasonCode==='duplicate-inset-values')continue;
      if(a&&b&&(prior.design!==c.design||prior.runtime!==c.runtime)){
        out[i]=hold({...c,design:'待确认',runtime:'待确认'},'同一侧可见留白的测量值冲突','duplicate-inset-values');continue;
      }
      if(b&&!a||a===b&&c.insetGroup&&!prior.insetGroup)out[i]=c;
    }
    return out;
  }
  function publish(ctx,checks){
    const published=checks.filter(c=>c&&c.property!=='line-height').map(c=>{
      if(['uncovered','content'].includes(c.status))return c;
      const out=remeasure(ctx,c);if(!out)return null;
      if(c.status==='review'&&out.status==='same'&&out.publication?.metric==='existing-measurement')return c;
      if(out.design!==c.design||out.runtime!==c.runtime||out.status!==c.status)out.originalCheck={status:c.status,design:c.design,runtime:c.runtime,visual:c.visual};
      return out;
    }).filter(Boolean);
    const visible=published.filter(c=>!coveredTransparentInset(ctx,c,published));
    const edges=mergeInsetEdges(visible.flatMap(c=>expandInsetEdges(ctx,c)));
    return edges.filter(c=>!coveredTransparentInset(ctx,c,edges));
  }
  function relationChecks(ctx){
    const checks=[],seen=new Set();
    for(const parent of ctx.nodes.design){
      const cc=children(parent).filter(visible);if(cc.length<2||cc.length>10)continue;
      const pairs=cc.map(c=>canonicalEndpoint(c)).map(d=>({d,r:ctx.maps.runtime.get(ctx.pairs.get(d.id))})).filter(p=>p.r);
      if(pairs.length!==cc.length)continue;
      for(const axis of ['horizontal','vertical']){
        const start=axis==='horizontal'?'x':'y',size=axis==='horizontal'?'width':'height',cross=axis==='horizontal'?'y':'x',cs=axis==='horizontal'?'height':'width';
        const sorted=pairs.slice().sort((a,b)=>box(a.d)[start]-box(b.d)[start]);
        for(let i=1;i<sorted.length;i++){
          const p=sorted[i-1],q=sorted[i];
          const aligned=(a,b)=>Math.min(box(a)[cross]+box(a)[cs],box(b)[cross]+box(b)[cs])-Math.max(box(a)[cross],box(b)[cross])>0;
          if(!aligned(p.d,q.d)||!aligned(p.r,q.r))continue;
          const key=`contract-gap:${axis}:${p.d.id}:${q.d.id}`;if(seen.has(key))continue;seen.add(key);
          const label=(p.d.text?.direct||p.d.text?.descendant||p.d.name||'组件').slice(0,40);
          const check={key,item:`${label} · ${axis==='horizontal'?'横向':'纵向'}间距`,property:`layout.${axis}-gap`,status:'review',category:'layout',design:'待测量',runtime:'待测量',matchBasis:['同模块完整子内容','属性端点规范化'],visual:visual([p.d,q.d],[p.r,q.r])};
          const out=remeasure(ctx,check);if(out?.publication?.status==='validated')checks.push(out);
        }
      }
    }return checks;
  }
  function propertyTasks(ctx){
    const out=[],seen=new Set(),edgeNames={top:'顶部',right:'右侧',bottom:'底部',left:'左侧'};
    for(const m of ctx.structureMatches||[]){
      const carrier=measurementCarrier(ctx,m.designNode.raw,m.runtimeNode.raw);
      const d=carrier?.design||m.designNode.raw,r=carrier?.runtime||m.runtimeNode.raw;
      if(!d._parent||d.type==='TEXT'||!children(d).length||!pairValid(ctx,d,r))continue;
      if(!visibleSurface(d)||!visibleSurface(r))continue;
      const geometry=ctx.hooks.contentGeometry(d,'design');
      for(const edge of ['top','right','bottom','left']){
        const property='padding-'+edge,key=`spacing-owner:${d.id}:${r.id}:${property}`;
        if(seen.has(key)||(!num(d.styles?.[property])&&!num(r.styles?.[property])))continue;seen.add(key);
        // Centering/fill remainder is not CSS padding. Existing relationship and
        // typography tasks cover it; don't invent a padding task from that space.
        if(!Number.isFinite(geometry.insets?.[edge])||Math.abs(geometry.insets[edge]-num(d.styles?.[property]))>1.5)continue;
        const item=`${(d.text?.descendant||d.name||'组件').slice(0,50)} · ${edgeNames[edge]}可见留白`;
        const measured=remeasure(ctx,{key,item,property,status:'review',category:'layout',visual:visual([d],[r]),matchBasis:['属性对象独立测量','外框与内容分别定位']});
        if(measured)out.push(measured);
      }
    }return out;
  }
  const FUNCTION_ROLES=new Set(['component','content-group','text','value','unit','button','progress-track','progress-fill','progress-thumb','progress-tooltip','state-label']);
  const ROLE_ALIASES={container:'component',card:'component',region:'component',frame:'component',title:'text',label:'text',tab:'button'};
  function nestedRepresentations(ctx,a,b){
    const composite=p=>['component','content-group','button'].includes(p.role);
    const field=p=>['text','value','unit'].includes(p.role);
    const owner=composite(a)&&field(b)?a:composite(b)&&field(a)?b:null;
    if(!owner)return false;
    const slot=owner===a?b:a,d=ctx.maps.design.get(owner.designId),leaf=ctx.maps.design.get(slot.designId);
    if(!d||!leaf||d===leaf||!within(leaf,d))return false;
    const fields=descendants(d).filter(n=>n.type==='TEXT'&&text(n));
    return fields.length===1&&within(fields[0],leaf);
  }
  function registerSingleTextSlot(ctx,item){
    if(!['component','content-group','button'].includes(item.role))return;
    const d=ctx.maps.design.get(item.designId),r=ctx.maps.runtime.get(item.runtimeId);
    const dl=descendants(d).filter(n=>n!==d&&n.type==='TEXT'&&visible(n)&&text(n));
    const all=descendants(r).filter(n=>visible(n)&&text(n));
    const rl=all.filter(n=>!all.some(child=>child!==n&&within(child,n)));
    // This is a unique field inside an already confirmed functional object,
    // never positional pairing of arbitrary lists of dynamic copy.
    if(dl.length!==1||rl.length!==1||rl[0]===r||!within(rl[0],r))return;
    const dn=dl[0],rn=rl[0];
    if(ctx.pairs.has(dn.id)&&ctx.pairs.get(dn.id)!==rn.id
      ||ctx.reverse.has(rn.id)&&ctx.reverse.get(rn.id)!==dn.id)return;
    ctx.pairs.set(dn.id,rn.id);ctx.reverse.set(rn.id,dn.id);
    if(ctx.statePairs.some(p=>p.designId===dn.id&&p.runtimeId===rn.id))return;
    ctx.invalidatedIdentityIds?.delete(dn.id);
    ctx.statePairs.push({designId:dn.id,runtimeId:rn.id,designScopeId:d.id,runtimeScopeId:r.id,
      role:'text',source:'ai-role-with-structural-validation',identityContract:'contextual-functional-v1',
      basis:'single-text-slot-in-confirmed-component',derivedFrom:{designId:d.id,runtimeId:r.id}});
  }
  function acceptPairs(ctx,proposals){
    const accepted=[],rejected=[],items=(proposals||[]).map(p=>({...p,role:ROLE_ALIASES[p.role]||p.role}))
      .sort((a,b)=>(ctx.maps.design.get(a.designId)?._ancestors||[]).length-(ctx.maps.design.get(b.designId)?._ancestors||[]).length);
    const conflict=p=>items.some(q=>q!==p&&(q.designId===p.designId&&q.runtimeId!==p.runtimeId
      ||q.runtimeId===p.runtimeId&&q.designId!==p.designId
        &&!nestedRepresentations(ctx,p,q)&&!sharedCarrier(ctx,p.designId,q.designId,ctx.maps.runtime.get(p.runtimeId))));
    const textEvidence=n=>Boolean(text(n)||full(n)||n?.text?.placeholder||n?.text?.ariaLabel||n?.text?.value
      ||n?.attributes?.placeholder||n?.attributes?.['aria-label']||n?.placeholder);
    for(const p of items){
      const d=ctx.maps.design.get(p.designId),r=ctx.maps.runtime.get(p.runtimeId),ds=ctx.maps.design.get(p.designScopeId),rs=ctx.maps.runtime.get(p.runtimeScopeId);
      const revisesInstance=p.role==='component'&&d&&r&&d!==ds&&r!==rs
        &&ctx.instancePairs.some(m=>m.designNode.raw.id===d.id);
      const instanceConflict=m=>within(d,m.designNode.raw)!==within(r,m.runtimeNode.raw);
      const mayReplaceInstance=m=>revisesInstance
        &&(m.designNode.raw===d||m.runtimeNode.raw===r)
        &&within(m.designNode.raw,ds)&&within(m.runtimeNode.raw,rs)
        &&m.designNode.raw!==ds&&m.runtimeNode.raw!==rs;
      let reason='';
      if(!d||!r||!ds||!rs||!FUNCTION_ROLES.has(p.role))reason='对象或功能角色无效';
      else if(conflict(p))reason='同批建议存在一对多或多对一冲突，需共同重新判断';
      else if(!within(d,ds)||!within(r,rs)||ctx.pairs.get(ds.id)!==rs.id)reason='不在已对应的同一组件实例内';
      else if(ctx.instancePairs.some(m=>instanceConflict(m)&&!mayReplaceInstance(m)))reason='建议跨越了已确认的组件实例';
      else if((d.id===ds.id)!==(r.id===rs.id))reason='整个所属模块不能对应到模块内的单个槽位';
      else if((d.id===ds.id||r.id===rs.id)&&p.role!=='component')reason='功能槽位不能占用整个所属模块';
      else if(['text','value','unit'].includes(p.role)&&(!textEvidence(d)||!textEvidence(r)))reason='文字字段缺少实际文字或控件字段证据';
      else if(['component','content-group','button'].includes(p.role)&&(d.type==='TEXT'||!ownsLayout(d)||!ownsLayout(r))&&!(['component','content-group'].includes(p.role)&&singleTextRepresentation(d,r)))reason='功能组件建议缺少实际内容对象';
      else if(['component','content-group','button'].includes(p.role)&&compareScopes(d,r,ctx).status==='conflict')reason='单个成员与包含其他独立成员的集合不能作为同一个功能对象';
      else if(p.role==='progress-track'&&[d,r].some(n=>!box(n)||box(n).width<box(n).height*3))reason='轨道不符合横向进度结构';
      else if(p.role==='progress-thumb'&&[d,r].some(n=>!box(n)||box(n).width>box(n).height*3||box(n).height>box(n).width*3))reason='进度点不符合局部标记结构';
      else if(p.role==='progress-tooltip'&&[d,r].some(n=>!full(n)))reason='提示浮层缺少内容';
      if(reason){rejected.push({...p,reason});continue;}
      const invalidated=[],reconsideredInstances=ctx.instancePairs.filter(m=>instanceConflict(m)&&mayReplaceInstance(m))
        .map(m=>({designId:m.designNode.raw.id,runtimeId:m.runtimeNode.raw.id}));
      const composite=['component','content-group','button'].includes(p.role);
      for(const [did,rid] of ctx.pairs){
        if(did===d.id&&rid===r.id)continue;
        const dn=ctx.maps.design.get(did),rn=ctx.maps.runtime.get(rid);
        const displaced=did===d.id||rid===r.id&&!sharedCarrier(ctx,did,d.id,r);
        const crossed=composite&&dn&&rn&&did!==d.id&&rid!==r.id&&within(dn,d)!==within(rn,r);
        if(displaced||crossed){
          invalidated.push({designId:did,runtimeId:rid,reason:crossed?'child-outside-confirmed-component':'superseded-identity'});
          ctx.pairs.delete(did);if(ctx.reverse.get(rid)===did)ctx.reverse.delete(rid);
        }
      }
      const invalidIds=new Set(invalidated.map(x=>x.designId));
      ctx.statePairs=ctx.statePairs.filter(x=>x.designId!==d.id&&!invalidIds.has(x.designId));
      ctx.instancePairs=ctx.instancePairs.filter(m=>!invalidIds.has(m.designNode.raw.id));
      ctx.pairs.set(d.id,r.id);ctx.reverse.set(r.id,d.id);
      const item={...p,source:'ai-role-with-structural-validation',identityContract:'contextual-functional-v1',
        ...(invalidated.length?{invalidatedPairs:invalidated}:{}),
        ...(reconsideredInstances.length?{reconsideredInstances}:{}),measurementStatus:'pending-property-resolution'};
      ctx.statePairs.push(item);
      ctx.invalidatedIdentityIds=ctx.invalidatedIdentityIds||new Set();
      for(const x of invalidated){
        ctx._imageSlotOwned?.delete(x.designId);ctx.invalidatedIdentityIds.add(x.designId);
        ctx.events.push({type:'identity-invalidated',...x,replacedBy:{designId:d.id,runtimeId:r.id},requiresRematch:true});
        if(x.designId!==d.id&&!ctx.ambiguities.some(a=>a.designId===x.designId))ctx.ambiguities.push({designId:x.designId,
          reason:'原对应关系与已确认组件冲突，需要重新定位',candidates:[]});
      }
      ctx.invalidatedIdentityIds.delete(d.id);ctx._imageSlotOwned?.delete(d.id);
      registerSingleTextSlot(ctx,item);
      accepted.push(item);
    }return {accepted,rejected};
  }
  function deriveContentGroups(ctx,ds,rs,matches){
    // Reconstruct a missing transparent group from ALL of its already paired
    // visible fields. This adds a component identity; it does not certify styles.
    const represented=new Set(matches.map(m=>m.runtimeNode.raw.id));
    const usedDesign=new Set(matches.map(m=>m.designNode.raw.id));
    const unitCache=new Map();
    const units=n=>{
      if(!unitCache.has(n))unitCache.set(n,descendants(n).filter(x=>visible(x)&&(text(x)||control(x)||graphicLeaf(x)))
        .filter(x=>!descendants(x).some(y=>y!==x&&visible(y)&&text(y)&&text(x)===full(y))));
      return unitCache.get(n);
    };
    const designGroups=ctx.nodes.design.filter(n=>n.type!=='TEXT'&&children(n).length
      &&!paint(n)&&!control(n)&&!descendants(n).some(x=>x!==n&&paint(x)&&!text(x))&&visible(n)).map(raw=>({id:raw.id,raw}));
    const signature=ns=>ns.map(n=>n.id).sort().join('|');
    for(const sn of rs.nodes){
      const r=sn.raw;
      if(represented.has(r.id)||!['title-region','content-group'].includes(sn.role)
        ||!children(r).length||paint(r)||control(r)||!visible(r)||r.geometry?.hasPseudoContent
        ||descendants(r).some(x=>x!==r&&paint(x)&&!text(x)))continue;
      const ru=units(r);if(!ru.length||ru.some(n=>!text(n)))continue;
      const candidates=designGroups.filter(dn=>{
        const d=dn.raw;if(usedDesign.has(d.id))return false;
        const du=units(d);if(du.length!==ru.length||du.some(n=>!text(n)))return false;
        const mapped=du.map(n=>ctx.maps.runtime.get(ctx.pairs.get(n.id)));
        if(mapped.some(n=>!n)||signature(mapped)!==signature(ru))return false;
        // A mapped ancestor must enclose BOTH proposed groups. No cross-instance promotion.
        const parent=(d._ancestors||[]).find(n=>ctx.pairs.has(n.id));
        const rp=parent&&ctx.maps.runtime.get(ctx.pairs.get(parent.id));
        return rp&&within(r,rp)&&r!==rp&&parent!==d;
      });
      // Nested same-content envelopes represent one group. Independent alternatives remain ambiguous.
      const outer=candidates.filter(a=>!candidates.some(b=>a!==b&&within(a.raw,b.raw)));
      if(outer.length!==1)continue;
      const d=outer[0];
      matches.push({designNode:structureNode(ds,d.raw),runtimeNode:sn,unique:true,score:100,layoutOnly:true,
        basis:['全部可见字段已一一对应','同一组件内透明内容组'],
        inspectionIdentity:{kind:'complete-content-group',memberPairs:units(d.raw).map(n=>({designId:n.id,runtimeId:ctx.pairs.get(n.id)}))}});
      represented.add(r.id);usedDesign.add(d.raw.id);
      ctx.events.push({type:'content-group-recovered',designId:d.raw.id,runtimeId:r.id,memberCount:ru.length});
    }
  }
  function derivePaintOwners(ctx,ds,rs,matches){
    const usedD=new Set(matches.map(m=>m.designNode.raw.id)),usedR=new Set(matches.map(m=>m.runtimeNode.raw.id));
    for(const d of ctx.nodes.design){
      if(usedD.has(d.id)||d.type==='TEXT'||!visibleSurface(d)||!visible(d))continue;
      const fields=descendants(d).filter(n=>n.type==='TEXT'&&visible(n)&&text(n));
      if(!fields.length||fields.some(n=>!ctx.pairs.has(n.id)))continue;
      const r=resolveOwner(ctx,d,null);
      if(!r||usedR.has(r.id)||!visibleSurface(r))continue;
      const parent=(d._ancestors||[]).find(n=>ctx.pairs.has(n.id));
      const rp=parent&&ctx.maps.runtime.get(ctx.pairs.get(parent.id));
      if(!rp||r===rp||!within(r,rp))continue;
      const mapped=new Set(fields.map(n=>ctx.pairs.get(n.id)));
      const runtimeFields=descendants(r).filter(n=>visible(n)&&text(n));
      if(runtimeFields.some(n=>!mapped.has(n.id))||mapped.size!==runtimeFields.length)continue;
      // Graphic-bearing components require their own complete graphic identities.
      const dg=descendants(d).filter(graphicLeaf),rg=descendants(r).filter(graphicLeaf);
      if(dg.length!==rg.length||dg.some(n=>!rg.some(x=>ctx.pairs.get(n.id)===x.id)))continue;
      matches.push({designNode:structureNode(ds,d),runtimeNode:structureNode(rs,r),unique:true,score:100,layoutOnly:false,
        basis:['组件全部字段已对应','实际绘制外框与所属模块验证'],inspectionIdentity:{kind:'layout-owner',contentMapped:fields.length}});
      usedD.add(d.id);usedR.add(r.id);
      ctx.events.push({type:'paint-owner-recovered',designId:d.id,runtimeId:r.id});
    }
  }
  function applyAcceptedPairs(ctx,designStructure,runtimeStructure,existingMatches=ctx.structureMatches||[]){
    const approved=ctx.statePairs.filter(p=>p.source==='ai-role-with-structural-validation'
      &&ctx.pairs.get(p.designId)===p.runtimeId&&(ctx.reverse.get(p.runtimeId)===p.designId||sharedCarrier(ctx,p.designId,ctx.reverse.get(p.runtimeId),ctx.maps.runtime.get(p.runtimeId)))
      &&pairValid(ctx,ctx.maps.design.get(p.designId),ctx.maps.runtime.get(p.runtimeId)));
    const designIds=new Set(approved.map(p=>p.designId)),runtimeIds=new Set(approved.map(p=>p.runtimeId));
    const result=existingMatches.filter(m=>!ctx.invalidatedIdentityIds?.has(m.designNode.raw.id)&&!designIds.has(m.designNode.raw.id)&&(!runtimeIds.has(m.runtimeNode.raw.id)
      ||approved.some(p=>p.runtimeId===m.runtimeNode.raw.id&&sharedCarrier(ctx,p.designId,m.designNode.raw.id,m.runtimeNode.raw))));
    for(const p of approved){
      const d=ctx.maps.design.get(p.designId),r=ctx.maps.runtime.get(p.runtimeId);
      const previous=existingMatches.find(m=>m.designNode.raw.id===p.designId);
      result.push({...previous,designNode:structureNode(designStructure,d),runtimeNode:structureNode(runtimeStructure,r),
        unique:true,score:100,layoutOnly:false,basis:['AI 功能对象对应','真实对象与所属范围验证'],
        inspectionIdentity:{kind:'ai-validated-functional-slot',role:p.role,designScopeId:p.designScopeId,runtimeScopeId:p.runtimeScopeId},
        acceptedPair:{...p}});
    }
    // The selected roots are an identity anchor even when a caller passes only
    // component matches. Preserve that anchor for later scope validation.
    for(const d of ctx.nodes.design.filter(n=>!n._parent&&!n.parentId)){
      const r=ctx.maps.runtime.get(ctx.pairs.get(d.id));
      if(!r||r._parent||r.parentId||result.some(m=>m.designNode.raw.id===d.id||m.runtimeNode.raw.id===r.id))continue;
      result.unshift({designNode:structureNode(designStructure,d),runtimeNode:structureNode(runtimeStructure,r),
        unique:true,score:300,layoutOnly:false,basis:['选区根节点'],inspectionIdentity:{kind:'selection-root'}});
    }
    derivePaintOwners(ctx,designStructure,runtimeStructure,result);
    deriveContentGroups(ctx,designStructure,runtimeStructure,result);
    // Rebuild both indexes from the actual downstream matches. Existing equivalent
    // layout wrappers may share a carrier, but reverse always points to a live edge;
    // an accepted explicit pair is the sole owner of its newly assigned carrier.
    ctx.pairs.clear();ctx.reverse.clear();ctx._imageSlotOwned=new Map();ctx.imageSlotPairs=[];
    for(const m of result){
      ctx.pairs.set(m.designNode.raw.id,m.runtimeNode.raw.id);
    }
    for(const [d,r] of ctx.pairs)if(!ctx.reverse.has(r))ctx.reverse.set(r,d);
    ctx.structureMatches=result;
    return result;
  }
  function stateGroups(ctx){
    const groups=new Map();
    for(const p of ctx.statePairs){const key=p.designScopeId+'|'+p.runtimeScopeId;if(!groups.has(key))groups.set(key,{});groups.get(key)[p.role]=p;}
    return [...groups.values()];
  }
  function labelState(ctx,p,side,thumb){
    const label=ctx.maps[side].get(p[side+'Id']),segment=ctx.maps[side].get(p[side+'SegmentId']);
    const mark=ctx.maps[side].get(thumb[side+'Id']),scope=ctx.maps[side].get(p[side+'ScopeId']);
    if(!label||!segment||!mark||!within(segment,scope))return null;
    const s=box(segment),l=box(label),m=box(mark),cx=m.x+m.width/2;
    if(s.width<s.height*3||l.x+l.width/2<s.x-2||l.x+l.width/2>s.x+s.width+2||l.y<s.y||l.y-s.y>Math.max(100,l.height*4))return null;
    return cx>=s.x-.5&&cx<=s.x+s.width+.5;
  }
  function stateRelationChecks(ctx){
    const out=[];
    for(const g of stateGroups(ctx)){
      const track=g['progress-track'],thumb=g['progress-thumb'],tip=g['progress-tooltip'];if(!track)continue;
      const dt=ctx.maps.design.get(track.designId),rt=ctx.maps.runtime.get(track.runtimeId);
      const make=(name,property,ds,rs,a,b,metric)=>{
        const equal=Math.abs(a-b)<=1;out.push(complete({key:`state:${track.designId}:${property}`,item:`进度组件 · ${name}`,property,design:value(a),runtime:value(b),status:equal?'same':'different',category:'layout',judgment:equal?'一致':`前端${b>a?'多':'少'} ${value(Math.abs(b-a))}`,visual:visual(ds,rs)},ds,rs,metric));
      };
      make('轨道粗细','state.track-height',[dt],[rt],box(dt).height,box(rt).height,'state-invariant');
      if(!thumb)continue;
      const dp=ctx.maps.design.get(thumb.designId),rp=ctx.maps.runtime.get(thumb.runtimeId);
      const onTrack=(t,p)=>{const a=box(t),b=box(p);return b.x+b.width/2>=a.x-2&&b.x+b.width/2<=a.x+a.width+2&&Math.abs(b.y+b.height/2-a.y-a.height/2)<=Math.max(a.height,b.height)+2;};
      if(!onTrack(dt,dp)||!onTrack(rt,rp))continue;
      make('进度点与轨道垂直对齐','state.thumb-alignment',[dt,dp],[rt,rp],box(dp).y+box(dp).height/2-box(dt).y-box(dt).height/2,box(rp).y+box(rp).height/2-box(rt).y-box(rt).height/2,'state-invariant');
      if(tip){
        const df=ctx.maps.design.get(tip.designId),rf=ctx.maps.runtime.get(tip.runtimeId);
        // Compare attachment distance to the moving marker, never absolute x.
        const attachment=(p,f)=>box(p).y-box(f).y-box(f).height;
        if(attachment(dp,df)>=-1&&attachment(rp,rf)>=-1)make('浮层与进度点间距','state.tooltip-gap',[df,dp],[rf,rp],attachment(dp,df),attachment(rp,rf),'state-invariant');
      }
      const stateLabels=ctx.statePairs.filter(p=>p.role==='state-label'&&p.designScopeId===track.designScopeId&&p.runtimeScopeId===track.runtimeScopeId);
      for(const active of [true,false]){
        const dl=stateLabels.filter(p=>labelState(ctx,p,'design',thumb)===active),rl=stateLabels.filter(p=>labelState(ctx,p,'runtime',thumb)===active);
        // A shared variant can be measured only when the design examples agree.
        for(const property of ['color','font-weight']){
          const designs=dl.map(p=>ctx.maps.design.get(p.designId)),runs=rl.map(p=>ctx.maps.runtime.get(p.runtimeId));
          if(!designs.length||!runs.length)continue;
          const vals=designs.map(n=>ctx.hooks.resolveStyle(n,'design',property));
          if(vals.some(v=>!v.resolved)||!vals.every(v=>ctx.hooks.compareStyle(property,vals[0].value,v.value).same))continue;
          for(const rn of runs){
            const rv=ctx.hooks.resolveStyle(rn,'runtime',property);if(!rv.resolved)continue;
            const cmp=ctx.hooks.compareStyle(property,vals[0].value,rv.value),dn=designs[0];
            out.push(complete({key:`state-style:${track.designId}:${rn.id}:${property}`,item:`进度组件 · ${active?'当前':'非当前'}档位${property==='color'?'颜色':'字重'}`,property:'state.variant-'+property,design:cmp.left.display,runtime:cmp.right.display,status:cmp.same?'same':'different',category:'style',judgment:ctx.hooks.judgment(property,cmp),visual:visual([dn],[rn])},[dn],[rn],'same-state-variant',{active}));
          }
        }
      }
    }return out;
  }
  function stateDecision(ctx,check){
    // Only state-dependent dimensions can be exempted. Fonts, radius, padding,
    // track thickness and tooltip attachment remain measurable defects.
    if(!['box.local.width','state.progress-position','color','font-weight'].includes(check.property))return null;
    const ids=check.visual?.design?.nodeIds||[];
    for(const g of stateGroups(ctx)){
      const fill=g['progress-fill'],track=g['progress-track'],thumb=g['progress-thumb'];if(!track||!thumb)continue;
      if(['color','font-weight'].includes(check.property)){
        const p=ctx.statePairs.find(p=>p.role==='state-label'&&ids.length===1&&p.designId===ids[0]&&p.designScopeId===track.designScopeId&&p.runtimeScopeId===track.runtimeScopeId);
        if(!p)continue;
        const a=labelState(ctx,p,'design',thumb),b=labelState(ctx,p,'runtime',thumb);
        if(a===null||b===null||a===b)continue;
        return {...check,status:'behavior',judgment:'当前档位不同；颜色与字重按相同激活状态另行检查',publication:{version:VERSION,status:'validated',metric:'state-dependent',selected:{design:a,runtime:b}}};
      }
      if(!ids.every(id=>id===(fill?.designId)||id===thumb.designId))continue;
      const position=side=>{const t=box(ctx.maps[side].get(track[side+'Id'])),p=box(ctx.maps[side].get(thumb[side+'Id']));return (p.x+p.width/2-t.x)/t.width;};
      const a=position('design'),b=position('runtime');if(![a,b].every(v=>Number.isFinite(v)&&v>=-.02&&v<=1.02)||Math.abs(a-b)<.02)continue;
      return {...hold(check,'已识别进度位置变化，但数值到位置的映射规则尚未验证'),stateObservation:{designPosition:a,runtimePosition:b,roleVerified:true,policyVerified:false}};
    }return null;
  }
  function inspectSlots(ctx,pairs){
    const out=[];
    for(const p of pairs||[]){
      const d=ctx.maps.design.get(p.designId),r=ctx.maps.runtime.get(p.runtimeId);if(!d||!r)continue;
      const props=['text','value','unit','state-label'].includes(p.role)?['font-size','font-weight','line-height','color']:[];
      if(!props.length){
        const radius=n=>Number.parseFloat(n.styles?.['border-radius'])||0;
        if((paint(d)||paint(r))&&(radius(d)>0||radius(r)>0))props.push('border-radius');
        // A matched transparent layout group has no background to compare.
        // A fill on only one side is still a real candidate difference.
        if(backgroundPaint(d)||backgroundPaint(r))props.push('background-color');
      }
      for(const property of props){
        const c={key:`slot:${p.designId}:${property}`,item:`${d.text?.direct||d.name||p.role} · ${property}`,property,status:'review',category:'style',visual:visual([d],[r])};
        const measured=remeasure(ctx,c);if(measured)out.push(measured);
      }
    }return out;
  }
  function summary(ctx){return {version:VERSION,identityPairs:ctx.pairs.size,instances:ctx.instancePairs.map(p=>({designId:p.designNode.id,runtimeId:p.runtimeNode.id})),ownerRepairs:ctx.events,taskExclusions:[...(ctx.taskExclusions?.values()||[])],ambiguousSlots:ctx.ambiguities,statePairs:ctx.statePairs,imageSlotPairs:ctx.imageSlotPairs||[]};}
  return {VERSION,norm,text,full,box,within,descendants,visible,describeScope,compareScopes,semanticScopesCompatible,textClippedBackground,paint,visibleSurface,control,numeric,labels,componentIdentity,approvedIdentity,measurementCarrier,completeTextCarrier,contexts,contextScore,stateRole,makeContext,reconcile,deriveContentGroups,derivePaintOwners,clearImageSlots,registerImageSlots,resolveOwner,canonicalEndpoint,pairValid,gapEndpointIdentity,propertyOwnerValid,remeasure,publish,propertyTasks,relationChecks,acceptPairs,applyAcceptedPairs,stateRelationChecks,stateDecision,inspectSlots,summary};
});
