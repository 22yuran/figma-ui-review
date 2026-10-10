/* Identity and layout checks for a verified icon slot. No model/network access. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.IconReview=api;})(globalThis,function(){
  'use strict';
  const VERSION='1.0.0';
  const validBox=b=>b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0;
  const rawBox=node=>node?._box||node?.box?.local||node?.box||null;
  const round=value=>Math.round(value*100)/100;
  const hash=value=>{let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619);return (n>>>0).toString(16);};
  const text=value=>String(value||'').slice(0,600);
  function evaluate(input={}){
    const {design,runtime,slot={},identity={},boundaries={}}=input;
    const pairId=String(input.pairId||`${design?.id||''}__${runtime?.id||''}`);
    const base=`icon-${hash(pairId)}`,matches=[],checks=[],coverage=[];
    const ids={design:design?.id,runtime:runtime?.id};
    const box={design:rawBox(design),runtime:rawBox(runtime)};
    const evidence={version:VERSION,pairId,slot:{verified:slot.verified===true,basis:slot.basis||[],designParentId:slot.designParentId||null,runtimeParentId:slot.runtimeParentId||null},
      identity:{verdict:['same','different','uncertain'].includes(identity.verdict)?identity.verdict:'uncertain',confidence:Number.isFinite(Number(identity.confidence))?Number(identity.confidence):null,reason:text(identity.reason),error:text(identity.error),unsupported:identity.unsupported===true},
      boundaries:Object.fromEntries(['design','runtime'].map(side=>[side,{kind:boundaries[side]?.kind||null,box:boundaries[side]?.box||null}]))};
    const record=(property,status,reason,extra={})=>coverage.push({id:`${base}:coverage:${property}`,pairId,property,status,reason,nodeIds:ids,...extra});
    const visual=()=>Object.fromEntries(['design','runtime'].map(side=>[side,{nodeIds:[ids[side]],boxes:[box[side]]}]));
    const check=(property,status,designValue,runtimeValue,judgment,metric)=>({id:`${base}:${property}`,key:`${pairId}:${property}`,item:`图标 · ${({'icon.appearance':'图案','icon.width':'宽度','icon.height':'高度'})[property]||property}`,
      property,design:designValue,runtime:runtimeValue,status,judgment,category:property==='icon.appearance'?'style':'layout',source:'verified-icon-review',nodeIds:ids,
      visual:visual(),measurementEvidence:{...evidence,metric}});
    if(!ids.design||!ids.runtime||!validBox(box.design)||!validBox(box.runtime)){
      record('icon.identity','unverified','缺少两侧稳定节点或有效截图定位框');return {version:VERSION,pairId,matches,checks,coverage,evidence};
    }
    const slotVerified=slot.verified===true;
    const confidentIdentity=evidence.identity.confidence!=null&&evidence.identity.confidence>=0.8&&evidence.identity.confidence<=1;
    if(slotVerified){
      matches.push({designId:ids.design,runtimeId:ids.runtime,kind:'slot',identityVerdict:confidentIdentity?evidence.identity.verdict:'uncertain',basis:slot.basis||[],source:'verified-icon-review'});
      record('icon.slot','checked','两侧对应同一功能位置');
    }else record('icon.slot','unverified','尚未确认两侧属于同一功能位置，不能将相似图案直接视为同一检查对象');
    if(!slotVerified){
      record('icon.appearance','unverified',evidence.identity.verdict==='different'?'图案不同，但功能位置尚未确认，不能确定为图标替换错误':'图标对应关系尚未确认', {identityVerdict:evidence.identity.verdict});
    }else if(identity.unsupported){
      record('icon.appearance','unsupported',identity.reason||'当前模型不支持图标图案检查');
    }else if(identity.error||!confidentIdentity||evidence.identity.verdict==='uncertain'){
      record('icon.appearance','unverified',identity.error?'图标图案复核调用未完成':'图标图案证据不足，尚未确定是否一致');
    }else if(evidence.identity.verdict==='different'){
      checks.push(check('icon.appearance','different','设计图标','前端图标','同一功能位置的图标图案不同','same-slot-appearance'));
      record('icon.appearance','checked','同一功能位置已发现图案差异',{result:'different'});
    }else record('icon.appearance','checked','同一功能位置的图标身份已确认',{result:'same'});
    const d=boundaries.design,r=boundaries.runtime,knownKinds=new Set(['graphic-element','paint-path','image-element','visible-paint']);
    const compatible=slotVerified&&d&&r&&d.kind===r.kind&&knownKinds.has(d.kind)&&validBox(d.box)&&validBox(r.box);
    if(compatible){
      for(const dimension of ['width','height']){
        const left=round(d.box[dimension]),right=round(r.box[dimension]),delta=round(right-left),property=`icon.${dimension}`;
        const same=Math.abs(delta)<=1;
        const row=check(property,same?'same':'different',`${left}px`,`${right}px`,same?'同口径图标尺寸一致':`同口径图标${dimension==='width'?'宽':'高'}度：前端${delta>0?'多':'少'} ${Math.abs(delta)}px`,'same-boundary-dimension');
        row.measurementEvidence={...row.measurementEvidence,dimension,values:{design:left,runtime:right},delta,tolerancePx:1};
        row.visual=Object.fromEntries(['design','runtime'].map(side=>[side,{nodeIds:[ids[side]],boxes:[boundaries[side].box]}]));
        checks.push(row);record(property,'checked','已按相同类型的图标边界测量',{result:row.status});
      }
    }else{
      const reason=!slotVerified?'图标功能位置尚未确认，尺寸不能归到同一对象':!d||!r?'未取得两侧同口径的尺寸边界':'两侧尺寸边界含义不同或无效，不能混用路径轮廓、图像框与组件外框';
      for(const property of ['icon.width','icon.height'])record(property,'unverified',reason);
    }
    // Identity is not a finding about CSS color, stroke, or optical alignment.
    for(const [property,reason] of [['icon.color','图标填色与合成颜色尚未独立测量'],['icon.stroke','图标描边宽度尚未独立测量'],['icon.visual-alignment','可见轮廓与文字的视觉对齐尚未测量']])record(property,'unsupported',reason);
    return {version:VERSION,pairId,matches,checks,coverage,evidence};
  }
  return {VERSION,evaluate};
});
