/**
 * Una vuelta COMPLETA contra el Storage de verdad, como el usuario.
 *
 * Por qué hace falta: T-ADJ-01 escribe las filas de `storage.objects` a mano y
 * T-ADJ-02 usa un almacén falso. O sea que `almacenSupabase()` —el único
 * camino que corre en producción— nunca se ejecutó ni una vez. Lo que se
 * prueba acá no es la lógica (esa ya está probada) sino qué CONTESTA Supabase:
 *
 *   - ¿`list()` devuelve el objeto bajo la policy de SELECT? De eso depende
 *     `archivo_presente`: si contesta vacío, TODOS los comprobantes se
 *     dibujarían como "el archivo no está".
 *   - ¿`remove()` puede borrar, si la 0040 NO creó policy de DELETE? Y si no
 *     puede, ¿avisa con `error` o devuelve `data: []` y `error: null`?
 *     Esa diferencia decide si la compensación grita o se calla.
 *
 * Corre como el operador de dev (anon key + login real), no con el service
 * role: con el service role el RLS no se aplica y la prueba no probaría nada.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

function env(nombre) {
  // `.env.test` PRIMERO, y no es un descuido: en esta máquina `.env.local`
  // tiene el placeholder `dummy-project-test.supabase.co` y el Supabase que
  // corre de verdad es el local de Docker, que está en `.env.test`. Leer al
  // revés hacía que el script fallara con ENOTFOUND contra un host inventado.
  for (const archivo of ['.env.test', '.env.local', '.env']) {
    try {
      const m = readFileSync(archivo, 'utf8').match(
        new RegExp('^' + nombre + '=(.*)$', 'm')
      );
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      /* el archivo puede no existir */
    }
  }
  return process.env[nombre] ?? '';
}

const URL = env('NEXT_PUBLIC_SUPABASE_URL');
const ANON = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const EMAIL = process.env.EMAIL || 'operador@pandora.dev';
const PASS = process.env.PASS || 'pandora-dev-1234';

if (!URL || !ANON) {
  console.log('🔴 faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY');
  process.exit(1);
}

const supabase = createClient(URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: sesion, error: errLogin } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASS,
});
if (errLogin || !sesion?.session) {
  // SIN VERIFICAR y no rojo: esto necesita el Supabase local levantado y el
  // usuario de dev. En una máquina donde no están, el chequeo no corrió — y
  // un chequeo que no corrió no es un chequeo que pasó, así que lo DICE en vez
  // de sumar un verde que no significa nada.
  console.log('⚠️  SIN VERIFICAR: no se pudo entrar como', EMAIL, '-', errLogin?.message);
  process.exit(0);
}

// El tenant sale del JWT, igual que en la app.
const claims = JSON.parse(
  Buffer.from(sesion.session.access_token.split('.')[1], 'base64').toString()
);
const tenant = claims.company_id ?? (claims.company_ids ?? [])[0];
console.log('tenant del JWT:', tenant ?? '(ninguno)');
if (!tenant) {
  console.log('🔴 el JWT no trae company_id — sin eso la policy del bucket no deja nada');
  process.exit(1);
}

const bucket = supabase.storage.from('comprobantes');
const id = crypto.randomUUID();
const path = `${tenant}/${id}`;
const bytes = new TextEncoder().encode('%PDF-1.4 prueba real');

let fallas = 0;
const decir = (ok, txt) => {
  console.log(`${ok ? '✅' : '🔴'} ${txt}`);
  if (!ok) fallas++;
};

// ── 1. subir ────────────────────────────────────────────────────────────────
const sub = await bucket.upload(path, bytes, { contentType: 'application/pdf' });
decir(!sub.error, `upload: ${sub.error ? sub.error.message : 'ok'}`);

// ── 2. subir en la carpeta del VECINO ───────────────────────────────────────
const ajeno = await bucket.upload(`${crypto.randomUUID()}/x`, bytes, {
  contentType: 'application/pdf',
});
decir(!!ajeno.error, `upload en carpeta ajena: ${ajeno.error ? 'rechazado' : '🔴 ENTRÓ'}`);

