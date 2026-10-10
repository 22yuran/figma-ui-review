/* AI identity precedes measurement; difference review can then request remeasurement. */
function inspectionReviewSection(review){
  if(!review)return '';
  const label=review.status==='failed'?'中断':review.finished?(review.status==='complete'?'已结束':'部分完成'):'进行中';
  return `<section class="layout-review-summary"><p>对象与测量校验${label}；已验证 ${Number(review.verified)||0} 项检查${review.pending?`，${Number(review.pending)} 项未完成`:''}。</p><details class="inspection-review-diagnostics"><summary>查看对象复核记录</summary><p>请求尝试 ${Number(review.calls)||0} 次；已处理 ${Number(review.processed)||0}/${Number(review.packets)||0} 个局部范围；失败 ${Number(review.failed)||0} 个。</p>${(review.results||[]).map(r=>`<p>${esc(r.packetId)}：${esc(r.error||`${r.application?.records?.filter(x=>x.validation?.status==='validated').length||0} 项通过测量校验`)}</p>`).join('')}</details></section>`;
}
function inspectionPacketContent(packet,feedback){
  const evidence=InspectionReview.requestEvidence(packet);
  const content=[{type:'text',text:JSON.stringify({evidence,feedback})}];
  for(const side of ['design','runtime'])if(packet.sides[side].image?.dataUrl)content.push({type:'text',text:`${side} 组件截图`},{type:'image_url',image_url:{url:packet.sides[side].image.dataUrl}});
  return content;
}
function inspectionModelClient(cfg){
  return cfg.provider==='jev'?JevClient:KimiClient;
}
function inspectionModelConfig(){
  return {provider:aiConfig.provider,configured:aiConfig.configured,connectionError:aiConfig.connectionError,apiKey:aiConfig.apiKey,model:aiConfig.model,session:aiConfig.requestSession};
}
async function requestInspectionModel(packet,cfg,{phase='repair',feedback,totalMs,onProgress}={}){
  if(cfg.provider==='jev'){
    const evidence=InspectionReview.requestEvidence(packet);
    if(feedback)evidence.validationFeedback=feedback;
    const plan=phase==='identity'?JevReview.identityRequest(evidence):JevReview.repairRequest(evidence);
    const identityTasks=phase==='identity'?[...Object.entries(plan.bindings||{}).map(([questionId,binding])=>({questionId,designId:binding.designId,
      addedAncestor:Boolean(binding.addedAncestor),anchorDesignId:binding.anchorDesignId||binding.designId})),...(plan.fixed||[]).map(task=>({designId:task.designId,
      addedAncestor:Boolean(task.addedAncestor),anchorDesignId:task.anchorDesignId||task.designId}))].filter(task=>task.designId):undefined;
    let result;
    try{
      if(!Object.keys(plan.questions).length)return {value:JevReview.decode(plan,{answers:{}}),identityTasks,diagnostics:{provider:'jev',phase:'no-candidates',elapsedMs:0}};
      result=await JevClient.request({cfg,state:plan.state,questions:plan.questions,totalMs,onProgress});
      return {...result,value:JevReview.decode(plan,result.value),identityTasks};
    }catch(error){
      if(result)error.diagnostics=result.diagnostics;
      if(identityTasks)error.identityTasks=identityTasks;
      throw error;
    }
  }
  return KimiClient.completeJSON({cfg,messages:[{role:'system',content:phase==='identity'?InspectionReview.identityPrompt:InspectionReview.prompt},{role:'user',content:inspectionPacketContent(packet,feedback)}],maxTokens:phase==='repair'?3200:4800,totalMs,onProgress});
}
function recordInspectionFailure(entry,error,cfg){
  const failure=inspectionModelClient(cfg).errorDetails(error,cfg.apiKey);
  entry.error=failure.message;entry.status='failed';
  entry.attempts.push({error:failure.message,diagnostics:failure.diagnostics||null,cause:failure.cause});
}
async function runInspectionIdentity(){
  const current=report,context=aiFallbackContext,ctx=context?.inspectionContext;
  if(!current||!ctx)return;
  const review=current.identityReview={status:'running',calls:0,results:[],processed:0,considered:0,failed:0,queueComplete:false,finished:false};
  const packets=InspectionReview.buildIdentityPackets(ctx);review.packets=packets.length;
  const cfg=inspectionModelConfig();review.provider=cfg.provider||'kimi';review.model=cfg.model;
  const limits=InspectionReview.routing.LIMITS,budget=cfg.session?.budget,identityStarted=Date.now();
  const callLimit=Math.min(limits.maxIdentityCalls,packets.length*limits.maxAttempts);
  // Bound the run by its actual queue, while preserving any stricter caller
  // budget and the transport's elapsed-time, byte and fingerprint guards.
  const reserve=(limits.maxIconCalls||0)+(limits.maxLayoutCalls||0)+2;
  if(budget){
    budget.identityBaseMaxCalls??=budget.maxCalls;
    budget.maxCalls=Math.min(budget.identityBaseMaxCalls,(budget.calls||0)+callLimit+reserve);
  }
  review.budget={maxCalls:callLimit,maxIdentityMs:limits.maxIdentityMs,sharedMaxCalls:budget?.maxCalls??null};
  const remaining=()=>Math.min(limits.maxIdentityMs-(Date.now()-identityStarted),budget?budget.maxAiMs-budget.usedAiMs:Infinity);
  const exhaustedBudget=()=>{
    if(review.calls>=callLimit||budget&&budget.calls>=budget.maxCalls)return {code:'call-budget',reason:'身份阶段调用额度已用完，尚未处理的范围保留待确认'};
    if(remaining()<1000)return {code:'time-budget',reason:'身份阶段实际剩余时间不足，尚未处理的范围保留待确认'};
    return null;
  };
  const budgetFailureCode=message=>{
    if(/相同证据/.test(message))return 'unchanged-evidence';
    if(/输入|内容|字节/.test(message))return 'input-budget';
    const exhausted=exhaustedBudget();if(exhausted)return exhausted.code;
    if(/时间|耗时|time/i.test(message)&&!/调用|calls?/i.test(message))return 'time-budget';
    if(/调用|calls?/i.test(message)&&!/时间|耗时|time/i.test(message))return 'call-budget';
    return 'request-budget';
  };
  const stopReason=packet=>{
    if(packet.budget?.deferred)return {code:'input-budget',reason:packet.budget.deferred};
    const exhausted=exhaustedBudget();if(exhausted)return exhausted;
    const unavailable=inspectionModelClient(cfg).unavailableReason(cfg);
    if(!unavailable)return null;
    const blocked=cfg.session?.blocked&&inspectionModelClient(cfg).errorDetails(cfg.session.blocked,cfg.apiKey);
    return {code:blocked?.diagnostics?.failureKind==='budget'||/预算|budget/i.test(unavailable)?budgetFailureCode(unavailable):'service-unavailable',reason:unavailable};
  };
  const contentKey=packet=>JSON.stringify(['design','runtime'].map(side=>packet.sides[side].nodes));
  const requestBytes=(packet,feedback)=>{
    const evidence=InspectionReview.requestEvidence(packet);
    if(feedback)evidence.validationFeedback=feedback;
    const plan=cfg.provider==='jev'?JevReview.identityRequest(evidence):null;
    return new TextEncoder().encode(JSON.stringify(plan?{model:cfg.model,state:plan.state,questions:plan.questions}:evidence)).length;
  };
  const refreshRetryBudget=(packet,feedback)=>{
    if(cfg.provider!=='jev')return packet;
    const textBytes=requestBytes(packet,feedback);
    const maxTextBytes=Math.min(32000,packet.budget?.maxTextBytes??Infinity,limits.maxTextBytes,budget?.maxTextBytes??Infinity);
    const maxRequestBytes=Math.min(262144,limits.maxRequestBytes,budget?.maxRequestBytes??Infinity);
    const nextBudget={...packet.budget,textBytes,maxTextBytes,requestBytes:textBytes,maxRequestBytes,basis:'jev-identity-wire-with-feedback'};
    delete nextBudget.deferred;
    if(textBytes>maxTextBytes||textBytes>maxRequestBytes||Object.values(packet.sides).some(side=>side.nodes.length>limits.maxNodesPerSide))
      nextBudget.deferred='补充局部证据超过身份输入预算';
    return {...packet,budget:nextBudget};
  };
  const compactInput=(packet,entry,reason,feedback)=>{
    if(typeof InspectionReview.compactIdentityPacket!=='function')return null;
    try{
      const beforeBytes=requestBytes(packet,feedback);let next=InspectionReview.compactIdentityPacket(ctx,packet,{reason});
      if(!next)return null;
      next=refreshRetryBudget(next,feedback);
      const afterBytes=next.budget?.requestBytes??requestBytes(next,feedback),recovery={reason,beforeBytes,afterBytes};
      entry.inputRecoveries=[...(entry.inputRecoveries||[]),recovery];
      if(next.budget?.deferred||afterBytes>=beforeBytes){recovery.status='not-smaller';return null;}
      recovery.status='compacted';return next;
    }catch(error){
      entry.inputRecoveries=[...(entry.inputRecoveries||[]),{reason,status:'failed',error:inspectionModelClient(cfg).errorDetails(error,cfg.apiKey).message}];
      return null;
    }
  };
  const pairKey=p=>JSON.stringify([p.designId,p.runtimeId,p.role,p.designScopeId,p.runtimeScopeId,p.designSegmentId,p.runtimeSegmentId]);
  const acceptedIdentityPairs=new Set();
  const rememberTasks=(entry,packet,tasks)=>{
    const originals=entry.targetIds?.design||[],allowed=new Set([...originals,...packet.sides.design.nodes.map(n=>n.id)]);
    const required=new Map((entry.identityTasks||[]).map(task=>[task.designId,task]));
    for(const task of tasks||[]){
      if(!allowed.has(task.designId))continue;
      const previous=required.get(task.designId)||{};
      required.set(task.designId,{...previous,designId:task.designId,
        addedAncestor:Boolean(previous.addedAncestor||task.addedAncestor||!originals.includes(task.designId)),
        ...(task.anchorDesignId?{anchorDesignId:task.anchorDesignId}:{}),...(task.questionId?{questionId:task.questionId}:{})});
    }
    entry.identityTasks=[...required.values()];entry.requiredIdentityIds=[...new Set([...originals,...required.keys()])];
  };
  const unresolvedTargets=entry=>(entry.requiredIdentityIds||entry.targetIds?.design||[]).filter(id=>{
    const runtimeId=ctx.pairs.get(id);
    if(InspectionReview.routing.pair(ctx,ctx.maps.design.get(id),ctx.maps.runtime.get(runtimeId)).action!=='measure')return true;
    const task=entry.identityTasks?.find(task=>task.designId===id);
    // An added component question challenges the old enclosing-object guess.
    // A valid text answer alone cannot confirm that separate component task.
    return task?.addedAncestor&&!acceptedIdentityPairs.has(JSON.stringify([id,runtimeId]))
      &&!ctx.statePairs?.some(pair=>pair.designId===id&&pair.runtimeId===runtimeId&&pair.source==='ai-role-with-structural-validation');
  });
  const refresh=()=>{
    review.processed=review.results.filter(entry=>entry.attempts.length).length;
    review.considered=review.results.filter(entry=>entry.attempts.some(attempt=>attempt.response)).length;
    review.failed=review.results.filter(entry=>entry.attempts.some(attempt=>attempt.error&&!['budget','input-limit'].includes(attempt.diagnostics?.failureKind))).length;
    review.unprocessed=packets.length-review.considered;
    review.firstPassComplete=review.considered===packets.length;
    review.queueComplete=review.firstPassComplete&&review.results.every(entry=>!entry.retryQueued&&!['queued','running'].includes(entry.status));
    review.resolved=review.results.filter(entry=>entry.status==='complete').length;
    review.outcomes=Object.fromEntries([...new Set(review.results.map(entry=>entry.outcome))].filter(Boolean)
      .map(outcome=>[outcome,review.results.filter(entry=>entry.outcome===outcome).length]));
  };
  const queue=packets.map(packet=>{
    const entry={packetId:packet.id,phase:'identity',targetIds:packet.targetIds,requiredIdentityIds:[...(packet.targetIds?.design||[])],status:'queued',attempts:[],application:{accepted:[],rejected:[]}};
    review.results.push(entry);InspectionReview.routing.init(ctx).jobs.push(entry);
    return {packet,entry,round:1,feedback:undefined};
  });
  // Appending follow-ups ensures every independent scope receives its first
  // pass before any scope consumes another call. Dependent rounds stay serial.
  for(let index=0;index<queue.length;index++){
    if(report!==current)return;
    let {packet}=queue[index];
    const {entry,round,feedback}=queue[index];
    if(round>1)entry.retryQueued=false;
    if(packet.budget?.deferred)packet=compactInput(packet,entry,'input-budget',feedback)||packet;
    const defer=stop=>{
      entry.status=entry.attempts.length?'pending':'skipped';entry.outcome=stop.code;entry.error=stop.reason;
      entry.deferrals=[...(entry.deferrals||[]),{round,...stop}];
    };
    let stop=stopReason(packet);
    if(stop)defer(stop);
    else{
      entry.status='running';delete entry.error;
      const beforeCalls=budget?.calls;
      let requested=false,attempt;
      try{
        $('#status').textContent=`正在确认组件与字段：已审阅 ${review.considered}/${packets.length} 个范围${round>1?'，补充上下文后复核':''}…`;
        if(cfg.provider!=='jev'&&round===1)await attachLayoutImages({packets:[packet]},current.visuals);
        if(report!==current)return;
        stop=stopReason(packet);
        if(stop)defer(stop);
        else{
        requested=true;
        const response=await requestInspectionModel(packet,cfg,{phase:'identity',feedback,
          totalMs:Math.min(limits.totalMs,remaining()),onProgress:diagnostics=>{
            if(report===current)review.activeRequest={packetId:packet.id,round,...diagnostics};
          }});
        if(report!==current)return;
        attempt={round,diagnostics:response.diagnostics,response:response.value,identityTasks:response.identityTasks};entry.attempts.push(attempt);
        rememberTasks(entry,packet,[...(response.identityTasks||[]),...(response.value.identityDecisions||[])]);
        const application=InspectionReview.applyIdentity(ctx,packet,response.value);
        attempt.application=application;
        const accepted=new Map(entry.application.accepted.map(pair=>[pairKey(pair),pair]));
        application.accepted.forEach(pair=>{accepted.set(pairKey(pair),pair);acceptedIdentityPairs.add(JSON.stringify([pair.designId,pair.runtimeId]));});
        entry.application={accepted:[...accepted.values()],rejected:[...entry.application.rejected,...application.rejected]};
        const decisions=new Map((entry.identityDecisions||[]).map(decision=>[decision.designId,decision]));
        for(const decision of response.value.identityDecisions||[])decisions.set(decision.designId,decision);
        entry.identityDecisions=[...decisions.values()];
        entry.pendingTargets=unresolvedTargets(entry);
        const pendingDecisions=entry.pendingTargets.map(id=>decisions.get(id));
        const needsContext=response.value.requestContext?.length||pendingDecisions.some(d=>d?.action==='needs_context');
        const noMatch=entry.pendingTargets.length&&pendingDecisions.every(d=>d?.action==='no_match');
        entry.outcome=!entry.pendingTargets.length&&!application.rejected.length?'matched':needsContext?'needs_context':application.rejected.length?'rejected':noMatch?'no_match':'unresolved';
        attempt.outcome=entry.outcome;
        entry.status=entry.outcome==='matched'?'complete':'pending';
        if(needsContext&&entry.pendingTargets.length&&round<limits.maxAttempts){
          const before=contentKey(packet),expanded=InspectionReview.expand(ctx,packet,response.value.requestContext||[]);
          attempt.expandedNodes=expanded;
          if(expanded>0&&contentKey(packet)!==before){
            const retryIds=entry.pendingTargets.filter(id=>decisions.get(id)?.action!=='no_match');
            if(retryIds.length){
              const ids=new Set(retryIds);
              const retryFeedback={expandedNodes:expanded,acceptedIds:[...new Set(entry.application.accepted.map(pair=>pair.designId))]};
              const next=refreshRetryBudget({...packet,targetIds:{...packet.targetIds,design:retryIds},acceptedIdentityIds:retryFeedback.acceptedIds,
                routing:(packet.routing||[]).filter(item=>[item.designId,...(item.designIds||[])].some(id=>ids.has(id))),
                knownPairs:[...ctx.pairs].filter(([d,r])=>packet.sides.design.nodes.some(n=>n.id===d)&&packet.sides.runtime.nodes.some(n=>n.id===r)).map(([designId,runtimeId])=>({designId,runtimeId}))},retryFeedback);
              attempt.retryBudget={...next.budget};
              queue.push({packet:next,entry,round:round+1,feedback:retryFeedback});
              entry.retryQueued=true;
            }
          }else entry.contextStatus='no-new-evidence';
        }
        }
      }catch(error){
        const failure=inspectionModelClient(cfg).errorDetails(error,cfg.apiKey);
        entry.error=failure.message;entry.status='failed';entry.outcome=attempt?.response?'validation-failure':'service-failure';
        if(!attempt){attempt={round};entry.attempts.push(attempt);}
        if(error.identityTasks){attempt.identityTasks=error.identityTasks;rememberTasks(entry,packet,error.identityTasks);}
        Object.assign(attempt,{error:failure.message,diagnostics:failure.diagnostics||attempt.diagnostics||null,cause:failure.cause});
        if(failure.diagnostics?.failureKind==='budget'){
          entry.status='pending';entry.outcome=budgetFailureCode(failure.message);
        }else if(failure.diagnostics?.failureKind==='input-limit'||failure.diagnostics?.httpStatus===413){
          entry.status='pending';entry.outcome='input-limit';
        }
        attempt.outcome=entry.outcome;
        if(['input-limit','input-budget'].includes(entry.outcome)&&round<limits.maxAttempts){
          const next=compactInput(packet,entry,entry.outcome,feedback);
          if(next){
            queue.push({packet:next,entry,round:round+1,feedback:undefined});entry.retryQueued=true;
          }
        }
      }finally{
        if(requested)review.calls+=budget?Math.max(0,(budget.calls||0)-(beforeCalls||0)):attempt?.diagnostics?.phase==='no-candidates'?0:1;
        delete review.activeRequest;
      }
    }
    entry.identitySnapshot=Object.fromEntries((entry.requiredIdentityIds||entry.targetIds?.design||[]).map(id=>[id,ctx.pairs.get(id)]));
    refresh();
    if(typeof render==='function')render();
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  context.structureMatches=InspectionContracts.applyAcceptedPairs(ctx,context.designStructure,context.runtimeStructure,context.structureMatches);
  InspectionReview.routing.identities(ctx);
  // Later scope decisions can repair an earlier target or invalidate an old
  // child pair. The final state must describe the final graph, while snapshots
  // and attempts still show exactly what each request knew at the time.
  for(const entry of review.results){
    const ids=entry.requiredIdentityIds||entry.targetIds?.design||[];
    entry.pendingTargets=unresolvedTargets(entry);
    entry.executionStatus=entry.status;entry.executionOutcome=entry.outcome;
    const resolved=ids.length>0&&!entry.pendingTargets.length;
    entry.finalIdentity={status:resolved?'complete':'pending',pendingTargets:[...entry.pendingTargets],
      pairs:ids.map(designId=>({designId,runtimeId:ctx.pairs.get(designId)||null}))};
    if(resolved){entry.status='complete';entry.outcome='matched';}
    else if(entry.status==='complete'){entry.status='pending';entry.outcome='identity-changed';}
  }
  refresh();
  review.status=review.queueComplete&&review.results.every(entry=>entry.status==='complete')?'complete':'partial';review.finished=true;
  review.elapsedMs=Date.now()-identityStarted;
  current.technical.routing=InspectionReview.routing.summary(ctx);
}
// The first measurement reveals which local objects still lack an identity or
// a trustworthy pixel boundary. Revisit only those checks, once, before the
// icon and layout passes consume the final publication state.
async function runTargetedCompletion(){
  const current=report,ctx=aiFallbackContext?.inspectionContext;
  if(!current||!ctx)return;
  const repair=current.targetedCompletion={status:'running',pixelRetries:0,pixelsRecovered:0,packets:0,calls:0,accepted:0,results:[]};
  const pending=()=>current.checks.filter(c=>c.status==='review');
  const initiallyPending=new Set(pending().map(c=>c.id));
  for(const side of ['design','runtime']){
    const ids=new Set(pending().filter(c=>/边界|字形|行框|留白/.test(c.judgment||''))
      .flatMap(c=>c.visual?.[side]?.nodeIds||[]));
    const targets=[...ids].map(id=>ctx.maps[side].get(id)).filter(n=>n?.geometry?.textInk?.status==='unresolved'&&n.geometry.textInk.reason!=='text-clipped-by-ancestor');
    if(!targets.length||!current.visuals?.[side])continue;
    repair.pixelRetries+=targets.length;
    await TextInk.collect(targets,side,current.visuals[side]);
    repair.pixelsRecovered+=targets.filter(n=>n.geometry?.textInk?.status==='measured').length;
    const rawNodes=side==='design'?flatten(aiFallbackContext.page):runtime.elements||[];
    const rawById=new Map(rawNodes.map(n=>[n.id,n]));
    for(const node of targets){
      const raw=rawById.get(node.id);
      if(raw)raw.geometry={...raw.geometry,textInk:node.geometry.textInk,
        ...(node.geometry.numericSegments?{numericSegments:node.geometry.numericSegments}:{})};
    }
  }
  current.checks=InspectionReview.routing.routeChecks(ctx,InspectionContracts.publish(ctx,current.checks));
  const candidates=pending().filter(c=>c.routing?.action==='ai');
  const packets=InspectionReview.buildPackets(ctx,{checks:candidates}).sort((a,b)=>b.checks.length-a.checks.length||a.budget.textBytes-b.budget.textBytes);
  repair.packets=packets.length;
  const cfg=inspectionModelConfig();repair.provider=cfg.provider||'kimi';
  for(const packet of packets){
    if(report!==current)return;
    const entry={packetId:packet.id,checkIds:packet.checks.map(c=>c.id),status:'skipped'};
    repair.results.push(entry);
    // The shared request/time budget is the sole repair limit; no hidden two-call cutoff.
    if(packet.budget?.deferred){entry.reason=packet.budget.deferred;continue;}
    const unavailable=inspectionModelClient(cfg).unavailableReason(cfg);
    if(unavailable){entry.reason=unavailable;continue;}
    const repairPacket={...packet,phase:'targeted-repair'};
    try{
      $('#status').textContent=`正在补齐局部对象 ${repair.results.length}/${packets.length}…`;
      if(cfg.provider!=='jev')await attachLayoutImages({packets:[repairPacket]},current.visuals);
      repair.calls++;
      const response=await requestInspectionModel(repairPacket,cfg,{phase:'repair',totalMs:InspectionReview.routing.LIMITS.totalMs});
      if(report!==current)return;
      // Repair existing failed measurements only. New discovery checks belong
      // to the normal generation pass, never to this bounded completion pass.
      const applied=InspectionReview.apply(ctx,current,repairPacket,{...response.value,inspect:[]});
      repair.accepted+=applied.pairing.accepted.length;
      entry.status=applied.records.some(r=>r.validation?.status==='validated')?'accepted':'unresolved';
      entry.accepted=applied.pairing.accepted.map(p=>({designId:p.designId,runtimeId:p.runtimeId,role:p.role}));
      entry.rejected=applied.pairing.rejected.map(p=>({designId:p.designId,runtimeId:p.runtimeId,reason:p.reason}));
      entry.validated=applied.records.filter(r=>r.validation?.status==='validated').map(r=>r.checkId);
    }catch(error){
      entry.status='failed';entry.error=inspectionModelClient(cfg).errorDetails(error,cfg.apiKey).message;
    }
  }
  if(repair.accepted){
    aiFallbackContext.structureMatches=InspectionContracts.applyAcceptedPairs(ctx,aiFallbackContext.designStructure,
      aiFallbackContext.runtimeStructure,aiFallbackContext.structureMatches);
  }
  current.checks=InspectionReview.routing.routeChecks(ctx,InspectionContracts.publish(ctx,current.checks));
  repair.resolved=[...initiallyPending].filter(id=>current.checks.some(c=>c.id===id&&c.status!=='review')).length;
  repair.processed=repair.results.filter(r=>r.status!=='skipped').length;
  repair.unprocessed=repair.results.filter(r=>r.status==='skipped').length;
  repair.queueComplete=repair.unprocessed===0;
  repair.status=repair.queueComplete&&!repair.results.some(r=>r.status==='failed')?'complete':'partial';
  current.technical.routing=InspectionReview.routing.summary(ctx);
}
async function runInspectionAdjudication(){
  const current=report,ctx=aiFallbackContext?.inspectionContext;
  if(!current||!ctx||current.inspectionReview?.finished)return;
  const cfg=inspectionModelConfig();
  const review=current.inspectionReview={version:InspectionContracts.VERSION,status:'running',finished:false,completed:false,packets:0,results:[],coverage:[],calls:0,processed:0,failed:0};
  const hold=(ids,reason)=>{
    for(const id of ids){const c=current.checks.find(c=>c.id===id);if(c&&c.aiAdjudication?.status!=='verified'){
      if(c.status==='different')c.candidateVerdict={status:c.status,design:c.design,runtime:c.runtime};
      if(['different','review'].includes(c.status)){c.status='review';c.judgment=reason;c.aiAdjudication={status:'pending',reason};}
    }}
  };
  let fatal=false;
  try{
    current.checks=InspectionReview.routing.routeChecks(ctx,InspectionContracts.publish(ctx,current.checks));
    const packets=InspectionReview.buildPackets(ctx,current);review.packets=packets.length;
    const feedbackQueued=new Set();
    for(const packet of packets){
      if(report!==current)return;
      const entry={packetId:packet.id,phase:'measurement-objects',targetIds:packet.targetIds,status:'running',checkIds:packet.checks.map(c=>c.id),attempts:[]};review.results.push(entry);InspectionReview.routing.init(ctx).jobs.push(entry);
      if(packet.budget?.deferred){entry.status='skipped';entry.error=packet.budget.deferred;continue;}
      const unavailable=inspectionModelClient(cfg).unavailableReason(cfg);
      if(unavailable){
        entry.status='skipped';entry.error=unavailable;
        hold(entry.checkIds,'已测得候选结果，自动复核未完成');continue;
      }
      try{
        $('#status').textContent=`正在复核对象与测量结果 ${review.results.length}/${packets.length}…`;
        if(cfg.provider!=='jev')await attachLayoutImages({packets:[packet]},current.visuals);
        let feedback;
        for(let round=0;round<InspectionReview.routing.LIMITS.maxAttempts;round++){
          review.calls++;
          const response=await requestInspectionModel(packet,cfg,{phase:'repair',feedback,onProgress:()=>{if(report===current)$('#status').textContent=`正在复核对象与测量结果 ${review.results.length}/${packets.length}…`;}});
          if(report!==current)return;
          entry.attempts.push({diagnostics:response.diagnostics,response:response.value});
          entry.application=InspectionReview.apply(ctx,current,packet,response.value);
          if(response.value.requestContext?.length&&round+1<InspectionReview.routing.LIMITS.maxAttempts){
            const expanded=InspectionReview.expand(ctx,packet,response.value.requestContext);
            if(expanded){
              const accepted=new Set(entry.application.records.filter(r=>r.validation?.status==='validated').map(r=>r.checkId));
              packet.checks=packet.checks.filter(c=>!accepted.has(c.id));
              if(packet.checks.length){feedback={expandedNodes:expanded};continue;}
            }
          }
          const dirty=new Set((entry.application.invalidated||[]).filter(id=>!feedbackQueued.has(id)));
          if(dirty.size){
            // Correcting an object can expose differences outside this packet.
            // Queue those measurements automatically instead of publishing stale
            // 'same' rows or silently leaving the new difference unreviewed.
            for(const next of InspectionReview.buildPackets(ctx,current)){
              next.checks=next.checks.filter(c=>dirty.has(c.id));
              if(!next.checks.length)continue;
              next.id=`feedback-${packets.length+1}`;packets.push(next);
              next.checks.forEach(c=>feedbackQueued.add(c.id));
            }
            review.packets=packets.length;
          }
          const pending=entry.application.records.filter(r=>r.validation?.status!=='validated');
          entry.status=pending.length?'pending':'complete';
          if(pending.length&&round+1<InspectionReview.routing.LIMITS.maxAttempts){
            const expanded=0;
            const signature=JSON.stringify(pending.map(r=>[r.checkId,r.validation?.reason]));
            // Feed validation back once even with no new nodes, then stop if it
            // makes no progress. Do not silently consume 3 identical requests.
            if(round>0&&!expanded&&feedback?.signature===signature)break;
            const ids=new Set(pending.map(r=>r.checkId));packet.checks=packet.checks.filter(c=>ids.has(c.id));
            feedback={validation:pending.slice(0,8),pairRejections:entry.application.pairing.rejected.slice(0,8),expandedNodes:expanded,signature};continue;
          }
          break;
        }
      }catch(error){
        recordInspectionFailure(entry,error,cfg);
        hold(entry.checkIds,'本范围的自动复核失败，已保留原始诊断');
      }
      refreshInspectionSummary(current);render();
    }
    review.coverage=ctx.ambiguities.map(a=>({designId:a.designId,status:ctx.pairs.has(a.designId)?'matched':'unresolved'}));
  }catch(error){
    fatal=true;review.error=inspectionModelClient(cfg).errorDetails(error,cfg.apiKey);throw error;
  }finally{
    if(report===current){
      review.propertyCoverage=[...ctx.pairs].map(([designId,runtimeId])=>{
        const related=current.checks.filter(c=>(c.visual?.design?.nodeIds||[]).includes(designId)&&(c.visual?.runtime?.nodeIds||[]).includes(runtimeId));
        return {designId,runtimeId,verifiedProperties:[...new Set(related.filter(c=>c.publication?.status==='validated'&&['same','different','behavior'].includes(c.status)).map(c=>c.property))],pendingProperties:[...new Set(related.filter(c=>c.status==='review').map(c=>c.property))]};
      });
      current.checks=current.checks.filter(c=>{
        if(c.property!=='coverage.unmatched'||!c.coverageNodeId)return true;
        const side=c.uncoveredSide==='设计'?'design':'runtime';
        return !review.propertyCoverage.some(p=>p[side+'Id']===c.coverageNodeId&&p.verifiedProperties.length);
      });
      current.checks=InspectionReview.routing.routeChecks(ctx,InspectionContracts.publish(ctx,current.checks));
      current.technical.routing=InspectionReview.routing.summary(ctx);
      current.technical.requestBudget=aiConfig.requestSession?.budget?{...aiConfig.requestSession.budget,fingerprints:undefined}:null;
      review.processed=review.results.filter(e=>!['running','skipped'].includes(e.status)).length;
      review.failed=review.results.filter(e=>e.status==='failed').length;
      review.finished=true;
      review.completed=!fatal&&review.results.length===review.packets&&review.results.every(e=>e.status==='complete')&&!current.checks.some(c=>c.status==='review');
      review.status=fatal?'failed':review.completed?'complete':'partial';
      review.pending=current.checks.filter(c=>c.status==='review').length;
      review.aiVerified=current.checks.filter(c=>c.aiAdjudication?.status==='verified').length;
      review.verified=current.checks.filter(c=>c.publication?.status==='validated'&&['same','different','behavior'].includes(c.status)).length;
      current.technical.inspection=InspectionContracts.summary(ctx);
      refreshInspectionSummary(current);render();
    }
  }
}
