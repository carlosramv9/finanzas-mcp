import { z } from "zod";
import { listarCategorias, mensajeCategoriaInexistente, resolverCategoria } from "@/db/categorias";
import { actualizarMovimiento as actualizar, type CambiosDatos } from "@/db/movimientos";
import { cambiosMovimiento } from "@/validation/movimiento";
import { describirMovimiento, movimientoSalida, normalizarFecha, validarNoFutura } from "./comun";
import { definirHerramienta } from "./herramienta";

export const actualizarMovimiento = definirHerramienta({
  nombre: "actualizar_movimiento",
  titulo: "Actualizar movimiento",
  descripcion:
    "Corrige un movimiento existente por su id (obtenido de listar_movimientos). Solo se " +
    "pueden cambiar: categoria, concepto, notas (null para borrarlas), fecha y monto; envía " +
    "únicamente los campos a modificar. No permite cambiar tipo, origen ni id_correo.",
  entrada: cambiosMovimiento,
  salida: z.object({ movimiento: movimientoSalida }),
  anotaciones: {
    readOnlyHint: false,
    // Sobrescribe valores anteriores.
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ejecutar({ id, ...entrada }, { db, zonaHoraria, ahora }) {
    const cambios: CambiosDatos = { ...entrada };

    if (entrada.categoria !== undefined) {
      const categorias = await listarCategorias(db);
      cambios.categoria = resolverCategoria(categorias, entrada.categoria);
      if (!cambios.categoria) {
        return { error: `categoria: ${mensajeCategoriaInexistente(categorias, entrada.categoria)}` };
      }
    }
    if (entrada.fecha !== undefined) {
      cambios.fecha = normalizarFecha(entrada.fecha, zonaHoraria);
      const errorFecha = validarNoFutura(cambios.fecha, ahora());
      if (errorFecha) return { error: `fecha: ${errorFecha}` };
    }

    const movimiento = await actualizar(db, id, cambios);
    if (!movimiento) return { error: `No existe ningún movimiento con id ${id}.` };
    return {
      texto: `Movimiento actualizado: ${describirMovimiento(movimiento, zonaHoraria)}`,
      datos: { movimiento },
    };
  },
});
