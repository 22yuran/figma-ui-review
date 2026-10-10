const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../chrome-ui-review-extension/inspection-contracts.js');
const Review=require('../chrome-ui-review-extension/inspection-review.js');
const sandbox={console,document:{querySelector:()=>({selectedIndex:0})},InspectionContracts:C};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(`${__dirname}/../chrome-ui-review-extension/popup.js`,'utf8').split('const wait =')[0]+`\nglobalThis.api={prepareNodes,buildSemanticStructure,matchSemanticStructures,bottomUpPropagate,layoutPaddingChecks,layoutMeasurement,measureContentGeometry,geometryEdgesComparable,resolveVisualProperty,compareStyle,judgment};`,sandbox);
const a=sandbox.api,b=(x,y,width,height)=>({x,y,width,height});
function n(id,parentId,bb,direct='',styles={},extra={}){return {id,parentId,geometry:direct?{textInk:{policy:'visible-text-ink-v1',status:'measured',box:{...bb},lines:[{...bb}],validation:{verified:true}}}:{},box:{local:bb},text:{direct,descendant:direct},styles:{display:'block','font-size':'14px','font-weight':'400','line-height':bb.height+'px',color:'rgb(0,0,0)',...styles},...extra};}
function analyze(d,r){
  for(const ns of [d,r])for(const p of ns.slice().reverse())if(!p.text.direct)p.text.descendant=ns.filter(x=>x.parentId===p.id).map(x=>x.text.descendant).join(' ');
  const dd=a.prepareNodes(d,{width:1000,height:1000}),rr=a.prepareNodes(r,{width:1000,height:1000});
  const ds=a.buildSemanticStructure(dd,'design',0,null),rs=a.buildSemanticStructure(rr,'runtime',0,null),legacy=a.matchSemanticStructures(ds,rs).matches;
  legacy.push(...a.bottomUpPropagate(ds,rs,legacy));
  const ctx=C.makeContext(dd,rr,{measure:a.layoutMeasurement,contentGeometry:a.measureContentGeometry,edgesComparable:a.geometryEdgesComparable,resolveStyle:a.resolveVisualProperty,compareStyle:a.compareStyle,judgment:a.judgment});
  const matches=C.reconcile(ctx,ds,rs,legacy);return {ctx,matches,checks:C.publish(ctx,a.layoutPaddingChecks(matches)),dd,rr,ds,rs};
}
const design=(...args)=>({...n(...args),type:args[3]?'TEXT':'FRAME'}),runtime=(...args)=>({...n(...args),tag:args[5]?.tag||'div'});
// Repeated label in two modules, whose order changes. An injected style error
// must stay with the correct module instead of following the nearest text.
{
 const side=(prefix,swapped=false)=>{
  const f=prefix==='d'?design:runtime,ns=[f(prefix,null,b(0,0,400,300))];
  for(const [i,title] of ['店铺资料','经营数据'].entries()){
   const y=(swapped?1-i:i)*120,id=prefix+i;ns.push(f(id,prefix,b(0,y,300,100),'',{'background-color':'white'}),f(id+'h',id,b(16,y+10,100,20),title),f(id+'t',id,b(16,y+45,100,20),'相同店名',{'font-size':prefix==='r'&&i===1?'20px':'14px'}));
  }return ns;
 };
 const {ctx}=analyze(side('d'),side('r',true));
 assert.equal(ctx.pairs.get('d0t'),'r0t');assert.equal(ctx.pairs.get('d1t'),'r1t');
 const c=C.remeasure(ctx,{property:'font-size',status:'different',visual:{design:{nodeIds:['d1t']},runtime:{nodeIds:['r0t']}}});
 assert.equal(c.runtime,'20px');assert.equal(c.status,'different');
}
// Same-size button leaf must not replace the outer; real increased padding still fails.
for(const left of [23,29]){
 const d=[design('d',null,b(0,0,300,100)),design('db','d',b(10,10,88,36),'',{'padding-left':'23px','padding-right':'23px','background-color':'white'}),design('dt','db',b(33,17,42,22),'发布')];
 const r=[runtime('r',null,b(0,0,300,100)),runtime('rb','r',b(10,10,88,36),'',{'background-color':'white'},{tag:'button'}),runtime('rt','rb',b(10+left,17,42,22),'发布')];
 const {ctx}=analyze(d,r);assert.equal(ctx.pairs.get('db'),'rb');
 const c=C.remeasure(ctx,{property:'padding-left',status:'different',visual:{design:{nodeIds:['db']},runtime:{nodeIds:['rt']}}});
 assert.equal(c.design,'23px');assert.equal(c.runtime,left+'px');assert.equal(c.status,left===23?'same':'different');
}
// Equivalent internal padding and external margin, with an intentionally changed gap.
for(const gap of [12,18]){
 const d=[design('d',null,b(0,0,400,40)),design('dl','d',b(0,0,64,24),'说明'),design('dw','d',b(64,0,166,24),'',{'padding-left':'12px'}),design('dt','dw',b(76,0,154,24),'具体内容')];
 const r=[runtime('r',null,b(0,0,400,40)),runtime('rl','r',b(0,0,64,24),'说明'),runtime('rw','r',b(64+gap,0,154,24),'',{'margin-left':gap+'px'}),runtime('rt','rw',b(64+gap,0,154,24),'具体内容')];
 const {ctx}=analyze(d,r),checks=C.relationChecks(ctx),c=checks.find(c=>c.property==='layout.horizontal-gap');
 assert(c);assert.equal(c.design,'12px');assert.equal(c.runtime,gap+'px');assert.equal(c.status,gap===12?'same':'different');
 const inset=C.remeasure(ctx,{property:'padding-left',status:'different',visual:{design:{nodeIds:['dw']},runtime:{nodeIds:['rw']}}});
 assert.equal(inset.property,'layout.horizontal-gap','transparent wrapper padding is compared as an adjacent visible-content gap');
 assert.equal(inset.status,gap===12?'same':'different');
}
// Dynamic value and progress position change, while invariant styling remains testable.
function progress(thickness=4){
 const make=(side,x,val,h)=>{
  const f=side==='d'?design:runtime;
  return [f(side,null,b(0,0,500,300),'',{'background-color':'white'}),f(side+'heading',side,b(20,10,200,24),'激励'),f(side+'label',side,b(20,50,100,20),'预计奖励'),f(side+'v',side,b(20,80,val.length*20,40),val,{'font-size':side==='d'?'32px':'36px'}),f(side+'u',side,b(24+val.length*20,90,60,20),'积分'),f(side+'track',side,b(20,230,400,h),'',{'background-color':'gray'}),f(side+'thumb',side,b(x-6,226,12,12),'',{'background-color':'white'}),f(side+'tip',side,b(x-40,174,80,40),'提示内容',{'background-color':'white'})];
 };
 const v=analyze(make('d',300,'7000',4),make('r',100,'300',thickness));
 assert.equal(v.ctx.pairs.get('dv'),'rv');
 const proposals=['track','thumb','tip'].map(role=>({designId:'d'+role,runtimeId:'r'+role,designScopeId:'d',runtimeScopeId:'r',role:'progress-'+({track:'track',thumb:'thumb',tip:'tooltip'}[role])}));
 const accepted=C.acceptPairs(v.ctx,proposals);assert.equal(accepted.accepted.length,3);
 return v;
}
for(const height of [4,8]){
 const {ctx}=progress(height),checks=C.stateRelationChecks(ctx);
 assert.equal(checks.find(c=>c.property==='state.track-height').status,height===4?'same':'different');
 assert.equal(checks.find(c=>c.property==='state.tooltip-gap').status,'same');
 const font=C.remeasure(ctx,{property:'font-size',status:'review',visual:{design:{nodeIds:['dv']},runtime:{nodeIds:['rv']}}});
 assert.equal(font.status,'different');assert.equal(C.stateDecision(ctx,font),null,'data cannot exempt font defects');
 const state=C.stateDecision(ctx,{property:'state.progress-position',visual:{design:{nodeIds:['dthumb']},runtime:{nodeIds:['rthumb']}}});assert.equal(state.status,'review');assert.equal(state.stateObservation.policyVerified,false);
}
// Switching active tiers is allowed, but a wrong active-tier color still fails.
for(const badColor of [false,true]){
 const {ctx}=progress();
 for(const side of ['design','runtime']){
  const prefix=side==='design'?'d':'r',root=ctx.maps[side].get(prefix);
  for(let i=0;i<2;i++){
   const active=side==='design'?i===1:i===0;
   for(const [suffix,bb,direct,styles] of [[`seg${i}`,b(20+i*200,230,196,4),'',{'background-color':'gray'}],[`tier${i}`,b(40+i*200,245,140,20),i?'高档位':'低档位',{color:active?(side==='runtime'&&badColor?'red':'black'):'gray','font-weight':active?'600':'400'}]]){
    const item=n(prefix+suffix,prefix,bb,direct,styles,{type:side==='design'&&direct?'TEXT':'FRAME',tag:'div'});
    item._box=bb;item._parent=root;item._ancestors=[root];item._children=[];root._children.push(item);ctx.maps[side].set(item.id,item);ctx.nodes[side].push(item);
   }
  }
 }
 const pair=C.acceptPairs(ctx,[0,1].map(i=>({role:'state-label',designId:'dtier'+i,runtimeId:'rtier'+i,designScopeId:'d',runtimeScopeId:'r',designSegmentId:'dseg'+i,runtimeSegmentId:'rseg'+i})));
 assert.equal(pair.accepted.length,2);
 const d=C.stateDecision(ctx,{property:'color',visual:{design:{nodeIds:['dtier0']},runtime:{nodeIds:['rtier0']}}});assert.equal(d.status,'behavior');
 const c=C.stateRelationChecks(ctx).find(c=>c.property==='state.variant-color'&&c.publication.active);
 assert(c);assert.equal(c.status,badColor?'different':'same');
}
// Deterministically verified differences do not require an AI round trip.
// Existing inline numeric segment checks must survive the new publication gate.
for(const gap of [2,8]){
 const d=[design('d',null,b(0,0,200,30)),design('dl','d',b(0,0,20,20),'完成'),design('dn','d',b(22,0,8,20),'1'),design('dr','d',b(32,0,20,20),'次')];
 const r=[runtime('r',null,b(0,0,200,30)),runtime('rt','r',b(0,0,80,20),'完成1次',{}, {geometry:{numericSegments:[{index:2,text:'1',leftChar:'成',rightChar:'次',box:b(20+gap,0,8,20),leftBox:b(10,0,10,20),rightBox:b(28+gap*2,0,10,20)}]}})];
 for(const seg of r[1].geometry.numericSegments)seg.textInk={policy:'visible-text-ink-v1',status:'measured',box:seg.box,leftBox:seg.leftBox,rightBox:seg.rightBox};
 const {ctx}=analyze(d,r);
 const c=C.remeasure(ctx,{property:'layout.horizontal-gap',source:'numeric-segment',measurementEvidence:{segmentIndex:2,side:'left',designScopeId:'d',runtimeScopeId:'r',designNumberId:'dn',designLeftId:'dl',designRightId:'dr',runtimeTextId:'rt'}});
 assert.equal(c.design,'2px');assert.equal(c.runtime,gap+'px');assert.equal(c.status,gap===2?'same':'different');
}
{
 const {ctx}=progress(),report={checks:[{id:'font',item:'字号',property:'font-size',status:'different',visual:{design:{nodeIds:['dv']},runtime:{nodeIds:['rv']}}},{id:'gap',item:'间距',property:'layout.horizontal-gap',status:'different',visual:{design:{nodeIds:['dv','du']},runtime:{nodeIds:['rv','ru']}}}]};
 report.checks=C.publish(ctx,report.checks);
 const routed=Review.routing.routeChecks(ctx,report.checks);
 assert.equal(routed.find(c=>c.id==='font').status,'different');
 assert.equal(routed.find(c=>c.id==='font').routing.action,'measure');
 assert(!Review.buildPackets(ctx,{checks:routed}).some(p=>p.checks.some(c=>c.id==='font')));
 assert.equal(C.acceptPairs(ctx,[{designId:'dv',runtimeId:'not-real',designScopeId:'d',runtimeScopeId:'r',role:'value'}]).accepted.length,0);

}
// A component's logical root can be transparent in DOM while Figma paints that root.
// This must not contradict structural acceptance or turn the root into a button.
{
 const d=[design('d',null,b(0,0,300,200),'',{'background-color':'white','border-radius':'0px'}),design('dt','d',b(10,10,80,22),'经营数据'),design('dd','d',b(10,40,80,22),'预计奖励')];
 const r=[runtime('r',null,b(0,0,300,200),'',{'background-color':'transparent','border-radius':'0px'}),runtime('rt','r',b(10,10,80,22),'经营数据'),runtime('rd','r',b(10,40,80,22),'预计奖励')];
 const {ctx,ds,rs,matches}=analyze(d,r),dn=ctx.maps.design.get('d'),rn=ctx.maps.runtime.get('r');
 assert.equal(C.pairValid(ctx,dn,rn),false,'an unvalidated painted/transparent pairing keeps the original guard');
 const selectedHeight=C.remeasure(ctx,{property:'box.local.height',status:'review',visual:{design:{nodeIds:['d']},runtime:{nodeIds:['r']}}});
 assert.equal(selectedHeight.status,'same','selected range geometry is measurable even when paint lives on different layers');
 assert.equal(selectedHeight.publication.metric,'selected-scope-geometry');
 assert.equal(C.remeasure(ctx,{property:'border-radius',status:'review',visual:{design:{nodeIds:['d']},runtime:{nodeIds:['r']}}}).status,'review',
   'scope geometry does not certify the visual radius owner');
 const root={designId:'d',runtimeId:'r',designScopeId:'d',runtimeScopeId:'r'};
 assert.equal(C.acceptPairs(ctx,[{...root,role:'button'}]).accepted.length,0);
 const accepted=C.acceptPairs(ctx,[{...root,role:'component'}]);assert.equal(accepted.accepted.length,1,JSON.stringify(accepted));
 assert.equal(C.pairValid(ctx,dn,rn),true);
 const applied=C.applyAcceptedPairs(ctx,ds,rs,matches);
 assert.equal(applied.filter(m=>m.designNode.raw.id==='d').length,1);
 assert.equal(applied.find(m=>m.designNode.raw.id==='d').designNode.role,'root','component acceptance retains root semantics');
 const width=C.remeasure(ctx,{property:'box.local.width',status:'same',visual:{design:{nodeIds:['d']},runtime:{nodeIds:['r']}}});
 assert.equal(width.status,'same');assert.equal(width.publication.status,'validated');
 assert.equal(C.acceptPairs(ctx,[{...root,role:'component',designId:'dt'}]).accepted.length,0,'a module cannot stand in for a child slot');
}
// The component identity and the node painting its border are separate
// relations; a same-looking node in another component is never a valid owner.
{
 const side=p=>{const f=p==='d'?design:runtime;return [f(p,null,b(0,0,500,150)),
  f(p+'a',p,b(10,10,200,110),'',{'background-color':'white'}),
  f(p+'ah',p+'a',b(20,20,100,20),'组件甲'),f(p+'at',p+'a',b(20,50,100,20),'说明甲'),
  f(p+'b',p,b(260,10,200,110),'',{'background-color':'white'}),
  f(p+'bh',p+'b',b(270,20,100,20),'组件乙'),f(p+'bt',p+'b',b(270,50,100,20),'说明乙')];};
 const {ctx}=analyze(side('d'),side('r'));
 const da=ctx.maps.design.get('da'),ra=ctx.maps.runtime.get('ra'),rb=ctx.maps.runtime.get('rb');
 assert.equal(C.propertyOwnerValid(ctx,da,ra,'border-radius'),true);
 assert.equal(C.propertyOwnerValid(ctx,da,rb,'border-radius'),false,'a different matched component cannot become the paint owner');
}
// A previous screenshot measurement can finish an endpoint check only when it
// still names the same objects and their original boxes have not moved.
{
 const d=[design('d',null,b(0,0,200,50)),design('da','d',b(0,0,20,20),'甲'),design('db','d',b(40,0,20,20),'乙')];
 const r=[runtime('r',null,b(0,0,200,50)),runtime('ra','r',b(0,0,20,20),'甲'),runtime('rb','r',b(43,0,20,20),'乙')];
 const {ctx}=analyze(d,r);
 for(const id of ['da','db'])delete ctx.maps.design.get(id).geometry.textInk;
 for(const id of ['ra','rb'])delete ctx.maps.runtime.get(id).geometry.textInk;
 const measurement=(id,bb)=>({nodeId:id,ownerId:id,box:{...bb},originalBox:{...bb},axes:{horizontal:'ink',vertical:'ink'},
   measuredAxis:'horizontal',source:'visible-content-union',policy:'visible-text-ink-v1'});
 const check={property:'layout.horizontal-gap',status:'review',visual:{design:{nodeIds:['da','db'],measurements:[measurement('da',b(0,0,20,20)),measurement('db',b(40,0,20,20))]},
   runtime:{nodeIds:['ra','rb'],measurements:[measurement('ra',b(0,0,20,20)),measurement('rb',b(43,0,20,20))]}}};
 const result=C.remeasure(ctx,check);
 assert.equal(result.status,'different');assert.equal(result.design,'20px');assert.equal(result.runtime,'23px');
 check.visual.runtime.measurements[1].originalBox.x=41;
 assert.equal(C.remeasure(ctx,check).status,'review','stale screenshot bounds must not be reused');
}
// Accepted remapping replaces the stale match and the prior owner of its runtime
// node. Property-task creation and measurement must see the repaired structure.
{
 const d=[design('d',null,b(0,0,400,120)),design('db','d',b(10,10,100,40),'',{'background-color':'white','padding-left':'10px','padding-right':'10px'}),design('dt','db',b(20,19,40,22),'发布'),design('df','d',b(160,10,100,40),'',{'background-color':'gray'})];
 const r=[runtime('r',null,b(0,0,400,120)),runtime('rold','r',b(10,10,100,40),'',{'background-color':'white'},{tag:'button'}),runtime('roldt','rold',b(20,19,40,22),'取消'),runtime('rnew','r',b(160,10,100,40),'',{'background-color':'white','padding-left':'20px','padding-right':'20px'},{tag:'button'}),runtime('rt','rnew',b(180,19,40,22),'发布')];
 const {ctx,ds,rs,matches}=analyze(d,r),node=(s,id)=>s.nodes.find(n=>n.raw.id===id)||{id,raw:ctx.maps[s===ds?'design':'runtime'].get(id),role:'container'};
 const stale=[...matches.filter(m=>!['db','df'].includes(m.designNode.raw.id)),
   {designNode:node(ds,'db'),runtimeNode:node(rs,'rold'),unique:true,layoutOnly:true,basis:['stale']},
   {designNode:node(ds,'df'),runtimeNode:node(rs,'rnew'),unique:true,basis:['stale competing owner']}];
 ctx.pairs.set('db','rold');ctx.reverse.set('rold','db');ctx.pairs.set('df','rnew');ctx.reverse.set('rnew','df');
 const accepted=C.acceptPairs(ctx,[{designId:'db',runtimeId:'rnew',designScopeId:'d',runtimeScopeId:'r',role:'button'}]);
 assert.equal(accepted.accepted.length,1,JSON.stringify(accepted));assert.equal(ctx.pairs.has('df'),false);assert.equal(ctx.reverse.has('rold'),false);
 const applied=C.applyAcceptedPairs(ctx,ds,rs,stale),match=applied.find(m=>m.designNode.raw.id==='db');
 assert.equal(match.runtimeNode.raw.id,'rnew');assert.equal(match.layoutOnly,false);assert.equal(match.acceptedPair.role,'button');
 assert.equal(applied.some(m=>m.designNode.raw.id==='df'),false);assert.equal(applied.some(m=>m.runtimeNode.raw.id==='rold'),false);
 assert.equal(ctx.structureMatches,applied);assert.equal(ctx.pairs.get('db'),'rnew');assert.equal(ctx.reverse.get('rnew'),'db');
 for(const [rid,did] of ctx.reverse)assert.equal(ctx.pairs.get(did),rid,'reverse must point to a current forward pair');
 const property=C.propertyTasks(ctx).find(c=>c.key.includes('spacing-owner:db:rnew:padding-left'));
 assert(property,'the AI pair must participate in downstream property-task discovery');
 assert.equal(property.design,'10px');assert.equal(property.runtime,'20px');assert.equal(property.status,'different');
 const repeated=C.applyAcceptedPairs(ctx,ds,rs,applied);assert.equal(repeated.filter(m=>m.designNode.raw.id==='db').length,1);
 const withoutRoot=C.applyAcceptedPairs(ctx,ds,rs,repeated.filter(m=>m.designNode.raw.id!=='d'));
 assert.equal(ctx.pairs.get('d'),'r');assert.equal(ctx.reverse.get('r'),'d');
 assert.equal(withoutRoot.filter(m=>m.designNode.raw.id==='d').length,1,'omitted root matches must not erase the selected scope anchor');
}
// Cross-component scope remains hard; painted/transparent representation is a
// property-resolution concern once a real contextual component is confirmed.
{
 const side=p=>{const f=p==='d'?design:runtime;return [f(p,null,b(0,0,500,200)),f(p+'a',p,b(0,0,220,180),'',{'background-color':'white'}),f(p+'at',p+'a',b(10,10,100,22),'模块甲'),f(p+'av',p+'a',b(10,50,100,22),'独立字段甲'),f(p+'b',p,b(250,0,220,180),'',{'background-color':'white'}),f(p+'bt',p+'b',b(260,10,100,22),'模块乙'),f(p+'bv',p+'b',b(260,50,100,22),'独立字段乙')];};
 const {ctx}=analyze(side('d'),side('r'));
 const crossed=C.acceptPairs(ctx,[{designId:'dat',runtimeId:'rbt',designScopeId:'d',runtimeScopeId:'r',role:'text'}]);
 assert.equal(crossed.accepted.length,0);assert.match(crossed.rejected[0].reason,/组件实例/);
 const dn=ctx.maps.design.get('da'),rn=ctx.maps.runtime.get('ra');rn.styles['background-color']='transparent';
 const accepted=C.acceptPairs(ctx,[{designId:dn.id,runtimeId:rn.id,designScopeId:'d',runtimeScopeId:'r',role:'content-group'}]);
 assert.equal(accepted.accepted.length,1);assert(C.approvedIdentity(ctx,dn,rn));
 const inset=C.remeasure(ctx,{property:'padding-left',status:'review',visual:{design:{nodeIds:[dn.id]},runtime:{nodeIds:[rn.id]}}});
 assert.equal(inset.status,'review');assert.equal(inset.publication.reasonCode,'property-carrier-missing');
 const before=[...ctx.pairs],stateBefore=ctx.statePairs.slice();
 const invalid=C.acceptPairs(ctx,[{designId:dn.id,runtimeId:'missing-object',designScopeId:'d',runtimeScopeId:'r',role:'content-group'}]);
 assert.equal(invalid.accepted.length,0);
 assert.deepEqual([...ctx.pairs],before,'invalid real-object proposals cannot mutate ownership');assert.deepEqual(ctx.statePairs,stateBefore);
}
console.log('inspection contracts: repeated labels, reordered modules, real style defects, state invariants, root component identity, accepted-pair structure writeback, reverse ownership, downstream property tasks and strict scope/rollback checks passed');
// One real text-bearing DOM block may carry both a Figma wrapper and its leaf.
// Keep the leaf mapping for typography when accepting that wrapper's identity.
{
 const {ctx,ds,rs,matches}=analyze([
  design('d',null,b(0,0,300,100)),design('dw','d',b(0,0,80,24)),design('dt','dw',b(0,0,80,24),'我有货源')
 ],[runtime('r',null,b(0,0,300,100)),runtime('rt','r',b(0,0,80,24),'我有货源',{'font-size':'20px'})]);
 assert.equal(ctx.pairs.get('dt'),'rt');
 const accepted=C.acceptPairs(ctx,[{designId:'dw',runtimeId:'rt',designScopeId:'d',runtimeScopeId:'r',role:'container'}]);
 assert.equal(accepted.accepted.length,1,JSON.stringify(accepted));
 C.applyAcceptedPairs(ctx,ds,rs,matches);
 assert.equal(ctx.pairs.get('dt'),'rt');assert.equal(ctx.pairs.get('dw'),'rt');
 const check=C.remeasure(ctx,{property:'font-size',status:'review',visual:{design:{nodeIds:['dt']},runtime:{nodeIds:['rt']}}});
 assert.equal(check.status,'different');assert.equal(check.runtime,'20px');
 const unsupported=C.remeasure(ctx,{property:'unknown-property',status:'same',visual:{design:{nodeIds:['dt']},runtime:{nodeIds:['rt']}}});
 assert.equal(unsupported.status,'review','old same values cannot bypass an absent measurement contract');
}
console.log('single-field wrapper/leaf ownership survives AI acceptance and detects a real typography defect; unsupported legacy same is not published passed');
