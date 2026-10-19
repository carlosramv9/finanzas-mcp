import { z } from "zod";
import { aInstante, categoria, esSoloFecha, fechaIso, sumarDias, tipo } from "./comunes";
import { estado } from "./movimiento";

const descripcionDesde =
  "Inicio del periodo (inclusive). 'YYYY-MM-DD' (desde las 00:00 hora local) o fecha-hora ISO con zona.";
const descripcionHasta =
  "Fin del periodo (inclusive). 'YYYY-MM-DD' (incluye todo ese día, hora local) o fecha-hora ISO con zona.";

/** Rango ya convertido a instantes; `hasta` es exclusivo. */
export interface RangoInstantes {
  desde?: string;
  hastaExclusivo?: string;
  hastaInclusivo?: string;
}

/** Normaliza `desde`/`hasta` del usuario a instantes con zona explícita. */
export function normalizarRango(
  rango: { desde?: string; hasta?: string },
  zona: string,
): RangoInstantes {
  const resultado: RangoInstantes = {};
  if (rango.desde) {
    resultado.desde = esSoloFecha(rango.desde)
      ? aInstante(rango.desde, "00:00:00", zona)
      : rango.desde;
  }
  if (rango.hasta) {
    if (esSoloFecha(rango.hasta)) {
      resultado.hastaExclusivo = aInstante(sumarDias(rango.hasta, 1), "00:00:00", zona);
    } else {
      resultado.hastaInclusivo = rango.hasta;
    }
  }
  return resultado;
}

/** Instante aproximado para comparar desde/hasta sin conocer aún la zona. */
const instanteAproximado = (v: string) => Date.parse(esSoloFecha(v) ? `${v}T00:00:00Z` : v);

const desdeAntesDeHasta = (r: { desde?: string; hasta?: string }) =>
  !r.desde || !r.hasta || instanteAproximado(r.desde) <= instanteAproximado(r.hasta);

const errorRango = {
  error: "'desde' debe ser anterior o igual a 'hasta'.",
  path: ["hasta"],
};

export const filtrosListado = z
  .object({
    desde: fechaIso.optional().describe(descripcionDesde),
    hasta: fechaIso.optional().describe(descripcionHasta),
    tipo: tipo.optional().describe("Filtra por 'cargo' o 'abono'."),
    categoria: categoria.optional().describe("Filtra por nombre exacto de categoría."),
    estado: estado.optional().describe("Filtra por estado ('completado', 'pendiente', 'cancelado', 'rechazado')."),
    texto: z
      .string({ error: "El texto debe ser una cadena." })
      .trim()
      .min(1, { error: "El texto de búsqueda no puede estar vacío." })
      .max(100, { error: "El texto de búsqueda admite como máximo 100 caracteres." })
      .optional()
      .describe("Busca este texto dentro del concepto (sin distinguir mayúsculas)."),
    limite: z
      .number({ error: "El límite debe ser un número entero." })
      .int({ error: "El límite debe ser un número entero." })
      .min(1, { error: "El límite mínimo es 1." })
      .max(200, { error: "El límite máximo es 200." })
      .default(50)
      .describe("Máximo de movimientos a devolver (1–200, por defecto 50)."),
  })
  .strict()
  .refine(desdeAntesDeHasta, errorRango);

export type FiltrosListado = z.output<typeof filtrosListado>;

export const rangoResumen = z
  .object({
    desde: fechaIso.describe(descripcionDesde),
    hasta: fechaIso.describe(descripcionHasta),
  })
  .strict()
  .refine(desdeAntesDeHasta, errorRango);

export type RangoResumen = z.output<typeof rangoResumen>;
