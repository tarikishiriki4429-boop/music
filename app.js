(()=>{
'use strict';
const $=s=>document.querySelector(s), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const TYPES={voice:'ボイス',piano:'ピアノ',bass:'ベース',guitar:'ギター',violin:'ヴァイオリン',drums:'ドラム'};
const SOL=['ド','ド♯','レ','レ♯','ミ','ファ','ファ♯','ソ','ソ♯','ラ','ラ♯','シ'];
const LET=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
let state={bpm:100,labelMode:'letter',snap:.25,rangeMode:'normal',masterBoost:2,instrumentBoost:2.5,monitorLevel:0,autoHearRecording:'on',recordLimitSec:300,zoom:1,stabilize:2,intermediateFilter:2,trackingMode:'fast',minNoteMs:30,sensitivity:4,recognitionRange:'auto',quantize:0,inputBoost:2,outputMode:'compat',tracks:[],selectedTrack:null,selectedNote:null};
let audioCtx=null, activeNodes=[], isPlaying=false, playStartCtx=0, playStartBeat=0, raf=0;
let pinchActive=false,pinchSerial=0,lastPinchEnd=0,lastDoubleAdd=0,lastDoublePoint=null;
let mediaRecorder=null, mediaStream=null, rawMediaStream=null, recordGraph=null, recordAnalyser=null, chunks=[], currentRecordingBlob=null, currentRecordingBuffer=null, recStart=0, recMeterRAF=0, recLimitTimer=null, recClockTimer=null;
let compatObjectURL=null,recordingTrack=null,recordPreparing=false,compatIsSong=false;
const BASE_CELL_W=60,BASE_CELL_H=28,KEYS_W=74;let TOTAL_BEATS=80;let CELL_W=BASE_CELL_W,CELL_H=BASE_CELL_H;
function uid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4)}
function midiToFreq(m){return 440*Math.pow(2,(m-69)/12)}
function midiLabel(m,mode=state.labelMode){const pc=((m%12)+12)%12,oct=Math.floor(m/12)-1;return (mode==='solfege'?SOL[pc]:LET[pc])+oct}
function range(){if(state.rangeMode==='extreme')return [0,127];if(state.rangeMode==='full')return [12,120];if(state.rangeMode==='vocal')return [36,84];return [24,108]}
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),1500)}
function ensureAudio(){if(!audioCtx||audioCtx.state==='closed')audioCtx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});return audioCtx}
async function unlockAudio(){const ctx=ensureAudio();try{if(ctx.state!=='running')await ctx.resume()}catch{}if(ctx.state==='running'&&!ctx._kotobaUnlocked){try{const b=ctx.createBuffer(1,1,ctx.sampleRate),src=ctx.createBufferSource(),g=ctx.createGain();src.buffer=b;g.gain.value=0;src.connect(g);g.connect(ctx.destination);src.start();ctx._kotobaUnlocked=true}catch{}}return ctx}
function masterBoost(){return clamp(+($('#masterBoost')?.value||state.masterBoost||2),.25,4)}
function instrumentBoost(){return clamp(+($('#instrumentBoost')?.value||state.instrumentBoost||2.5),1,4)}
function instrumentGain(type){if(type==='voice')return 1;const trim={piano:1.05,bass:1.12,guitar:1.12,violin:1.08,drums:1.12}[type]||1;return instrumentBoost()*trim}
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
    if(!pinching)return;if(e.touches&&e.touches.length>=2)return;pinching=false;pinchActive=false;lastPinchEnd=performance.now();wrap.classList.remove('pinching');roll.classList.remove('pinching');roll.style.transform='';roll.style.transformOrigin='';
    const oldZoom=startZoom,newZoom=clamp(Math.round(targetZoom*20)/20,.5,3),ratio=newZoom/oldZoom;
    applyZoom(newZoom,true);
    requestAnimationFrame(()=>{wrap.scrollLeft=Math.max(0,originX*ratio-(originX-startScrollLeft));wrap.scrollTop=Math.max(0,originY*ratio-(originY-startScrollTop));});
  };
  wrap.addEventListener('touchend',finish,{passive:false});wrap.addEventListener('touchcancel',finish,{passive:false});
}
function defaultTrack(type,index=1){return {id:uid(),type,name:(TYPES[type]||type)+(index>1?' '+index:''),volume:.7,mute:false,solo:false,notes:[],recordBlob:null,recordBuffer:null,recordStart:0}}
function initTracks(){['voice','piano','bass','guitar','violin','drums'].forEach(t=>state.tracks.push(defaultTrack(t)));state.selectedTrack=state.tracks[1].id}
function currentTrack(){return state.tracks.find(t=>t.id===state.selectedTrack)||state.tracks[0]}
function currentNote(){const tr=currentTrack();return tr?.notes.find(n=>n.id===state.selectedNote)||null}
let dbPromise=null,saveTimer=null,saveChain=Promise.resolve(),history=[],future=[],historySignature='',appReady=false;
function metadata(){return {...state,savedAt:Date.now(),tracks:state.tracks.map(t=>({...t,recordBlob:null,recordBuffer:null}))};}
function snapshot(){return {...state,tracks:state.tracks.map(t=>({...t,notes:t.notes.map(n=>({...n}))}))};}
function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('KotobaMusicV30',1);r.onupgradeneeded=()=>r.result.createObjectStore('project');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return dbPromise;}
async function writeSnapshot(data){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('project','readwrite');tx.objectStore('project').put(data,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});}
async function readSnapshot(){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('project').objectStore('project').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
function historyKey(x){return JSON.stringify({...x,savedAt:null,tracks:x.tracks.map(t=>({...t,recordBlob:t.recordBlob?{size:t.recordBlob.size}:null,recordBuffer:null}))});}
function noteHistory(){if(!appReady)return;const x=snapshot(),key=historyKey(x);if(key===historySignature)return;history.push(x);if(history.length>45)history.shift();future=[];historySignature=key;updateHistoryUI();}
function updateHistoryUI(){if(!$('#undoBtn'))return;$('#undoBtn').disabled=history.length<2;$('#redoBtn').disabled=!future.length;}
function restoreHistory(x){state={...x,tracks:x.tracks.map(t=>({...t,notes:t.notes.map(n=>({...n}))}))};historySignature=historyKey(state);applyZoom(state.zoom,false);syncSelectedRecording();renderAll();queueSave();updateHistoryUI();}
function undo(){if(history.length<2||analysisBusy||mediaRecorder?.state==='recording')return;future.push(history.pop());restoreHistory(history[history.length-1]);}
function redo(){if(!future.length||analysisBusy||mediaRecorder?.state==='recording')return;const x=future.pop();history.push(x);restoreHistory(x);}
function queueSave(){
  try{localStorage.setItem('kotobaMusicV30',JSON.stringify(metadata()))}catch{$('#saveStatus').textContent='本文の簡易保存ができません。プロジェクトを書き出してください。'}
  clearTimeout(saveTimer);saveTimer=setTimeout(()=>persistNow().catch(()=>{}),500);
}
function saveSilent(){if(!appReady)return;noteHistory();queueSave();}
async function persistNow(){clearTimeout(saveTimer);const data={meta:metadata(),recordings:state.tracks.filter(t=>t.recordBlob).map(t=>({id:t.id,blob:t.recordBlob}))};const p=saveChain.then(()=>writeSnapshot(data));saveChain=p.catch(()=>{});try{await p;$('#saveStatus').textContent='録音を含め自動保存済み';return true}catch(e){$('#saveStatus').textContent='録音の自動保存に失敗。プロジェクト書出しでバックアップしてください。';throw e}}
async function saveLocal(){try{await persistNow();toast('録音と音符を保存しました')}catch{toast('録音の保存に失敗しました。プロジェクトを書き出してください')}}
function loadLocal(){for(const key of ['kotobaMusicV30','kotobaMusicV16','kotobaMusicV26'])try{const x=JSON.parse(localStorage.getItem(key));if(x?.tracks?.length){state=normalizeState(x);return true}}catch{}return false;}
async function restoreRecordings(){
 try{
  const x=await readSnapshot();if(x?.meta){if(!state.savedAt||x.meta.savedAt>=state.savedAt)state=normalizeState(x.meta);
   const ctx=ensureAudio();for(const r of x.recordings||[]){const tr=state.tracks.find(t=>t.id===r.id);if(!tr)continue;tr.recordBlob=r.blob;try{tr.recordBuffer=await ctx.decodeAudioData(await r.blob.arrayBuffer())}catch{tr.analysisSummary='録音の復元に失敗。再取り込みしてください。'}}
   applyZoom(state.zoom,false);renderAll();syncSelectedRecording();focusTrackNotes();$('#saveStatus').textContent='保存データを復元しました';
  }
 }catch{$('#saveStatus').textContent='この環境では録音の自動保存が使えません。書出しで保存してください。'}
 appReady=true;if($('#saveStatus').textContent==='保存データを準備中…')$('#saveStatus').textContent='編集内容と録音を自動保存します';history=[snapshot()];historySignature=historyKey(state);updateHistoryUI();
}
function normalizeState(x){
  if(!Array.isArray(x.tracks)||!x.tracks.length||x.tracks.length>100)throw new Error('トラック数が不正です');
  const allowed=Object.keys(TYPES);const out={...state,...x,bpm:clamp(+x.bpm||100,40,240),zoom:clamp(+x.zoom||1,.5,3),snap:[.125,.25,.5,1].includes(+x.snap)?+x.snap:.25};
  out.tracks=x.tracks.map(t=>{if(!allowed.includes(t.type)||!Array.isArray(t.notes)||t.notes.length>100000)throw new Error('音符データが不正です');return {...defaultTrack(t.type),...t,id:typeof t.id==='string'?t.id:uid(),name:String(t.name||TYPES[t.type]).slice(0,100),volume:clamp(+t.volume||0,0,4),recordBlob:null,recordBuffer:null,recordStart:clamp(+t.recordStart||0,0,7200),notes:t.notes.map(n=>{if(!Number.isFinite(+n.start)||!Number.isFinite(+n.dur)||+n.start<0||+n.start>7200||+n.dur<=0||+n.dur>7200)throw new Error('音符の時刻が不正です');return {...n,id:typeof n.id==='string'?n.id:uid(),midi:clamp(Math.round(Number.isFinite(+n.midi)?+n.midi:60),0,127),start:+n.start,dur:+n.dur,vel:clamp(+n.vel||.75,.05,1)}})}});
  if(!out.tracks.some(t=>t.id===out.selectedTrack))out.selectedTrack=out.tracks[0].id;
  if(!['full','normal','vocal','extreme'].includes(out.rangeMode))out.rangeMode='normal';out.stabilize=clamp(+out.stabilize||0,0,3);out.intermediateFilter=clamp(+out.intermediateFilter||0,0,3);out.minNoteMs=[30,50,80,120].includes(+out.minNoteMs)?+out.minNoteMs:50;out.trackingMode=['fast','balanced'].includes(out.trackingMode)?out.trackingMode:'fast';if(x.trackingMode==null)out.minNoteMs=30;if(!['auto','low','high','wide'].includes(out.recognitionRange))out.recognitionRange='auto';return out;
}

function renderTracks(){const box=$('#trackList');box.innerHTML='';state.tracks.forEach(tr=>{const d=document.createElement('div');d.className='track'+(tr.id===state.selectedTrack?' selected':'');d.innerHTML=`<div class="trackTop"><button data-sel="${tr.id}" class="trackName ghost">${escapeHTML(tr.name)}</button><button data-solo="${tr.id}" aria-label="このパートだけ再生" class="${tr.solo?'primary':''}" style="padding:5px 8px">S${tr.solo?'✓':''}</button><button data-mute="${tr.id}" style="padding:5px 8px">${tr.mute?'M✓':'M'}</button><button data-deltrack="${tr.id}" class="danger" style="padding:5px 8px">×</button></div><label class="small">音量 ${Math.round(tr.volume*100)}%<input data-vol="${tr.id}" class="slider" type="range" min="0" max="4" step="0.05" value="${tr.volume}"></label><div class="muted">${tr.notes.length}音${tr.recordBlob?' · 録音あり':''}</div>`;box.appendChild(d)});
box.querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>{state.selectedTrack=b.dataset.sel;state.selectedNote=null;syncSelectedRecording();renderAll();focusTrackNotes();saveSilent()});
box.querySelectorAll('[data-mute]').forEach(b=>b.onclick=()=>{const tr=state.tracks.find(t=>t.id===b.dataset.mute);tr.mute=!tr.mute;renderTracks();saveSilent()});
box.querySelectorAll('[data-deltrack]').forEach(b=>b.onclick=()=>{if(state.tracks.length<=1)return toast('トラックは1本以上必要です');state.tracks=state.tracks.filter(t=>t.id!==b.dataset.deltrack);if(!state.tracks.some(t=>t.id===state.selectedTrack))state.selectedTrack=state.tracks[0].id;state.selectedNote=null;syncSelectedRecording();renderAll();saveSilent()});
box.querySelectorAll('[data-vol]').forEach(r=>r.oninput=()=>{const tr=state.tracks.find(t=>t.id===r.dataset.vol);tr.volume=+r.value;r.closest('.track').querySelector('.muted').textContent=`${tr.notes.length}音${tr.recordBlob?' · 録音あり':''}`;r.parentElement.firstChild.textContent='音量 '+Math.round(tr.volume*100)+'%';saveSilent()});
box.querySelectorAll('[data-solo]').forEach(b=>b.onclick=()=>{const tr=state.tracks.find(t=>t.id===b.dataset.solo);tr.solo=!tr.solo;renderTracks();saveSilent()});
}
function escapeHTML(s){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function renderPitchSelect(){const [lo,hi]=range(),sel=$('#notePitch');const old=+sel.value;sel.innerHTML='';for(let m=hi;m>=lo;m--){const o=document.createElement('option');o.value=m;o.textContent=midiLabel(m);sel.appendChild(o)}if(old>=lo&&old<=hi)sel.value=old}
function renderRoll(){const roll=$('#roll'),tr=currentTrack();if(!tr)return;TOTAL_BEATS=Math.max(80,Math.ceil(songEndBeat()+8));const [lo,hi]=range();const rows=hi-lo+1,height=rows*CELL_H,width=KEYS_W+TOTAL_BEATS*CELL_W;roll.style.height=height+'px';roll.style.width=width+'px';roll.innerHTML='';
const keys=document.createElement('div');keys.className='keys';keys.style.height=height+'px';roll.appendChild(keys);const grid=document.createElement('div');grid.className='grid';grid.style.width=(TOTAL_BEATS*CELL_W)+'px';grid.style.height=height+'px';roll.appendChild(grid);
for(let i=0;i<rows;i++){const m=hi-i,y=i*CELL_H,black=[1,3,6,8,10].includes(m%12);const k=document.createElement('div');k.className='keyLabel'+(black?' black':'');k.style.top=y+'px';k.textContent=midiLabel(m);keys.appendChild(k);const r=document.createElement('div');r.className='rowLine'+(black?' black':'');r.style.top=y+'px';r.style.height=CELL_H+'px';grid.appendChild(r)}
for(let b=0;b<=TOTAL_BEATS;b++){const l=document.createElement('div');l.className='beatLine'+(b%4===0?' bar':'');l.style.left=(b*CELL_W)+'px';grid.appendChild(l);if(b%4===0){const lab=document.createElement('span');lab.className='barLabel';lab.style.left=(b*CELL_W+4)+'px';lab.textContent=String(b/4+1);grid.appendChild(lab)}}
tr.notes.forEach(n=>{if(n.midi<lo||n.midi>hi)return;const el=document.createElement('div');el.className='note'+(n.id===state.selectedNote?' selected':'')+(n.uncertain||n.confidence<.82?' uncertain':'');el.dataset.id=n.id;el.style.left=(n.start*CELL_W)+'px';el.style.top=((hi-n.midi)*CELL_H+2)+'px';el.style.width=Math.max(8,n.dur*CELL_W)+'px';el.textContent=midiLabel(n.midi);const rz=document.createElement('i');rz.className='resize';el.appendChild(rz);grid.appendChild(el);attachNoteDrag(el,n,rz)});
const ph=document.createElement('div');ph.id='playhead';ph.className='playhead';ph.style.left='0px';grid.appendChild(ph);updateEditorHeader();}

function addNoteAtGridPoint(clientX,clientY){
  const now=performance.now();
  if(pinchActive||now-lastPinchEnd<450||now-lastDoubleAdd<300&&lastDoublePoint&&Math.hypot(clientX-lastDoublePoint.x,clientY-lastDoublePoint.y)<12)return false;
  const grid=$('#roll .grid');
  if(!grid)return false;
  const rect=grid.getBoundingClientRect();
  const x=clientX-rect.left,y=clientY-rect.top;
  if(x<0||y<0||x>=rect.width||y>=rect.height)return false;
  const [lo,hi]=range(),snap=+state.snap||.25;
  const beat=clamp(Math.round((x/CELL_W)/snap)*snap,0,Math.max(0,TOTAL_BEATS-snap));
  const row=clamp(Math.floor(y/CELL_H),0,hi-lo);
  const midi=clamp(hi-row,lo,hi);
  const dur=Math.max(.5,snap);
  const tr=currentTrack();if(!tr)return false;
  const n={id:uid(),midi,start:beat,dur,vel:.75};
  lastDoubleAdd=now;lastDoublePoint={x:clientX,y:clientY};tr.notes.push(n);state.selectedNote=n.id;
  renderAll();saveSilent();
  toast(`${midiLabel(midi)} を ${beat.toFixed(beat%1?3:0)}拍に追加`);
  return true;
}
function initDoubleTapAdd(){
  const wrap=$('#rollWrap');if(!wrap||wrap._doubleTapReady)return;wrap._doubleTapReady=true;
  let last={time:0,x:0,y:0,pointerType:''},downPoint=null;wrap.addEventListener('pointerdown',e=>{downPoint={id:e.pointerId,x:e.clientX,y:e.clientY}});
  const eligibleTarget=t=>!t.closest?.('.note')&&!t.closest?.('.keys')&&!t.closest?.('.keyLabel');
  wrap.addEventListener('pointerup',e=>{
    if(!eligibleTarget(e.target)||pinchActive||e.pointerType==='mouse'||!downPoint||downPoint.id!==e.pointerId||Math.hypot(e.clientX-downPoint.x,e.clientY-downPoint.y)>10)return;
    const now=performance.now();
    const near=Math.hypot(e.clientX-last.x,e.clientY-last.y)<=32;
    const samePointer=last.pointerType===e.pointerType;
    if(now-last.time<=380&&near&&samePointer&&now-lastPinchEnd>450){
      e.preventDefault();
      last.time=0;
      addNoteAtGridPoint(e.clientX,e.clientY);
      return;
    }
    last={time:now,x:e.clientX,y:e.clientY,pointerType:e.pointerType};
  },{passive:false});
  wrap.addEventListener('dblclick',e=>{
    if(!eligibleTarget(e.target)||pinchActive)return;
    e.preventDefault();
    addNoteAtGridPoint(e.clientX,e.clientY);
  },{passive:false});
}
function attachNoteDrag(el,n,rz){
 let drag=null;
 el.onpointerdown=e=>{if(pinchActive)return;e.preventDefault();e.stopPropagation();state.selectedNote=n.id;drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:n.start,midi:n.midi,dur:n.dur,resize:e.target===rz,serial:pinchSerial};el.setPointerCapture?.(e.pointerId);renderNotePanel();document.querySelectorAll('.note').forEach(x=>x.classList.toggle('selected',x.dataset.id===n.id));};
 el.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;if(pinchActive||drag.serial!==pinchSerial){n.start=drag.start;n.midi=drag.midi;n.dur=drag.dur;drag=null;return}e.preventDefault();const snap=+state.snap,dx=(e.clientX-drag.x)/CELL_W,dy=(e.clientY-drag.y)/CELL_H;
 if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<4)return;
 if(drag.resize)n.dur=Math.max(snap,Math.round((drag.dur+dx)/snap)*snap);
 else{const [lo,hi]=range();n.start=Math.max(0,Math.round((drag.start+dx)/snap)*snap);n.midi=clamp(Math.round(drag.midi-dy),lo,hi)}
 el.style.left=n.start*CELL_W+'px';el.style.width=Math.max(8,n.dur*CELL_W)+'px';el.style.top=(range()[1]-n.midi)*CELL_H+2+'px';el.childNodes[0].nodeValue=midiLabel(n.midi);renderNotePanel();};
 el.onpointerup=e=>{if(!drag)return;drag=null;saveSilent();renderRoll();};
 el.onpointercancel=()=>{if(drag){n.start=drag.start;n.midi=drag.midi;n.dur=drag.dur;drag=null;renderRoll()}};
 el.onclick=e=>{e.stopPropagation();state.selectedNote=n.id;renderNotePanel()};
}
function renderNotePanel(){const n=currentNote();['notePitch','noteStart','noteDur','noteVel','previewNote','deleteNote'].forEach(id=>$('#'+id).disabled=!n);if(!n)return;$('#notePitch').value=n.midi;$('#noteStart').value=+n.start.toFixed(4);$('#noteDur').value=+n.dur.toFixed(4);$('#noteVel').value=n.vel??.75}
function updateEditorHeader(){const tr=currentTrack();$('#editorTitle').textContent=`音を編集 — ${tr?.name||''}`;$('#editorSub').textContent=`${TYPES[tr?.type]||''} / ${tr?.notes.length||0}音 / ダブルタップで追加・音符を直接ドラッグ`}
function renderAll(){renderTracks();renderPitchSelect();renderRoll();renderNotePanel();$('#bpm').value=state.bpm;$('#labelMode').value=state.labelMode;$('#snap').value=state.snap;$('#rangeMode').value=state.rangeMode;if($('#masterBoost'))$('#masterBoost').value=state.masterBoost||2;if($('#outputMode'))$('#outputMode').value=state.outputMode||'compat';if($('#zoomLabel'))$('#zoomLabel').textContent=Math.round((state.zoom||1)*100)+'%';if($('#zoomResetBtn'))$('#zoomResetBtn').textContent=Math.round((state.zoom||1)*100)+'%';for(const id of ['instrumentBoost','monitorLevel','autoHearRecording','trackingMode','sensitivity','recognitionRange','stabilize','intermediateFilter','minNoteMs','quantize','inputBoost']){if(state[id]!=null&&$('#'+id))$('#'+id).value=state[id];}}
function addNote(midi=60,start=null,dur=null){const tr=currentTrack();if(!tr)return;const last=tr.notes.reduce((a,n)=>Math.max(a,n.start+n.dur),0),snap=+state.snap;const n={id:uid(),midi,start:start??Math.round(last/snap)*snap,dur:dur??Math.max(.5,snap),vel:.75};tr.notes.push(n);state.selectedNote=n.id;renderAll();scrollNoteIntoView(n);saveSilent()}
function scrollNoteIntoView(n){requestAnimationFrame(()=>{const [lo,hi]=range(),wrap=$('#rollWrap');wrap.scrollLeft=Math.max(0,n.start*CELL_W-140);wrap.scrollTop=Math.max(0,(hi-n.midi)*CELL_H-100)})}
async function playWebAudio(fromBeat=0){
 stop(false);const ctx=await unlockAudio();if(ctx.state!=='running')return toast('音声出力を開始できませんでした');
 const blob=await renderSongAsync();if(!blob)return;const buffer=await ctx.decodeAudioData(await blob.arrayBuffer()),src=ctx.createBufferSource();src.buffer=buffer;src.connect(ctx.destination);
 playStartCtx=ctx.currentTime+.02;playStartBeat=fromBeat;const offset=fromBeat*60/state.bpm;if(offset>=buffer.duration)return;src.start(playStartCtx,offset);activeNodes.push(src);src.onended=()=>{if(isPlaying)stop(false)};isPlaying=true;tick();
}
async function play(fromBeat=0){const mode=$('#outputMode')?.value||state.outputMode||'compat';if(mode==='compat')return playCompat();return playWebAudio(fromBeat)}
function stop(reset=true){isPlaying=false;cancelAnimationFrame(raf);const ca=$('#compatPlayer');if(ca){try{ca.pause()}catch{}};activeNodes.forEach(n=>{try{n.stop?.()}catch{}try{n.disconnect?.()}catch{}});activeNodes=[];if(reset){$('#time').textContent='00:00.0';const p=$('#playhead');if(p)p.style.left='0px'}}
function tick(){if(!isPlaying)return;const ctx=ensureAudio(),bpm=+state.bpm||100,beat=playStartBeat+(ctx.currentTime-playStartCtx)*bpm/60,t=Math.max(0,(beat*60/bpm));$('#time').textContent=fmt(t);const p=$('#playhead');if(p)p.style.left=(Math.max(0,beat)*CELL_W)+'px';if(beat>songEndBeat()+.8)return stop();raf=requestAnimationFrame(tick)}
function fmt(t){const m=Math.floor(t/60),s=t-m*60;return String(m).padStart(2,'0')+':'+s.toFixed(1).padStart(4,'0')}
async function preview(n=currentNote()){if(!n)return;const tr=currentTrack(),r=KotobaMixer.mix({bpm:state.bpm,masterBoost:masterBoost(),instrumentBoost:instrumentBoost(),tracks:[{type:tr.type,volume:tr.volume,recordStart:0,notes:[{...n,start:0,dur:Math.max(.1,n.dur)}]}]});return playCompatBlob(floatMonoToWav(r.samples,r.sampleRate),'選択音')}
function setAudioStatus(t){const e=$('#audioStatus');if(e)e.textContent=t}
function floatMonoToWav(samples,sr=22050){const ab=new ArrayBuffer(44+samples.length*2),v=new DataView(ab);let p=0;const ws=x=>{for(let i=0;i<x.length;i++)v.setUint8(p++,x.charCodeAt(i))},u32=x=>{v.setUint32(p,x,true);p+=4},u16=x=>{v.setUint16(p,x,true);p+=2};ws('RIFF');u32(36+samples.length*2);ws('WAVE');ws('fmt ');u32(16);u16(1);u16(1);u32(sr);u32(sr*2);u16(2);u16(16);ws('data');u32(samples.length*2);for(let i=0;i<samples.length;i++){const x=clamp(samples[i],-1,1);v.setInt16(p,x<0?x*32768:x*32767,true);p+=2}return new Blob([ab],{type:'audio/wav'})}
function setCompatSource(blob,label='音声'){const a=$('#compatPlayer');if(!a)return null;if(compatObjectURL)URL.revokeObjectURL(compatObjectURL);compatObjectURL=URL.createObjectURL(blob);a.src=compatObjectURL;a.muted=false;a.volume=1;a.load();setAudioStatus(label+'を準備しました');return a}
async function playCompatBlob(blob,label='音声'){stop(false);compatIsSong=label==='曲';const a=setCompatSource(blob,label);if(!a)return false;try{await a.play();setAudioStatus(label+'を再生中');return true}catch(e){console.warn(e);setAudioStatus('下のプレイヤーの▶を押してください');toast('下のiPad互換プレイヤーの▶を押してください');return false}}
function exactToneBlob(freq,d=.85){const sr=44100,n=Math.floor(sr*d),x=new Float32Array(n);for(let i=0;i<n;i++){const t=i/sr,env=Math.min(1,t/.018)*Math.max(0,1-t/d);x[i]=Math.sin(2*Math.PI*freq*t)*.72*env}return floatMonoToWav(x,sr)}
async function testExactPitch(midi){const f=midiToFreq(midi),name=midiLabel(midi,'letter');await playCompatBlob(exactToneBlob(f),`${name} / ${f.toFixed(2)}Hz`);toast(`${name} = ${f.toFixed(2)}Hz`)}
async function testTone(){return testExactPitch(69)}
function isIPadLike(){return /iPad|iPhone|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)}
let mixBusy=false,mixSerial=0,mixWorker=null,mixReject=null;
async function renderSongAsync(){
 if(mixBusy)return null;
 const tracks=state.tracks.filter(trackAudible).map(t=>{let voice=null;if(t.type==='voice'&&t.recordBuffer){voice=new Float32Array(t.recordBuffer.length);for(let c=0;c<t.recordBuffer.numberOfChannels;c++){const x=t.recordBuffer.getChannelData(c);for(let i=0;i<x.length;i++)voice[i]+=x[i]/t.recordBuffer.numberOfChannels;}}
 return {type:t.type,volume:t.volume,recordStart:t.recordStart||0,voice,sampleRate:t.recordBuffer?.sampleRate||22050,notes:t.notes.map(n=>({...n}))}});
 if(songEndBeat()*60/state.bpm>1800){toast('1曲は30分以内にしてください');return null}const project={bpm:state.bpm,masterBoost:masterBoost(),instrumentBoost:instrumentBoost(),tracks};
 mixBusy=true;$('#playBtn').disabled=true;$('#wavBtn').disabled=true;const serial=++mixSerial;
 try{
  let r;if(typeof Worker!=='undefined'){const url=URL.createObjectURL(new Blob([KotobaMixer.workerSource],{type:'text/javascript'}));mixWorker=new Worker(url);URL.revokeObjectURL(url);r=await new Promise((resolve,reject)=>{mixReject=reject;mixWorker.onmessage=e=>e.data?.error?reject(new Error(e.data.error)):resolve(e.data);mixWorker.onerror=e=>reject(new Error(e.message));mixWorker.postMessage(project,tracks.filter(t=>t.voice).map(t=>t.voice.buffer))});}
  else{await new Promise(r=>setTimeout(r,0));r=KotobaMixer.mix(project)}
  if(serial!==mixSerial)return null;return r?floatMonoToWav(r.samples,r.sampleRate):null;
 }catch(e){if(serial===mixSerial){toast('曲の作成に失敗しました');setAudioStatus(e.message)}return null}
 finally{if(serial===mixSerial){mixWorker?.terminate();mixWorker=null;mixReject=null;mixBusy=false;$('#playBtn').disabled=false;$('#wavBtn').disabled=false}}
}
function cancelMix(){if(!mixBusy)return;mixSerial++;mixWorker?.terminate();mixWorker=null;mixReject?.(new Error('cancelled'));mixReject=null;mixBusy=false;$('#playBtn').disabled=false;$('#wavBtn').disabled=false;setAudioStatus('曲の作成を中止しました')}
async function playCompat(){stop(false);setAudioStatus('曲を作成中…');const blob=await renderSongAsync();if(!blob){setAudioStatus('再生できる音がありません');toast('音符または録音がありません');return}await playCompatBlob(blob,'曲')}

