/* Review repeated, visible image slots as a group. Image contents can be data-driven. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ImageGroupReview=api;})(globalThis,function(){
  'use strict';
  const VERSION='1.0.0';
  const round=n=>Math.round(n*100)/100;
  const box=n=>n?._box||n?.box?.local||null;
  const valid=b=>b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0;
  const label=n=>String(n?.text?.direct||'').replace(/[\u200b-\u200d\s]+/g,'').trim();
  const textAsset=n=>String(n?.type||'').toUpperCase()==='TEXT'
    ||[n?.role,n?.inspectionRole].some(role=>['text','title','heading','paragraph','label','statictext'].includes(String(role||'').toLowerCase()));
  // Figma exports some gradient text as PNG while retaining its text identity.
  // The asset format describes how it is painted, not an image-layout slot.
  const image=(n,side)=>side==='design'?n?.asset?.type==='image'&&!textAsset(n):n?.tag==='img';
  const nearX=(a,b)=>Math.abs(a-b)<=Math.max(4,Math.min(a,b)*.08);
  function collect(nodes,side,rootBox){
    const images=[],excluded=[];
    for(const node of nodes||[]){
      if(!image(node,side))continue;
      const b=box(node);if(!valid(b))continue;
      if(rootBox&&b.width>=rootBox.width*.65&&b.height>=rootBox.height*.4){excluded.push(node.id);continue;}
      if(b.width<32||b.height<32)continue;
      images.push({node,box:b});
    }
    return {images,excluded};
  }
  function groups(images){
    const columns=[];
    for(const item of images.slice().sort((a,b)=>a.box.y-b.box.y||a.box.x-b.box.x)){
      const g=columns.find(g=>{
        const last=g.items[g.items.length-1].box,b=item.box;
        const gap=b.y-last.y-last.height;
        // Size and overlap are measured properties, not evidence of slot identity.
        return nearX(b.x,last.x)&&b.y>last.y&&gap<=Math.max(100,last.height*1.6);
      });
      if(g)g.items.push(item);else columns.push({items:[item]});
    }
    return columns.filter(g=>g.items.length>=2||g.items[0].box.width*g.items[0].box.height>=8000).map(g=>{
      const first=g.items[0].box,last=g.items[g.items.length-1].box;
      return {...g,box:{x:first.x,y:first.y,width:Math.max(...g.items.map(i=>i.box.x+i.box.width))-first.x,
        height:last.y+last.height-first.y}};
    });
  }
  function anchor(group,side,pairs){
    const b=group.box,candidates=[];
    for(const pair of pairs){
      const n=pair[side],p=box(n),txt=label(n);
      if(!valid(p)||txt.length<2||txt.length>80||!txt||label(pair.design)!==label(pair.runtime))continue;
      if(p.x<b.x-75||p.x>b.x+b.width+180||p.y<b.y-145||p.y>b.y+48)continue;
      const dx=Math.max(0,b.x-p.x,p.x-(b.x+b.width+100));
      const dy=Math.abs(p.y-b.y);
      candidates.push({pair,score:dy+dx*.5});
    }
    return candidates.sort((a,b)=>a.score-b.score).slice(0,8).map(c=>c.pair);
  }
  function format(values){
    const rounded=values.map(round);
    if(rounded.every(v=>v===rounded[0]))return `${rounded[0]}px × ${rounded.length}`;
    return rounded.map(v=>`${v}px`).join(' / ');
  }
  function ancestry(node,map){
    const out=[],seen=new Set();
    for(let n=node;n&&!seen.has(n.id);n=map.get(n.parentId)||n._parent){seen.add(n.id);out.push(n);}
    return out;
  }
  const within=(node,scope,map)=>ancestry(node,map).some(n=>n.id===scope.id);
  function commonScope(nodes,map){
    return ancestry(nodes[0],map).find(n=>nodes.every(item=>within(item,n,map)))||null;
  }
  function enclosingPair(d,r,pairs,dm,rm){
    return pairs.filter(p=>!image(p.design,'design')&&!image(p.runtime,'runtime')
      &&d.items.every(i=>within(i.node,p.design,dm))&&r.items.every(i=>within(i.node,p.runtime,rm)))
      .sort((a,b)=>ancestry(b.design,dm).length-ancestry(a.design,dm).length)[0]||null;
  }
  function slotIdentity(d,r,candidate,context){
    const {dm,rm,dg,rg,pairs,forward,reverse}=context;
    const shared=candidate.shared;
    let scopeD,scopeR,basis,anchor;
    if(shared){
      scopeD=commonScope([...d.items.map(i=>i.node),shared.design],dm);
      scopeR=commonScope([...r.items.map(i=>i.node),shared.runtime],rm);
      basis='stable-text-anchor';anchor={designId:shared.design.id,runtimeId:shared.runtime.id};
    }else{
      const parent=candidate.parentPair||enclosingPair(d,r,pairs,dm,rm);
      if(parent){scopeD=parent.design;scopeR=parent.runtime;basis='matched-parent';}
    }
    if(!scopeD||!scopeR)return {reason:'图片组缺少可验证的共同模块范围'};
    // A shared page title cannot authorize several unrelated image columns.
    if(dg.filter(g=>g.items.some(i=>within(i.node,scopeD,dm))).length!==1
      ||rg.filter(g=>g.items.some(i=>within(i.node,scopeR,rm))).length!==1)
      return {reason:'图片组的共同范围仍包含多个图片组'};
    for(let i=0;i<d.items.length;i++){
      const di=d.items[i].node.id,ri=r.items[i].node.id;
      if(forward.get(di)?.some(id=>id!==ri)||reverse.get(ri)?.some(id=>id!==di))
        return {reason:'图片槽位顺序与已有图片对应关系冲突'};
    }
    return {identity:{kind:'ordered-image-slot',basis,scope:{designId:scopeD.id,runtimeId:scopeR.id},
      ...(anchor?{anchor}:{}),designIds:d.items.map(i=>i.node.id),runtimeIds:r.items.map(i=>i.node.id),
      order:'top-to-bottom',contentPolicy:'data-driven',scopeUnique:true}};
  }
  function review(input={}){
    const design=input.design||[],runtime=input.runtime||[];
    const rootD=box(design.find(n=>!n._parent||!n.parentId)),rootR=box(runtime.find(n=>!n._parent||!n.parentId));
    const dc=collect(design,'design',rootD),rc=collect(runtime,'runtime',rootR);
    const dg=groups(dc.images),rg=groups(rc.images);
    const rawPairs=(input.pairs||[]).map(p=>({design:p.designNode?.raw||p.design,runtime:p.runtimeNode?.raw||p.runtime})).filter(p=>p.design&&p.runtime);
    const pairTargets=new Map(),pairSources=new Map();
    for(const p of rawPairs){
      if(!pairTargets.has(p.design.id))pairTargets.set(p.design.id,new Set());
      if(!pairSources.has(p.runtime.id))pairSources.set(p.runtime.id,new Set());
      pairTargets.get(p.design.id).add(p.runtime.id);pairSources.get(p.runtime.id).add(p.design.id);
    }
    const pairs=rawPairs.filter(p=>pairTargets.get(p.design.id).size===1&&pairSources.get(p.runtime.id).size===1);
    const known=new Set(pairs.map(p=>`${p.design.id}|${p.runtime.id}`));
    const dm=new Map(design.map(n=>[n.id,n])),rm=new Map(runtime.map(n=>[n.id,n]));
    const forward=new Map(),reverse=new Map();
    for(const p of rawPairs)if(image(p.design,'design')&&image(p.runtime,'runtime')){
      forward.set(p.design.id,[...new Set([...(forward.get(p.design.id)||[]),p.runtime.id])]);
      reverse.set(p.runtime.id,[...new Set([...(reverse.get(p.runtime.id)||[]),p.design.id])]);
    }
    const used=new Set(),checks=[],coverage=[],slotPairs=[];
    // Evaluate every contender before accepting any group, so iteration order cannot
    // let two design groups silently compete for the same runtime group.
    const proposals=dg.map(d=>{
      const da=anchor(d,'design',pairs);
      const candidates=rg.map((r,ri)=>{
        const x=Math.abs(d.box.x-r.box.x),y=Math.abs(d.box.y-r.box.y);
        if(x>Math.max(90,(rootD?.width||1000)*.08)||y>Math.max(100,(rootD?.height||1000)*.08))return null;
        const shared=da.find(p=>anchor(r,'runtime',pairs).includes(p));
        const pairedImage=d.items.some(di=>r.items.some(ri=>known.has(`${di.node.id}|${ri.node.id}`)));
        const parentPair=enclosingPair(d,r,pairs,dm,rm);
        if(!shared&&!pairedImage&&!parentPair)return null;
        return {r,ri,shared,pairedImage,parentPair,score:x+y+(shared?0:parentPair?10:30)};
      }).filter(Boolean).sort((a,b)=>a.score-b.score);
      return {da,candidates};
    });
    for(const [index,d] of dg.entries()){
      const {da,candidates}=proposals[index];
      const best=candidates[0];
      const above=da.filter(p=>box(p.design)?.y<=d.box.y-18&&Math.abs(box(p.design).x-d.box.x)<=80)
        .sort((a,b)=>box(b.design).y-box(a.design).y)[0];
      const heading=best?.pairedImage&&best.shared?.design?label(best.shared.design)
        :above?label(above.design):best?.shared?.design?label(best.shared.design):d.items[0].node.name||'图片';
      if(!best||candidates[1]&&candidates[1].score-best.score<20){
        coverage.push({designIds:d.items.map(i=>i.node.id),status:'unverified',reason:'图片组尚未找到唯一的对应模块'});continue;
      }
      const contenders=proposals.map((p,di)=>({di,candidate:p.candidates.find(c=>c.ri===best.ri)}))
        .filter(p=>p.candidate).sort((a,b)=>a.candidate.score-b.candidate.score);
      if(used.has(best.ri)||contenders[0]?.di!==index||contenders[1]&&contenders[1].candidate.score-best.score<20){
        coverage.push({designIds:d.items.map(i=>i.node.id),status:'unverified',reason:'多个设计图片组竞争同一前端模块'});continue;
      }
      used.add(best.ri);
      const r=best.r;
      if(d.items.length!==r.items.length){
        coverage.push({designIds:d.items.map(i=>i.node.id),runtimeIds:r.items.map(i=>i.node.id),status:'unverified',reason:'图片数量不同，可能由数据或列表状态造成'});continue;
      }
      const proof=slotIdentity(d,r,best,{dm,rm,dg,rg,pairs,forward,reverse});
      if(!proof.identity){
        coverage.push({designIds:d.items.map(i=>i.node.id),runtimeIds:r.items.map(i=>i.node.id),status:'unverified',reason:proof.reason});continue;
      }
      const identity=proof.identity;
      for(let slotIndex=0;slotIndex<d.items.length;slotIndex++)slotPairs.push({
        designId:d.items[slotIndex].node.id,runtimeId:r.items[slotIndex].node.id,status:'validated',
        source:'verified-image-group',identity:{...identity,slotIndex}});
      const visual={design:{nodeIds:d.items.map(i=>i.node.id),boxes:d.items.map(i=>i.box)},
        runtime:{nodeIds:r.items.map(i=>i.node.id),boxes:r.items.map(i=>i.box)}};
      const metrics=[['width','宽度',g=>g.items.map(i=>i.box.width)],['height','高度',g=>g.items.map(i=>i.box.height)],
        ['vertical-gap','纵向排列间距',g=>g.items.slice(1).map((i,j)=>i.box.y-g.items[j].box.y-g.items[j].box.height)]];
      for(const [property,name,values] of metrics){
        const a=values(d),b=values(r);if(!a.length||a.some(v=>v<0)||b.some(v=>v<0))continue;
        const delta=Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
        const same=delta<=1;
        checks.push({id:`image-group-${index+1}-${property}`,key:`image-group:${d.items.map(i=>i.node.id).join(',')}:${property}`,
          item:`${heading.slice(0,20)} · ${d.items.length===1?'图片':'图片组'}${name}（${d.items.length}处）`,property:`image-group.${property}`,
          design:format(a),runtime:format(b),status:same?'same':'different',category:'layout',source:'verified-image-group',
          judgment:same?'图片槽位排列与设计一致':`图片槽位${name}最大相差 ${round(delta)}px`,visual,
          measurementEvidence:{identity,metric:property,designValues:a,runtimeValues:b,tolerancePx:1},
          publication:{status:'validated',metric:'same-module-image-slot-geometry'}});
      }
      coverage.push({designIds:d.items.map(i=>i.node.id),runtimeIds:r.items.map(i=>i.node.id),status:'checked',
        label:heading,slots:d.items.length,identity});
    }
    for(const [index,r] of rg.entries())if(!used.has(index))coverage.push({runtimeIds:r.items.map(i=>i.node.id),status:'unverified',reason:'前端图片组尚未找到对应的设计模块'});
    return {version:VERSION,checks,coverage,slotPairs,summary:{designGroups:dg.length,runtimeGroups:rg.length,
      checked:coverage.filter(c=>c.status==='checked').length,unverified:coverage.filter(c=>c.status==='unverified').length,
      excludedBackgrounds:{design:dc.excluded.length,runtime:rc.excluded.length}}};
  }
  return {VERSION,review};
});
