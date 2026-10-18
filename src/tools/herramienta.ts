import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { Db } from "@/db/cliente";
import { formatearErrores } from "@/validation/comunes";

/** Dependencias que reciben las herramientas (inyectables en pruebas). */
export interface Contexto {
  db: Db;
  /** Zona horaria para interpretar fechas sin hora. */
  zonaHoraria: string;
  ahora: () => Date;
}

export type Resultado<T> = { texto: string; datos: T } | { error: string };

export interface Herramienta<E extends z.ZodType = z.ZodType, S extends z.ZodType = z.ZodType> {
  nombre: string;
  titulo: string;
  descripcion: string;
  /** Valida los argumentos antes de `ejecutar`. */
  entrada: E;
  /** Esquema que se anuncia en `tools/list` si difiere de `entrada`. */
  anuncio?: z.ZodType;
  salida: S;
  anotaciones: ToolAnnotations;
  ejecutar(args: z.output<E>, ctx: Contexto): Promise<Resultado<z.input<S>>>;
}

/** Identidad con inferencia de tipos para declarar herramientas. */
export function definirHerramienta<E extends z.ZodType, S extends z.ZodType>(
  h: Herramienta<E, S>,
): Herramienta<E, S> {
  return h;
}

export function respuestaError(mensaje: string): CallToolResult {
  return { content: [{ type: "text", text: mensaje }], isError: true };
}

/**
 * Valida la entrada con zod (mensajes en español) y ejecuta la herramienta.
 * Nunca lanza: todo error se devuelve como resultado con `isError: true`.
 */
export async function ejecutarHerramienta(
  h: Herramienta,
  argumentos: unknown,
  ctx: Contexto,
): Promise<CallToolResult> {
  const entrada = h.entrada.safeParse(argumentos ?? {});
  if (!entrada.success) {
    return respuestaError(`Datos inválidos:\n${formatearErrores(entrada.error)}`);
  }
  try {
    const resultado = await h.ejecutar(entrada.data, ctx);
    if ("error" in resultado) return respuestaError(resultado.error);
    return {
      content: [{ type: "text", text: resultado.texto }],
      structuredContent: resultado.datos as Record<string, unknown>,
    };
  } catch (error) {
    // Solo el mensaje: los argumentos pueden contener datos personales.
    console.error(`[${h.nombre}] error interno:`, error instanceof Error ? error.message : error);
    return respuestaError(
      "Error interno del servidor al ejecutar la herramienta. Intenta de nuevo más tarde.",
    );
  }
}

/**
 * Esquema para el SDK: anuncia el JSON Schema de zod en `tools/list`, pero deja
 * pasar los argumentos sin validar. La validación real ocurre en
 * `ejecutarHerramienta`, con mensajes en español y, en el lote, por elemento
 * (el SDK rechazaría el lote completo ante un solo elemento inválido).
 */
export function esquemaAnunciado(esquema: z.ZodType): StandardSchemaWithJSON<unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "finanzas-mcp",
      validate: (valor: unknown) => ({ value: valor ?? {} }),
      jsonSchema: esquema["~standard"].jsonSchema,
    },
  };
}

export function registrarHerramienta(
  server: McpServer,
  h: Herramienta,
  obtenerContexto: () => Contexto,
): void {
  server.registerTool(
    h.nombre,
    {
      title: h.titulo,
      description: h.descripcion,
      inputSchema: esquemaAnunciado(h.anuncio ?? h.entrada),
      outputSchema: h.salida,
      annotations: { title: h.titulo, ...h.anotaciones },
    },
    (argumentos: unknown) => ejecutarHerramienta(h, argumentos, obtenerContexto()),
  );
}
