/* No model keys or provider calls in this browser. Operator token is session-only. */
const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1)).get('token');
let token = fragment || sessionStorage.getItem('nareal-obs-token') || '';
if (fragment) history.replaceState(null, '', '/');
let state, selected = '', editingVersion = 0, dirty = false, busy = false, lastRevision = -1;
let refreshing = false;
const notice = message => { $('notice').textContent = message; };
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
const clock = ms => new Date(ms).toISOString().slice(11, 19);

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {method, headers: {'Authorization': 'Bearer ' + token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
  if (!response.ok) {
    if (response.status === 401) { $('login').hidden = false; $('workspace').hidden = true; }
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Confira os campos e tente novamente.');
  }
  return response.json();
}

function sourceRow(source = {}) {
  const row = node('div', '', 'source-row');
  row.dataset.id = source.id || crypto.randomUUID();
  const title = node('input'); title.placeholder = 'Instituição ou título da fonte'; title.value = source.title || ''; title.maxLength = 300; title.required = true; title.setAttribute('aria-label', 'Título da fonte'); title.dataset.field = 'title';
  const url = node('input'); url.placeholder = 'https://…'; url.type = 'url'; url.value = source.url || ''; url.maxLength = 2000; url.required = true; url.setAttribute('aria-label', 'URL da fonte'); url.dataset.field = 'url';
  const excerpt = node('textarea'); excerpt.placeholder = 'Trecho que sustenta a análise'; excerpt.value = source.excerpt || ''; excerpt.maxLength = 6000; excerpt.rows = 2; excerpt.setAttribute('aria-label', 'Trecho da fonte'); excerpt.dataset.field = 'excerpt';
  const remove = node('button', 'Remover fonte', 'quiet'); remove.type = 'button'; remove.onclick = () => { row.remove(); setDirty(); };
  row.append(title, url, excerpt, remove); $('sources').append(row);
}

function setDirty() {
  dirty = true;
  $('unsaved').textContent = 'Há alterações não salvas. Salve antes de aprovar ou exibir.';
  $('approve').disabled = $('publish').disabled = $('recheck').disabled = $('close').disabled = true;
}

function showRecord(item) {
  if (!item) return;
  selected = item.id; editingVersion = item.version; dirty = false;
  $('empty').hidden = true; $('editor').hidden = false;
  $('meta').textContent = `${clock(item.start_ms)} → ${clock(item.end_ms)} · ${item.speaker} · ${item.status === 'approved' ? 'Revisado' : item.status === 'closed' ? 'Encerrado' : 'Revisão pendente'}`;
  $('original').textContent = item.text;
  $('claim').value = item.claim; $('verdict').value = item.verdict; $('explanation').value = item.explanation;
  $('phase').textContent = item.error || ({checking: 'Consultando evidências…', queued: 'Aguardando IA…', ready: 'Análise disponível para revisão.', error: 'A checagem precisa de atenção.'}[item.phase]);
  $('sources').replaceChildren(); item.sources.forEach(sourceRow);
  $('approve').hidden = item.status === 'approved'; $('publish').hidden = item.status !== 'approved';
  $('approve').disabled = item.phase !== 'ready' || item.status === 'closed';
  $('publish').disabled = false; $('recheck').disabled = item.phase === 'checking' || item.status !== 'pending'; $('close').disabled = item.status === 'closed';
  $('unsaved').textContent = 'Salvar uma edição retira a versão anterior do overlay e devolve a análise para revisão.';
}

function renderList() {
  $('count').textContent = state.records.length + (state.records.length === 1 ? ' bloco recente' : ' blocos recentes');
  const list = $('records'); list.replaceChildren();
  if (!state.records.length) list.append(node('p', 'Nenhuma fala capturada ainda.', 'empty-list'));
  for (const item of state.records) {
    const button = node('button', '', 'transcript-item' + (item.id === selected ? ' selected' : ''));
    button.type = 'button'; button.setAttribute('aria-pressed', String(item.id === selected));
    button.append(node('span', clock(item.start_ms) + ' · ' + item.speaker, 'time'), node('span', item.text), node('span', item.phase === 'checking' ? 'Checando…' : item.verdict, 'verdict-small'));
    button.onclick = () => { if (dirty && !confirm('Descartar as alterações não salvas?')) return; showRecord(item); renderList(); };
    list.append(button);
  }
}

async function refresh() {
  if (!token || refreshing) return;
  refreshing = true;
  try {
    state = await api('/api/state'); sessionStorage.setItem('nareal-obs-token', token);
    $('login').hidden = true; $('workspace').hidden = false;
    const c = state.capture;
    $('connection').textContent = c.session ? '● Capturando ' + c.session.source : '● Serviço local conectado';
    $('capture-status').textContent = `${c.transcriber}: ${c.model_ready ? 'pronto' : c.warming ? 'carregando…' : 'aguardando carga'} · ${c.provider} · ${c.audio_queue} pacotes de áudio · ${c.check_queue} checagens na fila${c.error ? ' · ' + c.error : ''}`;
    $('warmup').disabled = c.model_ready || c.warming || busy;
    $('warmup').textContent = c.model_ready ? '✓ Transcrição pronta' : c.warming ? 'Carregando modelo…' : 'Carregar transcrição local';
    $('automatic').checked = state.automatic;
    if (state.revision !== lastRevision) {
      if (!selected && state.records.length) selected = state.records[0].id;
      const item = state.records.find(r => r.id === selected);
      if (!dirty && item && (item.version !== editingVersion || !editingVersion)) showRecord(item);
      renderList(); lastRevision = state.revision;
    }
  } catch (error) { notice(error.message); $('connection').textContent = 'Serviço desconectado'; }
  finally { refreshing = false; }
}

async function run(operation) {
  if (busy) return;
  busy = true; notice('');
  try { await operation(); } catch (error) { notice(error.message); } finally { busy = false; await refresh(); }
}

$('login-form').onsubmit = event => { event.preventDefault(); token = $('token').value.trim(); refresh(); };
$('editor').addEventListener('input', setDirty);
$('add-source').onclick = () => { if ($('sources').children.length >= 8) return; sourceRow(); setDirty(); };
$('editor').onsubmit = event => { event.preventDefault(); run(async () => {
  const sources = [...$('sources').children].map(row => ({id: row.dataset.id, ...Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.value.trim()]))}));
  await api('/api/records/' + selected, 'PUT', {version: editingVersion, claim: $('claim').value.trim(), verdict: $('verdict').value, explanation: $('explanation').value.trim(), sources});
  dirty = false; editingVersion = 0; lastRevision = -1; notice('Revisão salva. Confira e aprove para exibir.');
}); };
for (const [button, action] of [['approve', 'approve'], ['publish', 'publish'], ['recheck', 'check'], ['close', 'close']]) {
  $(button).onclick = () => run(async () => { if (dirty) throw new Error('Salve as alterações antes de continuar.'); await api('/api/records/' + selected + '/action', 'POST', {version: editingVersion, action}); lastRevision = -1; notice(action === 'approve' || action === 'publish' ? 'Tarja enviada à fila de exibição.' : 'Atualizado.'); });
}
$('warmup').onclick = () => run(async () => { $('warmup').disabled = true; $('warmup').textContent = 'Carregando modelo…'; await api('/api/warmup', 'POST', {}); notice('Modelo carregado. Inicie a captura no painel do OBS.'); });
$('hide').onclick = () => run(async () => { await api('/api/hide', 'POST', {}); notice('Todas as tarjas foram retiradas.'); });
$('automatic').onchange = () => { const enabled = $('automatic').checked; run(async () => {
  if (enabled && !confirm('Exibir as próximas análises sem aprovação humana? Elas serão identificadas como “Análise por IA · não revisada”.')) return;
  await api('/api/mode', 'PUT', {automatic: enabled});
}); };
$('export').onclick = () => run(async () => { const data = await api('/api/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'})); const a = node('a'); a.href = url; a.download = 'nareal-obs.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 1200);
