import { z } from "zod";

// Mensajes de error de zod en español para todo lo que no tenga mensaje propio.
z.config(z.locales.es());

/** Zona horaria con la que se interpretan fechas sin hora (`YYYY-MM-DD`). */
export const ZONA_HORARIA_POR_DEFECTO = "America/Mexico_City";

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_MINIMA = Date.parse("2000-01-01T00:00:00Z");

/** `true` si el texto es una fecha sin hora (`YYYY-MM-DD`). */
export function esSoloFecha(valor: string): boolean {
  return PATRON_FECHA.test(valor);
}

/** Desfase UTC (p. ej. `-06:00`) de una zona horaria en un día dado. */
export function desfaseZona(fecha: string, zona: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${fecha}T12:00:00Z`));
  const nombre = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  // "GMT" a secas significa desfase cero.
  return nombre === "GMT" ? "+00:00" : nombre.replace("GMT", "");
}

/** Convierte `YYYY-MM-DD` + hora local en un instante ISO con desfase explícito. */
export function aInstante(fecha: string, hora: string, zona: string): string {
  return `${fecha}T${hora}${desfaseZona(fecha, zona)}`;
}

/** Suma días a una fecha `YYYY-MM-DD`. */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const fechaCalendarioValida = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/**
 * Fecha ISO 8601: `YYYY-MM-DD` o fecha-hora con zona (`Z` o `±HH:MM`).
 * No transforma; la interpretación depende de quien la use.
 */
export const fechaIso = z
  .string({ error: "La fecha debe ser un texto ISO 8601." })
  .trim()
  .refine(
    (v) =>
      esSoloFecha(v)
        ? fechaCalendarioValida(v)
        : z.iso.datetime({ offset: true }).safeParse(v).success,
    {
      error:
        "Fecha inválida. Usa ISO 8601: 'YYYY-MM-DD' o fecha-hora con zona horaria, " +
        "p. ej. '2026-10-18T14:30:00-06:00'.",
    },
  )
  .refine((v) => Date.parse(esSoloFecha(v) ? `${v}T00:00:00Z` : v) >= FECHA_MINIMA, {
    error: "La fecha no puede ser anterior al año 2000.",
  });

/** Monto positivo con máximo 2 decimales, dentro de NUMERIC(12,2). */
export const monto = z
  .number({ error: "El monto debe ser un número." })
  .positive({ error: "El monto debe ser mayor que 0." })
  .max(9_999_999_999.99, { error: "El monto excede el máximo permitido (9,999,999,999.99)." })
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(String(v)), {
    error: "El monto admite como máximo 2 decimales.",
  });

export const concepto = z
  .string({ error: "El concepto debe ser texto." })
  .trim()
  .min(1, { error: "El concepto no puede estar vacío." })
  .max(200, { error: "El concepto admite como máximo 200 caracteres." });

export const categoria = z
  .string({ error: "La categoría debe ser texto." })
  .trim()
  .min(1, { error: "La categoría no puede estar vacía." })
  .max(100, { error: "La categoría admite como máximo 100 caracteres." });

export const notas = z
  .string({ error: "Las notas deben ser texto." })
  .trim()
  .max(1000, { error: "Las notas admiten como máximo 1000 caracteres." });

export const tipo = z.enum(["cargo", "abono"], {
  error: "El tipo debe ser 'cargo' o 'abono'.",
});

/** Formatea los errores de zod en un mensaje legible en español. */
export function formatearErrores(error: z.ZodError, prefijo = ""): string {
  return error.issues
    .map((issue) => {
      const ruta = [prefijo, ...issue.path.map(String)].filter(Boolean).join(".");
      return ruta ? `${ruta}: ${issue.message}` : issue.message;
    })
    .join("\n");
}
