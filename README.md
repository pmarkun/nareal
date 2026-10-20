# Na Real

Vídeo do YouTube, chat público e checagens com fontes, com revisão editorial e transcrição em blocos por falante. Aplicação Next.js/Node 24 pronta para Railway, independente do login e da infraestrutura do Sites.

## Rodar localmente

```bash
npm ci
cp .env.example .env.local
npm run password:hash
# Cole o hash inteiro em ADMIN_PASSWORD_HASH de .env.local, entre aspas simples.
npm run dev
```

Abra http://localhost:3000. A administração fica em `/admin`, com usuário configurado em `ADMIN_USERNAME` e a senha usada para gerar o hash. Não há senha padrão nem cadastro público. O hash usa scrypt; sessões opacas são persistidas no banco por oito horas, com cookie HttpOnly e SameSite=Lax. Alterar usuário ou hash revoga as sessões existentes. Em produção `APP_URL` deve usar HTTPS para cookies Secure. Login e gravações verificam a origem; há limitação de tentativas de login.

## Railway

1. Crie um serviço a partir deste repositório, branch `main`. O `railway.json` seleciona o `Dockerfile` e configura a verificação em `/api/health`.
2. Adicione um **volume persistente montado em `/data`**. Mantenha **uma réplica**: este projeto usa um único SQLite, com WAL e transações. Não habilite réplicas ou regiões adicionais para o mesmo banco.
3. Configure as variáveis abaixo. Gere seu hash localmente com `npm run password:hash` e cole o valor completo, sem aspas adicionais no painel de variáveis do Railway. Não coloque senha, hash real ou chaves no GitHub.
4. Gere o domínio público do serviço, configure `APP_URL` com a URL HTTPS exata (sem caminho) e faça o deploy. `PORT` é fornecida pelo Railway. O processo escuta em `0.0.0.0`.
5. Confira `/api/health`, entre em `/admin` e teste uma importação antes de operar uma transmissão.

| Variável | Valor |
| --- | --- |
| `APP_URL` | `https://SEU-DOMINIO.up.railway.app` |
| `DATABASE_PATH` | `/data/nareal.sqlite` |
| `ADMIN_USERNAME` | Seu usuário de administração |
| `ADMIN_PASSWORD_HASH` | Saída completa de `npm run password:hash` |
| `MODEL_BASE_URL` | Opcional, endpoint compatível com OpenAI, incluindo `/v1` |
| `MODEL_NAME` | Opcional, nome do modelo disponível no endpoint |
| `MODEL_API_KEY` | Opcional, segredo do provedor; usado apenas no servidor |

As migrações SQL são aplicadas na primeira abertura do banco, durante a execução. Não coloque migrações em pre-deploy: o volume só está montado no contêiner em execução. Nunca edite uma migração já aplicada; adicione uma nova. Faça backups do volume antes de atualizações. Sem `ADMIN_PASSWORD_HASH`, a consulta pública funciona e o login permanece desabilitado. O serviço não recebe automaticamente dados salvos na publicação anterior do Sites.

### Modelo de checagem

Com `MODEL_BASE_URL` e `MODEL_NAME`, o servidor envia a fala e os trechos recuperados da base ao endpoint configurado. Um Ollama privado acessível pela rede Railway pode ser usado com sua API `/v1`. Hospedar o modelo e dimensionar CPU/GPU é uma etapa separada; o Dockerfile deste repositório executa a aplicação web. Na ausência do modelo, os blocos selecionados entram na fila para revisão manual. A ponte Python opcional em `agent/` também permite Whisper e modelos na máquina do operador.

## Transcrição e revisão

Na aba **Transcrição**, importe JSON, SRT, VTT ou TXT. Cada troca de falante inicia um bloco. Segmentos adjacentes do mesmo falante são agrupados até aproximadamente 45 segundos/900 caracteres. Os horários ficam vinculados ao vídeo e o botão “Ouvir trecho” posiciona o player.

- JSON: lista ou objeto com `segments`, cada item com `text`, `speaker`, `start` e `end` (tempos em segundos). Veja [examples/transcricao.json](examples/transcricao.json), que contém apenas falas fictícias.
- VTT: preserva marcações `<v Nome>`. SRT/TXT podem usar `Nome: fala`; TXT também aceita `[00:01:23] Nome: fala`.
- Sem identificação na entrada, o bloco fica como **Falante não identificado**. O revisor pode corrigir o falante e os horários. Legendas comuns do YouTube não fornecem diarização confiável; este projeto não infere nomes a partir do áudio.
- Selecione até 20 blocos e clique em **Checar**. Cada bloco gera uma entrada pendente, sem duplicação. O modelo sugere uma análise se estiver conectado; o revisor corrige, vincula fontes e aprova ou encerra.
- Só checagens aprovadas aparecem publicamente. Em gravações, aparecem conforme o tempo do player. Aprovar exige horário válido e, para vereditos factuais, fonte vinculada.

A extração automática de legendas do YouTube não está implementada nesta versão. A tentativa pelo extrator não oficial no ambiente de nuvem foi bloqueada pelo YouTube. Não há transcrição real pré-carregada do debate. Importe uma transcrição disponível ou use a captura de áudio pela ponte local. A captura salva as janelas transcritas na aba Transcrição para seleção; para identificar os falantes, importe uma transcrição já identificada ou ajuste os rótulos manualmente.

## Fontes e limites

A recuperação é lexical sobre textos cadastrados pelo revisor, sem índice vetorial ou busca automática na web. URLs servem de referências e não são baixadas automaticamente. Mantenha as fontes atualizadas e confira período, território e unidade. O modelo não aprova checagens sozinho. A latência de uma transmissão real depende do transcritor, do modelo e do hardware e ainda precisa ser medida.

O chat usa nome escolhido pelo visitante, sem conta, com limites e moderação pelo administrador. A sala suporta até 1.500 checagens, 500 fontes e 1,5 MB por atualização; transcrições são armazenadas separadamente. O login próprio é de um administrador configurado por ambiente, sem gestão de múltiplos usuários ou recuperação de senha por email.

## Verificação

```bash
npm test
npm run typecheck
npm run build
npm run test:integration
```

O teste de integração inicia a build em uma porta local com banco temporário, valida autenticação, proteção de gravação, importação por falante, persistência e publicação de checagens. Requer a build concluída. Nenhuma credencial de produção é usada.
