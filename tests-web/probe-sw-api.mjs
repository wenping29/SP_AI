const DEBUG='http://127.0.0.1:9333';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
class S{constructor(u){this.ws=new WebSocket(u);this.i=0;this.p=new Map();this.ws.addEventListener('message',(e)=>{const d=JSON.parse(e.data);if(d.id&&this.p.has(d.id)){this.p.get(d.id)(d);this.p.delete(d.id);}});}
open(){return new Promise(r=>this.ws.addEventListener('open',r,{once:true}));}
send(m,pr){const id=++this.i;this.ws.send(JSON.stringify({id,method:m,params:pr||{}}));return new Promise(r=>this.p.set(id,r));}
ev(x){return this.send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}).then(r=>r.result?.result?.value??r);} }
const l=async()=>(await (await fetch(DEBUG+'/json')).json());
const sw=(await l()).find(t=>t.type==='service_worker');
const s=new S(sw.webSocketDebuggerUrl);await s.open();await s.send('Runtime.enable');
console.log(JSON.stringify(await s.ev(`(() => ({ api: Object.keys(chrome.sidePanel), hasClose: typeof chrome.sidePanel.close, behavior: typeof chrome.sidePanel.setPanelBehavior, getOptions: null }))()`),null,1));
const panels=(await l()).filter(t=>/sidepanel\.html/.test(t.url));
console.log('panels', panels.length);
if (panels.length){const p=new S(panels[0].webSocketDebuggerUrl);await p.open();await p.send('Runtime.enable');
console.log('panel innerW', await p.ev('innerWidth'));
console.log('getOptions', JSON.stringify(await p.ev(`chrome.sidePanel.getOptions({windowId: (await chrome.windows.getCurrent()).id ?? 0}).catch(e=>String(e))`).catch(()=>null)));
p.close();}
s.close();process.exit(0);
