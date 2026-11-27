import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
export const ADDRESS_CATALOG=[
 {id:'constitution-hill',name:'Constitution Hill, Johannesburg',lat:-26.1885859,lon:28.0425438},
 {id:'johannesburg-city-hall',name:'Johannesburg City Hall',lat:-26.2044087,lon:28.0410794},
 {id:'cape-town-civic',name:'Cape Town Civic Centre',lat:-33.9218,lon:18.4285},
] as const;
export const ADDRESS_DISCLAIMER='UNKNOWN exact-address match. Dated public visual context only, not proof of residence, identity, ownership, fraud or benefit entitlement. Provider coordinates and imagery require human comparison. Missing imagery is not evidence of fraud.';
export function metres(a:number,b:number,c:number,d:number){const rad=Math.PI/180,x=Math.sin((c-a)*rad/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;return Math.round(6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)))}
export function imageURL(raw:string){if(!/^storage\d+\/files\/photo\/[A-Za-z0-9_./-]+\.jpg$/.test(raw)||raw.includes('..'))throw Error('IMAGE_PATH_DENIED');const slash=raw.indexOf('/');const original='https://'+raw.slice(0,slash)+'.openstreetcam.org'+raw.slice(slash);return'https://cdn.kartaview.org/insecure/'+Buffer.from(original).toString('base64url')}
export class AddressEvidence{
 constructor(public root:string){mkdirSync(root,{recursive:true})}
 async lookup(caseRef:string,landmarkId:string){
  if(!/^SYN-[A-Z0-9-]+$/.test(caseRef))throw Error('SYNTHETIC_CASE_REQUIRED');const place=ADDRESS_CATALOG.find(x=>x.id===landmarkId);if(!place)throw Error('PUBLIC_SYNTHETIC_LANDMARK_REQUIRED');
  const capturedAt=new Date().toISOString(),id='address-'+randomUUID();let candidates:any[]=[],geocoderError:string|null=null;
  const geocoderURL='https://photon.komoot.io/api/?'+new URLSearchParams({q:place.name,limit:'3'});
  try{const r=await fetch(geocoderURL,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('GEOCODER_HTTP_'+r.status);const j=await r.json()as any;candidates=(j.features||[]).map((x:any)=>({coordinates:x.geometry?.coordinates,properties:x.properties}));}catch(e){geocoderError=String(e)}
  const metadataURL='https://api.kartaview.org/1.0/list/nearby-photos/';let photos:any[]=[],providerError:string|null=null;
  try{const r=await fetch(metadataURL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','user-agent':'NahaShield-Synthetic-Review/1.0'},body:new URLSearchParams({lat:String(place.lat),lng:String(place.lon),radius:'2000',ipp:'6',page:'1'}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('IMAGERY_METADATA_HTTP_'+r.status);const j=await r.json()as any;
   photos=(j.currentPageItems||[]).slice(0,6).filter((p:any)=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))).map((p:any)=>({provider:'KartaView',provider_photo_id:String(p.id),source_url:imageURL(p.lth_name),coordinates:{lat:Number(p.lat),lon:Number(p.lng)},distance_m:metres(place.lat,place.lon,Number(p.lat),Number(p.lng)),imagery_date:p.shot_date||null,author:p.username||'Unknown contributor',licence:'CC-BY-SA-4.0',licence_url:'https://creativecommons.org/licenses/by-sa/4.0/',attribution:'© Grab and KartaView Contributors',capture_date:capturedAt,exact_address_match:'UNKNOWN',status:'metadata_only'}));
  }catch(e){providerError=String(e)}
  for(const p of photos.slice(0,3)){try{const r=await fetch(p.source_url,{redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('IMAGE_HTTP_'+r.status);if(!r.headers.get('content-type')?.startsWith('image/'))throw Error('IMAGE_TYPE_DENIED');if(Number(r.headers.get('content-length')||0)>5000000)throw Error('IMAGE_TOO_LARGE');const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>5000000||bytes[0]!==255||bytes[1]!==216)throw Error('JPEG_REQUIRED');p.binary_sha256=createHash('sha256').update(bytes).digest('hex');p.byte_size=bytes.length;p.filename=p.binary_sha256+'.jpg';writeFileSync(path.join(this.root,p.filename),bytes);p.status='original_cached_unverified';}catch(e){p.error=String(e)}}
  const out={id,case_ref:caseRef,place,search_terms:place.name,capture_date:capturedAt,geocoder_url:geocoderURL,geocoder_candidates:candidates,geocoder_error:geocoderError,metadata_url:metadataURL,provider_error:providerError,photos,disclaimer:ADDRESS_DISCLAIMER,verification:'UNKNOWN',human_review_required:true};writeFileSync(path.join(this.root,id+'.json'),JSON.stringify(out,null,2));return out;
 }
 get(id:string){if(!/^address-[a-f0-9-]{36}$/.test(id))throw Error('ADDRESS_ID_DENIED');const p=path.join(this.root,id+'.json');if(!existsSync(p))throw Error('ADDRESS_NOT_FOUND');return JSON.parse(readFileSync(p,'utf8'))}
 original(id:string,hash:string){const report=this.get(id);const p=report.photos.find((x:any)=>x.binary_sha256===hash&&x.status==='original_cached_unverified');if(!p)throw Error('ORIGINAL_NOT_FOUND');const bytes=readFileSync(path.join(this.root,p.filename));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('ORIGINAL_HASH_MISMATCH');return{photo:p,bytes,report}}
}
