(()=>{
'use strict';
const $=s=>document.querySelector(s), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TYPES={voice:'ボイス',piano:'ピアノ',bass:'ベース',guitar:'ギター',violin:'ヴァイオリン',drums:'ドラム'};
const SOL=['ド','ド♯','レ','レ♯','ミ','ファ','ファ♯','ソ','ソ♯','ラ','ラ♯','シ'];
const LET=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
let state={bpm:100,labelMode:'letter',snap:.25,rangeMode:'normal',masterBoost:2,zoom:1,outputMode:'compat',tracks:[],selectedTrack:null,selectedNote:null};
let audioCtx=null, activeNodes=[], isPlaying=false, playStartCtx=0, playStartBeat=0, raf=0;
let pinchActive=false,pinchSerial=0;
let mediaRecorder=null, mediaStream=null, rawMediaStream=null, recordGraph=null, recordAnalyser=null, chunks=[], currentRecordingBlob=null, currentRecordingBuffer=null, recStart=0, recMeterRAF=0;
let compatObjectURL=null;
const BASE_CELL_W=30,BASE_CELL_H=24,KEYS_W=74,TOTAL_BEATS=80;let CELL_W=BASE_CELL_W,CELL_H=BASE_CELL_H;
function uid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4)}
function midiToFreq(m){return 440*Math.pow(2,(m-69)/12)}
function midiLabel(m,mode=state.labelMode){const pc=((m%12)+12)%12,oct=Math.floor(m/12)-1;return (mode==='solfege'?SOL[pc]:LET[pc])+oct}
function range(){if(state.rangeMode==='extreme')return [0,127];if(state.rangeMode==='full')return [12,120];if(state.rangeMode==='vocal')return [36,84];return [24,108]}
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),1500)}
function ensureAudio(){if(!audioCtx||audioCtx.state==='closed')audioCtx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});return audioCtx}
async function unlockAudio(){const ctx=ensureAudio();try{if(ctx.state!=='running')await ctx.resume()}catch{}if(ctx.state==='running'&&!ctx._kotobaUnlocked){try{const b=ctx.createBuffer(1,1,ctx.sampleRate),src=ctx.createBufferSource(),g=ctx.createGain();src.buffer=b;g.gain.value=0;src.connect(g);g.connect(ctx.destination);src.start();ctx._kotobaUnlocked=true}catch{}}return ctx}
function masterBoost(){return clamp(+($('#masterBoost')?.value||state.masterBoost||2),.25,4)}
function makeOutput(ctx,base=1){const g=ctx.createGain(),c=ctx.createDynamicsCompressor();g.gain.value=base*masterBoost();c.threshold.value=-10;c.knee.value=18;c.ratio.value=5;c.attack.value=.003;c.release.value=.18;g.connect(c);c.connect(ctx.destination);activeNodes.push(g,c);return g}
function applyZoom(z,rerender=true){state.zoom=clamp(Math.round(z*4)/4,.5,3);CELL_W=BASE_CELL_W*state.zoom;CELL_H=BASE_CELL_H*state.zoom;document.documentElement.style.setProperty('--cellW',CELL_W+'px');document.documentElement.style.setProperty('--cellH',CELL_H+'px');const lab=$('#zoomLabel');if(lab)lab.textContent=Math.round(state.zoom*100)+'%';const reset=$('#zoomResetBtn');if(reset)reset.textContent=Math.round(state.zoom*100)+'%';if(rerender)renderRoll();saveSilent()}
function toggleEditorExpand(){const card=$('#editorCard'),on=!card.classList.contains('expanded');card.classList.toggle('expanded',on);document.body.classList.toggle('editorExpanded',on);$('#expandEditorBtn').textContent=on?'× 通常表示':'⛶ 拡大編集';requestAnimationFrame(()=>{renderRoll();const n=currentNote();if(n)scrollNoteIntoView(n)})}
function initPinchZoom(){
  const wrap=$('#rollWrap'),roll=$('#roll');if(!wrap||!roll)return;
  let pinching=false,startDist=0,startZoom=1,targetZoom=1,originX=0,originY=0,startScrollLeft=0,startScrollTop=0;
  const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  const center=t=>({x:(t[0].clientX+t[1].clientX)/2,y:(t[0].clientY+t[1].clientY)/2});
  wrap.addEventListener('touchstart',e=>{
    if(e.touches.length!==2)return;
    e.preventDefault();pinching=true;pinchActive=true;pinchSerial++;wrap.classList.add('pinching');startDist=Math.max(1,dist(e.touches));startZoom=state.zoom||1;targetZoom=startZoom;
    const r=wrap.getBoundingClientRect(),c=center(e.touches);originX=wrap.scrollLeft+(c.x-r.left);originY=wrap.scrollTop+(c.y-r.top);startScrollLeft=wrap.scrollLeft;startScrollTop=wrap.scrollTop;
    roll.classList.add('pinching');roll.style.transformOrigin=`${originX}px ${originY}px`;
  },{passive:false});
  wrap.addEventListener('touchmove',e=>{
    if(!pinching||e.touches.length<2)return;
    e.preventDefault();const scale=dist(e.touches)/startDist;targetZoom=clamp(startZoom*scale,.5,3);
    const visual=targetZoom/startZoom;roll.style.transform=`scale(${visual})`;const lab=$('#zoomLabel');if(lab)lab.textContent=Math.round(targetZoom*100)+'%';
  },{passive:false});
  const finish=e=>{
    if(!pinching)return;if(e.touches&&e.touches.length>=2)return;pinching=false;pinchActive=false;wrap.classList.remove('pinching');roll.classList.remove('pinching');roll.style.transform='';roll.style.transformOrigin='';
    const oldZoom=startZoom,newZoom=clamp(Math.round(targetZoom*20)/20,.5,3),ratio=newZoom/oldZoom;
    applyZoom(newZoom,true);
    requestAnimationFrame(()=>{wrap.scrollLeft=Math.max(0,originX*ratio-(originX-startScrollLeft));wrap.scrollTop=Math.max(0,originY*ratio-(originY-startScrollTop));});
  };
  wrap.addEventListener('touchend',finish,{passive:false});wrap.addEventListener('touchcancel',finish,{passive:false});
}
function defaultTrack(type,index=1){return {id:uid(),type,name:(TYPES[type]||type)+(index>1?' '+index:''),volume:.7,mute:false,notes:[],recordBlob:null,recordBuffer:null,recordStart:0}}
function initTracks(){['voice','piano','bass','guitar','violin','drums'].forEach(t=>state.tracks.push(defaultTrack(t)));state.selectedTrack=state.tracks[1].id}
function currentTrack(){return state.tracks.find(t=>t.id===state.selectedTrack)||state.tracks[0]}
function currentNote(){const tr=currentTrack();return tr?.notes.find(n=>n.id===state.selectedNote)||null}
function saveLocal(){const compact={...state,tracks:state.tracks.map(t=>({...t,recordBlob:null,recordBuffer:null}))};localStorage.setItem('kotobaMusicV21',JSON.stringify(compact));toast('保存しました')}
function loadLocal(){try{const raw=localStorage.getItem('kotobaMusicV21')||localStorage.getItem('kotobaMusicV17')||localStorage.getItem('kotobaMusicV16');const x=JSON.parse(raw);if(x&&x.tracks){state={...state,...x};return true}}catch{}return false}
function renderTracks(){const box=$('#trackList');box.innerHTML='';state.tracks.forEach(tr=>{const d=document.createElement('div');d.className='track'+(tr.id===state.selectedTrack?' selected':'');d.innerHTML=`<div class="trackTop"><button data-sel="${tr.id}" class="ghost" style="padding:4px 7px">●</button><div class="trackName">${escapeHTML(tr.name)}</div><span class="pill">${TYPES[tr.type]}</span><button data-mute="${tr.id}" style="padding:5px 8px">${tr.mute?'M✓':'M'}</button><button data-deltrack="${tr.id}" class="danger" style="padding:5px 8px">×</button></div><label class="small">音量 ${Math.round(tr.volume*100)}%<input data-vol="${tr.id}" class="slider" type="range" min="0" max="4" step="0.05" value="${tr.volume}"></label><div class="muted">${tr.notes.length}音${tr.recordBlob?' · 録音あり':''}</div>`;box.appendChild(d)});
box.querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>{state.selectedTrack=b.dataset.sel;state.selectedNote=null;syncSelectedRecording();renderAll()});
box.querySelectorAll('[data-mute]').forEach(b=>b.onclick=()=>{const tr=state.tracks.find(t=>t.id===b.dataset.mute);tr.mute=!tr.mute;renderTracks()});
box.querySelectorAll('[data-deltrack]').forEach(b=>b.onclick=()=>{if(state.tracks.length<=1)return toast('トラックは1本以上必要です');state.tracks=state.tracks.filter(t=>t.id!==b.dataset.deltrack);if(!state.tracks.some(t=>t.id===state.selectedTrack))state.selectedTrack=state.tracks[0].id;state.selectedNote=null;renderAll()});
box.querySelectorAll('[data-vol]').forEach(r=>r.oninput=()=>{const tr=state.tracks.find(t=>t.id===r.dataset.vol);tr.volume=+r.value;r.closest('.track').querySelector('.muted').textContent=`${tr.notes.length}音${tr.recordBlob?' · 録音あり':''}`;r.parentElement.firstChild.textContent='音量 '+Math.round(tr.volume*100)+'%'});
}
function escapeHTML(s){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function renderPitchSelect(){const [lo,hi]=range(),sel=$('#notePitch');const old=+sel.value;sel.innerHTML='';for(let m=hi;m>=lo;m--){const o=document.createElement('option');o.value=m;o.textContent=midiLabel(m);sel.appendChild(o)}if(old>=lo&&old<=hi)sel.value=old}
function renderRoll(){const roll=$('#roll'),tr=currentTrack();if(!tr)return;const [lo,hi]=range();const rows=hi-lo+1,height=rows*CELL_H,width=KEYS_W+TOTAL_BEATS*CELL_W;roll.style.height=height+'px';roll.style.width=width+'px';roll.innerHTML='';
const keys=document.createElement('div');keys.className='keys';keys.style.height=height+'px';roll.appendChild(keys);const grid=document.createElement('div');grid.className='grid';grid.style.width=(TOTAL_BEATS*CELL_W)+'px';grid.style.height=height+'px';roll.appendChild(grid);
for(let i=0;i<rows;i++){const m=hi-i,y=i*CELL_H,black=[1,3,6,8,10].includes(m%12);const k=document.createElement('div');k.className='keyLabel'+(black?' black':'');k.style.top=y+'px';k.textContent=midiLabel(m);keys.appendChild(k);const r=document.createElement('div');r.className='rowLine'+(black?' black':'');r.style.top=y+'px';r.style.height=CELL_H+'px';grid.appendChild(r)}
for(let b=0;b<=TOTAL_BEATS;b++){const l=document.createElement('div');l.className='beatLine'+(b%4===0?' bar':'');l.style.left=(b*CELL_W)+'px';grid.appendChild(l)}
tr.notes.forEach(n=>{if(n.midi<lo||n.midi>hi)return;const el=document.createElement('div');el.className='note'+(n.id===state.selectedNote?' selected':'');el.dataset.id=n.id;el.style.left=(n.start*CELL_W)+'px';el.style.top=((hi-n.midi)*CELL_H+2)+'px';el.style.width=Math.max(8,n.dur*CELL_W)+'px';el.textContent=midiLabel(n.midi);const rz=document.createElement('i');rz.className='resize';el.appendChild(rz);grid.appendChild(el);attachNoteDrag(el,n,rz)});
const ph=document.createElement('div');ph.id='playhead';ph.className='playhead';ph.style.left='0px';grid.appendChild(ph);updateEditorHeader();}
function attachNoteDrag(el,n,rz){let mode='move',sx=0,sy=0,os=0,om=0,od=0,dragSerial=pinchSerial;const down=e=>{if(pinchActive)return;e.preventDefault();e.stopPropagation();dragSerial=pinchSerial;state.selectedNote=n.id;mode=(e.target===rz?'resize':'move');sx=e.clientX;sy=e.clientY;os=n.start;om=n.midi;od=n.dur;el.setPointerCapture?.(e.pointerId);renderNotePanel();document.querySelectorAll('.note').forEach(x=>x.classList.toggle('selected',x.dataset.id===n.id))};const move=e=>{if(pinchActive||dragSerial!==pinchSerial){sx=sy=0;return}if(!sx&&!sy)return;e.preventDefault();const snap=+state.snap,dx=(e.clientX-sx)/CELL_W,dy=(e.clientY-sy)/CELL_H;if(mode==='resize'){n.dur=Math.max(snap,Math.round((od+dx)/snap)*snap)}else{const [lo,hi]=range();n.start=Math.max(0,Math.round((os+dx)/snap)*snap);n.midi=clamp(Math.round(om-dy),lo,hi)};el.style.left=(n.start*CELL_W)+'px';el.style.width=Math.max(8,n.dur*CELL_W)+'px';const [lo,hi]=range();el.style.top=((hi-n.midi)*CELL_H+2)+'px';el.childNodes[0].nodeValue=midiLabel(n.midi);renderNotePanel()};const up=e=>{sx=sy=0;saveSilent()};el.onpointerdown=down;el.onpointermove=move;el.onpointerup=up;el.onclick=e=>{e.stopPropagation();state.selectedNote=n.id;renderAll()}}
function renderNotePanel(){const n=currentNote();['notePitch','noteStart','noteDur','noteVel','previewNote','deleteNote'].forEach(id=>$('#'+id).disabled=!n);if(!n)return;renderPitchSelect();$('#notePitch').value=n.midi;$('#noteStart').value=n.start;$('#noteDur').value=n.dur;$('#noteVel').value=n.vel??.75}
function updateEditorHeader(){const tr=currentTrack();$('#editorTitle').textContent=`音を編集 — ${tr?.name||''}`;$('#editorSub').textContent=`${TYPES[tr?.type]||''} / ${tr?.notes.length||0}音 / 音符を直接ドラッグできます`}
function renderAll(){renderTracks();renderPitchSelect();renderRoll();renderNotePanel();$('#bpm').value=state.bpm;$('#labelMode').value=state.labelMode;$('#snap').value=state.snap;$('#rangeMode').value=state.rangeMode;if($('#masterBoost'))$('#masterBoost').value=state.masterBoost||2;if($('#outputMode'))$('#outputMode').value=state.outputMode||'compat';if($('#zoomLabel'))$('#zoomLabel').textContent=Math.round((state.zoom||1)*100)+'%';if($('#zoomResetBtn'))$('#zoomResetBtn').textContent=Math.round((state.zoom||1)*100)+'%'}
function saveSilent(){try{const compact={...state,tracks:state.tracks.map(t=>({...t,recordBlob:null,recordBuffer:null}))};localStorage.setItem('kotobaMusicV21',JSON.stringify(compact))}catch{}}
function addNote(midi=60,start=null,dur=null){const tr=currentTrack();if(!tr)return;const last=tr.notes.reduce((a,n)=>Math.max(a,n.start+n.dur),0),snap=+state.snap;const n={id:uid(),midi,start:start??Math.round(last/snap)*snap,dur:dur??Math.max(.5,snap),vel:.75};tr.notes.push(n);state.selectedNote=n.id;renderAll();scrollNoteIntoView(n);saveSilent()}
function scrollNoteIntoView(n){requestAnimationFrame(()=>{const [lo,hi]=range(),wrap=$('#rollWrap');wrap.scrollLeft=Math.max(0,n.start*CELL_W-140);wrap.scrollTop=Math.max(0,(hi-n.midi)*CELL_H-100)})}
function scheduleOsc(ctx,dest,type,midi,start,dur,vel=0.75){if(type==='drums'){return scheduleDrum(ctx,dest,midi,start,dur,vel)}const f=midiToFreq(midi),g=ctx.createGain();g.gain.setValueAtTime(0,start);const amp=.38*vel;g.gain.linearRampToValueAtTime(amp,start+.008);let release=.12;if(type==='piano'){g.gain.exponentialRampToValueAtTime(.0008,start+Math.max(.15,dur));release=.04}else if(type==='guitar'){g.gain.exponentialRampToValueAtTime(.001,start+Math.max(.22,dur*.85));release=.04}else if(type==='bass'){g.gain.setValueAtTime(amp,start+.02);g.gain.exponentialRampToValueAtTime(.001,start+Math.max(.18,dur));release=.06}else if(type==='violin'){g.gain.setValueAtTime(amp*.65,start+.06);g.gain.linearRampToValueAtTime(amp*.8,start+.16);g.gain.exponentialRampToValueAtTime(.001,start+dur+release)}else{g.gain.exponentialRampToValueAtTime(.001,start+Math.max(.18,dur))}
g.connect(dest);const oscs=[];function osc(wave,mult,level,det=0){const o=ctx.createOscillator(),og=ctx.createGain();o.type=wave;o.frequency.value=f*mult;o.detune.value=det;og.gain.value=level;o.connect(og);og.connect(g);o.start(start);o.stop(start+dur+release+.1);oscs.push(o)}
if(type==='piano'){osc('triangle',1,.9);osc('sine',2,.35);osc('sine',3,.15)}else if(type==='bass'){osc('sawtooth',1,.45);osc('sine',.5,.6)}else if(type==='guitar'){osc('sawtooth',1,.45,-4);osc('triangle',2,.25,4);osc('sine',3,.12)}else if(type==='violin'){osc('sawtooth',1,.42,-5);osc('sawtooth',1,.42,5);osc('triangle',2,.18)}else{osc('sine',1,.8);osc('triangle',2,.16)}
activeNodes.push(...oscs,g);return g}
function scheduleDrum(ctx,dest,midi,start,dur,vel){const pc=midi%12;if(pc<4){const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.setValueAtTime(130,start);o.frequency.exponentialRampToValueAtTime(45,start+.12);g.gain.setValueAtTime(.5*vel,start);g.gain.exponentialRampToValueAtTime(.001,start+.2);o.connect(g);g.connect(dest);o.start(start);o.stop(start+.21);activeNodes.push(o,g)}else{const len=Math.floor(ctx.sampleRate*.12),buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);const s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();s.buffer=buf;f.type='highpass';f.frequency.value=pc>8?5000:1200;g.gain.setValueAtTime(.22*vel,start);g.gain.exponentialRampToValueAtTime(.001,start+.12);s.connect(f);f.connect(g);g.connect(dest);s.start(start);activeNodes.push(s,f,g)}}
async function playWebAudio(fromBeat=0){stop(false);const ctx=await unlockAudio();if(ctx.state!=='running'){toast('音声出力を開始できませんでした');return}const master=makeOutput(ctx,.9);const bpm=+state.bpm||100,spb=60/bpm;playStartCtx=ctx.currentTime+.06;playStartBeat=fromBeat;state.tracks.forEach(tr=>{if(tr.mute)return;const tg=ctx.createGain();tg.gain.value=tr.volume;tg.connect(master);activeNodes.push(tg);if(tr.type==='voice'&&tr.recordBuffer){const rs=tr.recordStart||0,re=rs+tr.recordBuffer.duration/spb;if(re>fromBeat){const src=ctx.createBufferSource();src.buffer=tr.recordBuffer;src.connect(tg);const offset=Math.max(0,(fromBeat-rs)*spb),when=playStartCtx+Math.max(0,rs-fromBeat)*spb;try{src.start(when,offset)}catch{}activeNodes.push(src)}}tr.notes.forEach(n=>{if(n.start+n.dur<fromBeat)return;const start=playStartCtx+Math.max(0,n.start-fromBeat)*spb,dur=Math.max(.04,n.dur*spb);scheduleOsc(ctx,tg,tr.type,n.midi,start,dur,n.vel)})});isPlaying=true;tick()}
async function play(fromBeat=0){const mode=$('#outputMode')?.value||state.outputMode||'compat';if(mode==='compat'||isIPadLike())return playCompat();return playWebAudio(fromBeat)}
function stop(reset=true){isPlaying=false;cancelAnimationFrame(raf);const ca=$('#compatPlayer');if(ca){try{ca.pause()}catch{}};activeNodes.forEach(n=>{try{n.stop?.()}catch{}try{n.disconnect?.()}catch{}});activeNodes=[];if(reset){$('#time').textContent='00:00.0';const p=$('#playhead');if(p)p.style.left='0px'}}
function tick(){if(!isPlaying)return;const ctx=ensureAudio(),bpm=+state.bpm||100,beat=playStartBeat+(ctx.currentTime-playStartCtx)*bpm/60,t=Math.max(0,(beat*60/bpm));$('#time').textContent=fmt(t);const p=$('#playhead');if(p)p.style.left=(Math.max(0,beat)*CELL_W)+'px';if(beat>TOTAL_BEATS+2)return stop();raf=requestAnimationFrame(tick)}
function fmt(t){const m=Math.floor(t/60),s=t-m*60;return String(m).padStart(2,'0')+':'+s.toFixed(1).padStart(4,'0')}
async function preview(n=currentNote()){if(!n)return;const tr=currentTrack(),sr=22050,d=.75,x=new Float32Array(Math.floor(sr*d)),f=midiToFreq(n.midi);for(let i=0;i<x.length;i++){const t=i/sr;x[i]=synthSample(tr.type,f,t,.55)*clamp(n.vel||.75,.1,1)*.6}return playCompatBlob(floatMonoToWav(x,sr),'選択音')}
function setAudioStatus(t){const e=$('#audioStatus');if(e)e.textContent=t}
function floatMonoToWav(samples,sr=22050){const ab=new ArrayBuffer(44+samples.length*2),v=new DataView(ab);let p=0;const ws=x=>{for(let i=0;i<x.length;i++)v.setUint8(p++,x.charCodeAt(i))},u32=x=>{v.setUint32(p,x,true);p+=4},u16=x=>{v.setUint16(p,x,true);p+=2};ws('RIFF');u32(36+samples.length*2);ws('WAVE');ws('fmt ');u32(16);u16(1);u16(1);u32(sr);u32(sr*2);u16(2);u16(16);ws('data');u32(samples.length*2);for(let i=0;i<samples.length;i++){const x=clamp(samples[i],-1,1);v.setInt16(p,x<0?x*32768:x*32767,true);p+=2}return new Blob([ab],{type:'audio/wav'})}
function setCompatSource(blob,label='音声'){const a=$('#compatPlayer');if(!a)return null;if(compatObjectURL)URL.revokeObjectURL(compatObjectURL);compatObjectURL=URL.createObjectURL(blob);a.src=compatObjectURL;a.muted=false;a.volume=1;a.load();setAudioStatus(label+'を準備しました');return a}
async function playCompatBlob(blob,label='音声'){const a=setCompatSource(blob,label);if(!a)return false;try{await a.play();setAudioStatus(label+'を再生中');return true}catch(e){console.warn(e);setAudioStatus('下のプレイヤーの▶を押してください');toast('下のiPad互換プレイヤーの▶を押してください');return false}}
function testToneBlob(){const sr=22050,d=.8,n=Math.floor(sr*d),x=new Float32Array(n);for(let i=0;i<n;i++){const t=i/sr,env=Math.min(1,t/.015)*Math.max(0,1-t/d);x[i]=Math.sin(2*Math.PI*440*t)*.72*env}return floatMonoToWav(x,sr)}
async function testTone(){await playCompatBlob(testToneBlob(),'440Hzテスト音');toast('テスト音を再生')}
function isIPadLike(){return /iPad|iPhone|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)}
function synthSample(type,f,t,dur){const ph=2*Math.PI*f*t;const saw=2*((t*f)%1)-1;const tri=2*Math.abs(2*((t*f)%1)-1)-1;let w=0,env=1;if(type==='piano'){w=.72*Math.sin(ph)+.22*Math.sin(ph*2)+.08*Math.sin(ph*3);env=Math.exp(-4.4*t/Math.max(.12,dur))}else if(type==='bass'){w=.68*Math.sin(ph)+.23*saw;env=Math.exp(-2.5*t/Math.max(.15,dur))}else if(type==='guitar'){w=.48*saw+.36*Math.sin(ph)+.12*Math.sin(ph*2);env=Math.exp(-5*t/Math.max(.16,dur))}else if(type==='violin'){w=.44*saw+.42*Math.sin(ph)+.12*Math.sin(ph*2);env=Math.min(1,t/.07)*Math.max(.1,1-t/(dur+.18))}else{w=.84*Math.sin(ph)+.14*Math.sin(ph*2);env=Math.max(.08,1-t/(dur+.12))}return w*env}
function renderCompatSong(){const sr=22050,bpm=+state.bpm||100,spb=60/bpm;let endBeat=.5;for(const tr of state.tracks){for(const n of tr.notes)endBeat=Math.max(endBeat,n.start+n.dur+.35);if(tr.recordBuffer)endBeat=Math.max(endBeat,(tr.recordStart||0)+tr.recordBuffer.duration/spb)}const dur=Math.min(300,endBeat*spb+.35),out=new Float32Array(Math.max(1,Math.ceil(dur*sr)));let material=0;
  const add=(i,v)=>{if(i>=0&&i<out.length)out[i]+=v};
  for(const tr of state.tracks){if(tr.mute)continue;const tg=clamp(tr.volume,0,4);
    if(tr.type==='voice'&&tr.recordBuffer){material++;const b=tr.recordBuffer,ch=b.getChannelData(0),start=Math.floor((tr.recordStart||0)*spb*sr),ratio=b.sampleRate/sr;let peak=0;for(let j=0;j<ch.length;j+=Math.max(1,Math.floor(ch.length/8000)))peak=Math.max(peak,Math.abs(ch[j]));const norm=peak>0?Math.min(8,.82/peak):1;for(let i=0;start+i<out.length;i++){const j=Math.floor(i*ratio);if(j>=ch.length)break;add(start+i,ch[j]*tg*norm*.78)}}
    for(const n of tr.notes){material++;const st=Math.floor(n.start*spb*sr),nd=Math.min(out.length,Math.ceil((n.start*spb+n.dur*spb+.18)*sr)),f=midiToFreq(n.midi),vel=clamp(n.vel||.75,.05,1);if(tr.type==='drums'){for(let i=st;i<nd;i++){const t=(i-st)/sr;if(t>.25)break;const pc=n.midi%12;let v;if(pc<4){v=Math.sin(2*Math.PI*(120-280*t)*t)*Math.exp(-18*t)}else{v=(Math.random()*2-1)*Math.exp(-24*t)}add(i,v*tg*vel*.52)}continue}for(let i=st;i<nd;i++){const t=(i-st)/sr;add(i,synthSample(tr.type,f,t,n.dur*spb)*tg*vel*.34)}}
  }
  if(!material)return null;let peak=0;for(let i=0;i<out.length;i++)peak=Math.max(peak,Math.abs(out[i]));if(peak>0){const target=.92,scale=Math.min(12,target/peak)*clamp(masterBoost()/1.5,.75,2.6);for(let i=0;i<out.length;i++)out[i]=Math.tanh(out[i]*scale)}return floatMonoToWav(out,sr)}
