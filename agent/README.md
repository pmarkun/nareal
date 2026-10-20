# Na Real · operação da ponte local

O site hospeda vídeo, fila, fontes e revisão em banco persistente. A ponte roda no computador do operador; a aplicação web roda em Node no Railway e a ponte opcional executa os modelos no computador do operador. Código experimental: valide com uma gravação antes de usar ao vivo.

## Instalação

Requisitos: Python 3.11+, ambiente virtual e Ollama instalado pela distribuição oficial. O faster-whisper baixa o modelo na primeira transcrição. Aguarde esse download antes da transmissão; o modelo small pode exigir centenas de MB. GPU é opcional. CPU usa int8.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ollama pull qwen3:8b
ollama serve
```

Em outro terminal, no mesmo ambiente:

```bash
export BRIDGE_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
# Copie essa chave pelo seu terminal para o campo Chave na aba Conexões.
printenv BRIDGE_KEY
export SITE_ORIGIN='https://SEU-DOMINIO.up.railway.app'
export WHISPER_MODEL='small'
export MODEL_BASE_URL='http://127.0.0.1:11434/v1'
uvicorn bridge:app --host 127.0.0.1 --port 8765
```

No site: Conexões → endereço http://localhost:8765 → chave → modelo qwen3:8b → Testar conexão. O teste confirma acesso à ponte e ao servidor de modelos; a transcrição só é confirmada após áudio real. Confira se o modelo informado está instalado. Não publique essa chave.

Se o navegador bloquear acesso local ou conteúdo misto, configure HTTPS com um certificado confiável para localhost. Use as opções --ssl-certfile e --ssl-keyfile do uvicorn; instale o certificado no sistema/navegador por sua conta. Não desative a segurança do navegador. Pode ser necessário autorizar o acesso à rede local. Não exponha a ponte na rede: mantenha --host 127.0.0.1. A ponte aceita somente SITE_ORIGIN e exige BRIDGE_KEY em todas as chamadas.

## Operação

1. Cadastre evidências antes do debate: texto, URL, instituição, data, período e território. A URL não é baixada automaticamente.
2. Conecte um vídeo do YouTube em Transmissão.
3. Abra o vídeo numa aba do navegador. Em Conexões, clique em selecionar aba e compartilhe também o áudio. A captura usa apenas o áudio; o vídeo compartilhado não é enviado.
4. O áudio mono é enviado à ponte em WAVs independentes de aproximadamente 12s. O texto é salvo em blocos na aba Transcrição; ajuste o falante e selecione os blocos para enviar à fila de checagem.
5. A recuperação por palavras e temas escolhe até quatro fontes. O modelo gera uma sugestão citando apenas IDs dessa seleção. Não há pesquisa web nem índice vetorial nesta versão.
6. Revise a fala e seu contexto, nomes, números e ano. Marque fontes e aprove, corrija ou encerre. Sugestões nunca são aprovadas sozinhas.
7. Exporte o JSON na aba Revisão. O banco mantém alterações e um registro de auditoria no servidor. O conflito de duas gravações simultâneas exige recarregar dados para evitar sobrescrever a revisão de outra pessoa.

## Modelos alternativos e API na nuvem

A ponte suporta API compatível com OpenAI. Defina MODEL_BASE_URL com /v1, MODEL_API_KEY no ambiente da ponte e informe o modelo na interface. A chave do provedor nunca vai para o navegador nem para o site. Ao escolher uma API remota, trechos da fala e evidências serão enviados ao provedor configurado.

## Limites conhecidos

- A consulta é pública. Gravação e revisão exigem o login próprio de administração, verificado pelo servidor. Visitantes recebem apenas checagens aprovadas, sem o histórico editorial.
- Não há captura automática de legendas do YouTube: a API oficial exige permissão para editar o vídeo. Há importação manual de JSON, SRT, VTT e TXT.
- A aba Transcrição importa JSON, VTT, SRT e TXT em blocos por falante, preservando os horários. Sem metadados de voz o rótulo precisa ser corrigido manualmente. A ponte não faz diarização de áudio. Blocos capturados pela ponte usam a posição do player; ajuste antes de revisar.
- A captura por navegador depende de desktop/Chromium, compartilhamento do áudio e permissões de rede local. Não promete suporte a todos os celulares.
- Frases nas bordas dos blocos de áudio podem ficar incompletas. A transcrição original é preservada para revisão; não há alinhamento palavra a palavra nem fusão semântica entre blocos.
- Sem evidência relevante, permanece Sem evidência. Nenhuma classificação demonstra intenção de mentir.
- A base inicial é pequena e contém referências históricas. Atualize os recortes para o debate concreto; não use dado de 2022 como estimativa de 2026.
- A busca é lexical. Não é RAG vetorial nem busca geral na web. Escala inicial: 1.500 falas e 500 fontes, até 1,5 MB por sala.
- A captura aplica contrapressão: pausa com aviso se o transcritor ficar para trás. Nenhum SLA de latência foi medido; 12s é janela de áudio, não tempo total de resposta.
- Esta versão não foi validada com um debate real ou hardware local do operador. A interface, persistência e revisão foram testadas separadamente.
- A primeira análise pode ser lenta por carregamento do modelo. Ollama mantém seu próprio ciclo de vida. Escolha um modelo menor se não acompanhar a fala.
- Aprovação exige fonte vinculada para Falso, Enganoso e Verdadeiro. O modelo ainda pode interpretar uma fonte incorretamente; revisão humana continua necessária.
