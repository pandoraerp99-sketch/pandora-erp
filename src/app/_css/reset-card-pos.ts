/**
 * Neutraliza el `.card` del POS en las pantallas de gestión.
 *
 * ── EL PROBLEMA ───────────────────────────────────────────────────────────
 * `shellCss` (el CSS del POS) define:
 *
 *     .card{ display:flex; flex-direction:column; background:...;
 *            border:...; }
 *     .card:hover{ transform:translateY(-2px); border-color:violeta; }
 *     .card:active{ transform:scale(0.98); }
 *
 * Las maquetas de Clientes, Productos y Contador declaran su `.card` con
 * **sólo** `border-radius` y `padding`. Como el CSS de cada pantalla se monta
 * DESPUES del shell, gana en esas dos propiedades — pero todo lo demás del POS
 * **se filtra**: las tarjetas quedan en columna, se levantan al pasar el mouse
 * y se achican al hacer clic.
 *
 * O sea: paneles de lectura que se comportan como botones. Se nota poco de a
 * uno y mucho cuando movés el mouse por la pantalla.
 *
 * ── POR QUE NO SE ARREGLA EN shellCss ─────────────────────────────────────
 * Porque ahí ese `.card` es CORRECTO: en el POS las tarjetas son productos, y
 * se tocan. El problema no es la regla, es que el mismo nombre significa dos
 * cosas distintas en dos maquetas. Se corrige donde se importa el significado
 * equivocado.
 *
 * ── POR QUE UN MODULO Y NO UNA COPIA EN CADA ARCHIVO ──────────────────────
 * Son tres pantallas con el mismo defecto. Triplicar un arreglo sutil es la
 * forma más confiable de que una copia quede vieja.
 */
export const RESET_CARD_POS = `
/* ── Ver src/app/_css/reset-card-pos.ts ── */
.card{ display:block; }
.card:hover{ transform:none; border-color:rgba(255,255,255,0.85); }
.card:active{ transform:none; }

/* Botones apagados: las maquetas no traen estado disabled porque en una
   maqueta todo "anda". Sin esto, un boton apagado se ve EXACTAMENTE igual a
   uno activo — y el que lo aprieta cree que la app se colgo. Se aplica a los
   tres vocabularios de boton que usan estas pantallas. */
.b[disabled], .emp-chip[disabled], .rx[disabled], .pm-btn[disabled],
.cta[disabled], .hbtn[disabled]{
  opacity:0.45; cursor:not-allowed; box-shadow:none; transform:none;
}
.b[disabled]:hover, .emp-chip[disabled]:hover, .rx[disabled]:hover,
.cta[disabled]:hover, .hbtn[disabled]:hover{ transform:none; }
`;
