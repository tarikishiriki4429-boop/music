class KotobaPCMRecorder extends AudioWorkletProcessor {
 constructor(){super();this.pcm=new Float32Array(2048);this.used=0;this.active=true;this.port.onmessage=e=>{if(e.data==='stop'){this.flush();this.active=false;this.port.postMessage({stopped:true})}}}
 flush(){if(!this.used)return;const pcm=this.pcm.slice(0,this.used);this.port.postMessage({pcm},[pcm.buffer]);this.used=0}
 process(inputs){const ch=inputs[0]?.[0];if(this.active&&ch){for(let p=0;p<ch.length;){const n=Math.min(ch.length-p,this.pcm.length-this.used);this.pcm.set(ch.subarray(p,p+n),this.used);this.used+=n;p+=n;if(this.used===this.pcm.length)this.flush()}}return this.active}
}
registerProcessor('kotoba-pcm-recorder',KotobaPCMRecorder);
