import type {Claim} from './data';
export function formatTime(seconds:number){const s=Math.max(0,Math.floor(seconds));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':');}
export function checksAt(claims:Claim[],videoId:string,seconds:number,live:boolean){return claims.filter(c=>c.status==='approved'&&c.videoId===videoId&&(live||c.seconds<=seconds+1)).sort((a,b)=>live?a.createdAt-b.createdAt:a.seconds-b.seconds);}
