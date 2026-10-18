import { describe, expect, it } from "vitest";
import { conSecretoDeRuta } from "@/auth/secreto-ruta";
import { crearHandlerMcp } from "@/servidor";
import { AHORA, crearDbFalsa } from "../helpers/db-falsa";

const SECRETO = "s3cr3t0-de-prueba-con-al-menos-32-caracteres";
const VERSION = "2025-06-18";

function crearRuta() {
  const { db } = crearDbFalsa();
  const handler = crearHandlerMcp(() => ({ db, zonaHoraria: "America/Mexico_City", ahora: () => AHORA }));
  return conSecretoDeRuta(handler, () => SECRETO);
}

/** Envía una petición JSON-RPC y extrae el resultado (JSON o SSE). */
async function rpc(
  ruta: ReturnType<typeof crearRuta>,
  method: string,
  params: unknown,
  secreto = SECRETO,
) {
  const respuesta = await ruta(
    new Request(`http://localhost/api/mcp/${secreto}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": VERSION,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    { params: Promise.resolve({ secreto }) },
  );
  const cuerpo = await respuesta.text();
  const json = cuerpo.startsWith("{")
    ? cuerpo
    : cuerpo.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
  return { status: respuesta.status, mensaje: json ? JSON.parse(json) : undefined };
}

describe("endpoint MCP", () => {
  it("inicializa por Streamable HTTP", async () => {
    const { status, mensaje } = await rpc(crearRuta(), "initialize", {
      protocolVersion: VERSION,
      capabilities: {},
      clientInfo: { name: "prueba", version: "1" },
    });
    expect(status).toBe(200);
    expect(mensaje.result.serverInfo.name).toBe("finanzas-mcp");
    expect(mensaje.result.capabilities.tools).toBeDefined();
  });

  it("lista las 6 herramientas con esquemas y anotaciones", async () => {
    const { mensaje } = await rpc(crearRuta(), "tools/list", {});
    const tools = mensaje.result.tools as any[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "actualizar_movimiento",
      "listar_categorias",
      "listar_movimientos",
      "registrar_movimiento",
      "registrar_movimientos_lote",
      "resumen_periodo",
    ]);
    const registrar = tools.find((t) => t.name === "registrar_movimiento");
    expect(registrar.inputSchema.properties.cuenta.description).toContain("4 dígitos");
    expect(registrar.inputSchema.required).toEqual(
      expect.arrayContaining(["tipo", "monto", "fecha", "concepto", "categoria", "origen"]),
    );
    expect(registrar.outputSchema.properties.movimiento).toBeDefined();
    expect(registrar.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const lote = tools.find((t) => t.name === "registrar_movimientos_lote");
    expect(lote.inputSchema.properties.movimientos.items.properties.monto.type).toBe("number");
  });

  it("ejecuta una herramienta con structuredContent", async () => {
    const { mensaje } = await rpc(crearRuta(), "tools/call", {
      name: "registrar_movimiento",
      arguments: {
        tipo: "cargo",
        monto: 89.9,
        fecha: "2026-10-18",
        concepto: "Spotify",
        categoria: "Suscripciones",
        origen: "manual",
      },
    });
    expect(mensaje.result.isError).toBeFalsy();
    expect(mensaje.result.structuredContent).toMatchObject({ insertado: true });
  });

  it("devuelve errores de validación como isError en español", async () => {
    const { mensaje } = await rpc(crearRuta(), "tools/call", {
      name: "registrar_movimiento",
      arguments: { tipo: "gasto" },
    });
    expect(mensaje.result.isError).toBe(true);
    expect(mensaje.result.content[0].text).toContain("El tipo debe ser 'cargo' o 'abono'");
  });

  it("responde 404 con un secreto incorrecto", async () => {
    const { status } = await rpc(crearRuta(), "tools/list", {}, "x".repeat(44));
    expect(status).toBe(404);
  });
});
