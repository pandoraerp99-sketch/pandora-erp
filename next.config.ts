import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ── YA NO HAY REWRITES A MAQUETAS (2026-09-10) ──
  // /caja dejó de tenerlo el 2026-09-03 y /panel hoy: los dos sirven React de
  // src/app/, sobre <AppShell>, como el resto.
  //
  // El de /panel servía `public/panel.html` verbatim y venía con la exención de
  // CSP **y de auth** en src/proxy.ts. Era la pantalla de inicio, con todos los
  // números escritos a mano y accesible sin sesión.
  //
  // Las dos maquetas quedan archivadas como referencia visual: panel.html y
  // _maquetas/caja.html. Fuera del alcance de cualquier rewrite.

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
