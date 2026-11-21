import {createHash,randomBytes} from 'node:crypto';
import {realpathSync,lstatSync,openSync,constants,closeSync,fstatSync,readSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {capturePreviewResourceFile,readPreviewResourceDraft,previewResourceFileMatchesSlot,
  assertPreviewResourceParent,samePreviewResourceFile,PREVIEW_RESOURCE_DRAFT_TTL_MS,type PreviewResourceSelection} from './preview-resource-draft.js';
import {selectionSlot} from './preview-resource-server.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const studioFileTargetPattern = new RegExp('^' + uuid + '/' + uuid + '$', 'u');
export const studioFilePagePattern = new RegExp('^' + uuid + '$', 'u');
type Origin = {moduleId:string; prop:string; fileTarget?:never} | {fileTarget:string; moduleId?:never; prop?:never};
export type DevelopmentPreviewResource = Origin & {
  resourceId:string; sha256:string; sizeBytes:number; contentType:'model/gltf-binary';
  expiresAt:string; watch:boolean; diagnostic?:string;
};
type File = NonNullable<PreviewResourceSelection['file']>;
type Slot = ReturnType<typeof selectionSlot>;
type Entry = {identity:string; file:File; bytes:Buffer; row:DevelopmentPreviewResource};
type Input = {key:string; identity:string; origin:Origin; file:File; slot:Slot; watch:boolean; expiresAt:string};
const transportSlot:Slot = {kinds:['model'],sources:['asset']};
const maximumBytes=64*1024*1024, maximumEntries=24;

/** The connected Studio page checks the destination schema. The local owner
 * admits only an explicitly selected, bounded and self-contained file. */
export class DevelopmentPreviewResources {
  private entries = new Map<string,Entry>();
  private direct = new Map<string,Input>();
  private readonly secret = randomBytes(32);
  private closed = false;
  constructor(private readonly root:string, private readonly modules:readonly {id:string;path:string}[],
    private readonly setWatchedPaths:(paths:readonly string[])=>void=()=>{}){}

  selectTarget(fileTarget:string, path:string, watch:boolean, now=Date.now()){
    if(this.closed || !studioFileTargetPattern.test(fileTarget)) throw Error('preview.resource.target_invalid');
    this.expire(now);
    if(!this.direct.has(fileTarget)&&this.direct.size>=maximumEntries) throw Error('preview.resource.watch_memory_busy');
    const file=capturePreviewResourceFile(path);
    if(file.contentType!=='model/gltf-binary') throw Error('preview.resource.file_rejected');
    const input:Input={key:fileTarget,identity:randomBytes(16).toString('hex'),origin:{fileTarget},file,
      slot:transportSlot,watch,expiresAt:new Date(now+PREVIEW_RESOURCE_DRAFT_TTL_MS).toISOString()};
    // Validate before replacing a prior selection. A failed new selection keeps it.
    const entry=this.checked(input);
    this.entries.set(fileTarget,entry);
    this.direct.set(fileTarget,input);
    this.updateWatch();
    return {...entry.row};
  }
  clearTarget(fileTarget:string){
    if(!studioFileTargetPattern.test(fileTarget)) throw Error('preview.resource.target_invalid');
    this.direct.delete(fileTarget);
    const cleared=this.entries.delete(fileTarget);
    this.updateWatch();
    return cleared;
  }
  private checked(input:Input):Entry {
    if(input.watch) assertPreviewResourceParent(input.file);
    const actual=capturePreviewResourceFile(input.file.path);
    if(actual.contentType!=='model/gltf-binary'||!previewResourceFileMatchesSlot(input.slot,actual))
      throw Error('preview.resource.file_rejected');
    if(!input.watch&&!samePreviewResourceFile(input.file,actual)) throw Error('preview.resource.file_changed');
    const previous=this.entries.get(input.key);
    const reusable=previous?.file.sha256===actual.sha256?previous.bytes:undefined;
    const held=[...this.entries.values()].reduce((n,e)=>n+e.bytes.length,0);
    if((!previous&&this.entries.size>=maximumEntries)||held+(reusable?0:actual.size)>maximumBytes)
      throw Error('preview.resource.watch_memory_busy');
    const bytes=reusable??readChecked(actual);
    const resourceId=createHash('sha256').update(this.secret).update(input.key).update(input.identity).digest('hex');
    return {identity:input.identity,file:actual,bytes,row:{...input.origin,resourceId,sha256:actual.sha256,
      sizeBytes:actual.size,contentType:'model/gltf-binary',expiresAt:input.expiresAt,watch:input.watch}};
  }
  private updateWatch(){
    this.setWatchedPaths([...new Set([...this.entries.values()].filter(e=>e.row.watch).map(e=>e.file.path)
      .concat([...this.direct.values()].filter(i=>i.watch).map(i=>i.file.path)))]);
  }
  observe(now=Date.now(),quick=false):boolean{
    if(this.closed)return false;
    const before=JSON.stringify([...this.entries.values()].map(e=>e.row));
    this.expire(now);
    const inputs:Input[]=[...this.direct.values()];
    for(const module of this.modules){
      const directory=resolve(this.root,module.path),within=relative(realpathSync(this.root),directory);
      if(!within||isAbsolute(within)||within==='..'||within.startsWith('..'+sep))continue;
      try{
        if(realpathSync(directory)!==directory)continue;
        const draft=readPreviewResourceDraft(directory,now);
        for(const selection of draft?.selections??[]){
          if(selection.file?.contentType!=='model/gltf-binary')continue;
          try{
            const slot=selectionSlot(directory,selection);
            inputs.push({key:JSON.stringify([module.id,selection.prop]),identity:JSON.stringify([selection,slot]),
              origin:{moduleId:module.id,prop:selection.prop},file:selection.file,slot,watch:selection.watch===true,
              expiresAt:new Date(Date.parse(draft!.updatedAt)+PREVIEW_RESOURCE_DRAFT_TTL_MS).toISOString()});
          }catch{ /* A removed or rejected declaration retires its old bytes. */ }
        }
      }catch{ /* A missing or expired draft has no active selections. */ }
    }
    const seen=new Set(inputs.map(input=>input.key));
    for(const key of this.entries.keys())if(!seen.has(key))this.entries.delete(key);
    for(const input of inputs){
      let prior=this.entries.get(input.key);
      if(prior?.identity!==input.identity){this.entries.delete(input.key);prior=undefined;}
      try{
        if(input.watch)assertPreviewResourceParent(input.file);
        if(quick&&prior&&!prior.row.diagnostic){
          const stat=lstatSync(input.file.path),expected=prior.file;
          if(stat.isFile()&&stat.dev===expected.dev&&stat.ino===expected.ino&&stat.size===expected.size&&stat.mtimeMs===expected.mtimeMs)continue;
        }
        this.entries.set(input.key,this.checked(input));
      }catch(error){
        if(prior&&input.watch){
          const raw=error instanceof Error?error.message:'';
          const diagnostic=/^(?:preview[.]resource[.]|model[.])[a-z0-9_.]{1,100}$/u.test(raw)?raw:'preview.resource.watch_update_rejected';
          this.entries.set(input.key,{...prior,row:{...prior.row,diagnostic}});
        }else{
          this.entries.delete(input.key);
          if(!input.watch)this.direct.delete(input.key);
        }
      }
    }
    this.updateWatch();
    return before!==JSON.stringify([...this.entries.values()].map(e=>e.row));
  }
  snapshot(now=Date.now(),pageId?:string):readonly DevelopmentPreviewResource[]{
    return [...this.entries.values()].filter(e=>Date.parse(e.row.expiresAt)>now
      &&(!e.row.fileTarget||e.row.fileTarget.split('/')[0]===pageId)).map(e=>({...e.row}));
  }
  expire(now=Date.now()):boolean{
    let changed=false;
    for(const [key,input]of this.direct)if(Date.parse(input.expiresAt)<=now){this.direct.delete(key);changed=true;}
    for(const [key,e]of this.entries)if(Date.parse(e.row.expiresAt)<=now){this.entries.delete(key);changed=true;}
    if(changed)this.updateWatch();
    return changed;
  }
  read(resourceId:string,sha256:string,now=Date.now(),pageId?:string):Readonly<{bytes:Buffer;row:DevelopmentPreviewResource}>|undefined{
    const entry=[...this.entries.values()].find(e=>e.row.resourceId===resourceId&&e.row.sha256===sha256&&Date.parse(e.row.expiresAt)>now
      &&(!e.row.fileTarget||e.row.fileTarget.split('/')[0]===pageId));
    return entry&&{bytes:entry.bytes,row:{...entry.row}};
  }
  close(){this.closed=true;this.entries.clear();this.direct.clear();this.secret.fill(0);this.setWatchedPaths([]);}
}

function readChecked(file:NonNullable<PreviewResourceSelection['file']>):Buffer{
  const fd=openSync(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=fstatSync(fd);
    if(!before.isFile()||before.dev!==file.dev||before.ino!==file.ino||before.size!==file.size||before.mtimeMs!==file.mtimeMs)
      throw Error('preview.resource.file_changed');
    const buffer=Buffer.alloc(file.size+1);let total=0;
    while(total<buffer.length){const count=readSync(fd,buffer,total,buffer.length-total,null);if(!count)break;total+=count;}
    const bytes=buffer.subarray(0,total),after=fstatSync(fd);
    if(total!==file.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino
      ||'sha256:'+createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('preview.resource.file_changed');
    return bytes;
  }finally{closeSync(fd);}
}
