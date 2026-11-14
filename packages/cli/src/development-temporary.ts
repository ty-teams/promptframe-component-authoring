import {createHash,randomBytes} from 'node:crypto';
import {constants,closeSync,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,mkdtempSync,openSync,opendirSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {developmentProcessBirth} from './development-owner.js';

type Producer={pid:number;birth:string|null;group?:number};
type RecordValue={version:1;kind:'build'|'check';nonce:string;directory:string;dev:string;ino:string;
  creator:Producer;phase:'preparing'|'launching'|'running'|'joined'|'not-started';worker:Producer|null};
const marker='.promptframe-temporary.json',active=new Set<string>();
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const fail=()=>{throw Error('development.temporary.identity_unconfirmed');};
function identity(root:string,parent=false){const s=lstatSync(root,{bigint:true});
  if(!s.isDirectory()||s.isSymbolicLink()||process.getuid&&s.uid!==BigInt(process.getuid())
    ||!parent&&process.platform!=='win32'&&(s.mode&0o022n)!==0n)fail();
  return{dev:String(s.dev),ino:String(s.ino)};
}
function parentDirectory(parent?:string){
  const value=parent??join(tmpdir(),'promptframe-development-'+(process.getuid?.()??'user'));
  if(!existsSync(value))try{mkdirSync(value,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  identity(value,true);const canonical=realpathSync(value),info=lstatSync(canonical,{bigint:true});
  if(process.platform!=='win32'&&(info.mode&0o022n)!==0n){
    // An explicit test/compiler parent may inherit a group-write umask while
    // remaining inside its creator's0700 root. Require that actual boundary;
    // a writable shared parent without one is never swept.
    let cursor=dirname(canonical),protectedByOwner=false;
    for(let depth=0;depth<128;depth++){const ancestor=lstatSync(cursor,{bigint:true});
      if(ancestor.isSymbolicLink()||!ancestor.isDirectory())fail();
      if(process.getuid&&ancestor.uid===BigInt(process.getuid())&&(ancestor.mode&0o077n)===0n){protectedByOwner=true;break;}
      const next=dirname(cursor);if(next===cursor)break;cursor=next;
    }
    if(!protectedByOwner)fail();
  }
  return canonical;
}
function parentSync(root:string){if(process.platform==='win32')return;
  const fd=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}
}
function write(root:string,value:RecordValue){const temporary=join(root,marker+'.'+value.nonce+'.new');
  const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,join(root,marker));parentSync(root);
}
function read(root:string):{value:RecordValue;digest:string}{
  const before=identity(root),file=join(root,marker),s=lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||process.getuid&&s.uid!==process.getuid()
    ||process.platform!=='win32'&&(s.mode&0o077)!==0||s.size>4096)fail();
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);let raw:string;
  try{const opened=fstatSync(fd);if(opened.dev!==s.dev||opened.ino!==s.ino)fail();raw=readFileSync(fd,'utf8');}finally{closeSync(fd);}
  const value=JSON.parse(raw!) as RecordValue;
  const producer=(v:Producer|null)=>v!==null&&Object.keys(v).every(k=>['pid','birth','group'].includes(k))
    &&Number.isSafeInteger(v.pid)&&v.pid>0&&(v.birth===null||typeof v.birth==='string'&&v.birth.length>0&&v.birth.length<=256)
    &&(v.group===undefined||Number.isSafeInteger(v.group)&&v.group===v.pid);
  if(Object.keys(value).some(k=>!['version','kind','nonce','directory','dev','ino','creator','phase','worker'].includes(k))
    ||value.version!==1||!['build','check'].includes(value.kind)||!/^[a-f0-9]{32}$/u.test(value.nonce)
    ||!basename(root).startsWith('promptframe-'+value.kind+'-')
    ||value.directory!==sha(root)||value.dev!==before.dev||value.ino!==before.ino||!producer(value.creator)||!value.creator.birth
    ||!['preparing','launching','running','joined','not-started'].includes(value.phase)||value.worker!==null&&!producer(value.worker)
    ||value.phase==='not-started'&&value.worker!==null)fail();
  return{value,digest:sha(raw!)};
}
function gone(producer:Producer){return producer.birth!==null&&developmentProcessBirth(producer.pid)!==producer.birth;}
function processGroup(pid:number){
  try{return Number(readFileSync('/proc/'+pid+'/stat','utf8').split(') ').at(-1)!.split(' ')[2]);}
  catch{return undefined;}
}
/** Linux workers have their own observed process group. Inspect every member,
 * including compiler descendants. Truncation/read failure means unknown. */
function groupEmpty(group:number):boolean|null{
  if(process.platform!=='linux')return null;
  const directory=opendirSync('/proc');let scanned=0;
  try{let entry;while((entry=directory.readSync())){if(!/^\d+$/u.test(entry.name))continue;if(++scanned>8192)return null;
    try{const fields=readFileSync('/proc/'+entry.name+'/stat','utf8').split(') ').at(-1)!.split(' ');
      if(Number(fields[2])===group&&!['Z','X'].includes(fields[0]!))return false;
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return null;}
  }return true;}finally{directory.closeSync();}
}
function retired(value:RecordValue){
  if(value.phase==='not-started')return value.worker===null;
  if(value.phase==='joined'){
    // Older writers could persist joined/null after a failed worker identity
    // write. That record does not prove NoStart or descendant exit.
    if(!value.worker)return false;
    return Boolean(value.worker.group&&gone(value.worker)&&groupEmpty(value.worker.group)===true);
  }
  if(!gone(value.creator))return false;
  if(value.phase==='preparing')return value.worker===null;
  // An interrupted spawn with no original worker identity is not NoStart.
  if(!value.worker||!value.worker.group||!gone(value.worker))return false;
  return groupEmpty(value.worker.group)===true;
}
export interface DevelopmentTemporaryRoot {
  directory:string;
  beforeSpawn():void;
  spawned(pid:number|undefined):void;
  joined(observation?:{notStarted:boolean}):void;
  release():void;
}
export interface DevelopmentTemporaryCleanup {removed:number;retained:number;unknown:number;truncated:boolean;lock:'held'|'busy'|'unsupported'}

