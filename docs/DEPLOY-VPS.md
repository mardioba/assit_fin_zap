# Guia de Deploy — VPS (produção)

Passo a passo para publicar o Assistente Financeiro em uma VPS com Docker.

## 1. Requisitos

- VPS com ≥ 2 GB RAM (recomendado 4 GB), Ubuntu 22.04+/Debian 12+
- Docker + Docker Compose (`curl -fsSL https://get.docker.com | sh`)
- Um domínio apontado para a VPS (A record) — **obrigatório** para o webhook da Meta

## 2. Código e variáveis

```bash
git clone <seu-repo> /opt/assist-fin && cd /opt/assist-fin
cp .env.example .env
```

Preencha o `.env` (nunca versionado):

| Variável | Como gerar/obter |
| --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `openssl rand -base64 48` (um por linha) |
| `CORS_ORIGIN` | `https://SEUDOMINIO.com` |
| `WHATSAPP_*` | Meta Developers → app WhatsApp → Configuração da API |
| `OPENAI_API_KEY` ou `GEMINI_API_KEY` | painel do provedor (interpretação, áudio e comprovantes) |

> Regra: segredos **somente** no `.env`. O `.env.example` é o único modelo versionado.

## 3. Banco PostgreSQL

Troque o provider antes da primeira subida:

```bash
cd backend
# em prisma/schema.prisma: provider = "postgresql"
npx prisma migrate deploy     # aplica as migrações já criadas
cd ..
```

> `migrate deploy` roda automaticamente no start da API (Dockerfile),
> mas rodar antes evita corrida na primeira inicialização.

## 4. Subir os serviços

```bash
docker compose up --build -d
docker compose ps             # postgres/api/web devem ficar "healthy"
docker compose logs -f api    # sem erros de migração/conexão
```

- Web: `http://SEUDOMINIO.com` (nginx na porta 80)
- API: `http://SEUDOMINIO.com/api/health`

## 5. HTTPS + webhook da Meta

O webhook exige HTTPS. Com o nginx do container `web` na porta 80, use
**Certbot em modo standalone** ou **Caddy/Certbot reverse-proxy**:

```bash
apt install -y certbot
certbot certonly --standalone -d SEUDOMINIO.com
# aponte o certificado para o nginx do frontend ou use um proxy externo
```

No Meta Developers:
1. Webhook URL: `https://SEUDOMINIO.com/api/whatsapp/webhook`
2. Token de verificação = `WHATSAPP_VERIFY_TOKEN` do `.env`
3. **App Secret** = `WHATSAPP_APP_SECRET` (ativa a validação HMAC)
4. Assinar os campos: `messages`

## 6. Pós-deploy — checklist

- [ ] `GET /api/health` → 200
- [ ] Painel carrega e registra um usuário
- [ ] Tela **WhatsApp**: API "Configurada", App Secret "Ativa", interpretador "OpenAI/Gemini"
- [ ] Envio de mensagem de teste pelo painel
- [ ] Backup automático do Postgres (cron):

```bash
# /etc/cron.d/assist-fin-backup — diário às 3h
0 3 * * * root docker compose -f /opt/assist-fin/docker-compose.yml exec -T postgres pg_dump -U assist_fin assist_fin | gzip > /var/backups/assist-fin-$(date +\%F).sql.gz
```

- [ ] Logs: `docker compose logs --since=24h api | grep -i error`
- [ ] Atualizações: `git pull && docker compose up --build -d`

## 7. Segurança (já implementado — conferir)

- Cookies `httpOnly` + `SameSite=Lax` + `Secure` (`COOKIE_SECURE=true`)
- Rate limit global (`RATE_LIMIT_GLOBAL`, padrão 300/15min) e de login
  (`RATE_LIMIT_AUTH`, padrão 30/15min por IP)
- Helmet (headers), CORS restrito a `CORS_ORIGIN`
- Rotação de refresh token com **detecção de reuso** (revoga a família)
- Assinatura HMAC no webhook, deduplicação por `wamid`
- Isolamento multi-tenant por `userId` em todas as queries (testado)

## 8. Solução de problemas

| Sintoma | Causa provável |
| --- | --- |
| API reiniciando | `DATABASE_URL` errado ou migração pendente (`docker compose logs api`) |
| Webhook 403 na Meta | `WHATSAPP_APP_SECRET`/`VERIFY_TOKEN` divergentes do painel |
| Mídia não processa | Faltam `OPENAI_API_KEY`/`GEMINI_API_KEY` (o bot avisa no chat) |
| 429 no painel | Limite de IP — ajuste `RATE_LIMIT_*` ou use proxy confiável |
| Cookies não salvam | `COOKIE_SECURE=true` exige HTTPS |
