import type { McpServer } from "@modelcontextprotocol/server";
import { actualizarMovimiento } from "./actualizar-movimiento";
import { registrarHerramienta, type Contexto, type Herramienta } from "./herramienta";
import { listarCategorias } from "./listar-categorias";
import { listarMovimientos } from "./listar-movimientos";
import { registrarMovimiento } from "./registrar-movimiento";
import { registrarMovimientosLote } from "./registrar-movimientos-lote";
import { resumenPeriodo } from "./resumen-periodo";

export const herramientas: Herramienta[] = [
  registrarMovimiento,
  registrarMovimientosLote,
  listarMovimientos,
  resumenPeriodo,
  actualizarMovimiento,
  listarCategorias,
] as Herramienta[];

export function registrarHerramientas(server: McpServer, obtenerContexto: () => Contexto): void {
  for (const h of herramientas) registrarHerramienta(server, h, obtenerContexto);
}

export type { Contexto } from "./herramienta";
