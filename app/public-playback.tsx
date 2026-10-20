'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {initialState,type Claim,type Workspace} from '../lib/data';
import {youtubeId} from '../lib/core';
import {currentPublicChecks,formatTime,isPublicClaim,publicChecksAt,videoStartSeconds} from '../lib/timeline';
import YouTubePlayer from './youtube-player';

const filters=[['all','Todas'],['Verdadeiro','Verdadeiro'],['Falso','Falso'],['Enganoso','Enganoso'],['inconclusive','Inconclusivo']] as const;

export default function Watch(){
 const [data,setData]=useState<Workspace>(initialState);
 const [error,setError]=useState('');
 const [ready,setReady]=useState(false);
 useEffect(()=>{
  let active=true,inFlight=false,etag:string|null=null;
  const abort=new AbortController();
  async function refresh(){
   if(inFlight||document.hidden)return;
   inFlight=true;
   try{
    const response=await fetch('/api/workspace?view=public',{headers:etag?{'If-None-Match':etag}:{},signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});
    if(response.status===304){if(active)setError('');return;}
    const result=await response.json();
    if(!response.ok)throw Error(result.error);
    if(active){etag=response.headers.get('ETag');setData(result.state);setReady(true);setError('');}
   }catch{if(active)setError('Não foi possível atualizar as checagens. Tentando novamente…');}
   finally{inFlight=false;}
  }
  void refresh();
  const timer=setInterval(()=>void refresh(),4000);
  const resume=()=>{if(!document.hidden)void refresh();};
  document.addEventListener('visibilitychange',resume);
  return()=>{active=false;abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',resume);};
 },[]);
 return <PublicPlayback key={(youtubeId(data.videoUrl)||'none')+':'+data.videoMode} data={data} ready={ready} error={error}/>;
}

function PublicPlayback({data,ready,error}:{data:Workspace,ready:boolean,error:string}){
 const videoId=youtubeId(data.videoUrl)||'';
 const live=data.videoMode==='live';
 const first=live?0:videoStartSeconds(videoId);
 const [seconds,setSeconds]=useState(first);
 const [filter,setFilter]=useState('all');
 const [limit,setLimit]=useState(5);
 const [playerReady,setPlayerReady]=useState(false);
 const seek=useRef<((seconds:number)=>void)|null>(null);
 const published=useMemo(()=>data.claims.filter(c=>isPublicClaim(c)&&c.videoId===videoId),[data.claims,videoId]);
 const reached=useMemo(()=>publicChecksAt(published,videoId,seconds,live),[published,videoId,seconds,live]);
 const current=useMemo(()=>live?reached.slice(0,1):currentPublicChecks(published,videoId,seconds),[published,videoId,seconds,live,reached]);
 const pool=useMemo(()=>reached.filter(c=>filter==='all'||(filter==='inconclusive'?['Sem evidência','Não verificável'].includes(c.verdict):c.verdict===filter)),[reached,filter]);
 const sources=useMemo(()=>new Map(data.sources.map(s=>[s.id,s])),[data.sources]);
 const previews=published.filter(c=>c.status!=='approved').length;
 function choose(value:string){setFilter(value);setLimit(5);}
 function jump(time:number){seek.current?.(time);}
 function card(claim:Claim){return <FactCard key={claim.id} claim={claim} sources={claim.sourceIds.flatMap(id=>{const source=sources.get(id);return source?[source]:[];})} onJump={()=>jump(claim.seconds)} canJump={playerReady}/>;}
 return <div className="watch facts-page playback-page">
  <header className="watch-header"><a href="/" className="watch-brand">NA REAL <span>por <b>CTRL+Z</b></span></a><a className="watch-admin" href="/admin">Administração</a></header>
  <main className="facts-content">
   <section className="facts-intro"><div><span className="facts-eyebrow">CHECAGEM DO DEBATE</span><h1>Fato ou fake?</h1><p>Assista ao vídeo. A checagem acompanha cada fala.</p></div><div className="facts-refresh"><span className={error?'facts-dot is-offline':'facts-dot'}/><span>{error?'Reconectando':ready?'Atualização automática':'Conectando'}</span></div></section>
   <div className="facts-event"><h2>{data.title}</h2><span>{published.length} análises disponíveis{previews>0?' · '+previews+' preliminares':''}</span></div>
   {previews>0&&<p className="playback-preview-note">As pré-análises estão identificadas como <b>revisão pendente</b>. Podem mudar após conferência das fontes e da transcrição.</p>}
   {error&&<p className="facts-error" role="status">{error}</p>}
   <section className="public-playback-stage" aria-label="Vídeo e checagem sincronizados">
    <div className="public-video-panel">
     {ready&&videoId?<YouTubePlayer videoId={videoId} initialSeconds={first} onTime={setSeconds} onSeekReady={fn=>{seek.current=fn;setPlayerReady(true);}}/>:<div className="public-player-loading">{ready?'Nenhum vídeo configurado.':'Carregando vídeo…'}</div>}
     <div className="public-player-controls"><time data-testid="public-playback-time">{formatTime(seconds)}</time><span>{live?'AO VIVO':'CHECAGENS NO TEMPO DO VÍDEO'}</span>{!live&&<button type="button" disabled={!playerReady} onClick={()=>jump(first)}>Primeira resposta · {formatTime(first)}</button>}</div>
    </div>
    <aside className="playback-now" aria-label="Checagem do trecho em reprodução"><div className="playback-now-heading"><h2>{live?'Última checagem':'Neste trecho'}</h2><span>● {live?'AO VIVO':'SINCRONIZADO'}</span></div><div className="playback-now-scroll" aria-live="polite">
     {current.map(card)}
     {!current.length&&<div className="facts-empty"><span aria-hidden="true">?</span><h2>{!ready?'Carregando análises…':'Sem checagem neste trecho.'}</h2><p>{!ready?'Buscando os resultados disponíveis.':'Ao chegar a uma fala analisada, o resultado e suas fontes aparecem aqui.'}</p>{ready&&published.length===0&&<small>As análises aparecem quando são publicadas pela equipe.</small>}</div>}
    </div></aside>
   </section>
   <section className="playback-history" aria-label="Checagens já alcançadas no vídeo">
    <div className="facts-toolbar"><div><h2>{live?'Últimas checagens':'Checagens até '+formatTime(seconds)}</h2><div className="facts-filters" role="group" aria-label="Filtrar histórico por veredito">{filters.map(([value,label])=><button key={value} type="button" aria-pressed={filter===value} onClick={()=>choose(value)}>{label}</button>)}</div></div><details className="facts-method"><summary>Como funciona</summary><p>Na gravação, o resultado acompanha o horário da fala. Avançar ou voltar no vídeo também muda a checagem. Clique em “Ouvir esta fala” para voltar ao trecho.</p><p>Pré-análises são sugestões ainda não revisadas. Só resultados aprovados recebem o selo “Revisado”. Falta de evidência não significa que uma afirmação seja falsa.</p></details></div>
    <div className="facts-list">{pool.slice(0,limit).map(card)}{ready&&!pool.length&&<p className="playback-history-empty">{reached.length?'Nenhuma checagem com esse filtro neste ponto do vídeo.':'As checagens já alcançadas ficarão disponíveis aqui.'}</p>}</div>
    {pool.length>limit&&<button type="button" className="btn facts-more" onClick={()=>setLimit(n=>n+5)}>Ver mais checagens ↓</button>}
   </section>
   <footer className="facts-footer"><b>NA REAL / CTRL+Z</b><span>Fontes abertas. Confira o status de revisão.</span></footer>
  </main>
 </div>;
}

function FactCard({claim,sources,onJump,canJump}:{claim:Claim,sources:Workspace['sources'],onJump:()=>void,canJump:boolean}){
 const tone=claim.verdict==='Falso'?'false':claim.verdict==='Verdadeiro'?'true':claim.verdict==='Enganoso'?'misleading':'inconclusive';
 const label=claim.verdict==='Não verificável'?'Não verificável':tone==='inconclusive'?'Inconclusivo':claim.verdict;
 const reviewed=claim.status==='approved';
 return <article className={'fact-card fact-'+tone+(reviewed?'':' fact-preview')} aria-label={'Checagem: '+label+(reviewed?' · revisada':' · revisão pendente')}>
  <div className="fact-verdict"><strong>{label}</strong><span>{reviewed?'✓ Revisado':'Pré-análise · revisão pendente'}</span></div>
  <div className="fact-body"><div className="fact-statement"><div className="fact-meta"><b>{claim.speaker}</b><time title="Momento da fala">{formatTime(claim.seconds)}</time></div><blockquote>“{claim.text}”</blockquote><button type="button" className="text-btn fact-jump" disabled={!canJump} onClick={onJump}>▶ Ouvir esta fala</button></div>
   <div className="fact-finding"><h3>{reviewed?'O que dizem os dados':'Análise preliminar'}</h3><p>{claim.explanation}</p><div className="fact-sources"><h3>Fontes</h3>{sources.length?sources.map(s=><a href={s.url} key={s.id} target="_blank" rel="noopener noreferrer"><b>{s.publisher} ↗</b><span>{s.title}</span><small>{s.period}</small></a>):<p>{claim.verdict==='Não verificável'?'Promessa, opinião ou fala sem verificação factual aplicável.':'Sem evidência suficiente para concluir.'}</p>}</div></div>
  </div>
 </article>;
}
