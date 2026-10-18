import { z } from "zod";
import { listarCategorias } from "@/db/categorias";
import { insertarMovimientos, type DatosMovimiento } from "@/db/movimientos";
import { formatearErrores } from "@/validation/comunes";
import { movimientoNuevo } from "@/validation/movimiento";
import { prepararMovimiento } from "./comun";
import { definirHerramienta } from "./herramienta";

export const MAX_LOTE = 50;

const resultadoElemento = z.object({
  indice: z.number().describe("Posición (desde 0) en el arreglo enviado"),
  estado: z.enum(["insertado", "existente", "error"]),
  id: z.number().optional().describe("ID del movimiento insertado o existente"),
  mensaje: z.string().optional().describe("Motivo del error de validación"),
});

const entradaLote = <T extends z.ZodType>(elemento: T) =>
  z
    .object({
      movimientos: z
        .array(elemento, { error: "movimientos debe ser un arreglo." })
        .min(1, { error: "Envía al menos un movimiento." })
        .max(MAX_LOTE, { error: `Máximo ${MAX_LOTE} movimientos por lote.` })
        .describe(`Arreglo de 1 a ${MAX_LOTE} movimientos.`),
    })
    .strict();

export const registrarMovimientosLote = definirHerramienta({
  nombre: "registrar_movimientos_lote",
  titulo: "Registrar movimientos en lote",
  descripcion:
    `Guarda de 1 a ${MAX_LOTE} movimientos en una sola llamada (p. ej. varias notificaciones ` +
    "bancarias de Gmail). Cada elemento tiene el mismo formato que registrar_movimiento. Los " +
    "elementos válidos se guardan en una transacción aunque otros fallen la validación; los " +
    "id_correo ya registrados no se duplican. Devuelve cuántos se insertaron, cuántos ya " +
    "existían y los errores por índice (posición desde 0) para corregirlos y reenviarlos.",
  // Solo se exige el arreglo: cada elemento se valida por separado en `ejecutar`
  // para que los inválidos no impidan guardar los válidos.
  entrada: entradaLote(z.unknown()),
  // A Claude se le anuncia la forma completa de cada elemento.
  anuncio: entradaLote(movimientoNuevo),
  salida: z.object({
    insertados: z.number(),
    existentes: z.number(),
    con_error: z.number(),
    resultados: z.array(resultadoElemento),
  }),
  anotaciones: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async ejecutar({ movimientos }, { db, zonaHoraria, ahora }) {
    const categorias = await listarCategorias(db);
    const momento = ahora();
    const resultados: z.input<typeof resultadoElemento>[] = [];
    const validos: { indice: number; datos: DatosMovimiento }[] = [];

    movimientos.forEach((crudo, indice) => {
      const entrada = movimientoNuevo.safeParse(crudo);
      if (!entrada.success) {
        resultados.push({ indice, estado: "error", mensaje: formatearErrores(entrada.error) });
        return;
      }
      const preparado = prepararMovimiento(entrada.data, categorias, zonaHoraria, momento);
      if ("error" in preparado) {
        resultados.push({ indice, estado: "error", mensaje: preparado.error });
      } else {
        validos.push({ indice, datos: preparado.datos });
      }
    });

    const insertados = await insertarMovimientos(db, validos.map((v) => v.datos));
    insertados.forEach(({ movimiento, insertado }, i) => {
      resultados.push({
        indice: validos[i]!.indice,
        estado: insertado ? "insertado" : "existente",
        id: movimiento.id,
      });
    });
    resultados.sort((a, b) => a.indice - b.indice);

    const contar = (estado: string) => resultados.filter((r) => r.estado === estado).length;
    const datos = {
      insertados: contar("insertado"),
      existentes: contar("existente"),
      con_error: contar("error"),
      resultados,
    };
    const errores = resultados
      .filter((r) => r.estado === "error")
      .map((r) => `[${r.indice}] ${r.mensaje}`);
    return {
      texto:
        `Lote procesado: ${datos.insertados} insertado(s), ${datos.existentes} ya existía(n), ` +
        `${datos.con_error} con error.` +
        (errores.length ? `\nErrores:\n${errores.join("\n")}` : ""),
      datos,
    };
  },
});
