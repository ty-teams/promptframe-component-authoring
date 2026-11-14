import {createHash,randomBytes} from 'node:crypto';
import {constants,chmodSync,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {createConnection,createServer,type Server} from 'node:net';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

type State={version:1;connectionId:string;port?:number};
type Owner={version:1;rootDigest:string;instanceId:string;connectionId:string;pid:number;birth:string;port?:number};
const hex=/^[a-f0-9]{32}$/u;
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function birth(pid:number):string|null{
  try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return null;throw Error('development.owner.identity_unavailable');}
  try{
    if(process.platform==='linux'){
      const stat=readFileSync(`/proc/${pid}/stat`,'utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
      return readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()+':'+fields[19];
    }
    if(process.platform==='win32')return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']}).trim();
    return execFileSync('ps',['-p',String(pid),'-o','lstart=','-o','uid='],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']}).trim();
  }catch{try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return null;}throw Error('development.owner.identity_unavailable');}
}
export {birth as developmentProcessBirth};
function paths(root:string,create=false){
  root=realpathSync(root);
  const directory=join(root,'.promptframe','dev'),rootDigest=createHash('sha256').update(root).digest('hex');
  for(const path of[join(root,'.promptframe'),directory]){
    if(!existsSync(path)){if(!create)continue;mkdirSync(path,{mode:0o700});}
    const info=lstatSync(path);if(!info.isDirectory()||info.isSymbolicLink()||process.getuid&&info.uid!==process.getuid())throw Error('development.owner.directory_unsafe');
  }
  const ignored=join(directory,'.gitignore');if(create&&!existsSync(ignored))writeFileSync(ignored,'*\n',{flag:'wx',mode:0o600});
  return{directory,rootDigest,state:join(directory,'state.json'),lock:join(directory,'owner.json')};
}
function read(path:string):unknown{
  const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||process.getuid&&info.uid!==process.getuid())throw Error('development.owner.record_unsafe');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const raw=readFileSync(fd,'utf8');if(Buffer.byteLength(raw)>4096)throw Error('development.owner.record_invalid');return JSON.parse(raw);}finally{closeSync(fd);}
}
function write(path:string,value:unknown){
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
}
function endpoint(owner:Owner){
  const name=`promptframe-dev-${process.getuid?.()??'user'}-${owner.rootDigest.slice(0,24)}`;
  // Linux abstract sockets and Windows named pipes are kernel-owned: stale
  // metadata cannot require an unsafe unlink/recreate arbitration sequence.
  if(process.platform==='linux')return '\0'+name;
  return process.platform==='win32'?`\\\\.\\pipe\\${name}`:join(tmpdir(),name+'.sock');
}
function ownerAt(path:string,rootDigest:string):Owner|null{
  if(!existsSync(path))return null;
  const value=read(path)as Owner;
  if(Object.keys(value).some(key=>!['version','rootDigest','instanceId','connectionId','pid','birth','port'].includes(key))||value.version!==1||typeof value.instanceId!=='string'||typeof value.connectionId!=='string'||value.rootDigest!==rootDigest||!hex.test(value.instanceId)||!hex.test(value.connectionId)
    ||!Number.isSafeInteger(value.pid)||value.pid<1||typeof value.birth!=='string'||!value.birth||value.birth.length>256
    ||value.port!==undefined&&(!Number.isInteger(value.port)||value.port<1||value.port>65535))throw Error('development.owner.record_invalid');
  return value;
}
function same(a:Owner,b:Owner){return a.instanceId===b.instanceId&&a.pid===b.pid&&a.birth===b.birth&&a.rootDigest===b.rootDigest;}
function removeOwned(path:string,owner:Owner){const current=ownerAt(path,owner.rootDigest);if(current&&same(current,owner))unlinkSync(path);}

async function command(owner:Owner,action:'inspect'|'stop'|'replace'){
  return new Promise<Owner>((resolve,reject)=>{
    const socket=createConnection(endpoint(owner));let raw='';const timer=setTimeout(()=>socket.destroy(Error('development.owner.control_unconfirmed')),3000);
    socket.setEncoding('utf8');socket.once('connect',()=>socket.end(JSON.stringify({action,instanceId:owner.instanceId})+'\n'));
    socket.on('data',chunk=>{raw+=chunk;if(raw.length>4096)socket.destroy(Error('development.owner.control_invalid'));});
    socket.once('error',reject);socket.once('close',()=>{clearTimeout(timer);try{const result=JSON.parse(raw);if(!same(result,owner)||result.connectionId!==owner.connectionId)throw Error();resolve(result);}catch{reject(Error('development.owner.control_unconfirmed'));}});
  });
}
/** Same CLI process, filesystem-local owner control. The Studio HTTP surface
 * remains GET-only, and stop never signals a numeric PID. */
