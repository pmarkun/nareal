# Na Real para OBS · 0.1.0

Plugin nativo com painel para escolher **uma fonte de áudio** do OBS, serviço local de transcrição/checagem e overlay transparente. O plugin encaminha áudio em memória para `127.0.0.1`; Whisper, rede e modelos ficam fora do processo do OBS.

Primeira plataforma: **Linux, OBS 30+ com Qt 6**, instalado pelo sistema. Windows/macOS têm serviço Python e código CMake, mas ainda exigem compilação e teste nativos; não há instaladores assinados. Use SDK e Qt compatíveis com seu OBS. O OBS Flatpak usa isolamento e caminhos diferentes dos comandos abaixo.

## Instalar no Linux

Ubuntu 24.04 / Debian compatível, com o OBS fechado:

```bash
sudo apt install obs-studio libobs-dev qt6-base-dev cmake build-essential python3-venv
git clone https://github.com/pmarkun/nareal.git
cd nareal
bash obs/install-linux.sh
cp obs/env.example obs/.env
```

Edite `obs/.env` e informe `GEMINI_API_KEY`. O modelo é configurável em `GEMINI_MODEL`; confirme que está disponível no seu projeto Google AI. O exemplo usa o modelo mostrado na documentação consultada durante a implementação. Chaves do provedor ficam somente no serviço local. Ele envia **texto e contexto** à IA; o áudio é processado localmente e não é gravado em disco.

```bash
bash obs/start.sh
```

O primeiro início instala dependências em `obs/.venv`. O terminal mostra o painel com chave local no fragmento `#token=…`. Abra esse endereço. Clique **Carregar transcrição local** e aguarde download/carregamento do Whisper. O padrão é `small` multilíngue, CPU/int8. Ajuste `WHISPER_MODEL`, `WHISPER_DEVICE` e `WHISPER_COMPUTE` conforme o hardware. A duração de transcrição deve ficar abaixo da duração de áudio recebido.

Windows: `powershell -File obs/start.ps1` inicia o serviço; o plugin precisa ser compilado com SDK/Qt da instalação do OBS. macOS: o serviço usa Python 3.11+ e o script Bash; a extensão exige empacotamento para a arquitetura instalada. Esses caminhos não foram homologados nesta versão.

## Configurar o OBS

Se você baixou o artefato **nareal-obs-linux-x86_64** no GitHub Actions, extraia a pasta e execute `bash install-linux.sh` nela. Esse caminho usa a biblioteca já compilada; depois copie `env.example` para `.env`, configure a chave e execute `bash start.sh`.

1. Reinicie o OBS. Abra **Painéis → Na Real**.
2. Escolha a fonte de áudio do debate. Clique **Atualizar fontes** se ela foi criada recentemente. Não use áudio geral do desktop se ele também contém microfone, notificações ou retorno da transmissão.
3. Mantenha a porta `8766` e cole **somente a chave** exibida após `#token=` no terminal. Ela não é salva pelo plugin. A fonte precisa produzir áudio; fontes mutadas enviam silêncio.
4. Clique **Abrir revisão e configurar IA**. Carregue o Whisper e clique **Iniciar captura** no painel nativo.
5. Clique **Copiar URL do overlay**. Adicione uma **Fonte de navegador** à cena: `http://127.0.0.1:8766/overlay`, `1920 × 1080`, acima do vídeo. A página fica transparente enquanto não há checagem publicada.
6. No painel de revisão, selecione uma fala. Confira resumo, explicação e fontes. Edite e clique **Salvar revisão** quando necessário. **Aprovar e exibir** publica por 20 segundos; até cinco tarjas ficam enfileiradas. **Retirar todas as tarjas** limpa tela e fila.
7. **Parar captura** envia o áudio restante e encerra a entrada. Transcrições e checagens enfileiradas continuam. **Encerrar** uma análise a retira do overlay. Editar também retira sua versão anterior e exige nova aprovação.

Sem pacotes do OBS por 20 segundos, o serviço encerra a sessão. A captura é independente do botão de transmissão: pode ser usada em gravação ou ensaio. Trocar a coleção de cenas encerra a captura; trocar de cena pode produzir silêncio se a fonte deixar de estar ativa.

## Como funciona

