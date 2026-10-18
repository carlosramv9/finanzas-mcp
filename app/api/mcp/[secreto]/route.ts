import { conSecretoDeRuta } from "@/auth/secreto-ruta";
import { crearHandlerMcp } from "@/servidor";

// node:crypto y el driver de Neon requieren el runtime de Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Autenticación (fase 1: secreto en la ruta) como capa sobre el handler MCP.
const manejador = conSecretoDeRuta(crearHandlerMcp());

export { manejador as DELETE, manejador as GET, manejador as POST };
