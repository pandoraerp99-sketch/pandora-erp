#!/usr/bin/env bash
# Wrapper del round trip real contra el Storage. Ver probar-storage-real.mjs.
set -u
cd ~/workspace/pandora-erp || exit 1
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
node scripts/probar-storage-real.mjs
