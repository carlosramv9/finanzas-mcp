import { z } from "zod";
import { listarCategorias, mensajeCategoriaInexistente, resolverCategoria } from "@/db/categorias";
import { listarMovimientos as consultarMovimientos } from "@/db/movimientos";
import { filtrosListado, normalizarRango } from "@/validation/filtros";
import { describirMovimiento, movimientoSalida } from "./comun";
import { definirHerramienta } from "./herramienta";

export const listarMovimientos = definirHerramienta({
  nombre: "listar_movimientos",
  titulo: "Listar movimientos",
  descripcion:
    "Consulta movimientos guardados, del más reciente al más antiguo. Todos los filtros son " +
    "opcionales y se combinan: periodo (desde/hasta, inclusive), tipo ('cargo' o 'abono'), " +
    "categoria, estado y texto contenido en el concepto. Cada movimiento incluye su estado " +
    "y motivo_estado. Devuelve hasta 'limite' movimientos " +
    "(por defecto 50, máximo 200) con su id, útil para actualizar_movimiento. Solo lectura.",
  entrada: filtrosListado,
  salida: z.object({
    total: z.number().describe("Cantidad de movimientos devueltos"),
    limite: z.number(),
    movimientos: z.array(movimientoSalida),
  }),
  anotaciones: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ejecutar(filtros, { db, zonaHoraria }) {
    let categoria: string | undefined;
    if (filtros.categoria) {
      const categorias = await listarCategorias(db);
      categoria = resolverCategoria(categorias, filtros.categoria);
      if (!categoria) {
        return { error: `categoria: ${mensajeCategoriaInexistente(categorias, filtros.categoria)}` };
      }
    }

    const movimientos = await consultarMovimientos(db, {
      ...normalizarRango(filtros, zonaHoraria),
      tipo: filtros.tipo,
      categoria,
      estado: filtros.estado,
      texto: filtros.texto,
      limite: filtros.limite,
    });

    const lineas = movimientos.map((m) => describirMovimiento(m, zonaHoraria));
    const aviso =
      movimientos.length === filtros.limite
        ? `\n(Se alcanzó el límite de ${filtros.limite}; puede haber más movimientos.)`
        : "";
    return {
      texto: movimientos.length
        ? `${movimientos.length} movimiento(s):\n${lineas.join("\n")}${aviso}`
        : "No hay movimientos con esos filtros.",
      datos: { total: movimientos.length, limite: filtros.limite, movimientos },
    };
  },
});
