#!/usr/bin/env bash
# A pilha do atendimento do ONE na VPS dividida com o Orkestree: Chatwoot, Postgres e Redis, sem o robô do kit
# e sem o OpenWA (o ONE fala com a Meta e responde com a própria IA; o Chatwoot é o painel da equipe).
# Roda como o usuário one, depois de copiar packages/atendimento (sem segredos/) para /opt/atendimento/one.
# O tema (gerado/) vem pronto do repositório: "kit.mjs theme packages/atendimento" antes de copiar.
# Idempotente: um segredo que já existe nunca é trocado, e nenhum valor de segredo é impresso.
# Rode com "bash pilha-one.sh < /dev/null": o "docker compose run" lê a entrada padrão.
set -euo pipefail

STACK=/opt/atendimento/one
IMPL="$STACK/modelos/implantacao"
SECRETS="$STACK/segredos"
ATENDIMENTO_HOST=atendimentoone.orkestree.com
WA_HOST=waone.orkestree.com

rand64() { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c 64; }

echo "== segredos (gerados aqui, nunca impressos)"
install -d -m 700 "$SECRETS"
umask 077
if [ ! -f "$SECRETS/chatwoot.env" ]; then
  sed -e "s#^FRONTEND_URL=.*#FRONTEND_URL=https://$ATENDIMENTO_HOST#" \
      -e "s#^SECRET_KEY_BASE=.*#SECRET_KEY_BASE=$(rand64)$(rand64)#" \
      -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(rand64)#" \
      -e "s#^REDIS_PASSWORD=.*#REDIS_PASSWORD=$(rand64)#" \
      -e "s#^MAILER_SENDER_EMAIL=.*#MAILER_SENDER_EMAIL=Atendimento ONE <nao-responda@$ATENDIMENTO_HOST>#" \
      "$IMPL/chatwoot.env.example" > "$SECRETS/chatwoot.env"
  echo "chatwoot.env criado"
else
  echo "chatwoot.env já existia"
fi
# Sem as contagens para o hub do Chatwoot (lib/chatwoot_hub.rb) e sem o repasse dos avisos do aplicativo de
# celular pelo servidor do Chatwoot: a equipe entra pelo navegador, com o login do ONE.
grep -q '^DISABLE_TELEMETRY=' "$SECRETS/chatwoot.env" ||
  printf '%s\n' "DISABLE_TELEMETRY=true" >> "$SECRETS/chatwoot.env"
grep -q '^ENABLE_PUSH_RELAY_SERVER=' "$SECRETS/chatwoot.env" ||
  printf '%s\n' "# Ninguém usa o aplicativo de celular do Chatwoot: nada vai pelo repasse de avisos deles." "ENABLE_PUSH_RELAY_SERVER=false" >> "$SECRETS/chatwoot.env"
grep -q '^POSTGRES_DATABASE=' "$SECRETS/chatwoot.env" ||
  printf '%s\n' "POSTGRES_DATABASE=chatwoot_production" >> "$SECRETS/chatwoot.env"
# O OpenWA dos números ligados pelo WhatsApp Web: a chave nasce aqui e nunca é impressa. Um openwa.env vazio (da
# primeira implantação, sem o OpenWA) é trocado. O ONE pede o telefone de quem escreve com um identificador de
# privacidade (RESOLVE_LID_TO_PHONE) e busca as mídias pela API, nunca dentro do aviso (WEBHOOK_MEDIA_INLINE_MAX_BYTES).
if [ ! -s "$SECRETS/openwa.env" ]; then
  sed -e "s#^BASE_URL=.*#BASE_URL=https://$WA_HOST#" \
      -e "s#^API_MASTER_KEY=.*#API_MASTER_KEY=$(rand64)#" \
      "$IMPL/openwa.env.example" > "$SECRETS/openwa.env"
  echo >> "$SECRETS/openwa.env"
  printf '%s\n' "RESOLVE_LID_TO_PHONE=true" "WEBHOOK_MEDIA_INLINE_MAX_BYTES=0" >> "$SECRETS/openwa.env"
  echo "openwa.env criado"
else
  echo "openwa.env já existia"
fi
# O compose.yml do kit cita os ambientes do robô e do proxy, que o ONE não sobe: ficam vazios.
for name in robo proxy; do [ -f "$SECRETS/$name.env" ] || : > "$SECRETS/$name.env"; done
chmod 600 "$SECRETS"/*.env
umask 022
for name in SECRET_KEY_BASE POSTGRES_PASSWORD REDIS_PASSWORD; do
  value=$(grep "^$name=" "$SECRETS/chatwoot.env" | cut -d= -f2-)
  [ "${#value}" -ge 64 ] || { echo "ERRO: $name curto"; exit 1; }
done
value=$(grep "^API_MASTER_KEY=" "$SECRETS/openwa.env" | cut -d= -f2-)
[ "${#value}" -ge 64 ] || { echo "ERRO: API_MASTER_KEY curta"; exit 1; }
for name in robo proxy; do [ ! -s "$SECRETS/$name.env" ] || { echo "ERRO: $name.env não está vazio"; exit 1; }; done
echo "segredos conferidos: tamanho certo; robô e proxy sem nada"

echo "== ambiente da pilha"
cp "$STACK/implantacao/compose.one.yml" "$IMPL/compose.one.yml"
cat > "$IMPL/.env" <<EOF
# Pilha do ONE na VPS dividida com o Orkestree. Sem segredo: os segredos ficam em ../../segredos.
PILHA=one
COMPOSE_PROJECT_NAME=atendimento-one
COMPOSE_FILE=compose.yml:compose.compartilhado.yml:compose.one.yml
COMPOSE_PROFILES=nao-oficial
EOF
cd "$IMPL"
docker compose config --quiet && echo "compose válido"
running=$(docker compose config --services)
if echo "$running" | grep -qE '^robo$'; then echo "ERRO: o robô está na pilha"; exit 1; fi
echo "serviços: $(echo "$running" | tr '\n' ' ')"

echo "== imagens"
docker compose pull --quiet postgres redis chatwoot-rails chatwoot-sidekiq openwa

echo "== banco do Chatwoot (chatwoot_production)"
docker compose up -d postgres redis
for i in $(seq 1 30); do
  docker compose exec -T postgres pg_isready -U postgres -d chatwoot_production >/dev/null 2>&1 && break
  sleep 2
done
docker compose run --rm chatwoot-rails bundle exec rails db:chatwoot_prepare 2>&1 | tail -3

echo "== Chatwoot"
docker compose up -d chatwoot-rails chatwoot-sidekiq

echo "== OpenWA"
docker compose up -d openwa

echo "== marca do painel (chatwoot-config, a cada implantação)"
[ -f "$STACK/gerado/marca.env" ] || { echo "ERRO: falta gerado/marca.env; rode kit.mjs theme antes"; exit 1; }
# O tema do kit e, depois dele, o que o ONE acrescenta ao painel (a lista abre em "Todos"): o chatwoot-config grava os dois.
cat "$STACK/gerado/painel.html" "$STACK/implantacao/painel-acrescimo.html" > "$STACK/gerado/painel-one.html"
docker compose --profile config run --rm chatwoot-config 2>&1 | grep -E '^(gravado|igual|sem arquivo|configuração)' || true
docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
