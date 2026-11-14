import {setTimeout as delay} from 'node:timers/promises';

type ObjectValue=Record<string,unknown>;
export type BuildWaitState='ready'|'failed'|'action_required'|'timed_out'|'cancelled'|'unconfirmed';
export interface BuildWaitResult {
 state:BuildWaitState;buildId:string;reads:number;elapsedMs:number;reason?:string;
 payload?:ObjectValue;componentRef?:ObjectValue;httpStatus?:number;
}
export class BuildStatusReadError extends Error{constructor(readonly status:number){super('status_read_failed');}}
const record=(value:unknown):ObjectValue|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:undefined;
const hash=(value:unknown)=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/u.test(value);

/** Only the platform's original completed receipt supplies a usable reference. */
export function readyBuildReference(build:ObjectValue):ObjectValue|undefined {
 const receipt=record(build.receipt),ref=record(receipt?.componentRef),security=record(build.securityReview),store=record(receipt?.objectStore);
 if(build.status!=='succeeded'||build.previewStatus!=='ready'||!receipt||!ref||store?.status!=='mirrored'
  ||security?.decision==='manual_review'||security?.decision==='reject'
  ||!['marketplace','project_private'].includes(String(ref.provider))||typeof ref.id!=='string'||!ref.id
  ||typeof ref.version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(ref.version))return;
 if(receipt.buildId!==undefined&&receipt.buildId!==build.buildId
  ||build.componentId!==undefined&&build.componentId!==ref.id
  ||build.version!==undefined&&build.version!==ref.version)return;
 for(const field of ['sourceHash','schemaHash','bundleHash'])if(!hash(ref[field])||ref[field]!==receipt[field])return;
 return ref;
}

/** Observe a single already accepted build. It never uploads, recovers or rebuilds. */
export async function waitForOriginalBuild(input:{
 buildId:string;timeoutMs:number;read(signal:AbortSignal):Promise<ObjectValue>;signal?:AbortSignal;
 now?:()=>number;sleep?:(ms:number,signal:AbortSignal)=>Promise<void>;
 progress?:(value:{buildId:string;status:string;reads:number})=>void;
}):Promise<BuildWaitResult>{
 if(!Number.isFinite(input.timeoutMs)||input.timeoutMs<100||input.timeoutMs>1_800_000)throw Error('status.wait.timeout_invalid');
 const now=input.now??(()=>performance.now()),sleep=input.sleep??((ms,signal)=>delay(ms,undefined,{signal}));
 const started=now(),controller=new AbortController();let payload:ObjectValue|undefined,reads=0,httpStatus:number|undefined;
 const stop=()=>controller.abort(input.signal?.reason??'cancelled');
 if(input.signal?.aborted)stop();else input.signal?.addEventListener('abort',stop,{once:true});
 const timer=setTimeout(()=>controller.abort('timed_out'),input.timeoutMs);
 const result=(state:BuildWaitState,reason?:string,componentRef?:ObjectValue):BuildWaitResult=>({state,buildId:input.buildId,reads,elapsedMs:Math.max(0,Math.round(now()-started)),...(reason?{reason}:{}),...(payload?{payload}:{}),...(componentRef?{componentRef}:{}),...(httpStatus!==undefined?{httpStatus}:{})});
 try{
  while(!controller.signal.aborted&&now()-started<input.timeoutMs){
   try{reads++;payload=await input.read(controller.signal);}catch(error){
    if(controller.signal.aborted)break;
    if(error instanceof BuildStatusReadError){httpStatus=error.status;return result('unconfirmed',[401,403].includes(error.status)?'status_read_denied':'status_read_http_error');}
    return result('unconfirmed','status_read_failed');
   }
   if(controller.signal.aborted||now()-started>=input.timeoutMs)break;
   const build=record(payload.build),observedId=build?.buildId??build?.id??payload.buildId??payload.jobId;
   if(observedId!==input.buildId)return result('unconfirmed','build_identity_unconfirmed');
   if(!build)return result('unconfirmed','build_shape_unconfirmed');
   const status=typeof build.status==='string'?build.status:'unknown';
   if(!['queued','running','succeeded','failed','cancelled','canceled'].includes(status))return result('unconfirmed','build_status_unconfirmed');
   input.progress?.({buildId:input.buildId,status,reads});
   if(record(build.securityReview)?.decision==='manual_review')return result('action_required','manual_review');
   if(['failed','cancelled','canceled'].includes(status))return result('failed',status);
   if(record(build.securityReview)?.decision==='reject')return result('failed','security_rejected');
   if(build.previewStatus==='failed')return result('action_required','preview_failed');
   const reference=readyBuildReference(build);if(reference)return result('ready',undefined,reference);
   if(!['queued','running','succeeded'].includes(status))return result('unconfirmed','build_status_unconfirmed');
   const remaining=input.timeoutMs-(now()-started);if(remaining<=0)break;
   try{await sleep(Math.min(500*2**Math.min(reads-1,4),5000,remaining),controller.signal);}catch{if(controller.signal.aborted)break;return result('unconfirmed','observation_interrupted');}
  }
  return result(input.signal?.aborted?'cancelled':'timed_out');
 }finally{clearTimeout(timer);input.signal?.removeEventListener('abort',stop);}
}
