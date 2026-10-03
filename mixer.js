/* Shared mixer for iPad playback and WAV export. Runs in a Worker where available. */
(function installMixer(root){
'use strict';
function mix(project){
 const sr=44100,spb=60/project.bpm;let duration=.5,material=0;
 for(const tr of project.tracks){if(tr.voice)duration=Math.max(duration,tr.recordStart*spb+tr.voice.length/tr.sampleRate);else for(const n of tr.notes)duration=Math.max(duration,(n.start+n.dur)*spb+.22)}
 const out=new Float32Array(Math.ceil((duration+.1)*sr));let seed=123456789;
 function noise(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296*2-1}
 for(const tr of project.tracks){
  const gain=tr.volume*(tr.type==='voice'?1:project.instrumentBoost),start=Math.floor(tr.recordStart*spb*sr);
  if(tr.voice){material++;const ratio=tr.sampleRate/sr;for(let i=0;start+i<out.length;i++){const j=i*ratio,k=Math.floor(j);if(k>=tr.voice.length)break;const s=tr.voice[k]*(1-(j-k))+(tr.voice[k+1]||0)*(j-k);out[start+i]+=s*gain}continue}
  for(const n of tr.notes){material++;const st=Math.floor(n.start*spb*sr),d=n.dur*spb,f=440*2**((n.midi-69)/12),tail=tr.type==='violin'?.15:.12,end=Math.min(out.length,st+Math.ceil((d+tail)*sr));
   for(let i=st;i<end;i++){
    const t=(i-st)/sr,ph=2*Math.PI*f*t,partial=h=>f*h<sr*.48?Math.sin(ph*h):0,attack=Math.min(1,t/(tr.type==='violin'?.045:.005)),release=t<=d?1:Math.max(0,1-(t-d)/tail);let w,env;
    if(tr.type==='drums'){if(t>.25)break;w=n.midi%12<4?Math.sin(2*Math.PI*(45*t+(120-45)*.035*(1-Math.exp(-t/.035)))):noise();env=Math.exp(-t*(n.midi%12<4?18:28));}
    else if(tr.type==='piano'){w=.74*Math.sin(ph)+.19*partial(2)+.07*partial(3);env=Math.exp(-t*(1.5+f/650));}
    else if(tr.type==='bass'){w=.85*Math.sin(ph)+.12*partial(2)+.03*partial(3);env=Math.exp(-1.4*t);}
    else if(tr.type==='guitar'){w=.65*Math.sin(ph)+.21*partial(2)+.10*partial(3)+.04*partial(4);env=Math.exp(-3.5*t);}
    else if(tr.type==='violin'){w=.54*Math.sin(ph)+.24*partial(2)+.14*partial(3)+.08*partial(4);env=1;}
    else{w=Math.sin(ph);env=1;}
    out[i]+=w*env*attack*release*gain*n.vel*.38;
   }
  }
 }
 if(!material)return null;
 const master=project.masterBoost;for(let i=0;i<out.length;i++){const x=out[i]*master;out[i]=Math.abs(x)<=.85?x:Math.sign(x)*(.85+.14*(1-Math.exp(-(Math.abs(x)-.85)/.14)));}
 return {samples:out,sampleRate:sr};
}
const api={mix};api.workerSource='('+installMixer.toString()+')(self);self.onmessage=e=>{try{const r=self.KotobaMixer.mix(e.data);if(r)self.postMessage(r,[r.samples.buffer]);else self.postMessage(null)}catch(e){self.postMessage({error:e.message})}};';root.KotobaMixer=api;if(typeof module!=='undefined')module.exports=api;
})(typeof self!=='undefined'?self:globalThis);
