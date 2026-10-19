import { z } from "zod";
import { categoria, concepto, fechaIso, monto, notas, tipo } from "./comunes";

const MONEDAS_ISO_4217 = new Set(Intl.supportedValuesOf("currency"));

export const cuenta = z
  .string({ error: "La cuenta debe ser texto con 4 dígitos, p. ej. '1234'." })
  .trim()
  .superRefine((v, ctx) => {
    if (/^\d{4}$/.test(v)) return;
    const digitos = v.replace(/\D/g, "").length;
    ctx.addIssue({
      code: "custom",
      message:
        digitos > 4
          ? "La cuenta solo puede contener los últimos 4 dígitos. Nunca envíes el número completo."
          : "La cuenta debe ser exactamente 4 dígitos (los últimos de la tarjeta o cuenta), p. ej. '1234'.",
    });
  });

export const moneda = z
  .string({ error: "La moneda debe ser un código ISO 4217, p. ej. 'MXN'." })
  .trim()
  .toUpperCase()
  .refine((v) => /^[A-Z]{3}$/.test(v) && MONEDAS_ISO_4217.has(v), {
    error: "Moneda inválida: usa un código ISO 4217 de 3 letras, p. ej. 'MXN' o 'USD'.",
  });

export const idCorreo = z
  .string({ error: "El id_correo debe ser texto." })
  .trim()
  .min(1, { error: "El id_correo no puede estar vacío." })
  .max(256, { error: "El id_correo admite como máximo 256 caracteres." });

export const ESTADOS = ["completado", "pendiente", "cancelado", "rechazado"] as const;
export type Estado = (typeof ESTADOS)[number];

export const estado = z.enum(ESTADOS, {
  error: "El estado debe ser 'completado', 'pendiente', 'cancelado' o 'rechazado'.",
});

export const MIN_MOTIVO_CANCELACION = 3;

export const motivoEstado = z
  .string({ error: "El motivo debe ser texto." })
  .trim()
  .min(1, { error: "El motivo no puede estar vacío." })
  .max(500, { error: "El motivo admite como máximo 500 caracteres." });

/** Reglas de estado/motivo compartidas por alta y actualización. */
function validarMotivo(
  e: Estado | undefined,
  motivo: string | null | undefined,
  ctx: z.RefinementCtx,
) {
  if (e === "cancelado" && (motivo ?? "").length < MIN_MOTIVO_CANCELACION) {
    ctx.addIssue({
      code: "custom",
      path: ["motivo_estado"],
      message: "Cancelar un movimiento exige motivo_estado (mínimo 3 caracteres).",
    });
  }
  if (e === "completado" && motivo) {
    ctx.addIssue({
      code: "custom",
      path: ["motivo_estado"],
      message: "motivo_estado no aplica a movimientos completados.",
    });
  }
}

const descripciones = {
  tipo: "'cargo' para gastos/salidas de dinero, 'abono' para ingresos/depósitos.",
  monto: "Monto positivo con máximo 2 decimales, sin signo ni símbolo de moneda. Ej.: 1250.5",
  fecha:
    "Fecha ISO 8601 del movimiento. Preferible fecha-hora con zona, p. ej. " +
    "'2026-10-18T14:30:00-06:00'. Si solo se conoce el día, 'YYYY-MM-DD' (se guarda a las 12:00 hora local).",
  concepto: "Descripción breve (1–200 caracteres), p. ej. el comercio: 'OXXO Insurgentes'.",
  categoria: "Nombre exacto de una categoría existente (consultar con listar_categorias).",
  cuenta: "Opcional. SOLO los últimos 4 dígitos de la tarjeta o cuenta, p. ej. '1234'.",
  moneda: "Opcional. Código ISO 4217 de 3 letras. Por defecto 'MXN'.",
  origen: "'correo' si viene de una notificación bancaria por email, 'manual' si lo dictó el usuario.",
  id_correo: "ID del mensaje de Gmail. Obligatorio si origen = 'correo'; evita duplicados.",
  notas: "Opcional. Notas libres (máx. 1000 caracteres).",
  estado:
    "Opcional. 'completado' (por defecto), 'pendiente', 'cancelado' o 'rechazado'. Solo los " +
    "completados cuentan en totales.",
  motivo_estado:
    "Motivo del estado. OBLIGATORIO si estado = 'cancelado'; opcional en pendiente/rechazado; " +
    "no aplica a completado.",
} as const;

