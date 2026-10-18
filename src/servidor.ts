import { createMcpHandler } from "mcp-handler";
import { obtenerDb } from "@/db/cliente";
import { registrarHerramientas, type Contexto } from "@/tools";
import { ZONA_HORARIA_POR_DEFECTO } from "@/validation/comunes";

const INSTRUCCIONES =
  "Servidor de finanzas personales del usuario. Registra cargos (gastos) y abonos (ingresos) " +
  "bancarios y permite consultarlos. Al leer notificaciones bancarias de Gmail usa origen " +
  "'correo' con el id del mensaje en id_correo (evita duplicados); para gastos dictados usa " +
  "origen 'manual'. Consulta listar_categorias si dudas de la categoría. Nunca envíes números " +
  "de tarjeta o cuenta completos: solo los últimos 4 dígitos.";

function zonaHorariaConfigurada(): string {
  const zona = process.env.ZONA_HORARIA?.trim() || ZONA_HORARIA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat("es-MX", { timeZone: zona });
    return zona;
  } catch {
    throw new Error(`ZONA_HORARIA inválida: '${zona}'`);
  }
}

export function contextoPorDefecto(): Contexto {
  return { db: obtenerDb(), zonaHoraria: zonaHorariaConfigurada(), ahora: () => new Date() };
}

/**
 * Handler MCP (Streamable HTTP, sin estado) con las herramientas registradas.
 * No sabe nada de autenticación: esa capa la compone la ruta.
 */
export function crearHandlerMcp(
  obtenerContexto: () => Contexto = contextoPorDefecto,
): (request: Request) => Promise<Response> {
  return createMcpHandler((server) => registrarHerramientas(server, obtenerContexto), {
    serverInfo: { name: "finanzas-mcp", version: "0.1.0" },
    instructions: INSTRUCCIONES,
    // Sin suscripciones: el servidor solo expone herramientas.
    maxSubscriptions: 0,
  });
}
