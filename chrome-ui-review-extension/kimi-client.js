/* Shared transport for all Kimi passes: bounded streaming, sanitized diagnostics, strict JSON. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KimiClient=api;})(globalThis,function(){
  'use strict';
  function parseJSON(raw) {
    if(typeof raw!=='string'||raw.length>128000)throw Error('Kimi 返回内容为空或过大');
    const text=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    let result;try{result=JSON.parse(text);}catch{throw Error('Kimi 返回的 JSON 格式无效');}
    if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Kimi 返回的 JSON 必须是对象');
    return result;
  }
  function sanitizeError(value, secret='') {
    let text='',token='';
    try{text=String(value??'');}catch{text='无法读取错误信息';}
    try{token=String(secret||'');}catch{}
    if(token)text=text.split(token).join('[redacted]');
    return text.replace(/Bearer\s+[^\s"',}]+/gi,'Bearer [redacted]')
      .replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]')
      .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,'[image omitted]')
      .replace(/[A-Za-z0-9+/=]{100,}/g,'[long data omitted]').slice(0,600);
  }
  // Error handling must not replace the original failure with another exception.
  // Preserve bounded, sanitized diagnostics even for non-Error throws or cycles.
  function errorDetails(error,secret='') {
    const seen=new Set();
    const read=(value,key)=>{try{return value?.[key];}catch{return undefined;}};
    const clean=(value,depth=0)=>{
      if(value==null||typeof value==='boolean'||typeof value==='number')return value;
      if(typeof value!=='object')return sanitizeError(value,secret);
      if(depth>=5)return '[nested data omitted]';
      if(seen.has(value))return '[circular]';
      seen.add(value);
      if(Array.isArray(value))return value.slice(0,30).map(v=>clean(v,depth+1));
      const result={};let keys=[];
      try{keys=Object.keys(value).slice(0,40);}catch{return '[unreadable]';}
      for(const key of keys)result[sanitizeError(key,secret)]=clean(read(value,key),depth+1);
      for(const key of ['name','message','cause'])if(!keys.includes(key)&&read(value,key)!=null)result[key]=clean(read(value,key),depth+1);
      return result;
    };
    try{
      const details={message:sanitizeError(read(error,'message')??error,secret)||'未知错误'};
      if(read(error,'diagnostics')!=null)details.diagnostics=clean(read(error,'diagnostics'));
      if(read(error,'cause')!=null)details.cause=clean(read(error,'cause'));
      if(read(error,'name'))details.name=sanitizeError(read(error,'name'),secret);
      return details;
    }catch{return {message:'无法读取错误信息'};}
  }
  function providerFields(error,secret) {
    const fields={};
    if(error&&typeof error==='object')for(const key of ['message','type','code','param']){
      if(typeof error[key]==='string'||typeof error[key]==='number')fields[key]=sanitizeError(error[key],secret);
    }
    else if(typeof error==='string')fields.message=sanitizeError(error,secret);
    return fields;
  }
  async function providerError(response,secret) {
    let text='',body;
    // Read only a bounded error response. Never persist the full request or arbitrary HTML.
    if(response.body?.getReader){
      const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;
      try{while(size<16384){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}
      finally{try{await reader.cancel();}catch{}}
      try{body=JSON.parse(text);}catch{}
    }else if(response.json){try{body=await response.json();}catch{}}
    const fields=providerFields(body?.error,secret);
    const requestId=response.headers?.get?.('x-request-id')||response.headers?.get?.('x-msh-request-id');
    if(requestId)fields.requestId=sanitizeError(requestId,secret).slice(0,120);
    return fields;
  }
  function createSession(limits={}) {
    return {budget:{maxCalls:limits.maxCalls??12,maxAiMs:limits.maxAiMs??120000,
      maxTextBytes:limits.maxTextBytes??96000,maxRequestBytes:limits.maxRequestBytes??2400000,
      idleMs:limits.idleMs??20000,totalMs:limits.totalMs??45000,startedAt:null,usedAiMs:0,calls:0,requests:[],fingerprints:[]}};
  }
  function unavailableReason(cfg){
    if(!cfg?.apiKey)return '模型连接尚未配置';
    if(cfg.session?.blocked)return '本轮模型连接已停止';
    const b=cfg.session?.budget;
    if(b&&(b.calls>=b.maxCalls||b.usedAiMs>=b.maxAiMs))return '本轮自动复核已达到调用或时间预算';
    return '';
  }
  function fingerprint(value){let h=2166136261;for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);return (h>>>0).toString(16)+':'+value.length;}
  function failureKind(diagnostics){
    const status=diagnostics.httpStatus,p=diagnostics.providerError||{},message=String(p.message||'')+' '+String(p.code||'');
    if(/context[_ -]?(?:length|window)|maximum.*tokens|tokens.*(?:maximum|max allowed|limit)|too (?:many|long)|prompt.*(?:long|limit)|超.*(?:上下文|token)/i.test(message))return 'input-limit';
    if([401,403,404,402,429].includes(status))return 'connection';
    if([400,422].includes(status)&&['model','temperature','top_p','thinking'].includes(p.param))return 'configuration';
    if([400,413,422].includes(status))return 'request';
    return 'transport';
  }
  async function completeJSON({cfg,messages,maxTokens=2400,onProgress=()=>{},fetchImpl=fetch,idleMs=60000,totalMs=180000}) {
    if(cfg.session?.blocked){
      const details=errorDetails(cfg.session.blocked,cfg.apiKey);
      const error=new Error(`Kimi 本轮后续请求已停止：${details.message}`);
      error.diagnostics={...details.diagnostics,phase:'skipped',elapsedMs:0};throw error;
    }
    const start=Date.now(),model=cfg.model||'kimi-k2.6',budget=cfg.session?.budget;
    if(budget){
      idleMs=Math.min(idleMs,budget.idleMs);totalMs=Math.min(totalMs,budget.totalMs);
      totalMs=Math.max(1,Math.min(totalMs,budget.maxAiMs-budget.usedAiMs));
    }
    const diagnostics={model,transport:'stream',thinking:/^kimi-k2\.(5|6)(?:$|-)/.test(model)?'disabled':'model-default',phase:'connecting',sampling:'model-default',idleTimeoutMs:idleMs,totalTimeoutMs:totalMs};
    const controller=new AbortController();let idleTimer,totalTimer,progressTimer,reader,timeoutKind,progressAt=0;
    const signalProgress=force=>{if(force||Date.now()-progressAt>1000){progressAt=Date.now();try{onProgress({...diagnostics,elapsedMs:Date.now()-start});}catch{}}};
    const resetIdle=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>{timeoutKind='idle';controller.abort();},idleMs);};
    // K2.6 fixes temperature at 1 in thinking and 0.6 in instant mode.
    // Omit sampling overrides so the provider selects the valid values for each mode.
    const body={model,stream:true,max_tokens:maxTokens,response_format:{type:'json_object'},messages};
    if(diagnostics.thinking==='disabled')body.thinking={type:'disabled'};
    const encoded=JSON.stringify(body);diagnostics.requestBytes=new TextEncoder().encode(encoded).length;
    const textContent=messages.map(m=>typeof m.content==='string'?m.content:(m.content||[]).filter(p=>p.type==='text').map(p=>p.text||'').join('\n')).join('\n');
    diagnostics.textBytes=new TextEncoder().encode(textContent).length;
    let requestRecord;
    totalTimer=setTimeout(()=>{timeoutKind='total';controller.abort();},totalMs);resetIdle();signalProgress(true);progressTimer=setInterval(()=>signalProgress(true),1000);
    try{
      if(budget){
        const key=fingerprint(encoded);
        let reason='';
        if(diagnostics.textBytes>budget.maxTextBytes||diagnostics.requestBytes>budget.maxRequestBytes)reason='局部证据超过单次输入预算';
        else if(budget.calls>=budget.maxCalls||budget.usedAiMs>=budget.maxAiMs)reason='本轮自动复核已达到调用或时间预算';
        else if(budget.fingerprints.includes(key))reason='相同证据已请求，停止重复调用';
        if(reason){diagnostics.phase='budget-check';diagnostics.failureKind='budget';throw Error('Kimi '+reason);}
        budget.startedAt??=start;budget.calls++;budget.fingerprints.push(key);
        requestRecord={index:budget.calls,textBytes:diagnostics.textBytes,requestBytes:diagnostics.requestBytes,status:'running'};budget.requests.push(requestRecord);
      }
      const response=await fetchImpl('https://api.moonshot.cn/v1/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${cfg.apiKey}`},body:encoded,signal:controller.signal
      });
      resetIdle();diagnostics.httpStatus=response.status||200;diagnostics.headersMs=Date.now()-start;diagnostics.phase='receiving';
      if(!response.ok){
        diagnostics.phase='request-rejected';
        diagnostics.providerError=await providerError(response,cfg.apiKey);
        const hint=diagnostics.providerError.message||({400:'请求参数不符合接口要求',401:'密钥无效或已过期',403:'无模型调用权限',404:'模型或接口不存在',429:'限流或余额不足'})[response.status]||'模型接口拒绝请求';
        throw Error(`Kimi HTTP ${response.status}：${hint}`);
      }
      const type=response.headers?.get?.('content-type')||'';
      let raw='',finishReason=null,usage=null;
      const append=value=>{if(typeof value==='string'){raw+=value;if(raw.length>128000)throw Error('Kimi 返回内容过大');}};
      if(/text\/event-stream/i.test(type)){
        if(!response.body?.getReader)throw Error('Kimi 流式响应不可读取');
        reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',done=false;
        const consume=line=>{
          if(!line.startsWith('data:'))return;
          const data=line.slice(5).trim();if(!data)return;
          if(data==='[DONE]'){done=true;return;}
          let event;try{event=JSON.parse(data);}catch{throw Error('Kimi 流式数据格式无效');}
          if(event.error){
            diagnostics.providerError=providerFields(event.error,cfg.apiKey);
            throw Error(`Kimi 流式响应返回错误：${diagnostics.providerError.message||'模型生成未完成'}`);
          }
          const choice=event.choices?.[0];append(choice?.delta?.content);
          if(choice?.finish_reason)finishReason=choice.finish_reason;
          if(event.usage)usage=event.usage;
          // Do not store reasoning text or page contents in diagnostics.
          diagnostics.phase=choice?.delta?.content?'receiving-result':'receiving';signalProgress(false);
        };
        while(!done){
          const chunk=await reader.read();
          if(chunk.done){buffer+=decoder.decode();if(buffer.trim())consume(buffer);break;}
          if(diagnostics.firstChunkMs==null)diagnostics.firstChunkMs=Date.now()-start;
          resetIdle();buffer+=decoder.decode(chunk.value,{stream:true});
          if(buffer.length>262144)throw Error('Kimi 单段流式数据过大');
          let newline;while((newline=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,newline).replace(/\r$/,''));buffer=buffer.slice(newline+1);if(done)break;}
        }
        if(!done&&!finishReason)throw Error('Kimi 流式响应中断，未完成生成');
      }else{
        diagnostics.transport='json';const data=await response.json();
        if(data.error){
          diagnostics.providerError=providerFields(data.error,cfg.apiKey);
          throw Error(`Kimi 响应返回错误：${diagnostics.providerError.message||'模型生成未完成'}`);
        }
        append(data.choices?.[0]?.message?.content);finishReason=data.choices?.[0]?.finish_reason;usage=data.usage||null;
      }
      if(finishReason==='length')throw Error('Kimi 输出达到长度限制，未完成 JSON');
      const value=parseJSON(raw);diagnostics.phase='complete';diagnostics.elapsedMs=Date.now()-start;signalProgress(true);
      return {value,model,usage,diagnostics};
    }catch(error){
      const failedPhase=diagnostics.phase;diagnostics.phase='failed';diagnostics.failedPhase=failedPhase;diagnostics.elapsedMs=Date.now()-start;
      const original=errorDetails(error,cfg.apiKey);
      const message=sanitizeError(timeoutKind?`Kimi ${timeoutKind==='idle'?'等待数据':'整次请求'}超时`:/^Kimi /.test(original.message)?original.message:'无法完成 Kimi 请求',cfg.apiKey);
      diagnostics.timeoutKind=timeoutKind||null;
      diagnostics.cause=original;
      const failure=new Error(message);failure.diagnostics=diagnostics;failure.cause=original;
      diagnostics.failureKind ||= failureKind(diagnostics);
      if(cfg.session&&['connection','configuration'].includes(diagnostics.failureKind))cfg.session.blocked={message,diagnostics};
      throw failure;
    }finally{
      if(requestRecord){
        const elapsedMs=Date.now()-start;
        budget.usedAiMs+=elapsedMs;
        Object.assign(requestRecord,{status:diagnostics.phase,httpStatus:diagnostics.httpStatus||null,elapsedMs,failureKind:diagnostics.failureKind||null});
      }
      clearTimeout(idleTimer);clearTimeout(totalTimer);clearInterval(progressTimer);
      if(reader){try{await reader.cancel();}catch{}}
      controller.abort();
    }
  }
  return {parseJSON,completeJSON,sanitizeError,errorDetails,createSession,unavailableReason};
});
