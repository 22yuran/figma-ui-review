const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../chrome-ui-review-extension/inspection-contracts.js');
const sb={console,InspectionContracts:C,document:{querySelector:()=>({selectedIndex:0})}};vm.createContext(sb);
vm.runInContext(fs.readFileSync('chrome-ui-review-extension/popup.js','utf8').split('const wait =')[0]+';globalThis.api={prepareNodes,layoutMeasurement,measureContentGeometry,geometryEdgesComparable,compareStyle,judgment,semanticBaseRole,updateCoverageLedger,matchedSiblingSpacingChecksMeasured,styleMeasurementMatches,propertyEligibleForMatch};',sb);
const a=sb.api,box=(x,y,w,h)=>({x,y,width:w,height:h});
const raw=(id,parentId,b,styles={},text='')=>({id,parentId,tag:'div',box:{local:b},styles,text:{direct:text,descendant:text}});
const dn=a.prepareNodes([raw('d',null,box(0,0,500,500)),raw('da','d',box(0,0,100,100)),raw('db','d',box(0,110,100,100)),raw('dc','d',box(112,0,100,210))],box(0,0,500,500));
const rn=a.prepareNodes([raw('r',null,box(0,0,500,500)),raw('ra','r',box(0,0,100,100)),raw('rb','r',box(0,110,100,100)),raw('rc','r',box(112,0,100,210))],box(0,0,500,500));
const ctx=C.makeContext(dn,rn,{measure:(n)=>({box:C.box(n),axes:{horizontal:'layout',vertical:'layout'}}),contentGeometry:a.measureContentGeometry,edgesComparable:a.geometryEdgesComparable,compareStyle:a.compareStyle,judgment:a.judgment});
for(const [d,r] of [['d','r'],['da','ra'],['db','rb'],['dc','rc']]){ctx.pairs.set(d,r);ctx.reverse.set(r,d);}
const check={key:'compound',property:'layout.horizontal-gap',status:'review',visual:{design:{nodeIds:['vd','dc'],groups:[{id:'vd',memberIds:['da','db']}]},runtime:{nodeIds:['vr','rc'],groups:[{id:'vr',memberIds:['ra','rb']}]}}};
let out=C.remeasure(ctx,check);assert.equal(out.status,'same',JSON.stringify(out));assert.equal(out.design,'12px');assert.equal(out.runtime,'12px');
assert.equal(C.remeasure(ctx,out).status,'same','compound source members survive a second publication pass');
ctx.maps.runtime.get('rc')._box.x+=8;out=C.remeasure(ctx,check);assert.equal(out.status,'different');assert.equal(out.runtime,'20px','real drift is measured after resolving a group');
ctx.pairs.delete('db');assert.equal(C.remeasure(ctx,check).status,'review','unpaired group member cannot inherit identity');ctx.pairs.set('db','rb');
const wrong=structuredClone(check);wrong.visual.design.groups[0].memberIds.push('missing');assert.equal(C.remeasure(ctx,wrong).status,'review');
assert.equal(C.visible({...dn[1],_box:box(-999,-999,20,20)}),false,'helper outside selected region is excluded');
assert.equal(C.visible({...dn[1],_box:box(-5,0,20,20)}),true,'partial visibility is retained');
assert.equal(C.visibleSurface({styles:{'border-bottom-width':'1px','border-bottom-style':'solid'}}),false);
assert.equal(C.visibleSurface({styles:{border:'1px solid red'}}),true);
assert.equal(C.visibleSurface({styles:{'background-color':'rgb(255,255,255)'}}),true);
assert.equal(C.remeasure(ctx,{key:'transparent',property:'padding-left',visual:{design:{nodeIds:['da']},runtime:{nodeIds:['ra']}}}),null);
assert.equal(ctx.taskExclusions.get('transparent').property,'padding-left','inapplicable task is audited, not counted as same');
const report={checks:[{id:'uncovered',category:'coverage',coverageNodeId:'da',uncoveredSide:'设计',status:'uncovered',item:'模块 · 未纳入对比'},
 {id:'font',property:'font-size',status:'different',publication:{status:'validated'},visual:{design:{nodeIds:['da']}}}]};