/** A short kernel-owned mutex, using the existing dev owner's abstract-socket /
 * named-pipe pattern. It has no daemon, TCP port or stale lock-file takeover. */
export async function cleanupDevelopmentTemporaries(parent?:string):Promise<DevelopmentTemporaryCleanup>{
  const directory=parentDirectory(parent),result:DevelopmentTemporaryCleanup={removed:0,retained:0,unknown:0,truncated:false,lock:'unsupported'};
  if(!['linux','win32'].includes(process.platform))return result;
  const name='promptframe-devtmp-'+(process.getuid?.()??'user')+'-'+sha(directory).slice(0,24);
  const endpoint=process.platform==='linux'?'\0'+name:'\\\\.\\pipe\\'+name;
  const server=createServer(socket=>socket.destroy());
  const acquired=await new Promise<boolean>((resolve,reject)=>{server.once('error',error=>{
    if((error as NodeJS.ErrnoException).code==='EADDRINUSE')resolve(false);else reject(error);});server.listen(endpoint,()=>resolve(true));});
  if(!acquired){result.lock='busy';return result;}result.lock='held';
  let entries:ReturnType<typeof opendirSync>|undefined;
  try{entries=opendirSync(directory);let entry,scanned=0;while((entry=entries.readSync())){
    if(++scanned>512){result.truncated=true;break;}
    if(!/^promptframe-(?:build|check)-[A-Za-z0-9]+$/u.test(entry.name))continue;
    if(result.removed>=32){result.truncated=true;break;}
    const root=join(directory,entry.name);if(active.has(root)){result.retained++;continue;}
    try{const captured=read(root);if(!retired(captured.value)){result.retained++;continue;}
      // Identity, original producer and all group members are checked again
      // immediately before removal. A new child or uncertainty keeps the root.
      if(read(root).digest!==captured.digest||!retired(captured.value)){result.retained++;continue;}
      rmSync(root,{recursive:true});result.removed++;
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||existsSync(root))result.unknown++;}
  }}finally{try{entries?.closeSync();}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}}
  return result;
}

export async function createDevelopmentTemporary(kind:'build'|'check',parent?:string):Promise<DevelopmentTemporaryRoot>{
  const base=parentDirectory(parent),cleanup=await cleanupDevelopmentTemporaries(base);
  if(cleanup.unknown||cleanup.truncated)process.stderr.write(JSON.stringify({code:'development.temporary.cleanup_deferred',
    unknown:cleanup.unknown,retained:cleanup.retained,truncated:cleanup.truncated})+'\n');
  const directory=mkdtempSync(join(base,'promptframe-'+kind+'-')),creator={pid:process.pid,birth:developmentProcessBirth(process.pid)};
  mkdirSync(join(directory,'content'),{mode:0o700});
  if(!creator.birth)fail();
  let value:RecordValue={version:1,kind,nonce:randomBytes(16).toString('hex'),directory:sha(directory),...identity(directory),creator,phase:'preparing',worker:null};
  let released=false,spawnObservation:'unobserved'|'started'|'not-created'='unobserved';
  write(directory,value);active.add(directory);
  const update=(next:RecordValue)=>{if(released||read(directory).value.nonce!==value.nonce)fail();write(directory,next);value=next;};
  return{directory:join(directory,'content'),
    beforeSpawn(){if(value.phase!=='preparing')fail();update({...value,phase:'launching'});},
    spawned(pid){spawnObservation=pid?'started':'not-created';if(value.phase!=='launching')fail();if(!pid)return;const birth=developmentProcessBirth(pid),group=process.platform==='linux'&&processGroup(pid)===pid?pid:undefined;
      update({...value,phase:'running',worker:{pid,birth,...(group?{group}:{})}});},
    joined(observation){if(!['launching','running'].includes(value.phase))fail();
      if(value.phase==='launching'){
        if(spawnObservation!=='not-created'||observation?.notStarted!==true)fail();
        update({...value,phase:'not-started',worker:null});
      }else{if(!value.worker)fail();update({...value,phase:'joined'});}
    },
    release(){if(released)return;try{if(!existsSync(directory))return;const current=read(directory).value;
      if(current.nonce!==value.nonce||!['preparing','joined','not-started'].includes(current.phase)
        ||current.phase==='joined'&&!current.worker||current.creator.pid!==process.pid||current.creator.birth!==creator.birth)fail();
      if(process.platform==='linux'&&current.worker&&(!current.worker.group||groupEmpty(current.worker.group)!==true)){
        process.stderr.write(JSON.stringify({code:'development.temporary.producer_exit_unconfirmed',directory})+'\n');return;
      }
      rmSync(directory,{recursive:true});
    }finally{released=true;active.delete(directory);}},
  };
}
