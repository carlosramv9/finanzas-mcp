import { z } from "zod";
import { listarCategorias } from "@/db/categorias";
import { insertarMovimiento } from "@/db/movimientos";
import { movimientoNuevo } from "@/validation/movimiento";
import { describirMovimiento, movimientoSalida, prepararMovimiento } from "./comun";
import { definirHerramienta } from "./herramienta";

export const registrarMovimiento = definirHerramienta({
  nombre: "registrar_movimiento",
  titulo: "Registrar movimiento",
  descripcion:
    "Guarda UN cargo (gasto) o abono (ingreso) bancario. Úsala al leer una notificación " +
    "bancaria en Gmail (origen 'correo', con el id_correo del mensaje) o cuando el usuario " +
    "dicta un gasto (origen 'manual'). Para varios movimientos a la vez usa " +
    "registrar_movimientos_lote. Si el id_correo ya estaba registrado no duplica: devuelve " +
    "el existente con insertado = false. La categoría debe ser una de listar_categorias. " +
    "La cuenta, si se conoce, son SOLO los últimos 4 dígitos.",
  entrada: movimientoNuevo,
  salida: z.object({
    insertado: z.boolean().describe("false si ya existía un movimiento con ese id_correo"),
    movimiento: movimientoSalida,
  }),
  anotaciones: {
    readOnlyHint: false,
    destructiveHint: false,
    // Con origen 'manual' repetir la llamada crea otro movimiento.
    idempotentHint: false,
    openWorldHint: false,
  },
  async ejecutar(entrada, { db, zonaHoraria, ahora }) {
    const preparado = prepararMovimiento(entrada, await listarCategorias(db), zonaHoraria, ahora());
    if ("error" in preparado) return preparado;

    const { movimiento, insertado } = await insertarMovimiento(db, preparado.datos);
    const linea = describirMovimiento(movimiento, zonaHoraria);
    return {
      texto: insertado
        ? `Movimiento registrado: ${linea}`
        : `Ya existía un movimiento con ese id_correo; no se duplicó: ${linea}`,
      datos: { insertado, movimiento },
    };
  },
});
