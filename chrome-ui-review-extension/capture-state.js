/* Compare capture state without treating document and viewport coordinates as interchangeable. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CaptureState=api;})(globalThis,function(){
  'use strict';
  const VERSION='1.0.0';
  const changed=(a,b,tolerance=1)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)>tolerance;
  const key=n=>n.nodeId||n.id||n.selector;
  function compare(measurement,capture){
    if(!measurement||!capture)return {version:VERSION,status:'unavailable',reason:'旧采集未记录视口与内部滚动状态',differences:[]};
    const differences=[];
    if(measurement.contentEntries&&capture.contentEntries){
      const before=new Map(measurement.contentEntries.map(n=>[n.nodeId,n.signature]));
      const after=new Map(capture.contentEntries.map(n=>[n.nodeId,n.signature]));
      for(const id of new Set([...before.keys(),...after.keys()]))if(before.get(id)!==after.get(id))
        differences.push({kind:'content-changed',nodeId:id});
    }
    for(const k of ['width','height','devicePixelRatio'])if(changed(measurement.viewport?.[k],capture.viewport?.[k],k==='devicePixelRatio' ? .001 : 1))
      differences.push({kind:'viewport',field:k,measured:measurement.viewport[k],captured:capture.viewport[k]});
    for(const k of ['width','height'])if(changed(measurement.rootViewport?.[k],capture.rootViewport?.[k]))
      differences.push({kind:'selection-size',field:k,measured:measurement.rootViewport[k],captured:capture.rootViewport[k]});
    const current=new Map((capture.scrollContainers||[]).map(n=>[key(n),n]));
    for(const before of measurement.scrollContainers||[]){
      // Ancestor scrolling is the intentional means of bringing a selected
      // module into view. Internal scrollports must keep their measured state.
      if(before.relation==='ancestor')continue;
      const after=current.get(key(before));
      if(!after){differences.push({kind:'missing-scroll-container',nodeId:before.nodeId});continue;}
      for(const k of ['scrollTop','scrollLeft','clientWidth','clientHeight'])if(changed(before[k],after[k]))
        differences.push({kind:'internal-scroll',nodeId:before.nodeId,field:k,measured:before[k],captured:after[k]});
    }
    const positioned=new Map((capture.positionedElements||[]).map(n=>[key(n),n]));
    for(const before of measurement.positionedElements||[]){
      const after=positioned.get(key(before));
      if(!after){differences.push({kind:'missing-positioned-element',nodeId:before.nodeId,selector:before.selector});continue;}
      if(after.captureSuppressed)continue;
      // Scrolling an ancestor to reveal the selection changes its local x/y.
      // A change in its dimensions still means the measured layout is stale.
      const fields=before.relation==='ancestor'?['width','height']:['x','y','width','height'];
      for(const k of fields)if(changed(before.box?.[k],after.box?.[k]))
        differences.push({kind:'positioned-geometry',nodeId:before.nodeId,field:k,measured:before.box[k],captured:after.box[k]});
    }
    return {version:VERSION,status:differences.length?'mismatch':'matched',differences,
      windowMoved:['scrollX','scrollY'].some(k=>changed(measurement.window?.[k],capture.window?.[k]))};
  }
  function observe(states){
    const present=(states||[]).filter(Boolean),first=present[0];if(!first)return [];
    const out=[];
    for(const node of first.positionedElements||[]){
      const observations=present.map(s=>({state:s,node:(s.positionedElements||[]).find(n=>key(n)===key(node))})).filter(p=>p.node);
      const scrolled=observations.some(p=>['scrollX','scrollY'].some(k=>changed(first.window?.[k],p.state.window?.[k])));
      const stable=observations.every(p=>['x','y'].every(k=>!changed(node.viewportBox?.[k],p.node.viewportBox?.[k])));
      out.push({nodeId:node.nodeId,selector:node.selector,position:node.position,
        observation:!scrolled?'single-scroll-state':stable?'viewport-position-stable':'viewport-position-changed',
        samples:observations.map(p=>({window:p.state.window,viewportBox:p.node.viewportBox,box:p.node.box,suppressed:p.node.captureSuppressed}))});
    }
    return out;
  }
  return {VERSION,compare,observe};
});
