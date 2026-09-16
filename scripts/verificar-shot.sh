#!/usr/bin/env bash
# Sintaxis del script de captura. Se edita desde Windows por \\wsl.localhost y
# ya creció bastante; un paréntesis de más se descubría recién al correrlo.
#
# Vive en un script y no en un `bash -lc` inline porque el $PATH de nvm se
# expande del lado de Windows y `node` no aparece.
#
# El CRLF NO se chequea acá: scripts/contar-crlf.sh recorre TODOS los archivos
# cambiados y NO toma argumentos — pasárselos hace creer que miró el archivo
# que uno le nombró cuando en realidad listó otra cosa.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
node --check scripts/shot-pos.mjs && echo "sintaxis OK"