// ── 3. list: de esto depende `archivo_presente` ─────────────────────────────
const lis = await bucket.list(tenant, { limit: 100, search: id });
const encontrado = (lis.data ?? []).some((o) => o.name === id);
decir(
  encontrado,
  `list encuentra el objeto: ${encontrado ? 'sí' : `NO (error=${lis.error?.message ?? 'ninguno'}, devolvió ${(lis.data ?? []).length})`}`
);

// ── 4. firmar ───────────────────────────────────────────────────────────────
const fir = await bucket.createSignedUrl(path, 60);
decir(!!fir.data?.signedUrl, `createSignedUrl: ${fir.error ? fir.error.message : 'ok'}`);

// ── 5. borrar — el punto del asunto ─────────────────────────────────────────
const rm = await bucket.remove([path]);
console.log(
  `   remove devolvió: data=${JSON.stringify(rm.data)} error=${rm.error ? rm.error.message : 'null'}`
);
const sigue = await bucket.list(tenant, { limit: 100, search: id });
const quedaba = (sigue.data ?? []).some((o) => o.name === id);
console.log(`   ¿el objeto sigue ahí? ${quedaba ? 'SÍ' : 'no'}`);

if (quedaba && !rm.error) {
  decir(false, 'remove NO borró y NO avisó: un error mudo (data vacío, error null)');
} else if (quedaba) {
  decir(true, 'remove no borró pero AVISÓ con error — la compensación puede gritar');
} else {
  decir(true, 'remove borró de verdad');
}

// ── 6. la otra mitad de la 0042: CON ficha, NO se puede borrar ─────────────
//
// El paso 5 probó que el huérfano se borra. Probar sólo eso sería peligroso:
// una policy de DELETE demasiado ancha también daría verde ahí, y dejaría que
// un usuario destruya un comprobante vivo — el estado "ficha sin archivo" que
// todo el diseño evita. Así que se prueba el caso que TIENE que fallar.
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
if (!SERVICE) {
  console.log('⚠️  sin SERVICE_ROLE_KEY: NO se pudo probar que el comprobante CON ficha esté protegido');
  fallas++;
} else {
  const admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const id2 = crypto.randomUUID();
  const path2 = `${tenant}/${id2}`;
  await bucket.upload(path2, bytes, { contentType: 'application/pdf' });

  const { data: gastos } = await admin
    .from('expenses')
    .select('id')
    .eq('tenant_id', tenant)
    .limit(1);
  const { data: usuarios } = await admin
    .from('company_users')
    .select('user_id')
    .eq('company_id', tenant)
    .limit(1);

  if (!gastos?.[0] || !usuarios?.[0]) {
    console.log('⚠️  la base no tiene gastos/usuarios: NO se probó la protección');
    fallas++;
  } else {
    const { error: errFicha } = await admin.from('attachments').insert({
      id: id2,
      tenant_id: tenant,
      tipo: 'comprobante',
      expense_id: gastos[0].id,
      nombre_original: 'protegido.pdf',
      content_type: 'application/pdf',
      bytes: bytes.length,
      sha256: 'b'.repeat(64),
      storage_path: path2,
      uploaded_by: usuarios[0].user_id,
    });

    if (errFicha) {
      console.log('⚠️  no se pudo crear la ficha de prueba:', errFicha.message);
      fallas++;
    } else {
      const rm2 = await bucket.remove([path2]);
      const sigue2 = await bucket.list(tenant, { limit: 100, search: id2 });
      const protegido = (sigue2.data ?? []).some((o) => o.name === id2);
      decir(
        protegido,
        protegido
          ? 'un comprobante CON ficha no se puede borrar (0042 protege el archivo vivo)'
          : `🔴 SE BORRÓ un comprobante con ficha — la policy quedó demasiado ancha (data=${JSON.stringify(rm2.data)})`
      );

      // Limpieza: se saca la ficha con el service role y después el objeto.
      await admin.from('attachments').delete().eq('id', id2);
      await bucket.remove([path2]);
    }
  }
}

console.log(fallas === 0 ? '\nVUELTA REAL OK' : `\n${fallas} problema(s) en la vuelta real`);
process.exit(fallas === 0 ? 0 : 1);
