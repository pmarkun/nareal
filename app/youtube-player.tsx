'use client';
import {useEffect,useRef,useState} from 'react';
declare global{interface Window{YT?:any;onYouTubeIframeAPIReady?:()=>void}}
let apiPromise:Promise<void>|null=null;
function loadAPI(){if(window.YT?.Player)return Promise.resolve();if(!apiPromise)apiPromise=new Promise((resolve,reject)=>{const previous=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{previous?.();resolve();};const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{apiPromise=null;reject(Error('Player indisponível.'));};document.head.appendChild(script);});return apiPromise;}
export default function YouTubePlayer({videoId,onTime,onSeekReady}:{videoId:string,onTime:(t:number)=>void,onSeekReady?:(seek:(seconds:number)=>void)=>void}){
 const frame=useRef<HTMLIFrameElement>(null);const callbacks=useRef({onTime,onSeekReady});callbacks.current={onTime,onSeekReady};
 const [origin,setOrigin]=useState('');const [error,setError]=useState(false);
 useEffect(()=>{setOrigin(window.location.origin);},[]);
 useEffect(()=>{
  if(!origin)return;let player:any;let stopped=false;let timer:ReturnType<typeof setInterval>|undefined;let pending:{seconds:number,until:number}|null=null;setError(false);
  function report(){if(stopped||typeof player?.getCurrentTime!=='function')return;const seconds=player.getCurrentTime();if(!Number.isFinite(seconds))return;if(pending){if(Math.abs(seconds-pending.seconds)>2&&Date.now()<pending.until)return;pending=null;}callbacks.current.onTime(seconds);}
  loadAPI().then(()=>{if(stopped||!frame.current)return;player=new window.YT.Player(frame.current,{events:{onReady:()=>{
   report();callbacks.current.onSeekReady?.(seconds=>{if(stopped||!Number.isFinite(seconds))return;const target=Math.max(0,seconds);pending={seconds:target,until:Date.now()+2500};player.seekTo(target,true);callbacks.current.onTime(target);player.playVideo();});timer=setInterval(report,350);
  },onStateChange:report,onError:()=>{if(!stopped)setError(true);}}});}).catch(()=>{if(!stopped)setError(true);});
  return()=>{stopped=true;if(timer)clearInterval(timer);try{player?.destroy();}catch{}};
 },[videoId,origin]);
 return <div className="watch-video"><iframe key={videoId} ref={frame} title="Debate da Band · transmissão" src={'https://www.youtube.com/embed/'+videoId+'?enablejsapi=1&playsinline=1&rel=0'+(origin?'&origin='+encodeURIComponent(origin):'')} referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen/>{error&&<div className="player-error">O YouTube não conseguiu carregar este vídeo. <a href={'https://www.youtube.com/watch?v='+videoId} target="_blank" rel="noreferrer">Abrir no YouTube ↗</a></div>}</div>;
}
