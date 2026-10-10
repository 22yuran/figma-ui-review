/* Loaded after popup.js. Reuses the comparison's immutable node snapshot. */
const activeLayoutReviews = new WeakSet();
function layoutReviewSection(review) {
  if(!review)return '';
  const labels={measured:'复测已完成',unresolved:'证据仍不足',rejected:'建议未通过验证',error:'调用失败'};
  const missing=review.evidence.packets.filter(p=>['design','runtime'].some(s=>p.sides[s].image?.status==='missing')).length;
  const rows=(review.results||[]).flatMap(result=>[...(result.error?[{checkId:result.packetId,requestDiagnostics:result.diagnostics,validation:{status:'error',reason:result.error}}]:[]),...(result.rows||[]).map(row=>({...row,requestDiagnostics:row.requestDiagnostics||result.diagnostics}))]);
  const metrics=review.metrics||layoutReviewMetrics(review);
  return `<section class="layout-review-summary"><p>自动完成 ${metrics.applied} 项布局复核${metrics.pending?`，${metrics.pending} 项自动检查未完成`:''}。结果已计入下方正式报告。</p><details class="layout-review-diagnostics"><summary>查看自动复核记录</summary><p>${esc(review.status)} · ${review.evidence.packets.length} 个局部证据包；${review.evidence.skipped.length} 项超出本版范围。${missing?`${missing} 个包缺少截图，建议仅基于结构数据。`:''}</p>${rows.map(row=>{
    const check=review.evidence.packets.flatMap(p=>p.checks).find(c=>c.id===row.checkId), v=row.validation;
    const packet=review.evidence.packets.find(p=>p.checks.some(c=>c.id===row.checkId));
    const diagnostic=row.requestDiagnostics;
    const applied=(review.results||[]).some(result=>result.application?.applied?.includes(row.checkId));
    const partial=v.resolutionContract?.metric==='partial-content-insets';
    const notApplied=v.status==='measured'&&!applied?(review.results||[]).flatMap(result=>result.application?.skipped||[]).find(item=>item.checkId===row.checkId):null;
    const verification=v.status==='unresolved'&&row.proposal?.action==='insufficient_evidence'&&v.reason===row.proposal.reason?'模型未提交可验证的测量对象，本项尚无独立复测结论。':v.reason;
    const verificationLabel=v.status==='error'?'调用情况':v.code?'程序检查':'复测验证';
    const callInfo=diagnostic?`耗时 ${Math.round(diagnostic.elapsedMs/1000)} 秒；${diagnostic.headersMs==null?'尚未收到响应头':`已收到 HTTP ${diagnostic.httpStatus}`}${diagnostic.transport==='json'?'（结构化响应）':`；${diagnostic.firstChunkMs==null?'未收到流式数据':`首段数据 ${Math.round(diagnostic.firstChunkMs/1000)} 秒`}`}`:'';
    const names={startNodeIds:'上端',endNodeIds:'下端',outerNodeIds:'外框',contentNodeIds:'内容'};
    const objects=row.proposal?['design','runtime'].map(s=>{
      const fields=Object.entries(row.proposal[s]||{}).filter(([k])=>names[k]);
      return fields.length?`${s==='design'?'Figma':'前端'}：${fields.map(([k,ids])=>`${names[k]}=${Array.isArray(ids)?ids.map(id=>{const n=packet?.sides[s].nodes.find(n=>n.id===id);return (n?.text.descendant||n?.text.direct||id).slice(0,100);}).join(' + '):''}`).join('；')}`:'';
    }).filter(Boolean).join(' / '):'';
    const valueText=value=>typeof value==='number'?`${value}px`:['top','right','bottom','left'].filter(edge=>Number.isFinite(value?.[edge])).map(edge=>`${({top:'上',right:'右',bottom:'下',left:'左'})[edge]} ${value[edge]}px`).join('、');
    return `<div class="layout-review-result"><b>${esc(check?.item||row.checkId)} · ${esc(applied?'正式结论已更新':notApplied?'复测未采用':partial?'部分边界已测量，自动检查未完成':labels[v.status]||v.status)}</b><p>${row.source==='deterministic'?'对象确认':'AI 建议'}：${esc(row.proposal?.reason||'暂无建议')}</p><p>${verificationLabel}：${esc(verification)}</p>${notApplied?`<p>正式结论未更新：${esc(notApplied.reason)}</p>`:''}${callInfo?`<p>${esc(callInfo)}</p>`:''}${v.values?`<p>复测：Figma ${esc(valueText(v.values.design))} / 前端 ${esc(valueText(v.values.runtime))}；差值 ${esc(valueText(v.delta))}。${v.contractVerified?(partial?'已验证列出的边界；其余边界自动检查未完成。':'测量对象和原检查口径已验证。'):v.scopeChanged?'测量对象范围已变化，尚未更新正式结论。':''}</p>`:''}${objects?`<p>${esc(objects)}</p>`:''}</div>`;
  }).join('')}${review.evidence.skipped.map(s=>`<p>${esc(s.checkId)}：${esc(s.reason)}</p>`).join('')}${(review.results||[]).flatMap(result=>(result.attempts||[]).filter(attempt=>attempt.error&&attempt.attempt>1).map(attempt=>`<p>${esc(result.packetId)}：候选重选调用失败，已保留首次有效结果。${esc(attempt.error)}</p>`)).join('')}${(review.unprocessed||[]).map(item=>`<p>${esc(item.packetId)}：${esc(item.reason)}</p>`).join('')}${review.error?`<p>${esc(review.error)}</p>`:''}</details></section>`;
}
function ensureLayoutEvidence() {
  if(!report||!aiFallbackContext)throw Error('请先完成一次走查');
  if(!report.layoutReview){
    report.layoutReview={version:LayoutReview.VERSION,mode:'validated',status:'正在准备排版复核',results:[],evidence:LayoutReview.buildEvidence(report,
      {design:aiFallbackContext.designNodes,runtime:aiFallbackContext.runtimeNodes},layoutMeasurement,
      LayoutReview.identityEvidence(aiFallbackContext.inspectionContext,typeof InspectionContracts==='undefined'?null:InspectionContracts))};
  }
  return report.layoutReview;
}
async function attachLayoutImages(evidence,visuals) {
  for(const packet of evidence.packets)for(const side of ['design','runtime']){
    const source=visuals?.[side], entry=packet.sides[side], b=entry.crop;
    if(!source?.dataUrl||!b){entry.image={status:'missing',reason:'缺少局部截图，将仅基于结构分析'};continue;}
    try{
      const image=await loadImage(source.dataUrl), w=Number(source.width)||image.naturalWidth,h=Number(source.height)||image.naturalHeight;
      const x=Math.max(0,b.x-24),y=Math.max(0,b.y-24),crop={x,y,width:Math.min(w,b.x+b.width+24)-x,height:Math.min(h,b.y+b.height+24)-y};
      if(crop.width<=0||crop.height<=0)throw Error('截图范围无效');
      const scale=Math.min(2,1200/Math.max(crop.width,crop.height)), canvas=document.createElement('canvas');
      canvas.width=Math.ceil(crop.width*scale);canvas.height=Math.ceil(crop.height*scale);
      canvas.getContext('2d').drawImage(image,crop.x*image.naturalWidth/w,crop.y*image.naturalHeight/h,crop.width*image.naturalWidth/w,crop.height*image.naturalHeight/h,0,0,canvas.width,canvas.height);
      entry.image={status:'available',crop,dataUrl:canvas.toDataURL('image/png')};
    }catch{entry.image={status:'missing',reason:'截图裁剪失败，将仅基于结构分析'};}
  }
}
// The selected provider shares the same session and verified measurement candidates.
async function requestKimiLayout(packet, cfg, onProgress, feedback) {
  const metadata=LayoutReview.modelEvidence(packet);
  if(feedback)metadata.validationFeedback=feedback;
  const content=[{type:'text',text:JSON.stringify(metadata)}];
  for(const side of ['design','runtime']) {
    const image=packet.sides[side].image;
    if(image?.dataUrl)content.push({type:'text',text:`${side} 局部截图`},{type:'image_url',image_url:{url:image.dataUrl}});
  }
  const limits=typeof InspectionReview!=='undefined'?InspectionReview.routing.LIMITS:null;
  const remaining=limits&&cfg.session?.budget?limits.maxPreVerifyAiMs-cfg.session.budget.usedAiMs:null;
  const timing=remaining!=null?{totalMs:Math.max(1,Math.min(limits.totalMs,remaining))}:{};
  let result;
  if(cfg.provider==='jev'){
    const plan=JevReview.layoutRequest(metadata);
    if(!Object.keys(plan.questions).length)throw Error('Jev 排版检查没有可选择的测量候选');
    result=await JevClient.request({cfg,state:plan.state,questions:plan.questions,onProgress,...timing});
    try{result={...result,value:JevReview.decode(plan,result.value)};}
    catch(error){error.diagnostics=result.diagnostics;throw error;}
  }else result=await KimiClient.completeJSON({cfg,messages:[{role:'system',content:LayoutReview.prompt},{role:'user',content}],maxTokens:2400,onProgress,...timing});
  try{return {model:result.model,usage:result.usage,diagnostics:result.diagnostics,rawResponse:result.value,
    rows:LayoutReview.validateResponse(packet,result.value).map(row=>({...row,requestDiagnostics:result.diagnostics}))};}
  catch(error){error.diagnostics=result.diagnostics;error.rawResponse=result.value;throw error;}
}
function layoutReviewMetrics(review) {
  const results=review.results||[],applied=new Set(results.flatMap(r=>r.application?.applied||[]));
  const partial=new Set(results.flatMap(r=>r.application?.partial||[]));
  const validated=new Set(results.flatMap(r=>(r.rows||[]).filter(row=>row.validation?.status==='measured'&&row.validation.contractVerified
    &&row.validation.resolutionContract?.metric!=='partial-content-insets').map(row=>row.checkId)));
  const planned=new Set([...(review.evidence?.packets||[]).flatMap(p=>p.checks.map(c=>c.id)),...(review.evidence?.skipped||[]).map(c=>c.checkId)]);
  return {successfulPackets:results.filter(r=>r.attempts?.some(a=>!a.error)).length,
    validated:validated.size,applied:applied.size,partial:partial.size,
    deterministic:results.reduce((n,r)=>n+(r.rows||[]).filter(row=>row.source==='deterministic'&&applied.has(row.checkId)).length,0),
    pending:[...planned].filter(id=>!applied.has(id)).length,
    failedCalls:results.reduce((n,r)=>n+(r.attempts||[]).filter(a=>a.error).length,0),unprocessedPackets:(review.unprocessed||[]).length};
}
async function runLayoutReview(options={}) {
  const current=report;
  if(!current||activeLayoutReviews.has(current)||current.layoutReview?.completed)return;
  activeLayoutReviews.add(current);
  const cfg={provider:aiConfig.provider,configured:aiConfig.configured,connectionError:aiConfig.connectionError,apiKey:aiConfig.apiKey,model:aiConfig.model,session:aiConfig.requestSession};
  const client=cfg.provider==='jev'?JevClient:KimiClient;
  const reviewLimits=typeof InspectionReview!=='undefined'?InspectionReview.routing.LIMITS:{maxLayoutCalls:2,maxPreVerifyCalls:9,maxPreVerifyAiMs:90000};
  let review;
  try {
    review=ensureLayoutEvidence();review.mode='validated';review.provider=cfg.provider||'kimi';review.automatic=true;review.results=[];review.unprocessed=[];
    let plans=review.evidence.packets.flatMap(packet=>LayoutReview.buildCandidates(packet).checks);
    const requirements=plans.filter(plan=>!(plan.candidates.length===1&&plan.candidates[0].deterministic&&plan.candidates[0].validation?.resolutionContract?.metric!=='partial-content-insets')).flatMap(plan=>(plan.requiredEvidence||[]).map(requirement=>({...requirement,checkId:plan.checkId})));
    const collectEvidence=options.collectEvidence||(typeof collectLayoutReviewEvidence==='function'?collectLayoutReviewEvidence:null);
    if(collectEvidence&&(requirements.length||review.evidence.skipped.length)){
      review.status='正在自动补充排版测量';render();
      try{
        const supplement=await collectEvidence(current,{requirements,checkIds:[...new Set([...requirements.map(r=>r.checkId),...review.evidence.skipped.map(c=>c.checkId)])]});
        if(report!==current)return;
        review.collection={requirements,diagnostics:supplement?.diagnostics||null};
        if(supplement?.evidence)review.evidence=supplement.evidence;
      }catch(error){
        if(report!==current)return;
        review.collection={requirements,error:client.sanitizeError(error.message,cfg.apiKey)};
      }
    }
    const packets=review.evidence.packets;
    if(!packets.length){review.status=review.evidence.skipped.length?`走查完成；${review.evidence.skipped.length} 项缺少可用局部证据，尚未处理`:'走查完成；没有待复核的局部排版项';return;}
    let modelPacketCount=0,layoutCalls=0;
    const mergeRows=(oldRows,newRows)=>{const updates=new Map(newRows.map(row=>[row.checkId,row]));return oldRows.map(row=>updates.get(row.checkId)||row);};
    for(let i=0;i<packets.length;i++) {
      if(report!==current)return;
      const packet=packets[i],packetPlans=LayoutReview.buildCandidates(packet),entry={packetId:packet.id,attempts:[],rows:[]};
      review.results.push(entry);
      entry.rows=packetPlans.checks.map(plan=>({checkId:plan.checkId,proposal:null,validation:{status:'unresolved',code:'no-measurable-candidate',reason:plan.reason||'测量对象存在歧义，尚未确认',requiredEvidence:plan.requiredEvidence||[]}}));
      const direct=packetPlans.checks.filter(plan=>plan.candidates.length===1&&plan.candidates[0].deterministic===true&&plan.candidates[0].validation?.contractVerified===true);
      if(direct.length){
        const ids=new Set(direct.map(plan=>plan.checkId)),input={...packet,checks:packet.checks.filter(check=>ids.has(check.id))};
        const rows=LayoutReview.validateResponse(input,{proposals:direct.map(plan=>({checkId:plan.checkId,action:'select_candidate',candidateId:plan.candidates[0].id,reason:'程序已确认唯一的完整对应对象及测量边界'}))}).map(row=>({...row,source:'deterministic'}));
        entry.rows=mergeRows(entry.rows,rows);
      }
      const directIds=new Set(direct.map(plan=>plan.checkId));
      const ambiguous=packetPlans.checks.filter(plan=>!directIds.has(plan.checkId)&&plan.candidates.length>0);
      if(ambiguous.length){
        const ids=new Set(ambiguous.map(plan=>plan.checkId)),input={...packet,checks:packet.checks.filter(check=>ids.has(check.id))};
        let deferred='';
        if(cfg.provider==='jev'?cfg.configured===false:!cfg.apiKey){review.connection=cfg.provider==='jev'?'unavailable':'missing-key';deferred=client.unavailableReason?.(cfg)||'模型连接尚未配置，存在歧义的对象尚未处理';}
        else if(cfg.session?.blocked)deferred='本轮模型连接异常，存在歧义的对象尚未处理';
        else if(cfg.session?.budget&&(layoutCalls>=reviewLimits.maxLayoutCalls||cfg.session.budget.calls>=reviewLimits.maxPreVerifyCalls||cfg.session.budget.usedAiMs>=reviewLimits.maxPreVerifyAiMs))deferred='排版阶段已达到预留额度，剩余额度留给最终复核';
        else if(client.unavailableReason?.(cfg))deferred=client.unavailableReason(cfg);
        if(deferred){review.unprocessed.push({packetId:packet.id,checkIds:input.checks.map(check=>check.id),reason:deferred});}
        else {
          modelPacketCount++;review.modelPackets=modelPacketCount;
          review.status='正在自动确认排版对象';render();
          if(cfg.provider!=='jev')await attachLayoutImages({...review.evidence,packets:[packet]},current.visuals);
          if(report!==current)return;
          const request=async(requestPacket,attempt,feedback)=>{
            if(cfg.session?.budget&&(layoutCalls>=reviewLimits.maxLayoutCalls||cfg.session.budget.calls>=reviewLimits.maxPreVerifyCalls||cfg.session.budget.usedAiMs>=reviewLimits.maxPreVerifyAiMs))return null;
            layoutCalls++;
            review.status=attempt>1?'正在根据验证结果重新确认排版对象':'正在自动确认排版对象';render();
            try {
              const result=await requestKimiLayout(requestPacket,cfg,diagnostics=>{
                if(report!==current)return;
                review.activeRequest={packetId:packet.id,attempt,...diagnostics};
                $('#status').textContent=review.status;
              },feedback);
              if(report!==current)return null;
              entry.attempts.push({attempt,checkIds:requestPacket.checks.map(c=>c.id),feedback,...result});
              return result;
            }catch(error){
              if(report!==current)return null;
              entry.attempts.push({attempt,checkIds:requestPacket.checks.map(c=>c.id),feedback,error:error.message,diagnostics:error.diagnostics||null,rawResponse:error.rawResponse});
              if(attempt===1){entry.error=error.message;entry.diagnostics=error.diagnostics||null;}
              return null;
            }
          };
          const first=await request(input,1);
          if(report!==current)return;
          if(first){
            entry.model=first.model;entry.usage=first.usage;entry.diagnostics=first.diagnostics;entry.rows=mergeRows(entry.rows,first.rows);
            const feedback=LayoutReview.validationFeedback(input,first.rows);
            const retryChecks=feedback.checks?.filter(c=>c.candidateIds?.length&&['unresolved','rejected'].includes(c.status))||[];
            if(feedback.retryable&&retryChecks.length&&!cfg.session?.blocked){
              const retryIds=new Set(retryChecks.map(c=>c.checkId));
              const retryPacket={...packet,checks:packet.checks.filter(c=>retryIds.has(c.id))};
              const second=await request(retryPacket,2,{...feedback,checks:retryChecks});
              if(report!==current)return;
              if(second)entry.rows=mergeRows(entry.rows,second.rows);
            }
          }
        }
      }
      entry.application=LayoutReviewDecisions.apply(current,packet,entry.rows);
    }
    review.metrics=layoutReviewMetrics(review);
    const m=review.metrics;
    review.status=`走查完成；自动完成 ${m.applied} 项布局复核${m.partial?`，${m.partial} 项已完成部分测量`:''}${m.pending?`，${m.pending} 项自动检查未完成`:''}${m.failedCalls?'；部分自动复核调用未完成':''}`;
  } catch(error) {
    if(review){review.status='走查完成；部分自动复核未完成，已验证结果保留';review.error=client.sanitizeError(error.message,cfg.apiKey);}
  } finally {
    if(review){review.metrics=layoutReviewMetrics(review);review.completed=true;delete review.activeRequest;}
    activeLayoutReviews.delete(current);
    if(report===current)render();
  }
}
