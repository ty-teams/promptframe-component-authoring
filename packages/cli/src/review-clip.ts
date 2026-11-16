import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync, linkSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {parseArgs} from 'node:util';

function run(command:string,args:string[],capture=false):string {
  const result=spawnSync(command,args,{encoding:'utf8',stdio:capture?'pipe':'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(command+' failed ('+(result.status??result.signal)+')'+(capture?': '+result.stderr.trim().slice(-300):''));
  return result.stdout??'';
}

function integer(value:string|undefined,minimum:number,label:string):number {
  const result=Number(value);
  if(!value || !/^\d+$/.test(value) || !Number.isSafeInteger(result) || result<minimum)throw Error(label+' must be an integer >= '+minimum);
  return result;
}

/** Local, original-audio cut. Frame positions use the source composition's clock. */
export function reviewClip(args:string[]){
  const {values:v}=parseArgs({args,options:{video:{type:'string'},entry:{type:'string'},composition:{type:'string'},
    props:{type:'string'},'from-frame':{type:'string'},frames:{type:'string'},output:{type:'string'}}});
  if(Boolean(v.video)===Boolean(v.entry) || !v.output || !v.output.endsWith('.mp4'))throw Error('Select --video or --entry and an --output .mp4');
  const first=integer(v['from-frame'],0,'--from-frame'),frames=integer(v.frames,1,'--frames'),end=first+frames;
  if(!Number.isSafeInteger(end))throw Error('Frame range exceeds supported precision');
  const output=resolve(v.output);
  if(existsSync(output))throw Error('Output already exists');
  const scratch=mkdtempSync(join(dirname(output),'.promptframe-review-')),temp=join(scratch,'clip.mp4');
  try {
    if(v.video){
      if(v.props||v.composition)throw Error('--props and --composition apply to --entry');
      const video=resolve(v.video);
      const probe=JSON.parse(run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=avg_frame_rate,r_frame_rate,nb_frames','-of','json',video],true));
      const stream=probe.streams?.[0];
      const [num,den]=String(stream?.avg_frame_rate).split('/').map(Number);
      const rate=num!/den!;
      if(!Number.isFinite(rate)||rate<=0||stream.avg_frame_rate!==stream.r_frame_rate||!Number.isSafeInteger(Number(stream.nb_frames))||end>Number(stream.nb_frames))throw Error('Expected a constant-frame-rate movie containing the requested range');
      run('ffmpeg',['-v','error','-nostdin','-i',video,'-map','0:v:0','-map','0:a:0?',
        '-vf',`trim=start_frame=${first}:end_frame=${end},setpts=PTS-STARTPTS`,
        '-af',`atrim=start=${first/rate}:end=${end/rate},asetpts=PTS-STARTPTS`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',temp]);
    }else{
      if(!v.composition)throw Error('--entry requires --composition');
      const entry=resolve(v.entry!),require=createRequire(entry);
      const pkgPath=require.resolve('@remotion/cli/package.json');
      const pkg=JSON.parse(readFileSync(pkgPath,'utf8'));
      const bin=resolve(dirname(pkgPath),typeof pkg.bin==='string'?pkg.bin:pkg.bin.remotion);
      run(process.execPath,[bin,'render',entry,v.composition,temp,`--frames=${first}-${end-1}`,'--codec=h264',...(v.props?['--props='+resolve(v.props)]:[])]);
    }
    linkSync(temp,output);
    return {output,fromFrame:first,endFrameExclusive:end,frames};
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
