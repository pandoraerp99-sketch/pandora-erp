import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── /panel = el mockup dashboard.html copiado LITERAL a public/ ──
  // Slice Panel (feedback owner 2026-07-09: copiar el mockup tal cual, sin
  // reinterpretar). El rewrite sirve public/panel.html en /panel. El proxy
  // (src/proxy.ts) exime /panel del CSP/auth para no romper los estilos/scripts
  // inline + fuentes del mockup. TODO F1: portar a componentes React nativos.
  async rewrites() {
    return [
      { source: "/panel", destination: "/panel.html" },
      // /caja sirve la MAQUETA linda (public/caja.html), tal cual, que es lo que
      // el owner quiere ver. La versión React (en construcción) quedó en /caja-real.
      { source: "/caja", destination: "/caja.html" },
    ];
  },

  // ── Resolución de imports `.js` → `.ts` (extensionAlias) ──
  // El codebase usa imports relativos con extensión `.js` (estilo NodeNext/ESM,
  // requerido por vitest + tsc) mientras moduleResolution es "bundler". Webpack
  // los resuelve a los `.ts` reales vía extensionAlias. Turbopack NO tiene un
  // equivalente (solo `resolveExtensions` para imports SIN extensión, y
  // `resolveAlias` para nombres de paquete — doc oficial verificada 2026-07-09),
  // por eso dev+build corren en webpack (`--webpack` en package.json). Sin esto,
  // NINGUNA ruta de Next que importe `src/lib/*` compila (Module not found
  // '../env.js'). Trade-off F0 aceptado: webpack es más lento que turbopack pero
  // correcto; volver a turbopack requeriría un codemod de imports a extensionless.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