function setRecStatus(t){const el=$('#recStatus');if(el)el.textContent=t}
async function attachRecordedBlob(blob,tr,sourceLabel='録音'){
  if(!blob||!blob.size)throw new Error('empty audio');
  currentRecordingBlob=blob;tr.recordBlob=blob;tr.recordStart=Math.max(0,+$('#recordStart').value||0);
  setRecStatus(`${sourceLabel}を解析中…`);
  const ab=await blob.arrayBuffer();
  const actx=await unlockAudio();currentRecordingBuffer=await actx.decodeAudioData(ab.slice(0));
  tr.recordBuffer=currentRecordingBuffer;saveSilent();
  const converted=await convertBufferToNotes(currentRecordingBuffer,tr);
  if(converted)setRecStatus(`${sourceLabel}OK：${currentRecordingBuffer.duration.toFixed(1)}秒 / ${tr.notes.length}音${tr.analysisSummary?' / '+tr.analysisSummary:''}`);
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
function selectedRecordLimit(){const v=+($('#recordLimit')?.value||state.recordLimitSec||300);return [60,180,300].includes(v)?v:300}
function fmtMMSS(sec){sec=Math.max(0,Math.floor(sec));return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}
function stopRecClock(finalize=false){if(recClockTimer){clearInterval(recClockTimer);recClockTimer=null}if(recLimitTimer){clearTimeout(recLimitTimer);recLimitTimer=null}const el=$('#recClock');if(el&&finalize){const elapsed=Math.min(selectedRecordLimit(),Math.max(0,(performance.now()-recStart)/1000));el.textContent=fmtMMSS(elapsed)+' / '+fmtMMSS(selectedRecordLimit())}}
function startRecClock(limit){stopRecClock(false);const el=$('#recClock');const update=()=>{const elapsed=Math.min(limit,Math.max(0,(performance.now()-recStart)/1000));if(el)el.textContent=fmtMMSS(elapsed)+' / '+fmtMMSS(limit)};update();recClockTimer=setInterval(update,250);recLimitTimer=setTimeout(()=>{if(mediaRecorder?.state==='recording'){setRecStatus('最大録音時間 '+Math.round(limit/60)+'分に達したので停止します…');stopRecording()}},limit*1000)}
async function startRecording(){
  if(mediaRecorder?.state==='recording')return stopRecording();
  if(recordPreparing||analysisBusy)return;recordPreparing=true;recordingTrack=currentTrack();stop();setRecStatus('マイクを準備中…');
  if(!canDirectRecord()){
    setRecStatus('この開き方では直接マイクを使えません。音声録音/音声ファイル選択を開きます。');
    toast('直接録音不可 → 音声取り込みを開きます');
    recordPreparing=false;openAudioImport();
    return;
  }
  try{
    const ctx=await unlockAudio();
    rawMediaStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
    const boost=clamp(+($('#inputBoost')?.value||1),1,16);
    mediaStream=rawMediaStream;
    recordAnalyser=null;recordGraph=null;
    try{
      const src=ctx.createMediaStreamSource(rawMediaStream),hp=ctx.createBiquadFilter(),lp=ctx.createBiquadFilter(),gain=ctx.createGain(),lim=ctx.createDynamicsCompressor(),dst=ctx.createMediaStreamDestination(),an=ctx.createAnalyser();
      hp.type='highpass';hp.frequency.value=45;hp.Q.value=.7;lp.type='lowpass';lp.frequency.value=3800;lp.Q.value=.7;
      gain.gain.value=boost;lim.threshold.value=-12;lim.knee.value=10;lim.ratio.value=8;lim.attack.value=.004;lim.release.value=.10;an.fftSize=512;
      src.connect(hp);hp.connect(lp);lp.connect(gain);gain.connect(lim);lim.connect(an);src.connect(dst);
      const monitorLevel=clamp(+($('#monitorLevel')?.value||state.monitorLevel||0),0,1);let monitor=null;
      if(monitorLevel>0){monitor=ctx.createGain();monitor.gain.value=monitorLevel;lim.connect(monitor);monitor.connect(ctx.destination)}
      mediaStream=dst.stream;recordAnalyser=an;recordGraph={src,hp,lp,gain,lim,dst,an,monitor};
      setRecStatus(`● 録音中… 入力ブースト ${boost}倍${monitorLevel>0?` / モニター ${Math.round(monitorLevel*100)}%`:''}`);
    }catch(err){console.warn('processed mic fallback',err);mediaStream=rawMediaStream}
    chunks=[];
    const opts=preferredRecorderOptions();
    mediaRecorder=opts?new MediaRecorder(mediaStream,opts):new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
    mediaRecorder.onerror=e=>{console.error(e);setRecStatus('録音エラー。音声ファイル取り込みを使ってください。')};
    mediaRecorder.onstop=async()=>{
      recordPreparing=true;stopRecClock(true);cleanupMic();setRecUI(false);
      const mime=mediaRecorder?.mimeType||opts?.mimeType||'audio/mp4';
      const blob=new Blob(chunks,{type:mime});
      const tr=recordingTrack;let ok=false;
      try{await attachRecordedBlob(blob,tr,'マイク録音');ok=true}
      catch(e){console.error(e);setRecStatus('録音はできましたが解析できませんでした。別形式の音声で試してください。');toast('録音解析に失敗しました')}
      finally{recordPreparing=false;renderAll();syncSelectedRecording();focusTrackNotes();saveSilent()}
      if(ok&&($('#autoHearRecording')?.value||state.autoHearRecording||'on')==='on'){await new Promise(r=>setTimeout(r,120));await playCompatBlob(blob,'録音した元の声')}
    };
    mediaRecorder.start(250);recordPreparing=false;recStart=performance.now();const limit=selectedRecordLimit();state.recordLimitSec=limit;setRecUI(true);if(!recordGraph)setRecStatus(`● 録音中… 最大 ${Math.round(limit/60)}分 / もう一度押すと停止`);startRecClock(limit);meterLoop();
  }catch(e){
    recordPreparing=false;console.error(e);mediaStream?.getTracks().forEach(t=>t.stop());rawMediaStream?.getTracks().forEach(t=>t.stop());mediaStream=null;rawMediaStream=null;recordGraph=null;recordAnalyser=null;setRecUI(false);
    const msg=e?.name==='NotAllowedError'?'マイク権限が拒否されています。Safariのサイト設定でマイクを許可してください。':'直接録音できません。音声ファイル取り込みを使ってください。';
    setRecStatus(msg);toast(msg);
  }
}
function stopRecording(){if(mediaRecorder?.state==='recording'){if(recLimitTimer){clearTimeout(recLimitTimer);recLimitTimer=null}setRecStatus('録音を停止して解析中…');mediaRecorder.stop()}}
function cleanupMic(){cancelAnimationFrame(recMeterRAF);mediaStream?.getTracks().forEach(t=>t.stop());rawMediaStream?.getTracks().forEach(t=>t.stop());if(recordGraph)for(const n of Object.values(recordGraph)){try{n?.disconnect?.()}catch{}}mediaStream=null;rawMediaStream=null;recordGraph=null;recordAnalyser=null;}
function setRecUI(on){for(const id of ['reconvertBtn','audioImportBtn','importProjectBtn','recordLimit'])$('#'+id).disabled=on;$('#recBox').classList.toggle('recording',on);$('#recBtn').classList.toggle('recording',on);$('#recBtn').textContent=on?'■ 録音停止':'● 声を録音';if(!on)cancelAnimationFrame(recMeterRAF)}
async function meterLoop(){if(!mediaStream&&!rawMediaStream)return;const ctx=ensureAudio();let an=recordAnalyser;if(!an){const src=ctx.createMediaStreamSource(rawMediaStream||mediaStream);an=ctx.createAnalyser();an.fftSize=512;src.connect(an)}const d=new Uint8Array(an.fftSize);function loop(){if(!mediaStream&&!rawMediaStream)return;an.getByteTimeDomainData(d);let s=0;for(const v of d){const x=(v-128)/128;s+=x*x}const rms=Math.sqrt(s/d.length);$('#meterBar').style.width=Math.min(100,rms*720)+'%';recMeterRAF=requestAnimationFrame(loop)}loop()}
let analysisWorker=null,analysisSerial=0,analysisBusy=false;
function analysisOptions(){return Object.fromEntries(['trackingMode','sensitivity','recognitionRange','stabilize','intermediateFilter','minNoteMs'].map(id=>[id,$('#'+id).value]));}
function setBusy(on){analysisBusy=on;if(on){setRecStatus('音程解析を準備中…');$('#analysisProgress').value=0;}$('#cancelAnalysis').hidden=!on;for(const id of ['recBtn','reconvertBtn','audioImportBtn','importProjectBtn'])$('#'+id).disabled=on;$('#analysisProgress').hidden=!on;}
function cancelAnalysis(){analysisSerial++;analysisWorker?.terminate();analysisWorker=null;analysisReject?.(new Error('cancelled'));analysisReject=null;setBusy(false);setRecStatus('解析を中止しました。元の録音と音符は残っています。');}
let analysisReject=null;
async function convertBufferToNotes(buffer,tr){
  if(analysisBusy)return;
  const serial=++analysisSerial,opt=analysisOptions(),bpm=state.bpm,startBeat=tr.recordStart||0,q=+$('#quantize').value||0;
  const mono=new Float32Array(buffer.length);for(let c=0;c<buffer.numberOfChannels;c++){const d=buffer.getChannelData(c);for(let i=0;i<d.length;i++)mono[i]+=d[i]/buffer.numberOfChannels;}
  setBusy(true);let result;
  const progress=p=>{if(serial!==analysisSerial)return;$('#analysisProgress').value=p;setRecStatus(`音程を解析中… ${p}% / 中止しても録音は残ります`);};
  try{
    if(typeof Worker!=='undefined'){
      try{
        const url=URL.createObjectURL(new Blob([KotobaPitch.workerSource],{type:'text/javascript'}));
        analysisWorker=new Worker(url);URL.revokeObjectURL(url);
        result=await new Promise((resolve,reject)=>{analysisReject=reject;analysisWorker.onmessage=e=>{if(e.data.progress!=null)progress(e.data.progress);else if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.result)};analysisWorker.onerror=e=>reject(new Error(e.message));analysisWorker.postMessage({samples:mono,sampleRate:buffer.sampleRate,opt},[mono.buffer])});
      }catch(e){if(serial!==analysisSerial)throw e;throw new Error('解析を開始できません。ページを再読み込みしてください。 '+e.message)}
    }else result=await KotobaPitch.analyze(mono,buffer.sampleRate,opt,progress);
    if(serial!==analysisSerial)return;
    const spb=60/bpm;
    const notes=result.notes.map(n=>{let st=n.start/spb+startBeat,end=n.end/spb+startBeat;if(q){st=Math.round(st/q)*q;end=Math.max(st+q,Math.round(end/q)*q)}return {id:uid(),midi:n.midi,start:Math.max(0,st),dur:Math.max(.01,end-st),vel:n.vel,confidence:n.confidence,uncertain:n.uncertain};});
    // Adjacent quantized melody notes share a boundary, never overlap accidentally.
    if(q)for(let i=0;i<notes.length-1;i++)if(notes[i].start+notes[i].dur>notes[i+1].start){if(notes[i+1].start>notes[i].start)notes[i].dur=notes[i+1].start-notes[i].start;else notes[i].dur=0;}
    tr.notes=notes.filter(n=>n.dur>0);state.selectedNote=state.selectedTrack===tr.id?tr.notes[0]?.id||null:state.selectedNote;
    tr.analysisSummary=`${tr.notes.length}音 / 要確認 ${result.lowConfidence}音`;
    setRecStatus(`変換完了：${tr.analysisSummary}。黄色の音符は音程を確認してください。`);toast(`${tr.notes.length}音に変換しました`);saveSilent();return true;
  }catch(e){if(serial===analysisSerial){setRecStatus(e.message);toast('解析できませんでした。録音は残っています。')}}
  finally{if(serial===analysisSerial){analysisWorker?.terminate();analysisWorker=null;analysisReject=null;setBusy(false)}}
}
async function reconvert(){if(recordPreparing||mediaRecorder?.state==='recording'||analysisBusy)return toast('録音が終わってから再変換してください');const tr=currentTrack();const buf=tr.recordBuffer;if(!buf)return toast('このトラックに録音がありません');await convertBufferToNotes(buf,tr);renderAll();focusTrackNotes()}
function syncSelectedRecording(){const tr=currentTrack();currentRecordingBlob=tr?.recordBlob||null;currentRecordingBuffer=tr?.recordBuffer||null;$('#recordStart').value=tr?.recordStart||0}
async function hearVoice(){const tr=currentTrack();if(!tr?.recordBlob)return toast('録音がありません');await playCompatBlob(tr.recordBlob,'元の声')}
function demo(){const tr=currentTrack(),base=tr.type==='bass'?40:tr.type==='violin'?67:60;tr.notes=[];[0,2,4,5,7,5,4,2].forEach((p,i)=>tr.notes.push({id:uid(),midi:base+p,start:i*.5,dur:.45,vel:.75}));state.selectedNote=tr.notes[0].id;renderAll();saveSilent()}
function blobToBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})}
async function exportProject(){
  try{setAudioStatus('録音を含むプロジェクトを作成中…');const recordings=[];for(const tr of state.tracks)if(tr.recordBlob)recordings.push({id:tr.id,mime:tr.recordBlob.type,base64:await blobToBase64(tr.recordBlob)});
  const out={version:'3.1',state:metadata(),recordings};downloadBlob(new Blob([JSON.stringify(out)],{type:'application/json'}),'Kotoba-Music-v3.1-project.json');setAudioStatus('録音を含め書き出しました')}catch(e){toast('書出しに失敗しました。 '+e.message)}
}
async function importProject(file){
  if(recordPreparing||analysisBusy||mediaRecorder?.state==='recording')return toast('録音・解析が終わってから開いてください');
  try{
    const x=JSON.parse(await file.text()),newState=normalizeState(x.state);if(x.recordings&&!Array.isArray(x.recordings))throw new Error('録音データが不正です');
    const ctx=await unlockAudio();for(const r of x.recordings||[]){const tr=newState.tracks.find(t=>t.id===r.id);if(!tr)continue;const bin=atob(r.base64),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);tr.recordBlob=new Blob([bytes],{type:r.mime||'audio/mp4'});tr.recordBuffer=await ctx.decodeAudioData(bytes.buffer.slice(0));}
    stop();state=newState;applyZoom(state.zoom,false);renderAll();syncSelectedRecording();focusTrackNotes();saveSilent();toast('録音と音符を開きました');
  }catch(e){toast('プロジェクトを読めませんでした');setAudioStatus(e.message)}
}

