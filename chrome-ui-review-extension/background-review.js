/* Compare a scope's painted backdrop at corresponding, unobstructed locations. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BackgroundReview=api;})(globalThis,function(){
  'use strict';
  const VERSION='1.0.0',round=n=>Math.round(n*100)/100;
  const box=n=>n?._box||n?.box?.local||null;
  const valid=b=>b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0;
  const label=n=>String(n?.text?.direct||'').trim();
  const styles=n=>n?.styles||{};
  const text=n=>!!label(n)||n?.type==='TEXT';
  const active=v=>v!=null&&!['','none','normal'].includes(String(v).trim());
  function color(v){
    const s=String(v||'').trim().toLowerCase();if(s==='transparent')return [0,0,0,0];if(s==='white')return [255,255,255,1];if(s==='black')return [0,0,0,1];
    if(/^#[a-f\d]{3,8}$/i.test(s)){
      let h=s.slice(1);if(h.length===3||h.length===4)h=[...h].map(x=>x+x).join('');
      if(h.length!==6&&h.length!==8)return null;
      return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).concat(h.length===8?parseInt(h.slice(6),16)/255:1);
    }
    const m=s.match(/^rgba?\(([^)]+)\)$/);if(!m)return null;
    const parts=m[1].replace(/\//g,' ').split(/[\s,]+/).filter(Boolean);if(parts.length<3||parts.length>4)return null;
    const c=parts.slice(0,3).map(x=>parseFloat(x)*(x.endsWith('%')?2.55:1));
    const a=parts[3]==null?1:parseFloat(parts[3])/(parts[3].endsWith('%')?100:1);
    return [...c,a].every(Number.isFinite)?[...c,a]:null;
  }
  function composite(front,back){
    const a=front[3]+back[3]*(1-front[3]);
    return a>0?front.slice(0,3).map((c,i)=>(c*front[3]+back[i]*back[3]*(1-front[3]))/a).concat(a):[0,0,0,0];
  }
  const background=n=>styles(n)['background-color']??styles(n).background;
  const textClip=n=>n?.geometry?.textPaint?.clip==='text'||['background-clip','-webkit-background-clip'].some(k=>String(styles(n)[k]||'').split(',').some(v=>v.trim()==='text'));
  function ownPaint(n){
    const s=styles(n),c=color(background(n));
    return !textClip(n)&&((c&&c[3]>0)||(!c&&active(background(n)))||active(s['background-image'])||/(?:gradient|url)\(/.test(String(background(n)||'')))
      ||!!n?.asset||['img','svg','canvas','video','path','rect','circle','ellipse','polygon','polyline','line'].includes(n?.tag)
      ||['VECTOR','ELLIPSE','BOOLEAN_OPERATION','LINE','POLYGON','STAR'].includes(n?.type)
      ||['top','right','bottom','left'].some(edge=>parseFloat(s[`border-${edge}-width`])>0&&s[`border-${edge}-style`]!=='none')
      ||active(s['box-shadow']);
  }
  function hidden(n){const s=styles(n);return s.display==='none'||s.visibility==='hidden'||s['content-visibility']==='hidden'||Number(s.opacity??1)<=0;}
  function interactive(n){return ['button','input','select','textarea','a'].includes(n?.tag)||['button','link','control','dialog','navigation'].includes(n?.role)||!!n?.reviewId;}
  function intersection(a,b){const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),r=Math.min(a.x+a.width,b.x+b.width),d=Math.min(a.y+a.height,b.y+b.height);return r>x&&d>y?{x,y,width:r-x,height:d-y}:null;}
  const contains=(a,b)=>a.x<=b.x&&a.y<=b.y&&a.x+a.width>=b.x+b.width&&a.y+a.height>=b.y+b.height;
  const pointIn=(b,x,y,p=0)=>x>=b.x-p&&x<=b.x+b.width+p&&y>=b.y-p&&y<=b.y+b.height+p;
  function effectOutset(n){
    const s=styles(n),values=[s['box-shadow'],s['text-shadow'],s.filter].filter(active).join(' ');
    const lengths=[...values.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map(m=>Math.abs(Number(m[1])));
    return lengths.length?Math.max(...lengths)*3+2:0;
  }
  function describe(input){
    const nodes=input.nodes||[],byId=new Map(nodes.map(n=>[n.id,n]));
    const root=typeof input.root==='string'?byId.get(input.root):input.root,rb=box(root);
    if(!root||!valid(rb))return {error:'scope-box-missing'};
    const children=new Map(nodes.map(n=>[n.id,[]]));for(const n of nodes)children.get(n.parentId)?.push(n);
    const inside=new Set(),walk=n=>{if(inside.has(n.id)||hidden(n))return;inside.add(n.id);for(const c of children.get(n.id)||[])walk(c);};walk(root);
    const contentMemo=new Map();
    function hasContent(n){if(contentMemo.has(n.id))return contentMemo.get(n.id);const yes=text(n)||interactive(n)||(children.get(n.id)||[]).some(c=>inside.has(c.id)&&hasContent(c));contentMemo.set(n.id,yes);return yes;}
    function hasPaint(n){return ownPaint(n)||(children.get(n.id)||[]).some(c=>inside.has(c.id)&&hasPaint(c));}
    const candidates=[];
    for(const n of nodes){
      if(!inside.has(n.id)||n===root||hasContent(n)||!hasPaint(n))continue;
      const b=box(n),overlap=valid(b)&&intersection(b,rb);if(!overlap)continue;
      // A backdrop spans the scope and starts near its top. Content cards and
      // product images never qualify just because they happen to be painted.
      if(overlap.width<rb.width*.92||overlap.height<rb.height*.35||b.y>rb.y+Math.max(4,rb.height*.025))continue;
      if(n.tag==='img'&&!['absolute','fixed'].includes(styles(n).position))continue;
      candidates.push(n);
    }
    const candidateIds=new Set(candidates.map(n=>n.id));
    const underCandidate=n=>{const seen=new Set();for(let p=byId.get(n.parentId);p&&!seen.has(p.id);p=byId.get(p.parentId)){if(candidateIds.has(p.id))return true;seen.add(p.id);}return false;};
    const layers=candidates.filter(n=>!underCandidate(n)),layerTree=new Set();
    function mark(n){layerTree.add(n.id);for(const c of children.get(n.id)||[])mark(c);}layers.forEach(mark);
    const masks=[];
    for(const n of nodes){
      if(n===root||!inside.has(n.id)||layerTree.has(n.id))continue;
      const pseudo=n.geometry?.pseudoElements||[];
      const maskBox=(b,outset=effectOutset(n))=>{const expanded=valid(b)&&{x:b.x-outset,y:b.y-outset,width:b.width+outset*2,height:b.height+outset*2};const clip=expanded&&intersection(expanded,rb);if(clip)masks.push({nodeId:n.id,box:{x:clip.x-rb.x,y:clip.y-rb.y,width:clip.width,height:clip.height}});};
      if(text(n)||ownPaint(n))maskBox(box(n));
      for(const p of pseudo){if(p.status==='bounded')maskBox(p.box);else if(p.status!=='unpainted')maskBox(box(n));}
      if(n.geometry?.hasPseudoContent&&!pseudo.length)maskBox(box(n));
    }
    // Contained descendants need no extra mask once a card's entire surface is excluded.
    masks.sort((a,b)=>b.box.width*b.box.height-a.box.width*a.box.height);
    const compact=[];for(const m of masks)if(!compact.some(p=>contains(p.box,m.box)))compact.push(m);
    return {root,box:rb,layerIds:layers.map(n=>n.id),layers:layers.map(n=>({nodeId:n.id,box:box(n),background:background(n)||null,image:styles(n)['background-image']||null,opacity:Number(styles(n).opacity??1),source:n.asset?'asset':'css-or-graphic-subtree'})),foregroundIds:[...new Set(compact.map(m=>m.nodeId))],masks:compact,byId};
  }
  function pureColor(input,description){
    if(description.error||description.layerIds.length)return null;
    // Ancestors must be supplied by the collector; absence is not a white canvas.
    const chain=[description.root,...(input.ancestorBackgrounds||[])];let out=[0,0,0,0];
    for(const n of chain){
      const s=styles(n);if(Number(s.opacity??1)<.999||active(s['background-image'])||active(s.filter)||active(s['mix-blend-mode'])||textClip(n))return null;
      const c=color(background(n));if(background(n)!=null&&!c)return null;
      if(c)out=composite(out,c);if(out[3]>=.999)return out;
    }
    return null;
  }
  function imageReady(i){return i&&i.width>0&&i.height>0&&i.data&&i.data.length>=i.width*i.height*4;}
  function sample(input,description,x,y){
    const im=input.image,cw=input.cssWidth||im.width,ch=input.cssHeight||im.height,origin=input.imageOrigin||{x:0,y:0};
    const px=Math.floor((description.box.x+x-origin.x)*im.width/cw),py=Math.floor((description.box.y+y-origin.y)*im.height/ch);
    if(px<1||py<1||px>=im.width-1||py>=im.height-1)return null;
    const channels=[[],[],[]];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const i=((py+dy)*im.width+px+dx)*4;if(im.data[i+3]<254)return null;
      for(let k=0;k<3;k++)channels[k].push(im.data[i+k]);
    }
    return channels.map(c=>c.sort((a,b)=>a-b)[4]).concat(1);
  }
  const delta=(a,b)=>Math.max(...a.slice(0,3).map((v,i)=>Math.abs(v-b[i])));
  function publicEvidence(d){return {rootId:d.root?.id,box:d.box,layerIds:d.layerIds||[],layers:d.layers||[],foregroundIds:d.foregroundIds||[],maskedRegions:d.masks?.length||0};}
  function review(options){
    const a=options.design,b=options.runtime,da=describe(a),db=describe(b);
    const base={version:VERSION,metric:'visible-background',design:publicEvidence(da),runtime:publicEvidence(db)};
    const reasons={'scope-box-missing':'背景所属区域的外框尚未取得','background-pixels-or-opaque-base-missing':'缺少可用背景截图或明确的不透明底色','background-scope-too-small':'可比较的背景范围过小','background-scope-width-mismatch':'两侧背景区域宽度不同，尚未建立对应采样坐标','no-common-unobstructed-background':'两侧共同范围内没有无遮挡的背景位置','insufficient-common-background-samples':'两侧共同背景的有效采样点不足','background-samples-too-local':'背景采样集中在很小的局部，尚不足以比较该区域','no-common-captured-region':'两侧截图没有对应且有效的采集区域'};
    const unresolved=code=>({...base,status:'unresolved',reasonCode:code.startsWith('background-')?code:'background-'+code,reason:reasons[code]||'可见背景尚未完成测量',samples:[]});
    if(da.error||db.error)return unresolved(da.error||db.error);
    const tolerance=options.colorTolerance??3,ac=pureColor(a,da),bc=pureColor(b,db);
    if(!imageReady(a.image)||!imageReady(b.image)){
      if(!ac||!bc)return unresolved('background-pixels-or-opaque-base-missing');
      const difference=delta(ac,bc);return {...base,status:difference<=tolerance?'same':'different',reasonCode:'background-composited-solid',reason:'已按明确的底色与透明度合成背景颜色',mode:'solid-color',samples:[],designColor:ac,runtimeColor:bc,maxDelta:round(difference),colorTolerance:tolerance};
    }
    const available=(input,d)=>{
      const allowed=input.validRegion?intersection(d.box,input.validRegion):d.box;
      return allowed?{x:allowed.x-d.box.x,y:allowed.y-d.box.y,width:allowed.width,height:allowed.height}:null;
    };
    const av=available(a,da),bv=available(b,db),region=av&&bv&&intersection(av,bv);
    if(!region)return unresolved('no-common-captured-region');
    const {width,height}=region;
    if(width<12||height<12)return unresolved('background-scope-too-small');
    if(Math.abs(da.box.width-db.box.width)>Math.max(2,width*.02))return unresolved('background-scope-width-mismatch');
    const masks=[...da.masks,...db.masks],pixelCss=i=>Math.max((i.cssWidth||i.image.width)/i.image.width,(i.cssHeight||i.image.height)/i.image.height);
    const pad=Math.max(options.maskPadding??3,2*pixelCss(a),2*pixelCss(b));
    const clear=(x,y)=>!masks.some(m=>pointIn(m.box,x,y,pad));
    const coordinates=(length,axis)=>{
      const start=region[axis],end=start+length,arr=[];for(let n=start+12;n<end-4;n+=24)arr.push(n);
      for(const m of masks){const lo=m.box[axis],hi=lo+m.box[axis==='x'?'width':'height'];for(const v of [lo-pad-3,hi+pad+3])if(v>start+4&&v<end-4)arr.push(v);}
      return [...new Set(arr.map(round))].sort((a,b)=>a-b);
    };
    const xs=coordinates(width,'x'),ys=coordinates(height,'y'),points=[];
    for(const y of ys)for(const x of xs)if(clear(x,y))points.push({x,y});
    if(!points.length)return unresolved('no-common-unobstructed-background');
    const maxSamples=options.maxSamples??768,stride=Math.max(1,Math.ceil(points.length/maxSamples)),samples=[];
    for(let i=0;i<points.length;i+=stride){
      const {x,y}=points[i],left=sample(a,da,x,y),right=sample(b,db,x,y);if(!left||!right)continue;
      samples.push({x,y,designColor:left,runtimeColor:right,delta:round(delta(left,right))});
    }
    const minSamples=options.minSamples??12;
    if(samples.length<minSamples)return {...unresolved('insufficient-common-background-samples'),samples,comparedRegion:region};
    const changed=samples.filter(s=>s.delta>tolerance),maxDelta=Math.max(...samples.map(s=>s.delta));
    const bands=[...new Set(samples.map(s=>Math.min(3,Math.floor((s.y-region.y)/height*4))))];
    // A handful of points in one tiny opening cannot certify an entire page.
    const sampleBounds={x:Math.min(...samples.map(s=>s.x)),y:Math.min(...samples.map(s=>s.y)),right:Math.max(...samples.map(s=>s.x)),bottom:Math.max(...samples.map(s=>s.y))};
    const sufficientExtent=sampleBounds.right-sampleBounds.x>=width*.35&&sampleBounds.bottom-sampleBounds.y>=height*.35&&bands.length>=2;
    if(!sufficientExtent)return {...unresolved('background-samples-too-local'),samples,comparedRegion:region};
    return {...base,status:changed.length?'different':'same',reasonCode:'background-corresponding-samples',reason:'已比较共同采集范围内无遮挡位置的背景外观',mode:'sampled-paint',comparedRegion:region,samples,
      coverage:{scope:'common-visible-background',samples:samples.length,changed:changed.length,unobstructedCandidates:points.length,verticalBands:bands,sampleBounds,excludedForeground:true,excludedUncapturedArea:true},
      maxDelta:round(maxDelta),colorTolerance:tolerance};
  }
  return {VERSION,review,describe,color,composite};
});
