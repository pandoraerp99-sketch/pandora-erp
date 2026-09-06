# -*- coding: utf-8 -*-
"""
Baja Inter + JetBrains Mono de Google Fonts y las deja AUTO-ALOJADAS.

Por que auto-alojadas y no por <link>: el CSP del proyecto es
`style-src 'self' 'unsafe-inline'` + `font-src 'self' data:`, asi que la hoja
de Google y los .woff2 de gstatic quedan BLOQUEADOS (en dev y en produccion,
sin ruido). Ademas un POS tiene que poder abrir con internet malo: si la fuente
no baja, las metricas cambian y la pantalla se deforma.

Solo subsets latin y latin-ext: alcanza para es-AR (acentos y ñ) y evita bajar
cirilico, griego y vietnamita que no se usan nunca.
"""
import os
import re
import subprocess

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

PEDIDOS = {
    "Inter": "https://fonts.googleapis.com/css2?family=Inter:wght@400..800&display=swap",
    "JetBrains Mono": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap",
}

DESTINO = "public/fonts"
SUBSETS_OK = ("latin", "latin-ext")


def bajar(url):
    return subprocess.run(
        ["curl", "-sf", "-A", UA, url], capture_output=True, check=True
    ).stdout.decode("utf-8")


os.makedirs(DESTINO, exist_ok=True)
reglas = []

for familia, url in PEDIDOS.items():
    css = bajar(url)
    # Cada bloque viene precedido por un comentario con el nombre del subset.
    bloques = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})", css)
    for subset, bloque in bloques:
        if subset not in SUBSETS_OK:
            continue
        m = re.search(r"url\((https://[^)]+\.woff2)\)", bloque)
        peso = re.search(r"font-weight:\s*([^;]+);", bloque).group(1).strip()
        if not m:
            continue
        remoto = m.group(1)
        slug = familia.lower().replace(" ", "-")
        nombre = f"{slug}-{subset}-{peso.replace(' ', '_')}.woff2"
        salida = os.path.join(DESTINO, nombre)
        subprocess.run(["curl", "-sf", "-A", UA, "-o", salida, remoto], check=True)
        local = bloque.replace(remoto, f"/fonts/{nombre}")
        reglas.append(local.strip())
        print("bajada:", nombre, os.path.getsize(salida), "bytes")

cabecera = """/* Fuentes de las maquetas, AUTO-ALOJADAS — generado 2026-09-06.

   El CSS de todas las pantallas (copia verbatim de pos-preview/) pide
   font-family:'Inter' y 'JetBrains Mono' por nombre. Antes no se cargaba
   ninguna de las dos -- se cargaba Geist -- y todo caia al sans-serif del
   sistema: "Monotributo" media 64.08px contra los 71.36px de la maqueta, un
   11% mas angosto en TODA la app.

   Van servidas desde /public y no por <link> a Google porque el CSP es
   style-src 'self' + font-src 'self' data:, que bloquea googleapis y gstatic
   sin decir nada. Ademas asi el POS abre igual con internet malo.

   Solo subsets latin y latin-ext: alcanza para es-AR.

   Para regenerar: scratchpad/bajar_fuentes.py */

"""

with open("src/app/fonts.css", "w", encoding="utf-8", newline="") as f:
    f.write(cabecera + "\n\n".join(reglas) + "\n")

print("escrito src/app/fonts.css con", len(reglas), "reglas")