function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
async function exportWav(){stop();toast('WAVを作成中…');await new Promise(r=>setTimeout(r,0));const blob=await renderSongAsync();if(!blob)return toast('書き出す音がありません');downloadBlob(blob,'Kotoba-Music.wav');toast('WAVを書き出しました')}
function trackAudible(tr){return !tr.mute&&(!state.tracks.some(t=>t.solo)||tr.solo)}
function songEndBeat(){let end=.5,spb=60/state.bpm;for(const tr of state.tracks){for(const n of tr.notes)end=Math.max(end,n.start+n.dur);if(tr.type==='voice'&&tr.recordBuffer)end=Math.max(end,(tr.recordStart||0)+tr.recordBuffer.duration/spb)}return end;}
function focusTrackNotes(){const tr=currentTrack(),n=tr?.notes[0];if(n){const [lo,hi]=range();if(tr.notes.some(x=>x.midi<lo||x.midi>hi)){state.rangeMode='extreme';renderAll()}scrollNoteIntoView(n)}else{const [lo,hi]=range();$('#rollWrap').scrollTop=(hi-(tr?.type==='bass'?40:60))*CELL_H-160}}
function compatTick(){const a=$('#compatPlayer');if(!compatIsSong||a.paused)return;$('#time').textContent=fmt(a.currentTime);const p=$('#playhead');if(p)p.style.left=(a.currentTime*state.bpm/60*CELL_W)+'px';raf=requestAnimationFrame(compatTick)}
function initAdvancedUI(){
  $('#undoBtn').onclick=undo;$('#redoBtn').onclick=redo;$('#cancelAnalysis').onclick=cancelAnalysis;
  $('#soloPlayBtn').onclick=async()=>{const solo=state.tracks.map(t=>t.solo);state.tracks.forEach(t=>t.solo=t.id===state.selectedTrack);try{await play()}finally{state.tracks.forEach((t,i)=>t.solo=solo[i]);renderTracks()}};
  for(const id of ['trackingMode','sensitivity','recognitionRange','stabilize','intermediateFilter','minNoteMs','quantize','inputBoost']){
    const el=$('#'+id);if(state[id]!=null)el.value=state[id];el.onchange=()=>{state[id]=el.value;if(id==='trackingMode'&&el.value==='fast'){state.minNoteMs=30;$('#minNoteMs').value='30';}if(id==='inputBoost'&&recordGraph)recordGraph.gain.gain.value=clamp(+el.value,1,16);saveSilent();toast('設定を保存しました。録音を再変換で反映します。')};
  }
  $('#deleteNote').title='元に戻すボタンで戻せます';
  document.addEventListener('click',e=>{if(!appReady&&e.target.closest('button,input,select')){e.preventDefault();e.stopImmediatePropagation();toast('保存データを読み込み中です。少しお待ちください。')}},true);
  document.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea'))return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){persistNow().catch(()=>{});if(mediaRecorder?.state==='recording'){stopRecording();setRecStatus('画面が非表示になったため録音を停止します。')}}});
  // Block track changes/deletion while a recorder owns a track.
  $('#trackList').addEventListener('click',e=>{if((recordPreparing||mediaRecorder?.state==='recording'||analysisBusy)&&e.target.closest('[data-sel],[data-deltrack]')){e.preventDefault();e.stopImmediatePropagation();toast('録音・解析が終わってからパートを変更してください')}},true);
  const originalAdd=$('#addTrackBtn').onclick;$('#addTrackBtn').onclick=e=>{if(recordPreparing||mediaRecorder?.state==='recording'||analysisBusy)return toast('録音・解析が終わってから追加してください');originalAdd(e)};
  $('#bpm').addEventListener('change',()=>{stop();renderRoll()});
}