async function playCompat(){stop(false);setAudioStatus('曲を作成中…');const blob=renderCompatSong();if(!blob){setAudioStatus('再生できる音がありません');toast('音符または録音がありません');return}await playCompatBlob(blob,'曲')}

function setRecStatus(t){const el=$('#recStatus');if(el)el.textContent=t}
async function attachRecordedBlob(blob,tr,sourceLabel='録音'){
  if(!blob||!blob.size)throw new Error('empty audio');
  currentRecordingBlob=blob;tr.recordBlob=blob;tr.recordStart=Math.max(0,+$('#recordStart').value||0);
  setRecStatus(`${sourceLabel}を解析中…`);
  const ab=await blob.arrayBuffer();
  const actx=await unlockAudio();currentRecordingBuffer=await actx.decodeAudioData(ab.slice(0));
  tr.recordBuffer=currentRecordingBuffer;
  await convertBufferToNotes(currentRecordingBuffer,tr);
  setRecStatus(`${sourceLabel}OK：${currentRecordingBuffer.duration.toFixed(1)}秒 / ${tr.notes.length}音`);
}
function preferredRecorderOptions(){
  if(!window.MediaRecorder)return null;
  const candidates=['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/webm'];
  for(const mimeType of candidates){try{if(MediaRecorder.isTypeSupported?.(mimeType))return {mimeType}}catch{}}
  return null;
}
function canDirectRecord(){return !!(window.MediaRecorder&&navigator.mediaDevices?.getUserMedia&&window.isSecureContext&&location.protocol!=='file:')}
function openAudioImport(){
  const inp=$('#audioCaptureFile');inp.value='';inp.click();
}
async function startRecording(){
  if(mediaRecorder?.state==='recording')return stopRecording();
  setRecStatus('マイクを準備中…');
  if(!canDirectRecord()){
    setRecStatus('この開き方では直接マイクを使えません。音声録音/音声ファイル選択を開きます。');
    toast('直接録音不可 → 音声取り込みを開きます');
    openAudioImport();
    return;
  }
  try{
    const ctx=await unlockAudio();
    rawMediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:true,channelCount:1}});
    const boost=clamp(+($('#inputBoost')?.value||1),1,256);
    mediaStream=rawMediaStream;
    recordAnalyser=null;recordGraph=null;
    try{
      const src=ctx.createMediaStreamSource(rawMediaStream),gain=ctx.createGain(),lim=ctx.createDynamicsCompressor(),dst=ctx.createMediaStreamDestination(),an=ctx.createAnalyser();
      gain.gain.value=boost;lim.threshold.value=-18;lim.knee.value=4;lim.ratio.value=20;lim.attack.value=.002;lim.release.value=.12;an.fftSize=512;
      src.connect(gain);gain.connect(lim);lim.connect(an);lim.connect(dst);mediaStream=dst.stream;recordAnalyser=an;recordGraph={src,gain,lim,dst,an};
      setRecStatus(`● 録音中… 実入力ブースト ${boost}倍`);
    }catch(err){console.warn('processed mic fallback',err);mediaStream=rawMediaStream}
    chunks=[];
    const opts=preferredRecorderOptions();
    mediaRecorder=opts?new MediaRecorder(mediaStream,opts):new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
    mediaRecorder.onerror=e=>{console.error(e);setRecStatus('録音エラー。音声ファイル取り込みを使ってください。')};
    mediaRecorder.onstop=async()=>{
      const mime=mediaRecorder?.mimeType||opts?.mimeType||'audio/mp4';
      const blob=new Blob(chunks,{type:mime});
      const tr=currentTrack();
      try{await attachRecordedBlob(blob,tr,'マイク録音')}
      catch(e){console.error(e);setRecStatus('録音はできましたが解析できませんでした。別形式の音声で試してください。');toast('録音解析に失敗しました')}
      finally{mediaStream?.getTracks().forEach(t=>t.stop());rawMediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;rawMediaStream=null;recordGraph=null;recordAnalyser=null;setRecUI(false);renderAll()}
    };
    mediaRecorder.start(250);recStart=performance.now();setRecUI(true);if(!recordGraph)setRecStatus('● 録音中… もう一度押すと停止');meterLoop();
    setTimeout(()=>{if(mediaRecorder?.state==='recording')stopRecording()},60000);
  }catch(e){
    console.error(e);mediaStream?.getTracks().forEach(t=>t.stop());rawMediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;rawMediaStream=null;recordGraph=null;recordAnalyser=null;setRecUI(false);
    const msg=e?.name==='NotAllowedError'?'マイク権限が拒否されています。Safariのサイト設定でマイクを許可してください。':'直接録音できません。音声ファイル取り込みを使ってください。';
    setRecStatus(msg);toast(msg);
  }
}
function stopRecording(){if(mediaRecorder?.state==='recording'){setRecStatus('録音を停止して解析中…');mediaRecorder.stop()}}
function setRecUI(on){$('#recBox').classList.toggle('recording',on);$('#recBtn').classList.toggle('recording',on);$('#recBtn').textContent=on?'■ 録音停止':'● 声を録音';if(!on)cancelAnimationFrame(recMeterRAF)}
async function meterLoop(){if(!mediaStream&&!rawMediaStream)return;const ctx=ensureAudio();let an=recordAnalyser;if(!an){const src=ctx.createMediaStreamSource(rawMediaStream||mediaStream);an=ctx.createAnalyser();an.fftSize=512;src.connect(an)}const d=new Uint8Array(an.fftSize);function loop(){if(!mediaStream&&!rawMediaStream)return;an.getByteTimeDomainData(d);let s=0;for(const v of d){const x=(v-128)/128;s+=x*x}const rms=Math.sqrt(s/d.length);$('#meterBar').style.width=Math.min(100,rms*720)+'%';recMeterRAF=requestAnimationFrame(loop)}loop()}
function autocorrelate(buf,sr){
  const size=buf.length;let rms=0;for(let i=0;i<size;i++)rms+=buf[i]*buf[i];rms=Math.sqrt(rms/size);
  const sens=+$('#sensitivity').value||1,boost=clamp(+($('#inputBoost')?.value||1),1,256),effectiveRms=rms*Math.sqrt(boost);if(effectiveRms<0.0045/Math.sqrt(sens))return null;
  const minFreq=20,maxFreq=Math.min(4500,sr*.40),minLag=Math.max(2,Math.floor(sr/maxFreq)),maxLag=Math.min(size-4,Math.ceil(sr/minFreq));
  let best=-1,bestLag=-1;const sampleStep=4,lagStep=2;
  const corrAt=lag=>{let sum=0,e1=0,e2=0;for(let i=0;i<size-lag;i+=sampleStep){const a=buf[i],b=buf[i+lag];sum+=a*b;e1+=a*a;e2+=b*b}return sum/Math.sqrt((e1||1e-9)*(e2||1e-9))};
  for(let lag=minLag;lag<=maxLag;lag+=lagStep){const c=corrAt(lag);if(c>best){best=c;bestLag=lag}}
  const minConf=clamp(.29-Math.log2(sens)*.016-Math.log2(boost)*.010,.11,.29);if(bestLag<0||best<minConf)return null;
  let refinedLag=bestLag,refined=best;for(let lag=Math.max(minLag,bestLag-3);lag<=Math.min(maxLag,bestLag+3);lag++){const c=corrAt(lag);if(c>refined){refined=c;refinedLag=lag}}
  let T0=refinedLag;if(refinedLag>minLag&&refinedLag<maxLag){const x1=corrAt(refinedLag-1),x2=refined,x3=corrAt(refinedLag+1),den=x1-2*x2+x3;if(Math.abs(den)>1e-6)T0=refinedLag+.5*(x1-x3)/den}
  const freq=sr/T0;return {freq,rms,confidence:refined};
}
function downsampleMono(src,factor){if(factor<=1)return src;const n=Math.floor(src.length/factor),out=new Float32Array(n);for(let i=0;i<n;i++){let s=0;for(let j=0;j<factor;j++)s+=src[i*factor+j];out[i]=s/factor}return out}
async function convertBufferToNotes(buffer,tr){
  const src0=buffer.getChannelData(0),factor=buffer.sampleRate>=32000?4:2,sr=buffer.sampleRate/factor,src=downsampleMono(src0,factor),frame=2048,hop=512,bpm=+state.bpm||100,spb=60/bpm,level=clamp(+$('#stabilize').value||0,0,8),inputBoost=+($('#inputBoost')?.value||1);
  const cfg=[
    {win:1,hold:0,dead:0,min:.035},{win:3,hold:1,dead:.30,min:.045},{win:5,hold:2,dead:.50,min:.055},
    {win:9,hold:3,dead:.80,min:.070},{win:15,hold:5,dead:1.15,min:.095},{win:25,hold:7,dead:1.65,min:.130},{win:41,hold:10,dead:2.30,min:.180},
    {win:61,hold:16,dead:3.10,min:.240},{win:81,hold:24,dead:4.20,min:.320}
  ][level];
  let frames=[];
  for(let i=0;i+frame<src.length;i+=hop){const seg=src.subarray(i,i+frame),p=autocorrelate(seg,sr);if(!p){frames.push(null);continue}const midi=69+12*Math.log2(p.freq/440);frames.push({t:i/sr,m:midi,r:p.rms})}
  let smooth=[];
  for(let i=0;i<frames.length;i++){
    if(!frames[i]){smooth.push(null);continue}
    const a=[];const half=Math.floor(cfg.win/2);for(let j=Math.max(0,i-half);j<=Math.min(frames.length-1,i+half);j++)if(frames[j])a.push(frames[j].m);
    a.sort((x,y)=>x-y);const med=a.length?a[Math.floor(a.length/2)]:frames[i].m;smooth.push({...frames[i],m:med});
  }
  let notes=[],cur=null,lastMidi=null,candidate=null,cCount=0;
  for(const f of smooth){
    if(!f){if(cur&&cur.end-cur.start>=cfg.min){notes.push(cur);cur=null}candidate=null;cCount=0;continue}
    let m=Math.round(f.m);
    if(level>0&&lastMidi!=null&&Math.abs(f.m-lastMidi)<=cfg.dead)m=lastMidi;
    if(lastMidi==null)lastMidi=m;
    if(m!==lastMidi){
      const jump=Math.abs(m-lastMidi),need=jump>=5?Math.max(1,Math.floor(cfg.hold/2)):cfg.hold;
      if(candidate===m)cCount++;else{candidate=m;cCount=1}
      if(cCount<=need)m=lastMidi;else{lastMidi=m;candidate=null;cCount=0}
    }else{candidate=null;cCount=0}
    const beat=f.t/spb;
    if(!cur||cur.midi!==m){if(cur&&cur.end-cur.start>=cfg.min)notes.push(cur);cur={midi:m,start:beat,end:beat+hop/sr/spb,vel:clamp(.30+f.r*inputBoost*3,.30,1)}}else cur.end=beat+hop/sr/spb;
  }
  if(cur&&cur.end-cur.start>=cfg.min)notes.push(cur);
  const q=+$('#quantize').value||0,snap=q||+state.snap;
  notes=notes.map(n=>{let st=n.start,d=Math.max(cfg.min,n.end-n.start);if(q){st=Math.round(st/q)*q;d=Math.max(q,Math.round(d/q)*q)}else{st=Math.round(st/snap)*snap;d=Math.max(snap,Math.round(d/snap)*snap)}return {id:uid(),midi:clamp(n.midi,0,127),start:st,dur:d,vel:n.vel}})
    .filter((n,i,a)=>i===0||n.midi!==a[i-1].midi||Math.abs(n.start-(a[i-1].start+a[i-1].dur))>.02);
  tr.notes=notes;state.selectedNote=notes[0]?.id||null;toast(`${notes.length}音に変換しました`);saveSilent();
}
async function reconvert(){const tr=currentTrack();const buf=tr.recordBuffer||currentRecordingBuffer;if(!buf)return toast('このトラックに録音がありません');await convertBufferToNotes(buf,tr);renderAll()}
function syncSelectedRecording(){const tr=currentTrack();currentRecordingBlob=tr?.recordBlob||null;currentRecordingBuffer=tr?.recordBuffer||null;$('#recordStart').value=tr?.recordStart||0}
async function hearVoice(){const tr=currentTrack();if(!tr?.recordBlob)return toast('録音がありません');await playCompatBlob(tr.recordBlob,'元の声')}
function demo(){const tr=currentTrack(),base=tr.type==='bass'?40:tr.type==='violin'?67:60;tr.notes=[];[0,2,4,5,7,5,4,2].forEach((p,i)=>tr.notes.push({id:uid(),midi:base+p,start:i*.5,dur:.45,vel:.75}));state.selectedNote=tr.notes[0].id;renderAll();saveSilent()}
function exportProject(){const out={version:'2.1',state:{...state,tracks:state.tracks.map(t=>({...t,recordBlob:null,recordBuffer:null}))}};downloadBlob(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}),'Kotoba-Music-project.json')}
function importProject(file){const fr=new FileReader();fr.onload=()=>{try{const x=JSON.parse(fr.result);if(x?.state?.tracks){state={...state,...x.state};state.tracks.forEach(t=>{t.recordBlob=null;t.recordBuffer=null});renderAll();saveSilent();toast('プロジェクトを開きました')}}catch{toast('プロジェクトを読めませんでした')}};fr.readAsText(file)}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
async function exportWav(){toast('WAVを作成中…');const bpm=+state.bpm||100,spb=60/bpm,endBeat=Math.max(8,...state.tracks.flatMap(t=>t.notes.map(n=>n.start+n.dur))),dur=endBeat*spb+1,sr=44100;const ctx=new OfflineAudioContext(2,Math.ceil(dur*sr),sr),master=ctx.createGain();master.gain.value=Math.min(3,.75*masterBoost());const comp=ctx.createDynamicsCompressor();comp.threshold.value=-10;comp.ratio.value=5;master.connect(comp);comp.connect(ctx.destination);state.tracks.forEach(tr=>{if(tr.mute)return;const tg=ctx.createGain();tg.gain.value=tr.volume;tg.connect(master);if(tr.type==='voice'&&tr.recordBuffer){const src=ctx.createBufferSource();src.buffer=tr.recordBuffer;src.connect(tg);try{src.start((tr.recordStart||0)*spb)}catch{}}tr.notes.forEach(n=>scheduleOsc(ctx,tg,tr.type,n.midi,n.start*spb,n.dur*spb,n.vel))});const rendered=await ctx.startRendering();const wav=audioBufferToWav(rendered);downloadBlob(new Blob([wav],{type:'audio/wav'}),'Kotoba-Music.wav');toast('WAVを書き出しました')}
function audioBufferToWav(buffer){const ch=buffer.numberOfChannels,sr=buffer.sampleRate,len=buffer.length,bytes=44+len*ch*2,ab=new ArrayBuffer(bytes),v=new DataView(ab);let p=0;const ws=s=>{for(let i=0;i<s.length;i++)v.setUint8(p++,s.charCodeAt(i))};const u32=x=>{v.setUint32(p,x,true);p+=4},u16=x=>{v.setUint16(p,x,true);p+=2};ws('RIFF');u32(bytes-8);ws('WAVE');ws('fmt ');u32(16);u16(1);u16(ch);u32(sr);u32(sr*ch*2);u16(ch*2);u16(16);ws('data');u32(len*ch*2);const data=[];for(let c=0;c<ch;c++)data.push(buffer.getChannelData(c));for(let i=0;i<len;i++)for(let c=0;c<ch;c++){let s=clamp(data[c][i],-1,1);v.setInt16(p,s<0?s*0x8000:s*0x7fff,true);p+=2}return ab}
$('#playBtn').onclick=()=>play(0);$('#stopBtn').onclick=()=>stop();$('#testToneBtn').onclick=testTone;$('#outputMode').onchange=e=>{state.outputMode=e.target.value;saveSilent();setAudioStatus(e.target.value==='compat'?'iPad互換再生を使用':'Web Audio再生を使用')};$('#masterBoost').onchange=e=>{state.masterBoost=+e.target.value||2;saveSilent();toast('全体音量 '+Math.round(state.masterBoost*100)+'%')};$('#bpm').onchange=e=>{state.bpm=clamp(+e.target.value||100,40,240);saveSilent()};
$('#saveBtn').onclick=saveLocal;$('#exportProjectBtn').onclick=exportProject;$('#importProjectBtn').onclick=()=>$('#importFile').click();$('#importFile').onchange=e=>e.target.files[0]&&importProject(e.target.files[0]);$('#wavBtn').onclick=exportWav;
$('#addTrackBtn').onclick=()=>{const type=$('#newTrackType').value,count=state.tracks.filter(t=>t.type===type).length+1,tr=defaultTrack(type,count);state.tracks.push(tr);state.selectedTrack=tr.id;state.selectedNote=null;syncSelectedRecording();renderAll();saveSilent()};
$('#recBtn').onclick=startRecording;$('#audioImportBtn').onclick=openAudioImport;$('#audioCaptureFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;const tr=currentTrack();try{setRecStatus('音声を読み込み中…');await attachRecordedBlob(file,tr,'音声ファイル');renderAll()}catch(err){console.error(err);setRecStatus('この音声を読み込めませんでした。m4a / mp4 / wav などで試してください。');toast('音声を読み込めませんでした')}};$('#reconvertBtn').onclick=reconvert;$('#hearVoiceBtn').onclick=hearVoice;$('#recordStart').onchange=e=>{const tr=currentTrack();if(tr){tr.recordStart=Math.max(0,+e.target.value||0);saveSilent()}};
$('#labelMode').onchange=e=>{state.labelMode=e.target.value;renderAll();saveSilent()};$('#snap').onchange=e=>{state.snap=+e.target.value;saveSilent()};$('#rangeMode').onchange=e=>{state.rangeMode=e.target.value;renderAll();saveSilent()};$('#zoomOutBtn').onclick=()=>applyZoom((state.zoom||1)-.25);$('#zoomInBtn').onclick=()=>applyZoom((state.zoom||1)+.25);$('#zoomResetBtn').onclick=()=>applyZoom(1);$('#expandEditorBtn').onclick=toggleEditorExpand;
$('#addNoteBtn').onclick=()=>{const tr=currentTrack();addNote(tr.type==='bass'?40:tr.type==='violin'?67:60)};$('#deleteNote').onclick=()=>{const tr=currentTrack();if(!state.selectedNote)return;tr.notes=tr.notes.filter(n=>n.id!==state.selectedNote);state.selectedNote=null;renderAll();saveSilent()};
$('#octDown').onclick=()=>{const tr=currentTrack(),targets=state.selectedNote?tr.notes.filter(n=>n.id===state.selectedNote):tr.notes;targets.forEach(n=>n.midi=clamp(n.midi-12,0,127));renderAll();saveSilent()};$('#octUp').onclick=()=>{const tr=currentTrack(),targets=state.selectedNote?tr.notes.filter(n=>n.id===state.selectedNote):tr.notes;targets.forEach(n=>n.midi=clamp(n.midi+12,0,127));renderAll();saveSilent()};
$('#notePitch').onchange=e=>{const n=currentNote();if(n){n.midi=+e.target.value;renderRoll();renderNotePanel();saveSilent()}};$('#noteStart').onchange=e=>{const n=currentNote();if(n){n.start=Math.max(0,+e.target.value||0);renderRoll();saveSilent()}};$('#noteDur').onchange=e=>{const n=currentNote();if(n){n.dur=Math.max(+state.snap,+e.target.value||+state.snap);renderRoll();saveSilent()}};$('#noteVel').oninput=e=>{const n=currentNote();if(n){n.vel=+e.target.value;saveSilent()}};$('#previewNote').onclick=()=>preview();$('#demoBtn').onclick=demo;
$('#roll').onclick=e=>{if(e.target.id==='roll'||e.target.classList.contains('grid')||e.target.classList.contains('rowLine')){state.selectedNote=null;renderAll()}};
if(!loadLocal())initTracks();if(!state.masterBoost)state.masterBoost=2;if(!state.zoom)state.zoom=1;if(!state.outputMode||isIPadLike())state.outputMode='compat';applyZoom(state.zoom,false);renderAll();syncSelectedRecording();initPinchZoom();const cp=$('#compatPlayer');if(cp){cp.onplay=()=>setAudioStatus('再生中');cp.onpause=()=>{if(cp.currentTime&&cp.currentTime<cp.duration)setAudioStatus('一時停止')};cp.onended=()=>setAudioStatus('再生終了');cp.onerror=()=>setAudioStatus('音声を再生できませんでした')};document.addEventListener('pointerdown',()=>{unlockAudio().catch(()=>{})},{once:true,passive:true});if(!canDirectRecord())setRecStatus('ZIP/ローカル表示では直接マイクが制限される場合があります。録音ボタンは音声取り込みへ自動切替します。');
})();
