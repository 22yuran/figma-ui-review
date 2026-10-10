/* One pixel measurement policy for Figma previews and browser captures.
 * DOM ranges / Figma frames locate text; neither is accepted as an ink box.
 * No network calls and no font reconstruction. Coordinates remain in CSS px.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TextInk=api;})(globalThis,function(){
  'use strict';
  const POLICY='visible-text-ink-v1';
  const union=boxes=>{if(!boxes.length)return null;const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};};
  const valid=b=>b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0;
  const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
  function color(value){
    if(Array.isArray(value))return value.length>=3&&value.every(Number.isFinite)?[...value.slice(0,3),value[3]??1]:null;
    if(value&&typeof value==='object'&&['r','g','b'].every(k=>Number.isFinite(value[k])))return [value.r*255,value.g*255,value.b*255,value.a??1];
    const s=String(value||'').trim().toLowerCase(),named={black:[0,0,0,1],white:[255,255,255,1],transparent:[0,0,0,0]};
    if(named[s])return named[s];
    if(/^#[\da-f]{3,4}$/i.test(s))return color('#'+s.slice(1).split('').map(c=>c+c).join(''));
    if(/^#[\da-f]{6}([\da-f]{2})?$/i.test(s))return [...[1,3,5].map(i=>parseInt(s.slice(i,i+2),16)),s.length===9?parseInt(s.slice(7,9),16)/255:1];
    const m=s.match(/^rgba?\(([^)]+)\)$/);if(!m)return null;
    const parts=m[1].trim().split(/\s*[,/]\s*|\s+/),v=parts.map((p,i)=>parseFloat(p)*(p.endsWith('%')?(i<3?2.55:.01):1));
    return v.length>=3&&v.every(Number.isFinite)?[...v.slice(0,3),clamp(v[3]??1)]:null;
  }
  const splitGradient=s=>{const parts=[];let depth=0,start=0;for(let i=0;i<s.length;i++){if(s[i]==='(')depth++;if(s[i]===')')depth--;if(s[i]===','&&!depth){parts.push(s.slice(start,i).trim());start=i+1;}}parts.push(s.slice(start).trim());return parts;};
  function cssGradient(value){
    const m=String(value||'').trim().match(/^linear-gradient\((.*)\)$/i);if(!m)return null;
    const parts=splitGradient(m[1]);let angleDeg=180;
    const angle=parts[0]?.match(/^(-?[\d.]+)(deg|turn|rad|grad)$/i);
    if(angle){angleDeg=Number(angle[1])*({deg:1,turn:360,rad:180/Math.PI,grad:.9}[angle[2].toLowerCase()]);parts.shift();}
    else if(/^to\s/.test(parts[0]||'')){
      const direction=parts.shift().slice(3).trim();
      const directions={top:0,right:90,bottom:180,left:270};
      if(!(direction in directions))return null; // Corner directions need the painting box's aspect ratio.
      angleDeg=directions[direction];
    }
    const stops=[];
    for(const part of parts){const stop=part.match(/^(rgba?\([^)]*\)|#[\da-f]{3,8}|black|white|transparent)(?:\s+(-?[\d.]+)%?)?$/i);if(!stop)return null;
      if(stop[2]!==undefined&&!part.endsWith('%')&&Number(stop[2])!==0)return null;
      const c=color(stop[1]);if(!c)return null;stops.push({color:c,offset:stop[2]===undefined?null:Number(stop[2])/100});}
    if(stops.length<2)return null;
    stops[0].offset??=0;stops.at(-1).offset??=1;
    let last=0;for(let i=1;i<stops.length;i++)if(stops[i].offset!==null){stops[i].offset=Math.max(stops[last].offset,stops[i].offset);for(let j=last+1;j<i;j++)stops[j].offset=stops[last].offset+(stops[i].offset-stops[last].offset)*(j-last)/(i-last);last=i;}
    return {kind:'linear-gradient',angleDeg,stops};
  }
  const paintsTextOnly=node=>['linear-gradient','css-gradient'].includes(node.geometry?.textPaint?.kind)||[node.styles?.['background-clip'],node.styles?.['-webkit-background-clip']].some(s=>String(s||'').split(',').some(v=>v.trim()==='text'));
  function textPaint(node){
    const recorded=node.geometry?.textPaint,styles=node.styles||{},box=recorded?.box||node._box||node.box?.local;
    const foreground=color(recorded?.foregroundColor||styles['-webkit-text-fill-color']||styles.color);
    // An opaque CSS fill covers a clipped background. Partial fills need paint
    // compositing evidence; treating the gradient alone would invent its pixels.
    const clippedCss=recorded?.kind==='css-gradient'||(!recorded&&paintsTextOnly(node));
    if(clippedCss&&foreground?.[3]>0)return foreground[3]===1?{kind:'solid',sample:()=>foreground}:null;
    if(recorded?.status==='unresolved')return null;
    const gradient=recorded?.kind==='linear-gradient'?recorded:paintsTextOnly(node)?cssGradient(recorded?.css||styles['background-image']||styles.background):null;
    if(gradient){
      if(!valid(box))return null;
      const stops=(gradient.stops||[]).map(s=>({offset:Number(s.offset),color:color(s.color)}));
      if(stops.length<2||stops.some(s=>!Number.isFinite(s.offset)||!s.color)||!stops.some(s=>s.color[3]>0))return null;
      stops.sort((a,b)=>a.offset-b.offset);
      let from=gradient.from,to=gradient.to;
      if(!from||!to){const angle=(gradient.angleDeg??180)*Math.PI/180,dx=Math.sin(angle),dy=-Math.cos(angle),length=Math.abs(box.width*dx)+Math.abs(box.height*dy);
        from={x:.5-dx*length/(2*box.width),y:.5-dy*length/(2*box.height)};to={x:1-from.x,y:1-from.y};}
      if(![from.x,from.y,to.x,to.y].every(Number.isFinite))return null;
      const dx=(to.x-from.x)*box.width,dy=(to.y-from.y)*box.height,den=dx*dx+dy*dy;
      if(den<1e-8)return null;
      const transform=gradient.gradientTransform,gradientRow=Array.isArray(transform?.[0])&&transform[0].length===3&&transform[0].every(Number.isFinite)?transform[0]:null;
      const opacity=clamp(Number(gradient.opacity??1));
      return {kind:'linear-gradient',sample(x,y){
        const t=gradientRow?gradientRow[0]*(x-box.x)/box.width+gradientRow[1]*(y-box.y)/box.height+gradientRow[2]:((x-box.x-from.x*box.width)*dx+(y-box.y-from.y*box.height)*dy)/den;
        let lo=stops[0],hi=stops.at(-1);for(let i=1;i<stops.length;i++)if(t<stops[i].offset){lo=stops[i-1];hi=stops[i];break;}
        const f=hi.offset===lo.offset?1:clamp((t-lo.offset)/(hi.offset-lo.offset)),alpha=lo.color[3]+(hi.color[3]-lo.color[3])*f;
        return [...[0,1,2].map(i=>alpha>0?(lo.color[i]*lo.color[3]*(1-f)+hi.color[i]*hi.color[3]*f)/alpha:0),alpha*opacity];
      }};
    }
    // Transparent text is never black ink. A background image alone is not proof
    // that it is clipped to glyphs; unsupported paints remain unmeasured.
    return foreground&&foreground[3]>0?{kind:'solid',sample:()=>foreground}:null;
  }
  function regions(node,side){
    const box=node._box||node.box?.local;
    // Range rectangles locate individual direct text runs, excluding child icons,
    // buttons and sibling labels. A missing Range is NOT an element-box fallback.
    return (side==='design'?[box]:(node.geometry?.textBoxes||[])).filter(valid);
  }
  function clippedRegions(node,rois){
    let regions=rois;
    for(const ancestor of node._ancestors||[]){
      const styles=ancestor.styles||{},clip=ancestor._box||ancestor.box?.local;
      if(!valid(clip))continue;
      const x=/^(hidden|clip|scroll|auto)$/.test(styles['overflow-x']||styles.overflow||'');
      const y=/^(hidden|clip|scroll|auto)$/.test(styles['overflow-y']||styles.overflow||'');
      if(!x&&!y)continue;
      regions=regions.map(b=>{
        const left=x?Math.max(b.x,clip.x):b.x,top=y?Math.max(b.y,clip.y):b.y;
        const right=x?Math.min(b.x+b.width,clip.x+clip.width):b.x+b.width;
        const bottom=y?Math.min(b.y+b.height,clip.y+clip.height):b.y+b.height;
        return {x:left,y:top,width:right-left,height:bottom-top};
      }).filter(valid);
      if(!regions.length)break;
    }
    return regions;
  }
  function extract(pixels,region,foreground,scaleX=1,scaleY=scaleX,fontSize=14){
    if(!valid(region)||!foreground)return {status:'unresolved',reason:'missing-text-region-or-color'};
    const paint=foreground.sample?foreground:{kind:'solid',sample:()=>color(foreground)};
    const sample=(x,y)=>paint.sample((x+.5)/scaleX,(y+.5)/scaleY);
    const distance=(a,b)=>a.slice(0,3).reduce((sum,c,i)=>sum+(c-b[i])**2,0);
    const composite=(fg,bg)=>fg.slice(0,3).map((c,i)=>c*(fg[3]??1)+bg[i]*(1-(fg[3]??1)));
    const {width,height,data}=pixels;
    const x0=Math.max(0,Math.floor(region.x*scaleX)),y0=Math.max(0,Math.floor(region.y*scaleY));
    const x1=Math.min(width,Math.ceil((region.x+region.width)*scaleX)),y1=Math.min(height,Math.ceil((region.y+region.height)*scaleY));
    if(x1<=x0||y1<=y0)return {status:'unresolved',reason:'text-outside-capture'};
    // Modal local background, quantized only for grouping; preserve its actual RGB.
    const histogram=new Map();let total=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const i=(y*width+x)*4;if(data[i+3]<240)continue;
      const key=(data[i]>>3)*1024+(data[i+1]>>3)*32+(data[i+2]>>3);
      let h=histogram.get(key);if(!h){h={count:0,r:0,g:0,b:0,x:0,y:0};histogram.set(key,h);}h.count++;h.r+=data[i];h.g+=data[i+1];h.b+=data[i+2];h.x+=x;h.y+=y;total++;
    }
    const candidates=[...histogram.values()].filter(h=>{const c=[h.r/h.count,h.g/h.count,h.b/h.count],fg=sample(h.x/h.count,h.y/h.count);return fg&&distance(c,composite(fg,c))>900;});
    const mode=candidates.sort((a,b)=>b.count-a.count)[0];
    if(!mode)return {status:'unresolved',reason:'insufficient-text-contrast'};
    const bg=[mode.r/mode.count,mode.g/mode.count,mode.b/mode.count];
    const rows=[];let count=0;
    for(let y=y0;y<y1;y++){
      let left=Infinity,right=-Infinity;
      const samples=[x0,Math.min(x0+1,x1-1),Math.max(x0,x1-2),x1-1].map(x=>{const i=(y*width+x)*4,c=[data[i],data[i+1],data[i+2]],fg=sample(x,y);return {color:c,distance:fg?distance(c,composite(fg,c)):0};});
      const rowBg=samples.sort((a,b)=>b.distance-a.distance)[0];
      const localBg=distance(rowBg.color,bg)<6400&&rowBg.distance>900?rowBg.color:bg;
      for(let x=x0;x<x1;x++){
        const i=(y*width+x)*4;if(data[i+3]<240)continue;
        const fg=sample(x,y);if(!fg||(fg[3]??1)<=0)continue;
        const localV=composite(fg,localBg).map((c,i)=>c-localBg[i]),localVV=localV.reduce((sum,c)=>sum+c*c,0);if(localVV<144)continue;
        const delta=[data[i]-localBg[0],data[i+1]-localBg[1],data[i+2]-localBg[2]];
        const alpha=delta.reduce((s,c,j)=>s+c*localV[j],0)/localVV;
        const error=Math.sqrt(delta.reduce((s,c,j)=>s+(c-alpha*localV[j])**2,0));
        // Same antialias coverage threshold on BOTH sides. Exclude backgrounds
        // and unrelated hues; accept actual screenshot pixels, never font metrics.
        if(alpha>=.28&&alpha<=1.25&&error<=22){left=Math.min(left,x);right=Math.max(right,x+1);count++;}
      }
      if(Number.isFinite(left))rows.push({x:left,y,width:right-left,height:1});
    }
    if(!rows.length||count<2)return {status:'unresolved',reason:'no-isolated-text-ink'};
    const groups=[];const maxBlank=Math.max(1,Math.floor(fontSize*scaleY*.16));
    for(const row of rows){let group=groups.at(-1);if(!group||row.y-group.at(-1).y>maxBlank+1){group=[];groups.push(group);}group.push(row);}
    const css=b=>({x:b.x/scaleX,y:b.y/scaleY,width:b.width/scaleX,height:b.height/scaleY});
    // A detached one-pixel underline or clipped frame border is not another text
    // line. Keep punctuation-only regions, but remove such decorations beside glyphs.
    const bands=groups.map(g=>union(g));
    const substantive=bands.filter(b=>b.height>=fontSize*scaleY*.38);
    const selected=substantive.length?bands.filter(b=>b.height>=fontSize*scaleY*.25):bands;
    const lines=selected.map(css);
    return {status:'measured',box:css(union(selected)),lines,pixels:count,uncertaintyPx:Math.max(1/scaleX,1/scaleY)};
  }
  function measure(node,side,pixels,source){
    const original=regions(node,side),rois=clippedRegions(node,original),fg=textPaint(node);
    const unresolved=reason=>({policy:POLICY,status:'unresolved',reason});
    if(!pixels||!source?.width||!source?.height)return unresolved('missing-text-screenshot');
    if(!rois.length)return unresolved(original.length?'text-clipped-by-ancestor':'missing-direct-text-regions');
    if(rois.some(b=>(source.excludedRegions||[]).some(r=>b.x<r.x+r.width&&b.x+b.width>r.x&&b.y<r.y+r.height&&b.y+b.height>r.y)))return unresolved('capture-occluded-by-repeated-overlay');
    // Refuse a clipped capture instead of silently measuring the visible subset.
    if(rois.some(b=>b.x<-.5||b.y<-.5||b.x+b.width>source.width+.5||b.y+b.height>source.height+.5))return unresolved('text-outside-capture');
    const sx=pixels.width/source.width,sy=pixels.height/source.height;
    const results=rois.map(r=>extract(pixels,r,fg,sx,sy,parseFloat(node.styles?.['font-size'])||14));
    // Range may report a wrapped fragment that clipping/ellipsis does not paint.
    // Keep measured visible fragments only when the remaining regions can be
    // proved blank in the screenshot; a wholly blank text node still abstains.
    const blank=region=>{
      if(!fg)return false;
      const x0=Math.max(0,Math.floor(region.x*sx)),y0=Math.max(0,Math.floor(region.y*sy));
      const x1=Math.min(pixels.width,Math.ceil((region.x+region.width)*sx)),y1=Math.min(pixels.height,Math.ceil((region.y+region.height)*sy));
      if(x1<=x0||y1<=y0)return false;
      let near=0;
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
        const i=(y*pixels.width+x)*4;
        if(pixels.data[i+3]<240)continue;
        const c=fg.sample((x+.5)/sx,(y+.5)/sy);
        if(c&&c[3]>0&&[0,1,2].reduce((sum,k)=>sum+(pixels.data[i+k]-c[k])**2,0)<35**2&&++near>=2)return false;
      }
      return true;
    };
    const measured=results.filter(r=>r.status==='measured');
    const omitted=results.flatMap((result,i)=>result.status==='measured'?[]:[{result,region:rois[i]}]);
    if(!measured.length||omitted.some(({result,region})=>result.reason!=='no-isolated-text-ink'||!blank(region)))
      return unresolved(omitted[0]?.result.reason||'no-isolated-text-ink');
    const boxes=measured.map(r=>r.box),lines=measured.flatMap(r=>r.lines).sort((a,b)=>a.y-b.y||a.x-b.x);
    // Direct runs on the same line (e.g. a link between two text nodes) share a line.
    const merged=[];
    for(const b of lines){const prior=merged.find(a=>Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>Math.min(a.height,b.height)*.5);if(prior)Object.assign(prior,union([prior,b]));else merged.push({...b});}
    return {policy:POLICY,status:'measured',source:'screenshot-ink',box:union(boxes),boxes,lines:merged,
      uncertaintyPx:Math.max(...measured.map(r=>r.uncertaintyPx)),validation:{verified:true,boundary:'visible-glyph',includesLineHeight:false,
        ...(omitted.length?{blankUnpaintedFragments:omitted.length}:{})},
      capture:{width:source.width,height:source.height,pixelWidth:pixels.width,pixelHeight:pixels.height}};
  }
  function legacyCaptureSource(source,nodes,diagnostics) {
    if(!source||source.stitchPolicy==='preserve-first-tile-v1')return source;
    const tiles=(diagnostics?.events||[]).filter(e=>e.type==='CAPTURE_SCROLL'&&e.ok);
    if(tiles.length<2)return source;
    const fixed=nodes.filter(n=>['fixed','sticky'].includes(n.styles?.position)&&String(n.text?.descendant||n.text?.direct||'').trim());
    const excludedRegions=[];
    for(const tile of tiles.slice(1)) {
      const root=tile.geometry?.root;if(!root)continue;
      for(const n of fixed){const b=n._box||n.box?.local;if(!valid(b))continue;
        excludedRegions.push({...b,x:b.x-root.x,y:b.y-root.y});}
    }
    return {...source,excludedRegions};
  }
  async function readImage(source){
    if(!source?.dataUrl)return null;
    const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('文字测量截图无法读取'));i.src=source.dataUrl;});
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    return ctx.getImageData(0,0,canvas.width,canvas.height);
  }
  async function collect(nodes,side,source){
    let pixels,error;try{pixels=await readImage(source);}catch(e){error=e.message;}
    const stats={policy:POLICY,requested:0,measured:0,unresolved:0,reasons:{}};
    for(const n of nodes){
      if(side==='design'?n.type!=='TEXT':!String(n.text?.direct||'').trim())continue;
      const result=measure(n,side,pixels,source);if(error)result.reason=error;
      n.geometry={...n.geometry,textInk:result};
      if(side==='runtime'&&n.geometry.numericSegments?.length) n.geometry.numericSegments=n.geometry.numericSegments.map(segment=>{
        const ink={};
        for(const field of ['box','leftBox','rightBox']){
          const m=measure({...n,geometry:{textBoxes:valid(segment[field])?[segment[field]]:[]}},side,pixels,source);
          ink[field]=m.status==='measured'?m.box:null;
        }
        ink.policy=POLICY;ink.status=['box','leftBox','rightBox'].every(k=>ink[k])?'measured':'unresolved';
        return {...segment,textInk:ink};
      });
      stats.requested++;stats[result.status]++;
      if(result.reason)stats.reasons[result.reason]=(stats.reasons[result.reason]||0)+1;
      if(stats.requested%60===0)await new Promise(resolve=>setTimeout(resolve,0));
    }return stats;
  }
  return {POLICY,union,regions,clippedRegions,extract,measure,collect,legacyCaptureSource,color,cssGradient,textPaint,paintsTextOnly};
});
