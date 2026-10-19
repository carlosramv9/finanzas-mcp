import { z } from "zod";
import { resumirPeriodo } from "@/db/movimientos";
import { normalizarRango, rangoResumen } from "@/validation/filtros";
import { formatearMonto } from "./comun";
import { definirHerramienta } from "./herramienta";

const totalCategoria = z.object({
  categoria: z.string(),
  total_cargos: z.number(),
  total_abonos: z.number(),
  num_movimientos: z.number(),
});

const resumenMoneda = z.object({
  moneda: z.string(),
  total_cargos: z.number(),
  total_abonos: z.number(),
  balance: z.number().describe("total_abonos - total_cargos"),
  num_movimientos: z.number(),
  categorias: z.array(totalCategoria).describe("Ordenadas de mayor a menor gasto"),
});

export const resumenPeriodo = definirHerramienta({
  nombre: "resumen_periodo",
  titulo: "Resumen del periodo",
  descripcion:
    "Resume un periodo (desde y hasta, inclusive): total de cargos, total de abonos, balance " +
    "(abonos − cargos) y desglose por categoría con total y número de movimientos, ordenado " +
    "de mayor a menor gasto. Si hay varias monedas, se resume cada una por separado. Solo " +
    "cuenta movimientos completados (no pendientes, cancelados ni rechazados). " +
    "Solo lectura.",
  entrada: rangoResumen,
  salida: z.object({
    desde: z.string(),
    hasta: z.string(),
    monedas: z.array(resumenMoneda),
  }),
  anotaciones: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ejecutar(rango, { db, zonaHoraria }) {
    const monedas = await resumirPeriodo(db, normalizarRango(rango, zonaHoraria));
    const periodo = `${rango.desde} a ${rango.hasta}`;
    if (monedas.length === 0) {
      return {
        texto: `Sin movimientos del ${periodo}.`,
        datos: { desde: rango.desde, hasta: rango.hasta, monedas },
      };
    }

    const bloques = monedas.map((r) => {
      const f = (n: number) => formatearMonto(n, r.moneda);
      const categorias = r.categorias
        .filter((c) => c.total_cargos > 0)
        .map((c) => `  - ${c.categoria}: ${f(c.total_cargos)} (${c.num_movimientos})`);
      return [
        `${r.moneda}: cargos ${f(r.total_cargos)}, abonos ${f(r.total_abonos)}, balance ${f(r.balance)}`,
        ...(categorias.length ? ["Gasto por categoría:", ...categorias] : []),
      ].join("\n");
    });
    return {
      texto: `Resumen del ${periodo}:\n${bloques.join("\n\n")}`,
      datos: { desde: rango.desde, hasta: rango.hasta, monedas },
    };
  },
});