export async function stopDevelopmentOwner(root:string,reason:'stop'|'replace'='stop'){
  const p=paths(root),owner=ownerAt(p.lock,p.rootDigest);if(!owner)return{stopped:false};
  const current=birth(owner.pid);
  if(current!==owner.birth)return{stopped:false,stale:true};
  await command(owner,'inspect');let acknowledged=true;try{await command(owner,reason);}catch{acknowledged=false;}
  // A lost control reply is observed under the same identity, never resent.
  const until=Date.now()+30_000;
  while(Date.now()<until){
    const live=ownerAt(p.lock,p.rootDigest);
    if(live&&!same(live,owner))throw Error('development.owner.changed');
    if(!live&&birth(owner.pid)!==owner.birth)return{stopped:true,acknowledged};
    await wait(50);
  }
  throw Error('development.owner.close_unconfirmed');
}
export async function acquireDevelopmentOwner(root:string,onStop:(reason:'stop'|'replace'|'fatal')=>void){
  const p=paths(root,true);let state:State;
  if(!existsSync(p.state)){
    try{write(p.state,{version:1,connectionId:randomBytes(16).toString('hex')});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  }
  state=read(p.state)as State;
  if(Object.keys(state).some(key=>!['version','connectionId','port'].includes(key))||state.version!==1||typeof state.connectionId!=='string'||!hex.test(state.connectionId)||state.port!==undefined&&(!Number.isInteger(state.port)||state.port<1||state.port>65535))throw Error('development.owner.state_invalid');
  let owner:Owner={version:1,rootDigest:p.rootDigest,instanceId:randomBytes(16).toString('hex'),connectionId:state.connectionId,pid:process.pid,birth:birth(process.pid)!};
  let ownsRecord=false;
  let closing=false;const sockets=new Set<import('node:net').Socket>();let control:Server|undefined;
  try{
    control=createServer({allowHalfOpen:true},socket=>{
      sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.setTimeout(3000,()=>socket.destroy());socket.setEncoding('utf8');let raw='';
      socket.on('data',chunk=>{
        raw+=chunk;if(raw.length>1024){socket.destroy();return;}if(!raw.endsWith('\n'))return;
        try{const input=JSON.parse(raw);if(input.instanceId!==owner.instanceId||!['inspect','stop','replace'].includes(input.action))throw Error();
          socket.end(JSON.stringify(owner));if(input.action!=='inspect'&&!closing){closing=true;onStop(input.action);}
        }catch{socket.destroy();}
      });
    });
    await new Promise<void>((resolve,reject)=>{control!.once('error',reject);control!.listen(endpoint(owner),()=>{control!.removeListener('error',reject);resolve();});});
    control.on('error',()=>{if(!closing){closing=true;onStop('fatal');}});
    if(process.platform!=='win32'&&process.platform!=='linux')chmodSync(endpoint(owner),0o600);
    // All stale reclamation, new record creation and state updates happen
    // while this process owns the fixed kernel endpoint.
    const previous=ownerAt(p.lock,p.rootDigest);
    if(previous){if(birth(previous.pid)===previous.birth)throw Error('development.owner.previous_exit_unconfirmed');removeOwned(p.lock,previous);}
    write(p.lock,owner);ownsRecord=true;
    let closePromise:Promise<void>|undefined;
    return Object.freeze({connectionId:state.connectionId,
      preferredPort:state.port&&state.port>=24000&&state.port<=24999?state.port:24000+parseInt(createHash('sha256').update(state.connectionId).digest('hex').slice(0,8),16)%1000,
      recordPort(port:number){
        const current=ownerAt(p.lock,p.rootDigest);if(!current||!same(current,owner))throw Error('development.owner.changed');
        state={...state,port};owner={...owner,port};
        for(const[path,value]of[[p.state,state],[p.lock,owner]]as const){const temporary=path+'.'+owner.instanceId;write(temporary,value);renameSync(temporary,path);}
      },
      close(){return closePromise??=(async()=>{
        removeOwned(p.lock,owner);
        for(const socket of sockets)socket.destroy();await new Promise<void>((resolve,reject)=>control!.close(error=>error?reject(error):resolve()));
      })();},
    });
  }catch(error){if(ownsRecord)removeOwned(p.lock,owner);control?.close();
    if((error as NodeJS.ErrnoException).code==='EADDRINUSE')throw Error('development.owner.already_running');throw error;}
}