$('#playBtn').onclick=()=>play(0);$('#stopBtn').onclick=()=>{cancelMix();stop()};$('#testC4Btn').onclick=()=>testExactPitch(60);$('#testToneBtn').onclick=testTone;$('#testC5Btn').onclick=()=>testExactPitch(72);$('#outputMode').onchange=e=>{state.outputMode=e.target.value;saveSilent();setAudioStatus(e.target.value==='compat'?'iPad互換再生を使用':'Web Audio再生を使用')};$('#masterBoost').onchange=e=>{state.masterBoost=+e.target.value||2;saveSilent();toast('全体音量 '+Math.round(state.masterBoost*100)+'%')};$('#instrumentBoost').onchange=e=>{state.instrumentBoost=+e.target.value||2.5;saveSilent();toast('ボイス以外の楽器 '+Math.round(state.instrumentBoost*100)+'%')};$('#monitorLevel').onchange=e=>{state.monitorLevel=+e.target.value||0;saveSilent();if(recordGraph){if(!recordGraph.monitor){recordGraph.monitor=ensureAudio().createGain();recordGraph.lim.connect(recordGraph.monitor);recordGraph.monitor.connect(ensureAudio().destination)}recordGraph.monitor.gain.value=state.monitorLevel;}if(state.monitorLevel>0)toast('録音モニターはイヤホン推奨')};$('#autoHearRecording').onchange=e=>{state.autoHearRecording=e.target.value;saveSilent()};$('#recordLimit').onchange=e=>{state.recordLimitSec=[60,180,300].includes(+e.target.value)?+e.target.value:300;const el=$('#recClock');if(el)el.textContent='00:00 / '+fmtMMSS(state.recordLimitSec);saveSilent();toast('最大録音時間 '+Math.round(state.recordLimitSec/60)+'分')};$('#bpm').onchange=e=>{state.bpm=clamp(+e.target.value||100,40,240);saveSilent()};
$('#saveBtn').onclick=saveLocal;$('#exportProjectBtn').onclick=exportProject;$('#importProjectBtn').onclick=()=>$('#importFile').click();$('#importFile').onchange=e=>e.target.files[0]&&importProject(e.target.files[0]);$('#wavBtn').onclick=exportWav;
$('#addTrackBtn').onclick=()=>{const type=$('#newTrackType').value,count=state.tracks.filter(t=>t.type===type).length+1,tr=defaultTrack(type,count);state.tracks.push(tr);state.selectedTrack=tr.id;state.selectedNote=null;syncSelectedRecording();renderAll();focusTrackNotes();saveSilent()};
$('#recBtn').onclick=startRecording;$('#audioImportBtn').onclick=openAudioImport;$('#audioCaptureFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;if(recordPreparing||mediaRecorder?.state==='recording'||analysisBusy)return;recordPreparing=true;const tr=currentTrack();try{setRecStatus('音声を読み込み中…');await attachRecordedBlob(file,tr,'音声ファイル');renderAll()}catch(err){console.error(err);setRecStatus('この音声を読み込めませんでした。m4a / mp4 / wav などで試してください。');toast('音声を読み込めませんでした')}finally{recordPreparing=false;syncSelectedRecording();focusTrackNotes();saveSilent()}};$('#reconvertBtn').onclick=reconvert;$('#hearVoiceBtn').onclick=hearVoice;$('#recordStart').onchange=e=>{const tr=currentTrack();if(tr){tr.recordStart=Math.max(0,+e.target.value||0);saveSilent()}};$('#recognitionRange').onchange=()=>{toast('認識音域を変更しました。録音を再変換してください')};
$('#labelMode').onchange=e=>{state.labelMode=e.target.value;renderAll();saveSilent()};$('#snap').onchange=e=>{state.snap=+e.target.value;saveSilent()};$('#rangeMode').onchange=e=>{state.rangeMode=e.target.value;renderAll();saveSilent()};$('#zoomOutBtn').onclick=()=>applyZoom((state.zoom||1)-.25);$('#zoomInBtn').onclick=()=>applyZoom((state.zoom||1)+.25);$('#zoomResetBtn').onclick=()=>applyZoom(1);$('#expandEditorBtn').onclick=toggleEditorExpand;
$('#addNoteBtn').onclick=()=>{const tr=currentTrack();addNote(tr.type==='bass'?40:tr.type==='violin'?67:60)};$('#deleteNote').onclick=()=>{const tr=currentTrack();if(!state.selectedNote)return;tr.notes=tr.notes.filter(n=>n.id!==state.selectedNote);state.selectedNote=null;renderAll();saveSilent()};
$('#octDown').onclick=()=>{const tr=currentTrack(),targets=state.selectedNote?tr.notes.filter(n=>n.id===state.selectedNote):tr.notes;targets.forEach(n=>n.midi=clamp(n.midi-12,0,127));renderAll();saveSilent()};$('#octUp').onclick=()=>{const tr=currentTrack(),targets=state.selectedNote?tr.notes.filter(n=>n.id===state.selectedNote):tr.notes;targets.forEach(n=>n.midi=clamp(n.midi+12,0,127));renderAll();saveSilent()};
$('#notePitch').onchange=e=>{const n=currentNote();if(n){n.midi=+e.target.value;renderRoll();renderNotePanel();saveSilent()}};$('#noteStart').onchange=e=>{const n=currentNote();if(n){n.start=Math.max(0,+e.target.value||0);renderRoll();saveSilent()}};$('#noteDur').onchange=e=>{const n=currentNote();if(n){n.dur=Math.max(.01,+e.target.value||.01);renderRoll();saveSilent()}};$('#noteVel').oninput=e=>{const n=currentNote();if(n){n.vel=+e.target.value;saveSilent()}};$('#previewNote').onclick=()=>preview();$('#demoBtn').onclick=demo;
if(!loadLocal())initTracks();if(!state.masterBoost)state.masterBoost=2;if(!state.instrumentBoost)state.instrumentBoost=2.5;if(state.monitorLevel==null)state.monitorLevel=0;if(!state.autoHearRecording)state.autoHearRecording='on';if(![60,180,300].includes(+state.recordLimitSec))state.recordLimitSec=300;if(!state.zoom)state.zoom=1;if(!state.outputMode)state.outputMode='compat';if($('#masterBoost'))$('#masterBoost').value=String(state.masterBoost);if($('#instrumentBoost'))$('#instrumentBoost').value=String(state.instrumentBoost);if($('#monitorLevel'))$('#monitorLevel').value=String(state.monitorLevel);if($('#autoHearRecording'))$('#autoHearRecording').value=state.autoHearRecording;if($('#recordLimit'))$('#recordLimit').value=String(state.recordLimitSec);if($('#recClock'))$('#recClock').textContent='00:00 / '+fmtMMSS(state.recordLimitSec);applyZoom(state.zoom,false);renderAll();syncSelectedRecording();initPinchZoom();initDoubleTapAdd();initAdvancedUI();restoreRecordings();focusTrackNotes();const cp=$('#compatPlayer');if(cp){cp.onplay=()=>{setAudioStatus('再生中');if(compatIsSong)compatTick()};cp.onpause=()=>{if(cp.currentTime&&cp.currentTime<cp.duration)setAudioStatus('一時停止')};cp.onended=()=>setAudioStatus('再生終了');cp.onerror=()=>setAudioStatus('音声を再生できませんでした')};document.addEventListener('pointerdown',()=>{unlockAudio().catch(()=>{})},{once:true,passive:true});if(!canDirectRecord())setRecStatus('ZIP/ローカル表示では直接マイクが制限される場合があります。録音ボタンは音声取り込みへ自動切替します。');
})();