a.updateCoverageLedger(report,ctx);assert.equal(report.technical.coverageLedger.partial,1);assert.equal(report.checks[0].status,'uncovered');assert.deepEqual(Array.from(report.checks[0].coverage.checkedIds),['font']);assert.match(report.checks[0].judgment,/已完成 1/);
assert.notEqual(a.semanticBaseRole({selector:'div.homepageRoot-X',_index:1},'runtime',0),'pagination');
assert.equal(a.semanticBaseRole({selector:'div.pager-X',_index:1},'runtime',0),'pagination');
const edges=(kind,id)=>({edges:{left:{confidence:'high',boundaryKinds:['layout'],kinds:[kind],ownerIds:[id],anchors:[]}}});
assert.equal(a.geometryEdgesComparable(edges('icon','i'),edges('image','j'),'left',false,new Map([['i','j']])),true);
assert.equal(a.geometryEdgesComparable(edges('icon','i'),edges('image','j'),'left',false,new Map()),false,'technical role bridging needs confirmed slot correspondence');
console.log('completion contracts: compound validation + real drift, scope clipping, visible surfaces, partial coverage, classifier and graphic slot bridge passed');
// A complete pair of fields can recover the transparent group, even with
// different copy. An extra unmapped field must prevent that recovery.
{
 const make=(p)=>a.prepareNodes([raw(p,null,box(0,0,400,200)),raw(p+'g',p,box(0,0,100,80)),raw(p+'a',p+'g',box(0,0,60,20),{},p+'title'),raw(p+'b',p+'g',box(0,25,60,20),{},p+'value')],box(0,0,400,200));
 const dd=make('D'),rr=make('R');dd.slice(2).forEach(n=>n.type='TEXT');
 const cx=C.makeContext(dd,rr),ds={nodes:dd.map(raw=>({id:raw.id,raw,role:raw.id==='Dg'?'content-group':'text'}))},rs={nodes:rr.map(raw=>({id:raw.id,raw,role:raw.id==='Rg'?'title-region':'text'}))};
 for(const [d,r] of [['D','R'],['Da','Ra'],['Db','Rb']]){cx.pairs.set(d,r);cx.reverse.set(r,d);}
 const matches=[{designNode:ds.nodes[0],runtimeNode:rs.nodes[0]}];
 C.deriveContentGroups(cx,ds,rs,matches);
 assert(matches.some(m=>m.designNode.id==='Dg'&&m.runtimeNode.id==='Rg'),'all independently paired fields establish the group');
 cx.pairs.delete('Db');const incomplete=[matches[0]];C.deriveContentGroups(cx,ds,rs,incomplete);
 assert.equal(incomplete.length,1,'missing member cannot be hidden as a matched whole');
}

// A wrapper sharing a runtime node must not consume its separately confirmed text field.
{
 const d=raw('T',null,box(0,0,80,20),{'font-size':'14px'},'title');d.type='TEXT';
 const r=raw('RT',null,box(0,0,80,20),{'font-size':'18px'},'title');
 const dd=a.prepareNodes([d],box(0,0,200,100)),rr=a.prepareNodes([r],box(0,0,200,100));
 const cx=C.makeContext(dd,rr);cx.pairs.set('T','RT');cx.reverse.set('RT','T');
 const sm=[{designNode:{raw:dd[0]},runtimeNode:{raw:rr[0]},unique:true}];
 const found=a.styleMeasurementMatches([{designIndex:9,runtimeIndex:0}],sm,cx);
 assert.equal(found.length,2);assert.equal(found[1].typographyOnly,true);
 assert(a.propertyEligibleForMatch('font-size',found[1],dd[0],rr[0]));
 assert(!a.propertyEligibleForMatch('background-color',found[1],dd[0],rr[0]));
 assert.equal(a.compareStyle('font-size',d.styles['font-size'],r.styles['font-size']).same,false);
}
// Once text identity is known, recover the real painted button, not its label.
{
 const make=(p)=>a.prepareNodes([raw(p,null,box(0,0,400,200)),raw(p+'b',p,box(10,10,100,40),{'background-color':'rgb(255,255,255)'}),raw(p+'t',p+'b',box(30,20,60,20),{},'action')],box(0,0,400,200));
 const dd=make('D'),rr=make('R');dd[2].type='TEXT';
 const cx=C.makeContext(dd,rr),ds={nodes:dd.map(raw=>({id:raw.id,raw,role:'button'}))},rs={nodes:rr.map(raw=>({id:raw.id,raw,role:'button'}))};
 for(const [d,r] of [['D','R'],['Dt','Rt']]){cx.pairs.set(d,r);cx.reverse.set(r,d);}
 const matches=[{designNode:ds.nodes[0],runtimeNode:rs.nodes[0]}];
 C.derivePaintOwners(cx,ds,rs,matches);
 assert(matches.some(m=>m.designNode.raw.id==='Db'&&m.runtimeNode.raw.id==='Rb'));
 cx.pairs.delete('Dt');const incomplete=[matches[0]];C.derivePaintOwners(cx,ds,rs,incomplete);assert.equal(incomplete.length,1);
}
