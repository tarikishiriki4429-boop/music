/* Kotoba Music 3.1 — local monophonic pitch analysis. No network calls. */
(function installPitchEngine(root){
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));let options={};
function highpassMono(src,sr,cut=42){
  const out=new Float32Array(src.length);if(!src.length)return out;
  const a=Math.exp(-2*Math.PI*cut/sr);let px=src[0]||0,py=0;
  for(let i=0;i<src.length;i++){const x=src[i];const y=a*(py+x-px);out[i]=y;px=x;py=y}
  return out;
}
function lowpassMono(src,sr,cut){
  const out=new Float32Array(src.length);if(!src.length)return out;
  const a=1-Math.exp(-2*Math.PI*Math.min(cut,sr*.45)/sr);let y=src[0]||0;
  for(let i=0;i<src.length;i++){y+=a*(src[i]-y);out[i]=y}return out;
}
function downsampleMono(src,factor){
  if(factor<=1)return src;
  const n=Math.floor(src.length/factor),out=new Float32Array(n);
  for(let i=0;i<n;i++){let s=0;for(let j=0;j<factor;j++)s+=src[i*factor+j];out[i]=s/factor}
  return out;
}
function frameRms(buf,step=4){let s=0,n=0,mean=0;for(let i=0;i<buf.length;i+=step){mean+=buf[i];n++}mean/=Math.max(1,n);s=0;n=0;for(let i=0;i<buf.length;i+=step){const x=buf[i]-mean;s+=x*x;n++}return Math.sqrt(s/Math.max(1,n))}
function estimateNoiseGate(src,frame,hop){
  const vals=[],stride=Math.max(hop*5,Math.floor(src.length/160));
  for(let i=0;i+frame<=src.length;i+=stride)vals.push(frameRms(src.subarray(i,i+frame),4));
  vals.sort((a,b)=>a-b);
  const q10=vals[Math.floor(vals.length*.1)]||0,q80=vals[Math.floor(vals.length*.8)]||0;
  const fixed=.003/Math.sqrt(options.sensitivity||4);
  return Math.max(fixed,q10<q80*.28?Math.min(q10*2.1,q80*.17):0);
}
function parabolicMinimum(a,i){
  if(i<=1||i>=a.length-1)return i;const y1=a[i-1],y2=a[i],y3=a[i+1],den=y1-2*y2+y3;
  if(!Number.isFinite(den)||Math.abs(den)<1e-9)return i;return i+.5*(y1-y3)/den;
}
function normalizedCorr(buf,lag,mean,step=3){
  const ilag=Math.max(1,Math.round(lag));let s=0,e1=0,e2=0;
  for(let i=0;i+ilag<buf.length;i+=step){const a=buf[i]-mean,b=buf[i+ilag]-mean;s+=a*b;e1+=a*a;e2+=b*b}
  return s/Math.sqrt(Math.max(1e-12,e1*e2));
}
function tonePower(buf,sr,freq,mean){
  if(freq<=0||freq>=sr*.48)return 0;const n=Math.min(buf.length,1024),step=1;let re=0,im=0,en=0,c=0;
  for(let i=0;i<n;i+=step){const w=.5-.5*Math.cos(2*Math.PI*i/Math.max(1,n-1)),x=(buf[i]-mean)*w,a=2*Math.PI*freq*i/sr;re+=x*Math.cos(a);im-=x*Math.sin(a);en+=x*x;c++}
  return en>1e-12?(re*re+im*im)/(en*Math.max(1,c)):0;
}
function spectralSupport(buf,sr,freq,mean){
  const e=[];for(let h=1;h<=4;h++)e.push(tonePower(buf,sr,freq*h,mean));const sum=e.reduce((a,b)=>a+b,0),weighted=(e[0]||0)+.62*(e[1]||0)+.38*(e[2]||0)+.24*(e[3]||0),base=sum>1e-12?(e[0]||0)/sum:0;return {raw:weighted,base,p1:e[0]||0};
}
function yinCandidates(buf,sr,noiseGate){
  const size=buf.length;let mean=0;for(let i=0;i<size;i+=2)mean+=buf[i];mean/=Math.ceil(size/2);
  let rms=0,nr=0;for(let i=0;i<size;i+=2){const x=buf[i]-mean;rms+=x*x;nr++}rms=Math.sqrt(rms/Math.max(1,nr));
  const sens=+options.sensitivity||4,boost=clamp(1,1,256),effective=rms*Math.pow(Math.min(boost,16),.16);
  if(effective<noiseGate)return null;
  const [minFreq,maxFreq0]=recognitionBounds(),maxFreq=Math.min(maxFreq0,sr*.43);
  const tauMin=Math.max(2,Math.floor(sr/maxFreq)),tauMax=Math.min(Math.floor(sr/minFreq),Math.floor(size*.46));
  if(tauMax<=tauMin+2)return null;
  const work=Math.max(96,Math.min(size-tauMax-2,768)),sampleStep=2;
  const diff=new Float32Array(tauMax+2),cmnd=new Float32Array(tauMax+2);cmnd[0]=1;
  let running=0;
  for(let tau=1;tau<=tauMax;tau++){
    let d=0,c=0;for(let i=0;i<work;i+=sampleStep){const z=(buf[i]-mean)-(buf[i+tau]-mean);d+=z*z;c++}
    d/=Math.max(1,c);diff[tau]=d;running+=d;cmnd[tau]=running>1e-12?d*tau/running:1;
  }
  const threshold=clamp(.16+Math.log2(Math.max(1,sens))*.020,.16,.28),locals=[];
  let globalTau=tauMin,globalVal=cmnd[tauMin];
  for(let tau=tauMin+1;tau<tauMax;tau++){
    if(cmnd[tau]<globalVal){globalVal=cmnd[tau];globalTau=tau}
    if(cmnd[tau]<=cmnd[tau-1]&&cmnd[tau]<cmnd[tau+1])locals.push(tau);
  }
  let firstGood=null;
  for(const tau of locals){if(cmnd[tau]<threshold){firstGood=tau;break}}
  if(firstGood==null&&globalVal>.36)return null;
  const bestVal=Math.min(globalVal,firstGood==null?1:cmnd[firstGood]);
  let pool=locals.filter(t=>cmnd[t]<=Math.min(.44,bestVal+.18));
  if(firstGood!=null&&!pool.includes(firstGood))pool.push(firstGood);
  if(!pool.includes(globalTau))pool.push(globalTau);
  // A strong second harmonic can produce a half-period minimum. If a deeper minimum exists near 2x,
  // keep it as an explicit candidate so the temporal path can choose the true fundamental.
  for(const t of [...pool]){
    const lo=Math.max(tauMin,Math.round(t*1.86)),hi=Math.min(tauMax,Math.round(t*2.14));let bt=-1,bv=1;
    for(let k=lo;k<=hi;k++)if(cmnd[k]<bv){bv=cmnd[k];bt=k}
    if(bt>0&&bv<Math.min(.38,cmnd[t]+.055)&&!pool.some(x=>Math.abs(x-bt)<=2))pool.push(bt);
  }
  pool.sort((a,b)=>cmnd[a]-cmnd[b]);pool=pool.slice(0,6);if(firstGood!=null&&!pool.some(x=>Math.abs(x-firstGood)<=1))pool.push(firstGood);if(!pool.some(x=>Math.abs(x-globalTau)<=1))pool.push(globalTau);
  const candidates=[];
  for(const tau0 of pool){
    const tau=parabolicMinimum(cmnd,tau0),freq=sr/tau;if(freq<minFreq||freq>maxFreq)continue;
    const corr=normalizedCorr(buf,tau,mean,4),q=clamp((1-cmnd[tau0])*.72+Math.max(0,corr)*.28,0,1);
    if(q<.65)continue;
    const midi=69+12*Math.log2(freq/440);if(!Number.isFinite(midi))continue;
    if(candidates.some(c=>Math.abs(c.midi-midi)<.22))continue;
    const sp=spectralSupport(buf,sr,freq,mean);candidates.push({freq,midi,q,y:cmnd[tau0],corr,tau,first:firstGood!=null&&Math.abs(tau0-firstGood)<=1,specRaw:sp.raw,base:sp.base,p1:sp.p1});
  }
  if(!candidates.length)return null;
  // If the true pitch is high, YIN can sometimes keep only an octave-lower period.
  // Add an octave-up hypothesis when there is clear spectral energy there; the octave evidence below decides between them.
  for(const c of [...candidates]){
    const uf=c.freq*2;if(c.midi+12<80||uf>maxFreq||uf>=sr*.44||candidates.some(x=>Math.abs(x.midi-(c.midi+12))<.45))continue;
    const upP=tonePower(buf,sr,uf,mean);if(upP<Math.max(.0025,(c.p1||0)*1.35))continue;
    const sp=spectralSupport(buf,sr,uf,mean),ratio=upP/(upP+(c.p1||0)+1e-9),q=clamp(.78+.12*ratio+.04*c.q,.50,.94);
    candidates.push({freq:uf,midi:c.midi+12,q,y:Math.min(.36,(c.y||0)+.08),corr:c.corr,tau:c.tau/2,first:false,specRaw:sp.raw,base:sp.base,p1:sp.p1,synthetic:true});
  }
  const maxSpec=Math.max(1e-9,...candidates.map(c=>c.specRaw||0));for(const c of candidates){c.spec=clamp((c.specRaw||0)/maxSpec,0,1);c.oct=0}
  // Resolve the most common voice error: confusing f0 with 2*f0 or f0/2.
  // A real lower fundamental leaves measurable spectral energy at half the higher candidate.
  for(const hi of candidates){
    const lo=candidates.find(c=>{const d=hi.midi-c.midi;return d>11.45&&d<12.55});if(!lo||hi.p1<.001)continue;
    const ratio=(lo.p1||0)/Math.max(1e-9,hi.p1||0);
    if(ratio<.0035)hi.oct+=.245;
    else if(ratio<.015)hi.oct+=.245*(.015-ratio)/.0115;
    else if(ratio>.024)lo.oct+=Math.min(.09,.025+(ratio-.024)*1.35);
  }
  return {rms,candidates};
}
function choosePitchPath(raw){
  const out=new Array(raw.length).fill(null);let i=0;
  while(i<raw.length){while(i<raw.length&&!raw[i])i++;if(i>=raw.length)break;let j=i;while(j<raw.length&&raw[j])j++;
    const block=raw.slice(i,j),scores=[],backs=[];
    for(let t=0;t<block.length;t++){
      const cs=block[t].candidates,sc=new Float64Array(cs.length),bk=new Int16Array(cs.length);bk.fill(-1);
      for(let k=0;k<cs.length;k++){
        const emit=(cs[k].resolution==='short'?.035:0)+cs[k].q-(cs[k].y||0)*.035+(cs[k].oct||0)+(cs[k].spec||0)*.10+(cs[k].first?.04:0);
        if(t===0){sc[k]=emit;continue}
        let best=-1e9,bi=-1;const pcs=block[t-1].candidates,ps=scores[t-1];
        for(let p=0;p<pcs.length;p++){
          const d=Math.abs(cs[k].midi-pcs[p].midi),oct=Math.abs(d-12)<1.25||Math.abs(d-24)<1.4;
          let penalty=Math.min(.22,d*.012);if(d<1.2)penalty*=.32;else if(d<3)penalty*=.62;if(oct)penalty+=.07;if(options.trackingMode==='fast'){penalty*=.35;if(cs[k].q>.92&&cs[k].spec>.6)penalty*=.35;}
          const v=ps[p]-penalty;if(v>best){best=v;bi=p}
        }
        sc[k]=best+emit;bk[k]=bi;
      }
      scores.push(sc);backs.push(bk);
    }
    let k=0,last=scores[scores.length-1];for(let x=1;x<last.length;x++)if(last[x]>last[k])k=x;
    for(let t=block.length-1;t>=0;t--){const f=block[t],c=f.candidates[k];out[i+t]={t:f.t,m:c.midi,r:f.rms,c:c.q,freq:c.freq};k=backs[t][k];if(k<0&&t>0){const ps=scores[t-1];k=0;for(let x=1;x<ps.length;x++)if(ps[x]>ps[k])k=x}}
    i=j;
  }
  return out;
}
function repairPitchTrack(frames){
  const x=frames.map(f=>f?{...f}:null);
  // Remove one/two-frame pitch spikes, especially octave mistakes, when both sides agree.
  for(let i=1;i<x.length-1;i++){
    if(!x[i]||!x[i-1]||!x[i+1])continue;const a=x[i-1].m,b=x[i].m,c=x[i+1].m;
    if(Math.abs(a-c)<1.2&&Math.abs(b-(a+c)/2)>3.5)x[i].m=(a+c)/2;
  }
  for(let i=1;i<x.length-2;i++){
    if(!x[i-1]||!x[i]||!x[i+1]||!x[i+2])continue;const a=x[i-1].m,d=x[i+2].m;
    if(Math.abs(a-d)<1.0&&Math.abs(x[i].m-a)>5&&Math.abs(x[i+1].m-a)>5){x[i].m=(a+d)/2;x[i+1].m=(a+d)/2}
  }
  // A small median only among nearby pitches kills vibrato jitter without smearing real note changes.
  const y=x.map((f,i)=>{if(!f)return null;const near=[];for(let j=Math.max(0,i-2);j<=Math.min(x.length-1,i+2);j++)if(x[j]&&Math.abs(x[j].m-f.m)<3.0)near.push(x[j].m);near.sort((a,b)=>a-b);return near.length?{...f,m:near[Math.floor(near.length/2)]}:f});
  return y;
}
function weightedMedianPitch(frames){
  const a=[];for(const f of frames)if(f)for(let n=0;n<Math.max(1,Math.round((f.c||.5)*4));n++)a.push(f.m);
  if(!a.length)return null;a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)];
}
function filterIntermediate(notes,level){
  if(!level||notes.length<3)return notes;
  const cfg=[null,{max:.060,anchor:.090,step:1,passes:1},{max:.110,anchor:.090,step:2,passes:3},{max:.170,anchor:.080,step:3,passes:4}][level];
  const a=notes.map(n=>({...n}));
  for(let pass=0;pass<cfg.passes;pass++){
    let changed=false;
    for(let i=1;i<a.length-1;i++){
      const p=a[i-1],c=a[i],n=a[i+1];
      if(c.protectShort||c.end-c.start>cfg.max||c.start-p.end>.035||n.start-c.end>.035||c.reattack||n.reattack)continue;
      if(p.end-p.start<cfg.anchor||n.end-n.start<cfg.anchor)continue;
      const same=p.midi===n.midi&&Math.abs(c.midi-p.midi)<=cfg.step+1;
      const between=(c.midi-p.midi)*(n.midi-c.midi)>0&&Math.abs(c.midi-p.midi)<=cfg.step&&Math.abs(n.midi-c.midi)<=cfg.step;
      if(!same&&!between)continue;
      if(same){p.end=n.end;p.confidence=(p.confidence+n.confidence)/2;a.splice(i,2)}
      else{const split=(c.start+c.end)/2;p.end=split;n.start=split;a.splice(i,1)}
      changed=true;i=Math.max(0,i-2);
    }
    if(!changed)break;
  }
  return a;
}
function segmentFrames(frames,hop,gate,opt){
  const fast=opt.trackingMode==='fast',level=clamp(+opt.stabilize||0,0,3),hold=(fast?[0,.010,.020,.035]:[0,.030,.055,.085])[level],dead=[0,.08,.14,.20][level],min=+opt.minNoteMs/1000||.050;
  const notes=[];let cur=null,pending=[],missing=0,last=null;
  function close(){if(!cur)return;if(cur.end-cur.start+1e-8>=min){const med=weightedMedianPitch(cur.frames),pitches=cur.frames.map(x=>x.m),spread=Math.max(...pitches)-Math.min(...pitches);notes.push({start:cur.start,end:cur.end,midi:cur.midi,vel:clamp(.3+Math.sqrt(cur.energy/cur.frames.length)*1.8,.3,1),confidence:cur.frames.reduce((a,f)=>a+f.c,0)/cur.frames.length,uncertain:spread>1.3,protectShort:fast&&cur.frames.filter(f=>f.c>.90&&Math.abs(f.m-cur.midi)<.22).length*hop>=.025,reattack:cur.reattack})}cur=null;}
  function begin(f,m,reattack=false){cur={midi:m,start:f.t,end:f.t+hop,frames:[f],energy:f.r*f.r,reattack};}
  function add(f){cur.end=f.t+hop;cur.frames.push(f);cur.energy+=f.r*f.r;}
  for(let i=0;i<frames.length;i++){
    const f=frames[i];
    if(!f){pending=[];missing++;if(missing*hop>.025){close();last=null}continue}
    if(missing*hop>.025)last=null;missing=0;
    let m=Math.round(f.m);if(cur&&Math.abs(f.m-cur.midi)<=.5+dead)m=cur.midi;
    const onset=cur&&last&&m===cur.midi&&f.r>last.r*2.2&&last.r<Math.max(gate*2,f.r*.4)&&f.t-cur.start>.1;
    if(!cur){begin(f,m);pending=[]}
    else if(onset){close();begin(f,m,true);pending=[]}
    else if(m===cur.midi){for(const p of pending)add(p);pending=[];add(f)}
    else{
      if(pending.length&&Math.round(pending[0].m)!==m){for(const p of pending)add(p);pending=[]}
      pending.push(f);
      if(pending.length*hop+1e-8>=hold){const first=pending[0];close();begin(first,m);for(let j=1;j<pending.length;j++)add(pending[j]);pending=[]}
    }
    last=f;
  }
  if(cur){for(const p of pending)add(p);close()}
  return filterIntermediate(notes,clamp(+opt.intermediateFilter||0,0,3));
}
async function analyze(samples,sampleRate,opt={},progress=()=>{}){
  options=opt;
  const target=opt.recognitionRange==='high'?22050:opt.recognitionRange==='low'?9000:14000;
  // Filter before decimation so ultrasonic/high partials cannot alias into melody pitches.
  const factor=Math.max(1,Math.floor(sampleRate/target));
  const pre=factor>1?lowpassMono(lowpassMono(samples,sampleRate,sampleRate/factor*.4),sampleRate,sampleRate/factor*.4):samples;
  const sr=sampleRate/factor,down=downsampleMono(pre,factor),[minFreq,maxFreq]=recognitionBoundsFromOpt(opt);
  const filtered=lowpassMono(highpassMono(down,sr,Math.max(24,minFreq*.55)),sr,Math.min(sr*.42,maxFreq*2.6));
  const frame=Math.max(512,Math.pow(2,Math.ceil(Math.log2(sr/minFreq*2.5)))),hop=Math.round(sr*(opt.trackingMode==='fast'?.005:.01)),gate=estimateNoiseGate(filtered,Math.min(frame,filtered.length),hop);
  const raw=[],window=new Float32Array(frame),half=Math.floor(frame/2),shortSize=Math.max(256,2**Math.round(Math.log2(sr*.024))),shortWindow=new Float32Array(shortSize),shortHalf=shortSize/2;
  for(let pos=0,count=0;pos<filtered.length;pos+=hop,count++){
    window.fill(0);const start=Math.max(0,pos-half),end=Math.min(filtered.length,pos+half);window.set(filtered.subarray(start,end),Math.max(0,half-pos));
    const energy=frameRms(filtered.subarray(pos,Math.min(filtered.length,pos+hop)),1);
    let p=energy>gate?yinCandidates(window,sr,gate):null;
    if(opt.trackingMode==='fast'&&energy>gate){
      shortWindow.fill(0);const a=Math.max(0,pos-shortHalf),b=Math.min(filtered.length,pos+shortHalf);shortWindow.set(filtered.subarray(a,b),Math.max(0,shortHalf-pos));
      const short=yinCandidates(shortWindow,sr,gate);
      if(short){const merged=short.candidates.map(c=>({...c,resolution:'short'}));if(p)for(const c of p.candidates)if(!merged.some(v=>Math.abs(v.midi-c.midi)<.25))merged.push(c);p={rms:energy,candidates:merged};}
    }
    raw.push(p?{t:pos/sr,rms:energy,candidates:p.candidates}:null);
    if(count%160===0){progress(Math.round(pos/filtered.length*82));await new Promise(r=>setTimeout(r,0))}
  }
  progress(85);
  let frames=choosePitchPath(raw);
  if(+opt.stabilize>0&&opt.trackingMode!=='fast')frames=repairPitchTrack(frames);
  const notes=segmentFrames(frames,hop/sr,gate,opt).map(n=>({...n,end:Math.min(n.end,samples.length/sampleRate)}));
  progress(100);
  return {notes,gate,frames:frames.length,duration:samples.length/sampleRate,lowConfidence:notes.filter(n=>n.confidence<.82||n.uncertain).length};
}
function recognitionBoundsFromOpt(opt){return opt.recognitionRange==='low'?[35,900]:opt.recognitionRange==='high'?[100,3000]:opt.recognitionRange==='wide'?[35,3500]:[50,2200]}
function recognitionBounds(){return recognitionBoundsFromOpt(options)}
const api={analyze,segmentFrames,filterIntermediate,yinCandidates};
api.workerSource='('+installPitchEngine.toString()+')(self);self.onmessage=async e=>{try{const result=await self.KotobaPitch.analyze(e.data.samples,e.data.sampleRate,e.data.opt,p=>self.postMessage({progress:p}));self.postMessage({result})}catch(err){self.postMessage({error:err.message})}};';
root.KotobaPitch=api;
if(typeof module!=='undefined')module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
