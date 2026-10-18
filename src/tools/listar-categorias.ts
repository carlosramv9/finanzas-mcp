import { z } from "zod";
import { listarCategorias as consultarCategorias } from "@/db/categorias";
import { definirHerramienta } from "./herramienta";

export const listarCategorias = definirHerramienta({
  nombre: "listar_categorias",
  titulo: "Listar categorías",
  descripcion:
    "Devuelve las categorías válidas para clasificar movimientos e indica cuáles son de " +
    "ingreso (es_ingreso = true, p. ej. 'Nómina'). Consúltala antes de registrar si no " +
    "estás seguro del nombre exacto. Solo lectura.",
  entrada: z.object({}).strict(),
  salida: z.object({
    categorias: z.array(z.object({ nombre: z.string(), es_ingreso: z.boolean() })),
  }),
  anotaciones: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ejecutar(_entrada, { db }) {
    const categorias = await consultarCategorias(db);
    const gasto = categorias.filter((c) => !c.es_ingreso).map((c) => c.nombre);
    const ingreso = categorias.filter((c) => c.es_ingreso).map((c) => c.nombre);
    return {
      texto: `Categorías de gasto: ${gasto.join(", ")}.\nCategorías de ingreso: ${ingreso.join(", ")}.`,
      datos: { categorias },
    };
  },
});
