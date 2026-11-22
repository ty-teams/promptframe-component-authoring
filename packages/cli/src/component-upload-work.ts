import {createHash} from 'node:crypto';
import {PromptFrameCliError} from './cli-error.js';

export interface ComponentUploadWork {projectId:string;sessionId:string;intentId:string}
export interface ComponentUploadWorkTarget {projectId:string;sessionId:string;operationId:string}
export const COMPONENT_UPLOAD_WORK_HEADER='x-promptframe-upload-work';
function invalid(){return new PromptFrameCliError('A component upload for a work needs its exact project and session.',
  'upload.work_target.invalid',2,'Use the current work projectId and sessionId; omit --session-id for an independent project upload.');}
export function componentUploadWorkTarget(work:ComponentUploadWork,sourceSha256:string):ComponentUploadWorkTarget{
  if(![work.projectId,work.sessionId,work.intentId].every((v,index)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=(index===1?180:160))
    ||!/^sha256:[a-f0-9]{64}$/.test(sourceSha256))throw invalid();
  // One workspace command may upload several archives. Each immutable source
  // has its own operation under the original frozen command intent.
  const operationId='component-upload-'+createHash('sha256').update(JSON.stringify([work.intentId,sourceSha256])).digest('hex');
  return{projectId:work.projectId,sessionId:work.sessionId,operationId};
}
export function assertComponentUploadWorkConfirmed(value:Record<string,unknown>,target:ComponentUploadWorkTarget){
  const actual=value.target as Record<string,unknown>|undefined;
  if(value.success!==true||value.contractVersion!=='creation-component-upload/v1'||!actual
    ||Object.keys(actual).length!==3||actual.projectId!==target.projectId||actual.sessionId!==target.sessionId||actual.operationId!==target.operationId)
    throw new PromptFrameCliError('The platform did not confirm the original work upload target. No source archive was sent.',
      'upload.work_target.unconfirmed',2,'Check the original work and account. Do not silently fall back to a project-only upload.');
}
