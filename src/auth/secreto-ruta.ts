import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Autenticación de fase 1: secreto en la ruta `/api/mcp/[secreto]`.
 *
 * Es una capa independiente del servidor MCP: envuelve un handler web
 * estándar. En fase 2 se reemplaza por `withMcpAuth` (OAuth) sin tocar las
 * herramientas.
 */

export const LONGITUD_MINIMA_SECRETO = 32;

export type Manejador = (request: Request) => Promise<Response>;
export type ManejadorConSecreto = (
  request: Request,
  contexto: { params: Promise<{ secreto: string }> },
) => Promise<Response>;

const resumen = (valor: string) => createHash("sha256").update(valor, "utf8").digest();

/**
 * Compara en tiempo constante. Se comparan los SHA-256 para que ambos buffers
 * midan lo mismo y no se filtre la longitud del secreto.
 */
export function secretoValido(recibido: string | undefined, esperado: string | undefined): boolean {
  if (!esperado || esperado.length < LONGITUD_MINIMA_SECRETO) return false;
  return timingSafeEqual(resumen(recibido ?? ""), resumen(esperado));
}

const noEncontrado = () => new Response("Not Found", { status: 404 });

let avisoConfiguracion = false;

export function conSecretoDeRuta(
  handler: Manejador,
  obtenerSecreto: () => string | undefined = () => process.env.MCP_PATH_SECRET,
): ManejadorConSecreto {
  return async (request, { params }) => {
    const esperado = obtenerSecreto();
    if (!esperado || esperado.length < LONGITUD_MINIMA_SECRETO) {
      if (!avisoConfiguracion) {
        avisoConfiguracion = true;
        // Nunca se registra el valor, solo que la configuración es inválida.
        console.error(
          `MCP_PATH_SECRET no está definido o tiene menos de ${LONGITUD_MINIMA_SECRETO} caracteres; ` +
            "todas las peticiones responderán 404.",
        );
      }
      return noEncontrado();
    }
    const { secreto } = await params;
    if (!secretoValido(secreto, esperado)) return noEncontrado();
    return handler(request);
  };
}
