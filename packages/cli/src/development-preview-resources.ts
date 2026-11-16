import {createHash,randomBytes} from 'node:crypto';
import {realpathSync,lstatSync,openSync,constants,closeSync,fstatSync,readSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {capturePreviewResourceFile,readPreviewResourceDraft,previewResourceFileMatchesSlot,
  assertPreviewResourceParent,samePreviewResourceFile,PREVIEW_RESOURCE_DRAFT_TTL_MS,type PreviewResourceSelection} from './preview-resource-draft.js';
import {selectionSlot} from './preview-resource-server.js';

export interface DevelopmentPreviewResource {
  resourceId:string;
  moduleId:string;
  prop:string;
  sha256:string;
  sizeBytes:number;
  contentType:'model/gltf-binary';
  expiresAt:string;
  watch:boolean;
  diagnostic?:string;
}
type Entry={selection:string;slot:string;file:NonNullable<PreviewResourceSelection['file']>;bytes:Buffer;row:DevelopmentPreviewResource};
const maximumBytes=64*1024*1024,maximumEntries=24;

/** Selected paths stay on the author host. A checked immutable byte snapshot is
 * independent of component compilation and can be assigned to one Studio slot.
 * Watching never refreshes the original draft deadline. */
export class DevelopmentPreviewResources {
  private entries=new Map<string,Entry>();
  private readonly secret=randomBytes(32);
  private closed=false;
  constructor(private readonly root:string,private readonly modules:readonly {id:string;path:string}[],
    private readonly setWatchedPaths:(paths:readonly string[])=>void=()=>{}){}

  observe(now=Date.now(),quick=false):boolean{
    if(this.closed)return false;
    const before=JSON.stringify(this.snapshot(now)),seen=new Set<string>(),watched=new Set<string>();
    for(const module of this.modules){
      const directory=resolve(this.root,module.path),within=relative(realpathSync(this.root),directory);
      // Module roots are the existing declared workspace roots, not arbitrary
      // directories supplied by a preview request.
      if(!within||isAbsolute(within)||within==='..'||within.startsWith('..'+sep))continue;
      let draft;
      try{if(realpathSync(directory)!==directory)throw Error();draft=readPreviewResourceDraft(directory,now);}
      catch{continue;}
      for(const selection of draft?.selections??[]){
        if(selection.file?.contentType!=='model/gltf-binary')continue;
        const key=JSON.stringify([module.id,selection.prop]),identity=JSON.stringify(selection);
        seen.add(key);
        let prior=this.entries.get(key);
        if(prior?.selection!==identity){this.entries.delete(key);prior=undefined;}
        const expiresAt=new Date(Date.parse(draft!.updatedAt)+PREVIEW_RESOURCE_DRAFT_TTL_MS).toISOString();
        let slot;
        try{slot=selectionSlot(directory,selection);}
        catch{this.entries.delete(key);continue;}
        const slotIdentity=JSON.stringify(slot);
        if(prior?.slot!==slotIdentity){this.entries.delete(key);prior=undefined;}
        if(selection.watch)watched.add(selection.file.path);
        try{
          if(selection.watch)assertPreviewResourceParent(selection.file);
          if(quick&&prior&&!prior.row.diagnostic){
            const stat=lstatSync(selection.file.path),expected=prior.file;
            if(stat.isFile()&&stat.dev===expected.dev&&stat.ino===expected.ino&&stat.size===expected.size&&stat.mtimeMs===expected.mtimeMs)
              continue;
          }
          const size=this.entries.size,retained=[...this.entries.entries()].reduce((n,[k,e])=>n+(k===key?0:e.bytes.length),0);
          if(!prior&&size>=maximumEntries||retained+(prior?.bytes.length??0)+selection.file.size>maximumBytes)
            throw Error('preview.resource.watch_memory_busy');
          const actual=capturePreviewResourceFile(selection.file.path);
          if(actual.contentType!=='model/gltf-binary'||!previewResourceFileMatchesSlot(slot,actual))
            throw Error('preview.resource.file_rejected');
          if(!selection.watch&&!samePreviewResourceFile(selection.file,actual))
            throw Error('preview.resource.file_changed');
          if(retained+(prior?.bytes.length??0)+actual.size>maximumBytes)throw Error('preview.resource.watch_memory_busy');
          // A second descriptor read must produce the same exact identity and
          // digest before replacing the prior good bytes.
          const bytes=readChecked(actual);
          const resourceId=createHash('sha256').update(this.secret).update(key).update(identity).digest('hex');
          this.entries.set(key,{selection:identity,slot:slotIdentity,file:actual,bytes,row:{resourceId,moduleId:module.id,prop:selection.prop,
            sha256:actual.sha256,sizeBytes:actual.size,contentType:'model/gltf-binary',expiresAt,watch:selection.watch===true}});
        }catch(error){
          if(prior&&selection.watch){
            const raw=error instanceof Error?error.message:'';
            const diagnostic=/^(?:preview\.resource\.|model\.)[a-z0-9_.]{1,100}$/u.test(raw)?raw:'preview.resource.watch_update_rejected';
            this.entries.set(key,{...prior,row:{...prior.row,diagnostic}});
          }else this.entries.delete(key);
        }
      }
    }
    for(const key of this.entries.keys())if(!seen.has(key))this.entries.delete(key);
    this.setWatchedPaths([...watched]);
    this.snapshot(now);
    return before!==JSON.stringify(this.snapshot(now));
  }
  snapshot(now=Date.now()):readonly DevelopmentPreviewResource[]{
    return [...this.entries.values()].filter(entry=>Date.parse(entry.row.expiresAt)>now).map(entry=>({...entry.row}));
  }
  expire(now=Date.now()):boolean{
    let changed=false;
    for(const [key,entry]of this.entries)if(Date.parse(entry.row.expiresAt)<=now){this.entries.delete(key);changed=true;}
    if(changed)this.setWatchedPaths([...this.entries.values()].filter(entry=>entry.row.watch).map(entry=>entry.file.path));
    return changed;
  }
  read(resourceId:string,sha256:string,now=Date.now()):Readonly<{bytes:Buffer;row:DevelopmentPreviewResource}>|undefined{
    const entry=[...this.entries.values()].find(entry=>entry.row.resourceId===resourceId&&entry.row.sha256===sha256&&Date.parse(entry.row.expiresAt)>now);
    return entry&&{bytes:entry.bytes,row:{...entry.row}};
  }
  close():void{this.closed=true;this.entries.clear();this.secret.fill(0);this.setWatchedPaths([]);}
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
