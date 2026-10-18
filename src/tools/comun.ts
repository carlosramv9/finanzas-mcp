import { z } from "zod";
import { mensajeCategoriaInexistente, resolverCategoria, type Categoria } from "@/db/categorias";
import type { DatosMovimiento, Movimiento } from "@/db/movimientos";
import { aInstante, esSoloFecha } from "@/validation/comunes";
import type { MovimientoNuevo } from "@/validation/movimiento";

/** Esquema de salida de un movimiento guardado. */
export const movimientoSalida = z.object({
  id: z.number(),
  tipo: z.enum(["cargo", "abono"]),
  monto: z.number(),
  moneda: z.string(),
  fecha: z.string(),
  concepto: z.string(),
  categoria: z.string(),
  cuenta: z.string().nullable(),
  origen: z.enum(["correo", "manual"]),
  id_correo: z.string().nullable(),
  notas: z.string().nullable(),
  creado_en: z.string(),
  actualizado_en: z.string(),
});

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Convierte la fecha del usuario en instante ISO. Una fecha sin hora se fija a
 * las 12:00 locales para que no cambie de día al guardarse en UTC.
 */
export function normalizarFecha(fecha: string, zona: string): string {
  return esSoloFecha(fecha) ? aInstante(fecha, "12:00:00", zona) : fecha;
}

/** Error si la fecha está más de un día en el futuro (probable error de captura). */
export function validarNoFutura(instante: string, ahora: Date): string | undefined {
  return Date.parse(instante) > ahora.getTime() + UN_DIA_MS
    ? `La fecha ${instante} está en el futuro.`
    : undefined;
}

/** Validaciones que dependen de la BD o del reloj, y normalización final. */
export function prepararMovimiento(
  m: MovimientoNuevo,
  categorias: Categoria[],
  zona: string,
  ahora: Date,
): { datos: DatosMovimiento } | { error: string } {
  const categoria = resolverCategoria(categorias, m.categoria);
  if (!categoria) return { error: `categoria: ${mensajeCategoriaInexistente(categorias, m.categoria)}` };
  const fecha = normalizarFecha(m.fecha, zona);
  const errorFecha = validarNoFutura(fecha, ahora);
  if (errorFecha) return { error: `fecha: ${errorFecha}` };
  return { datos: { ...m, categoria, fecha } };
}

export function formatearMonto(monto: number, moneda: string): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda }).format(monto);
}

/** Línea breve legible; la fecha se muestra en la zona horaria local. */
export function describirMovimiento(m: Movimiento, zona: string): string {
  const fecha = new Intl.DateTimeFormat("sv-SE", { timeZone: zona }).format(new Date(m.fecha));
  return `#${m.id} ${fecha} ${m.tipo} ${formatearMonto(m.monto, m.moneda)} · ${m.concepto} · ${m.categoria}`;
}
