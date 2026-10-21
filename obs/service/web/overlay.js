const $ = id => document.getElementById(id);
const clock = ms => new Date(ms).toISOString().slice(11, 19);
let current = '', expires = 0, fetching = false;
const hide = () => { $('card').hidden = true; current = ''; };
async function refresh() {
  if (fetching) return;
  fetching = true;
  try {
    const response = await fetch('/api/overlay', {cache: 'no-store'});
    if (!response.ok) throw new Error('offline');
    const {item} = await response.json();
    if (!item) return hide();
    expires = item.expires_at;
    const identity = item.id + ':' + item.version;
    if (current !== identity) {
      $('label').textContent = item.label;
      $('time').textContent = 'Fala em ' + clock(item.start_ms);
      $('verdict').textContent = item.verdict;
      $('claim').textContent = item.claim;
      $('explanation').textContent = item.explanation;
      $('sources').textContent = item.sources.length ? 'Fontes: ' + item.sources.map(s => { let host = ''; try { host = new URL(s.url).hostname; } catch {} return s.title + (host ? ' · ' + host : ''); }).join(' / ') : 'Evidência insuficiente ou afirmação não verificável';
      $('card').dataset.verdict = item.verdict;
      current = identity;
    }
    $('card').hidden = Date.now() / 1000 >= expires;
  } catch { hide(); } finally { fetching = false; }
}
refresh(); setInterval(refresh, 500);
setInterval(() => { if (expires && Date.now() / 1000 >= expires) hide(); }, 100);
