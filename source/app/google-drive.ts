import initial from './trip.json';
export type GoogleConfig={clientId:string,apiKey:string,projectNumber:string,fileId?:string};
export class DriveError extends Error {constructor(message:string,public code=0){super(message)}}
export function validatePlan(state:any){
 if(!state||!Object.keys(initial).every(k=>Array.isArray(state[k]))||state.travelers.length!==5||state.days.length!==22||state.days.some((d:any)=>!d.date||!Array.isArray(d.blocks)))throw new DriveError('Este archivo no corresponde al planificador de cinco viajeros.');
 return state;
}
export class DriveStore {
 private token=''; private expires=0; private etag=''; private revision=0;
 fileId=''; title=''; canEdit=false;
 constructor(private request:typeof fetch=(...args)=>globalThis.fetch(...args)){}
 authorize(token:string,expiresIn=3600){this.token=token;this.expires=Date.now()+Number(expiresIn)*1000-30000;}
 disconnect(){this.token='';this.expires=0;this.etag='';this.canEdit=false;}
 private async api(url:string,options:RequestInit={}):Promise<any>{
  if(!this.token||Date.now()>=this.expires)throw new DriveError('Vuelve a conectar con Google para continuar. Tu edición sigue disponible para exportar.',401);
  let r:Response;try{r=await this.request(url,{...options,cache:'no-store',headers:{...options.headers,Authorization:'Bearer '+this.token}})}catch(error){const detail=error instanceof Error?error.message:'';throw new DriveError('No se pudo completar la petición a Google Drive.'+(detail?' Detalle: '+detail:'')+' Conserva tu edición con Exportar copia.');}
  if(r.status===412||r.status===409)throw new DriveError('Otro viajero modificó el plan. Exporta tu edición y pulsa Actualizar desde Drive antes de continuar.',409);
  if(r.status===401)throw new DriveError('La sesión de Google venció. Pulsa Conectar con Google de nuevo.',401);
  if(r.status===403)throw new DriveError('Google no permitió esta operación. Comprueba que tienes permiso de Editor y que las APIs están habilitadas.',403);
  if(r.status===404)throw new DriveError('Selecciona el archivo con Elegir viaje de Drive. Comprueba que está compartido con esta cuenta.',404);
  if(!r.ok)throw new DriveError('Google Drive no completó la operación ('+r.status+'). Reintenta o exporta una copia.',r.status);
  return r.json();
 }
 private metadata(id:string){return this.api('https://www.googleapis.com/drive/v2/files/'+encodeURIComponent(id)+'?fields=id,title,etag,editable,mimeType,fileSize,labels(trashed)&supportsAllDrives=true');}
 async read(id=this.fileId){
  if(!/^[\w-]+$/.test(id))throw new DriveError('Elige el archivo compartido del viaje.');
  for(let attempt=0;attempt<3;attempt++){
   const before=await this.metadata(id);
   if(before.labels?.trashed||before.mimeType!=='application/json'||Number(before.fileSize)>1500000)throw new DriveError('Selecciona un archivo JSON del planificador, de hasta 1,5 MB.');
   if(!before.etag)throw new DriveError('No se pudo comprobar la versión de Drive. Se bloqueó el guardado para proteger los cambios.');
   const payload=await this.api('https://www.googleapis.com/drive/v2/files/'+encodeURIComponent(id)+'?alt=media&supportsAllDrives=true');
   const after=await this.metadata(id);if(before.etag!==after.etag)continue;
   const state=validatePlan(payload.state??payload);this.fileId=id;this.title=after.title;this.etag=after.etag;this.canEdit=after.editable===true;this.revision=Number.isInteger(payload.revision)?payload.revision:0;
   return {state,revision:this.revision,canEdit:this.canEdit};
  }
  throw new DriveError('El plan está cambiando mientras lo cargas. Espera unos segundos y pulsa Actualizar desde Drive.');
 }
 async write(state:any){
  validatePlan(state);if(!this.fileId||!this.etag||!this.canEdit)throw new DriveError('Carga un viaje y comprueba tu permiso de Editor antes de guardar.');
  const data=JSON.stringify({format:'viaje-europa-egipto-v1',state,revision:this.revision+1,updatedAt:new Date().toISOString()});
  if(new TextEncoder().encode(data).length>1500000)throw new DriveError('El plan supera 1,5 MB. Guarda fotografías y documentos como enlaces.');
  const current=await this.metadata(this.fileId);if(current.etag!==this.etag)throw new DriveError('Otro viajero modificó el plan. Exporta tu edición y pulsa Actualizar desde Drive antes de continuar.',409);
  const updated=await this.api('https://www.googleapis.com/upload/drive/v2/files/'+encodeURIComponent(this.fileId)+'?uploadType=media&newRevision=true&fields=id,title,etag,editable&supportsAllDrives=true',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':this.etag},body:data});
  // Never replace the expected version with a later metadata fetch: that could hide another writer.
  if(!updated.etag){this.canEdit=false;throw new DriveError('Drive recibió la petición, pero no confirmó la versión. Exporta tu edición y vuelve a cargar para comprobar el resultado.');}
  this.etag=updated.etag;this.revision++;return {revision:this.revision};
 }
 async create(state:any){
  validatePlan(state);const boundary='viaje_'+crypto.randomUUID().replaceAll('-','');
  const body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify({title:'Nuestro viaje · Europa y Egipto 2027.json',mimeType:'application/json'})+'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify({format:'viaje-europa-egipto-v1',state,revision:1})+'\r\n--'+boundary+'--';
  const x=await this.api('https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
  return this.read(x.id);
 }
}
const w=()=>window as any;
let client:any;
function script(src:string){return new Promise<void>((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=true;s.onload=()=>resolve();s.onerror=()=>reject(new Error('No se pudo cargar Google. Comprueba tu conexión.'));document.head.appendChild(s);});}
export async function initializeGoogle(config:GoogleConfig){
 if(!config.clientId?.endsWith('.apps.googleusercontent.com')||!config.apiKey||!/^\d+$/.test(config.projectNumber))throw new Error('Falta completar google-config.json. Sigue la guía CONFIGURAR_GOOGLE_DRIVE.md.');
 await Promise.all([script('https://accounts.google.com/gsi/client'),script('https://apis.google.com/js/api.js')]);
 await new Promise<void>((resolve,reject)=>w().gapi.load('picker',{callback:resolve,onerror:()=>reject(new Error('No se pudo cargar el selector de Drive.')),timeout:15000,ontimeout:()=>reject(new Error('El selector de Drive tardó demasiado. Recarga la página.'))}));
 client=w().google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:'https://www.googleapis.com/auth/drive.file',callback:()=>{}});
}
export function connectGoogle(){return new Promise<{access_token:string,expires_in:number}>((resolve,reject)=>{
 if(!client)return reject(new Error('Espera a que Google termine de cargar.'));
 client.callback=(r:any)=>{if(r.error||!r.access_token)return reject(new Error('Google no autorizó el acceso al archivo. Vuelve a intentar.'));if(!w().google.accounts.oauth2.hasGrantedAllScopes(r,'https://www.googleapis.com/auth/drive.file'))return reject(new Error('Autoriza el permiso para los archivos del viaje.'));resolve(r)};
 client.error_callback=()=>reject(new Error('No se completó la conexión. Permite la ventana emergente e intenta de nuevo.'));
 client.requestAccessToken({prompt:'select_account'});
});}
export function chooseDriveFile(config:GoogleConfig,token:string){return new Promise<string|null>(resolve=>{
 const g=w().google.picker;const view=new g.DocsView(g.ViewId.DOCS).setMimeTypes('application/json').setMode(g.DocsViewMode.LIST);
 const picker=new g.PickerBuilder().addView(view).setAppId(config.projectNumber).setDeveloperKey(config.apiKey).setOAuthToken(token).setOrigin(location.origin).setTitle('Selecciona el viaje compartido').setCallback((d:any)=>{if(d.action===g.Action.PICKED)resolve(d.docs[0].id);else if(d.action===g.Action.CANCEL)resolve(null)}).build();picker.setVisible(true);
});}