- Áudio convertido pelo plugin para mono Float32/16 kHz, em pacotes de aproximadamente 500 ms, com sessão, sequência e horário relativo. O callback de áudio não faz rede nem espera por bloqueios. Buffer nativo de até três segundos; perda/atraso interrompe a captura com aviso.
- Segmentação por energia em janelas de 20 ms: pausa de 700 ms, mínimo aproximado de 2s e máximo 18s. Isso **não identifica falantes**. Os blocos ficam como **Falante não identificado**. Cortes no limite podem dividir uma frase; o modelo recebe contexto anterior.
- Whisper local em português. Texto original separado do resumo da IA.
- Gemini pesquisa com Google Search e utiliza somente URLs/trechos vinculados nos metadados de grounding. Outra chamada gera JSON com schema. A validação rejeita IDs inventados e vereditos factuais sem fonte. Isso valida estrutura/proveniência, não garante interpretação correta da evidência.
- Filas separadas: oito pacotes de áudio e doze análises aguardando. Falhas ficam visíveis, sem repetição automática de chamadas pagas. Falas idênticas podem reaproveitar análise por até dez minutos.
- Padrão: revisão humana. **Exibir automaticamente** vale para próximas análises concluídas, com **Análise por IA · não revisada**. Não marca como aprovado e é desligado ao reiniciar. Desativá-lo retira suas tarjas.
- Overlay recebe somente o resultado publicado. Erro de conexão ou expiração retira a tarja. Mostra títulos/domínios das fontes; URLs e trechos completos ficam no painel/exportação.

## Outra IA e base própria

```dotenv
CHECK_PROVIDER=compatible
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_NAME=SEU_MODELO_INSTALADO
MODEL_API_KEY=ollama
NAREAL_SOURCES_FILE=/caminho/absoluto/fontes.json
```

Esse adaptador usa API compatível com OpenAI e recuperação lexical sobre evidências locais, **sem pesquisa web**. O arquivo é uma lista de até 500 itens:

```json
[{"id":"fonte-1","title":"Instituição e título","url":"https://example.org/dados","excerpt":"Trecho com período, território e unidade do dado."}]
```

Sem evidência suficiente: **Inconclusivo** ou **Não verificável**. O revisor pode inserir fontes e escrever sua análise mesmo se a IA falhar. Adaptadores implementam `check(text, context)`; transcritores implementam `prepare()` e `transcribe(samples, context)`.

## Dados e limites

SQLite e chave em `~/.nareal-obs`, configurável com `--data-dir`. A interface mostra os 300 blocos mais recentemente atualizados; **Exportar JSON** inclui todos. Análises e histórico persistem, áudio não. Ainda não há sincronização automática com o site no Railway: exportação usa `schema: nareal.obs.v1`, com sessão, horários, texto original, resumo, fontes e estado editorial.

O serviço escuta apenas `127.0.0.1`. Operações exigem chave, validam Host/Origin e não habilitam CORS. O overlay é leitura local sem autenticação, restrita a tarjas publicadas; outros processos/usuários do computador podem lê-las. Não exponha a porta na internet nem coloque a URL com `#token` na cena.

Horários relativos à captura, sem acompanhar buscas dentro de um arquivo de vídeo: pare/inicie outra captura ao buscar no player. A checagem aparece **depois** da fala e identifica seu horário. Atrasar a saída geral do OBS atrasa vídeo e tarja juntos, sem corrigir a diferença; sincronização exata exigiria buffer do conteúdo antes da composição. **10–30s é hipótese a medir**, não garantia. Acusação sem comprovação não equivale a falsidade.

## Desenvolvimento

```bash
cd obs
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
PYTHONPATH=. .venv/bin/python -m pytest -q tests
cmake -S plugin -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 2
```

Testes com transcritor/IA injetados e simulados, sem credenciais nem chamadas pagas: fluxo áudio→bloco→revisão→overlay, retirada ao editar, conflitos, fontes inválidas, duplicação, persistência, automático e contrato HTTP do Gemini. Não substituem ensaio com OBS e áudio reais. O workflow **OBS plugin** compila Linux e gera artefato de instalação.

Referências: [captura de áudio](https://docs.obsproject.com/reference-sources#c.obs_source_add_audio_capture_callback), [painel OBS](https://docs.obsproject.com/reference-frontend-api#c.obs_frontend_add_dock_by_id), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [JSON Gemini](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [busca Gemini](https://ai.google.dev/gemini-api/docs/generate-content/google-search).
