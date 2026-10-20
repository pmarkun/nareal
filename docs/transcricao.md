# Transcrição no servidor e entrada OBS

## Módulos

- `worker/adapters.py`: resolve a entrada. `YouTubeInput` consulta metadados/legendas com yt-dlp; `OBSInput` lê o RTMP configurado. Um novo adaptador implementa `prepare(job, phase) -> Media` e entra em `input_adapter`.
- `pcm_chunks`: decodifica qualquer entrada em PCM mono 16 kHz, em janelas de 20 segundos, usando FFmpeg e memória limitada.
- `worker/transcriber.py`: modelo substituível; usa faster-whisper `base`, CPU/int8, com VAD. Não identifica vozes.
- `POST /api/ingest/worker`: coordenação autenticada e checkpoints atômicos no SQLite do site. O worker não monta o banco do site.
- `app/ingest-panel.tsx`: operação por revisor autenticado; o navegador pode fechar enquanto o servidor continua trabalhando.
- `ingress/`: MediaMTX recebe OBS via RTMP, com credenciais distintas para publicar e ler. Só o RTMP é exposto; APIs, WebRTC, HLS, RTSP e SRT ficam desligados.

A fila processa um trabalho por vez; outros aguardam. Cada transmissão tem no máximo um trabalho ativo. A parada invalida a autorização de escrita daquele trabalho, preservando os blocos salvos. O worker mantém heartbeat e lease de 120 segundos; depois de uma interrupção, trabalhos podem retomar do checkpoint. Cinco retomadas sem conclusão encerram o trabalho com aviso. Transcrição e checkpoint são confirmados na mesma transação; repetir um lote não sobrescreve correções de falante.

## Serviços no Railway

As configurações estão aplicadas no projeto Railway. Para recriar em outro projeto, use os Dockerfiles e configure os serviços no painel/API. O antigo `railway.json` foi removido porque novos serviços não aceitam mais Config as Code.

| Serviço | Root Directory | Dockerfile | Healthcheck | Volume | Exposição |
| --- | --- | --- | --- | --- | --- |
| nareal | `/` | `Dockerfile` | `/api/health` | `/data`, uma réplica | HTTPS público |
| transcriber | `/worker` | `Dockerfile` | `/health` | `/models`, cache de modelos | Sem domínio público |
| obs-ingress | `/ingress` | `Dockerfile` | Nenhum HTTP | Nenhum | Proxy TCP para porta 1935 |

Use a branch `main` do mesmo repositório nos três serviços. No worker, limite inicial de 2 vCPU/3 GB de RAM, uma réplica. O consumo e a velocidade variam; só aumente após medir. O modelo é baixado no primeiro processamento de áudio, não durante a importação de legendas. O volume evita baixar novamente a cada deploy.

### Variáveis

Site:

- `INGEST_WORKER_TOKEN`: segredo aleatório de pelo menos 32 caracteres, igual ao configurado no worker.
- `OBS_PUBLISH_SERVER`: `rtmp://HOST-DO-PROXY:PORTA`.
- `OBS_PUBLISH_KEY`: `live?user=publisher&pass=SENHA-DE-PUBLICACAO`.

Worker:

- `NAREAL_URL`: URL HTTPS do site. Todas as chamadas de coordenação usam o token no cabeçalho Authorization.
- `INGEST_WORKER_TOKEN`: mesmo segredo do site.
- `OBS_STREAM_URL`: `rtmp://obs-ingress.railway.internal:1935/live?user=reader&pass=SENHA-DE-LEITURA`.
- `WHISPER_MODEL=base`, `WHISPER_THREADS=2`, `MODEL_CACHE=/models`, `PORT=8080`.

Recepção:

`MTX_AUTHINTERNALUSERS` deve substituir a lista de usuários pelo JSON a seguir, com senhas reais no ambiente. Não use estes placeholders em produção:

```json
[
  {"user":"publisher","pass":"SENHA-DE-PUBLICACAO","ips":[],"permissions":[{"action":"publish","path":"live"}]},
  {"user":"reader","pass":"SENHA-DE-LEITURA","ips":[],"permissions":[{"action":"read","path":"live"}]}
]
```

A chave de publicação é retornada apenas para administradores autenticados. Não publique credenciais no repositório. RTMP pelo proxy TCP não tem TLS; para sinal confidencial, use um receptor RTMPS com certificado confiável ou outra entrada protegida, em um adaptador separado.

## Operação YouTube

1. Configure vídeo ou live na aba Transmissão.
2. Na aba Transcrição, selecione YouTube e clique em Iniciar transcrição.
3. Para gravações, o adaptador tenta primeiro legenda manual ou automática em português. Remove repetições de legendas sobrepostas e conserva os horários. Se a legenda falhar, usa o áudio com Whisper. Para lives usa áudio.
4. Acompanhe fase, tempo processado e os blocos que chegam abaixo. Corrija falantes e horários, selecione os blocos e envie à revisão.

O campo “Começar no segundo” define o ponto inicial da gravação. yt-dlp pode deixar de funcionar por mudanças ou bloqueios do YouTube; o sistema informa o erro, sem tentar contornar bloqueios com proxies ou contas. Mantenha a dependência atualizada e use importação/OBS como alternativa quando necessário.

## Operação OBS

1. Na Transcrição, selecione OBS. Copie o servidor e revele a chave.
2. No OBS: Configurações → Transmissão → Serviço personalizado. Cole servidor e chave. Use áudio AAC. Uma saída H.264/AAC em FLV é compatível.
3. Clique em Iniciar transcrição no painel, depois inicie a transmissão no OBS. A ordem inversa também funciona, mas áudio anterior à conexão do worker não é recuperado.
4. O worker aguarda o sinal e tenta reconectar após quedas. Clique em Parar ao finalizar.

Essa recepção alimenta a transcrição. O player público continua sendo o YouTube configurado na sala; exibir o vídeo do OBS diretamente ou encaminhá-lo a outro destino exige uma saída de distribuição adicional. Use uma saída adicional do OBS se a transmissão pública já tem outro destino.

O campo de alinhamento informa em qual segundo do vídeo público começa o primeiro áudio recebido. Após quedas/reinícios, os blocos retomam depois do último tempo processado: intervalos sem sinal não são recuperados e devem ter o horário conferido pelo revisor. Não há gravação integral do stream nesta versão. Nenhum SLA de latência ou diarização automática está implícito.

## Testes

`npm run test:integration` verifica autenticação, fila, conflito por transmissão, lease, heartbeat, lote repetido, checkpoint regressivo, parada, reinício com persistência e entrada OBS. `PYTHONPATH=worker python -m unittest discover -s worker/tests -v` verifica os adaptadores e normalização das legendas. Um teste de ponta a ponta deve incluir fala real e envio OBS antes do debate; sinal sintético só valida o transporte.

Para um smoke test interno e limitado, defina temporariamente `OBS_PROBE_PUBLISH_URL` no worker com a URL RTMP interna e credencial de publicação. Ao iniciar, ele envia até 35 segundos de voz sintética, lê 20 segundos pelo receptor e executa o modelo, sem salvar transcrições ou checagens. O log `obs_smoke_passed` registra duração e quantidade de segmentos. Isso não testa o aplicativo OBS nem a precisão do português. Remova a variável depois do teste.

Ao reprocessar uma legenda automática com `replaceJobId`, a primeira confirmação de lote arquiva os blocos sem falante do trabalho anterior na mesma transação. Blocos já vinculados a checagens ou com falante corrigido são preservados. Os registros arquivados continuam no banco (`archived_at`), permitindo recuperação; nenhuma checagem é apagada.
