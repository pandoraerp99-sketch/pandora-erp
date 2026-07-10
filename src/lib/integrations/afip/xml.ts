/**
 * Helpers XML mínimos para parsear respuestas SOAP de AFIP (WSAA/WSFEv1).
 *
 * NO es un parser XML general. Extrae contenido de tags conocidos de un shape
 * fijo y confiable (respuestas del propio AFIP). Tolerante a prefijos de
 * namespace (`<ns:Tag>`) y a atributos (`<Tag attr="x">`).
 *
 * Para input no confiable NO usar esto (usar un parser real). Acá el input es
 * la respuesta de AFIP sobre TLS — confiable en estructura.
 */

export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tagPattern(tag: string): string {
  // <tag> | <ns:tag> | <tag attr="x">  ...  </tag> | </ns:tag>
  return `<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`;
}

/** Primer match del tag. Devuelve el contenido trim, o null si no está. */
export function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(tagPattern(tag)));
  return m ? m[1]!.trim() : null;
}

/** Todos los matches del tag (ej varios `<Obs>` / `<AlicIva>`). */
export function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(tagPattern(tag), 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]!.trim());
  }
  return out;
}

/** Contenido de un tag como número, o null si falta / no es número. */
export function extractNumber(xml: string, tag: string): number | null {
  const raw = extractTag(xml, tag);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}
