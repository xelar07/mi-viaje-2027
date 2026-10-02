const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const initial=JSON.parse(fs.readFileSync('app/trip.json','utf8'));
let nativeCalls=0;
function browserFetch(){if(this?.browserMarker!==true)throw new TypeError('Illegal invocation');nativeCalls++;return Promise.resolve(Response.json({}, {status:403}));}
const exportsObj={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/google-drive.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports:exportsObj,require:()=>initial,fetch:browserFetch,browserMarker:true,Response,TextEncoder,Date,JSON,crypto:globalThis.crypto});
const {DriveStore}=exportsObj;
function mock(){let etag='"v1"',state=structuredClone(initial),revision=1,editable=true;const calls=[];let fail=0,race=false;
 const request=async(url,opt={})=>{calls.push({url,opt});if(fail)return Response.json({}, {status:fail});if(opt.method==='PUT'){assert.equal(opt.headers['If-Match'],etag);if(race)return Response.json({}, {status:412});const body=JSON.parse(opt.body);state=body.state;revision=body.revision;etag='"v'+revision+'"';return Response.json({id:'file_1',etag,title:'Viaje',editable});}if(opt.method==='POST'){assert.match(opt.body,/Nuestro viaje/);return Response.json({id:'file_1'});}if(url.includes('alt=media'))return Response.json({state,revision});return Response.json({id:'file_1',title:'Viaje',etag,editable,mimeType:'application/json',fileSize:1000,labels:{trashed:false}});};
 return {request,calls,setETag:v=>etag=v,setEditable:v=>editable=v,setFail:v=>fail=v,setRace:v=>race=v};}
(async()=>{
 const nativeStore=new DriveStore();nativeStore.authorize('test-token');await assert.rejects(()=>nativeStore.create(initial),e=>e.code===403);assert.equal(nativeCalls,1);

 let m=mock(),d=new DriveStore(m.request);d.authorize('test-token');const x=await d.read('file_1');assert.equal(x.state.days.length,22);assert.equal(x.canEdit,true);const next=structuredClone(initial);next.travelers[0].name='Viajero actualizado';await d.write(next);assert.equal((await d.read()).state.travelers[0].name,'Viajero actualizado');assert.equal(m.calls.filter(c=>c.opt.method==='PUT').length,1);
 m.setETag('"other"');await assert.rejects(()=>d.write(initial),e=>e.code===409);assert.equal(m.calls.filter(c=>c.opt.method==='PUT').length,1);
 await d.read();m.setRace(true);await assert.rejects(()=>d.write(initial),e=>e.code===409);
 m=mock();m.setEditable(false);d=new DriveStore(m.request);d.authorize('test-token');await d.read('file_1');await assert.rejects(()=>d.write(initial));assert.equal(m.calls.filter(c=>c.opt.method==='PUT').length,0);
 m=mock();d=new DriveStore(m.request);d.authorize('test-token',0);await assert.rejects(()=>d.read('file_1'),e=>e.code===401);assert.equal(m.calls.length,0);
 for(const code of [401,403,404,429]){m=mock();m.setFail(code);d=new DriveStore(m.request);d.authorize('test-token');await assert.rejects(()=>d.read('file_1'),e=>e.code===code);}
 m=mock();d=new DriveStore(m.request);d.authorize('test-token');await d.create(initial);assert.equal(d.fileId,'file_1');assert.equal(m.calls.filter(c=>c.opt.method==='POST').length,1);
 assert.throws(()=>exportsObj.validatePlan({days:[],travelers:[]}));
 console.log('Correcto: carga, guardado condicional, lectura posterior, conflictos antes y durante escritura, solo lectura, sesión vencida, errores de permisos/API, creación y validación de formato. Pruebas con Drive simulado.');
})().catch(e=>{console.error(e);process.exitCode=1});