/** Entrada de un movimiento nuevo (registrar_movimiento y cada elemento del lote). */
export const movimientoNuevo = z
  .object({
    tipo: tipo.describe(descripciones.tipo),
    monto: monto.describe(descripciones.monto),
    fecha: fechaIso.describe(descripciones.fecha),
    concepto: concepto.describe(descripciones.concepto),
    categoria: categoria.describe(descripciones.categoria),
    cuenta: cuenta.optional().describe(descripciones.cuenta),
    moneda: moneda.default("MXN").describe(descripciones.moneda),
    origen: z
      .enum(["correo", "manual"], { error: "El origen debe ser 'correo' o 'manual'." })
      .describe(descripciones.origen),
    id_correo: idCorreo.optional().describe(descripciones.id_correo),
    notas: notas.optional().describe(descripciones.notas),
    estado: estado.default("completado").describe(descripciones.estado),
    motivo_estado: motivoEstado.optional().describe(descripciones.motivo_estado),
  })
  .strict()
  .superRefine((m, ctx) => {
    validarMotivo(m.estado, m.motivo_estado, ctx);
    if (m.origen === "correo" && !m.id_correo) {
      ctx.addIssue({
        code: "custom",
        path: ["id_correo"],
        message: "El id_correo es obligatorio cuando origen = 'correo'.",
      });
    }
    if (m.origen === "manual" && m.id_correo) {
      ctx.addIssue({
        code: "custom",
        path: ["id_correo"],
        message: "El id_correo solo aplica cuando origen = 'correo'.",
      });
    }
  });

export type MovimientoNuevo = z.output<typeof movimientoNuevo>;

export const CAMPOS_ACTUALIZABLES = [
  "categoria", "concepto", "notas", "fecha", "monto", "estado", "motivo_estado",
] as const;

/** Cambios permitidos por actualizar_movimiento. No incluye id_correo ni origen. */
export const cambiosMovimiento = z
  .object({
    id: z
      .number({ error: "El id debe ser un número entero." })
      .int({ error: "El id debe ser un número entero." })
      .positive({ error: "El id debe ser positivo." })
      .describe("ID del movimiento a actualizar (obtenido de listar_movimientos)."),
    categoria: categoria.optional().describe("Nueva categoría (debe existir)."),
    concepto: concepto.optional().describe("Nuevo concepto (1–200 caracteres)."),
    notas: notas
      .nullable()
      .optional()
      .describe("Nuevas notas; null para borrarlas."),
    fecha: fechaIso.optional().describe(descripciones.fecha),
    monto: monto.optional().describe(descripciones.monto),
    estado: estado.optional().describe(
      "Nuevo estado. Se permite pasar de cualquier estado a cualquier otro; al volver a " +
        "'completado' se borra el motivo.",
    ),
    motivo_estado: motivoEstado
      .nullable()
      .optional()
      .describe(descripciones.motivo_estado + " null para borrarlo."),
  })
  .strict()
  .refine((c) => CAMPOS_ACTUALIZABLES.some((campo) => c[campo] !== undefined), {
    error:
      "Indica al menos un campo a cambiar: categoria, concepto, notas, fecha, monto, estado o motivo_estado.",
  })
  .superRefine((c, ctx) => validarMotivo(c.estado, c.motivo_estado, ctx));

export type CambiosMovimiento = z.output<typeof cambiosMovimiento>;
