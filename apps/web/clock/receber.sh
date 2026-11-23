#!/bin/sh
# Receives a version of ONE's clock on ONE's server and puts it in the place of the running one.
#
# The one command the production deploy's key may run (authorized_keys of the user `one`:
# restrict,command="/opt/atendimento/one/relogio/receber.sh" ssh-ed25519 ...): the bundle of clock/build.mjs arrives
# as a .tar.gz on stdin and the commit it was built from is the command line (SSH_ORIGINAL_COMMAND). The key gives no
# shell and nothing else. This file is installed by hand (cp + chmod 755) when it changes: the deploy never rewrites it.
set -eu
umask 022

base=/opt/atendimento/one/relogio
segredos=/opt/atendimento/one/segredos/relogio.env
commit="${SSH_ORIGINAL_COMMAND:-}"

case "$commit" in
  *[!0-9a-f]* | "") echo "receber: commit inválido" >&2; exit 2 ;;
esac
[ "${#commit}" -eq 40 ] || { echo "receber: commit inválido" >&2; exit 2; }
[ -r "$segredos" ] || { echo "receber: falta $segredos" >&2; exit 3; }

mkdir -p "$base/versoes"
tmp="$base/versoes/.recebendo-$$"
trap 'rm -rf "$tmp"' EXIT
rm -rf "$tmp"
mkdir -p "$tmp"

# At most 64 MB from stdin: the bundle is about 12.
head -c 67108864 | tar -xz -C "$tmp"
for file in relogio.mjs package.json compose.yml; do
  [ -f "$tmp/$file" ] || { echo "receber: falta $file no pacote" >&2; exit 4; }
done

# The native modules: those of the running version when its list is the same, else installed in the image.
atual=$(readlink -f "$base/atual" 2>/dev/null || true)
if [ -n "$atual" ] && [ -d "$atual/node_modules" ] && cmp -s "$atual/package.json" "$tmp/package.json"; then
  cp -a "$atual/node_modules" "$tmp/node_modules"
else
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/npm \
    -v "$tmp:/app" -w /app node:22-slim npm install --omit=dev --no-audit --no-fund --loglevel=error
fi

# The version loads, with the server's keys, before it takes the clock's place.
docker run --rm --user node --env-file "$segredos" -e ONE_CLOCK_CHECK=1 -e NODE_ENV=production \
  -e VERCEL_ENV=production -e ONE_COMMIT="$commit" -v "$tmp:/app:ro" -w /app node:22-slim node relogio.mjs

# ONE's own browser (navegador.mjs, since 2026-11-23) loads in its own image, with the server's keys, and starts and
# closes its Chromium, before it takes the place of the running one. The image is pulled the first time.
if [ -f "$tmp/navegador.mjs" ]; then
  [ -f "$tmp/pagina.js" ] || { echo "receber: falta pagina.js no pacote" >&2; exit 4; }
  ONE_COMMIT="$commit" docker compose -f "$tmp/compose.yml" run --rm --no-deps -T -e ONE_BROWSER_CHECK=1 navegador \
    </dev/null
fi

versao="$base/versoes/$commit"
rm -rf "$versao"
mv "$tmp" "$versao"
trap - EXIT

# The running clock finishes its beat (stop_grace_period) and the new one starts from its own folder.
ONE_COMMIT="$commit" docker compose -f "$versao/compose.yml" up -d --force-recreate --remove-orphans --quiet-pull
ln -sfn "$versao" "$base/atual"

# The last three versions stay, the running one among them.
ls -1dt "$base"/versoes/*/ 2>/dev/null | tail -n +4 | while read -r velha; do
  [ "$(readlink -f "$velha")" = "$(readlink -f "$base/atual")" ] || rm -rf "$velha"
done

echo "relógio em ${commit}"
