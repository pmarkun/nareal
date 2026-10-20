import type {Claim} from './data';
export function formatTime(seconds:number){const s=Math.max(0,Math.floor(seconds));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':');}
export function checksAt(claims:Claim[],videoId:string,seconds:number,live:boolean){return claims.filter(c=>c.status==='approved'&&c.videoId===videoId&&(live||c.seconds<=seconds+1)).sort((a,b)=>live?a.createdAt-b.createdAt:a.seconds-b.seconds);}

// The offset belongs to this recording, never to unrelated videos or live inputs.
export function videoStartSeconds(videoId:string){return videoId==='Gqc1rQtzWUk'?15661.52:0;}

export function isPublicClaim(claim:Claim){return !claim.demo&&(claim.status==='approved'||claim.status==='pending'&&claim.publicPreview===true);}
export function publicChecksAt(claims:Claim[],videoId:string,seconds:number,live=false){
 return claims.filter(c=>isPublicClaim(c)&&c.videoId===videoId&&(live||c.seconds<=seconds)).sort((a,b)=>live?b.createdAt-a.createdAt:b.seconds-a.seconds||b.createdAt-a.createdAt);
}
export function currentPublicChecks(claims:Claim[],videoId:string,seconds:number){
 const reached=publicChecksAt(claims,videoId,seconds);
 const latest=reached[0]?.seconds??Infinity;
 return reached.filter(c=>seconds<(c.endSeconds??Math.min(c.seconds+45,c.seconds<latest?latest:Infinity)));
}

type TimedBlock={id:string,start:number|null,end:number|null};
// Private review includes drafts. Public visibility still requires editorial approval.
export function reviewChecksForBlock(claims:Claim[],videoId:string,block:TimedBlock|null){
 if(!block||block.start===null)return [];
 const start=block.start;
 return claims.filter(c=>!c.demo&&c.status!=='closed'&&c.videoId===videoId&&(
  c.transcriptBlockId?c.transcriptBlockId===block.id:
  c.seconds>=start&&(block.end===null?c.seconds===start:c.seconds<block.end)
 )).sort((a,b)=>Number(b.status==='approved')-Number(a.status==='approved')||b.createdAt-a.createdAt||a.seconds-b.seconds);
}

// Rows must be ordered by start. Explicit gaps have no active transcript block.
export function transcriptAt<T extends {start:number|null,end:number|null}>(rows:T[],seconds:number):T|null{
 if(!Number.isFinite(seconds)||seconds<0)return null;
 let low=0,high=rows.length;
 while(low<high){const mid=(low+high)>>>1;const start=rows[mid].start;if(start!==null&&start<=seconds)low=mid+1;else high=mid;}
 for(let index=low-1;index>=0;index--){const row=rows[index];if(row.start===null)continue;const end=row.end??rows[index+1]?.start??Infinity;if(seconds<end)return row;}
 return null;
}
