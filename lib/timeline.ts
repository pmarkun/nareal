import type {Claim} from './data';
export function formatTime(seconds:number){const s=Math.max(0,Math.floor(seconds));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':');}
export function checksAt(claims:Claim[],videoId:string,seconds:number,live:boolean){return claims.filter(c=>c.status==='approved'&&c.videoId===videoId&&(live||c.seconds<=seconds+1)).sort((a,b)=>live?a.createdAt-b.createdAt:a.seconds-b.seconds);}

// Rows must be ordered by start. Explicit gaps have no active transcript block.
export function transcriptAt<T extends {start:number|null,end:number|null}>(rows:T[],seconds:number):T|null{
 if(!Number.isFinite(seconds)||seconds<0)return null;
 let low=0,high=rows.length;
 while(low<high){const mid=(low+high)>>>1;const start=rows[mid].start;if(start!==null&&start<=seconds)low=mid+1;else high=mid;}
 for(let index=low-1;index>=0;index--){const row=rows[index];if(row.start===null)continue;const end=row.end??rows[index+1]?.start??Infinity;if(seconds<end)return row;}
 return null;
}
