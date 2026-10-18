import { describe, expect, it, vi } from "vitest";
import { conSecretoDeRuta, secretoValido } from "@/auth/secreto-ruta";

const SECRETO = "s3cr3t0-de-prueba-con-al-menos-32-caracteres";

describe("secretoValido", () => {
  it("acepta el secreto exacto", () => {
    expect(secretoValido(SECRETO, SECRETO)).toBe(true);
  });

  it("rechaza secretos incorrectos o de otra longitud", () => {
    expect(secretoValido(SECRETO.replace("s", "S"), SECRETO)).toBe(false);
    expect(secretoValido(SECRETO.slice(0, -1), SECRETO)).toBe(false);
    expect(secretoValido(`${SECRETO}x`, SECRETO)).toBe(false);
    expect(secretoValido("", SECRETO)).toBe(false);
    expect(secretoValido(undefined, SECRETO)).toBe(false);
  });

  it("rechaza todo si el secreto configurado es corto o no existe", () => {
    expect(secretoValido("corto", "corto")).toBe(false);
    expect(secretoValido("", undefined)).toBe(false);
  });
});

describe("conSecretoDeRuta", () => {
  const peticion = () => new Request("http://localhost/api/mcp/x", { method: "POST" });
  const contexto = (secreto: string) => ({ params: Promise.resolve({ secreto }) });

  it("delega al handler con el secreto correcto", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const r = await conSecretoDeRuta(handler, () => SECRETO)(peticion(), contexto(SECRETO));
    expect(r.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("responde 404 sin llamar al handler si no coincide", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const r = await conSecretoDeRuta(handler, () => SECRETO)(peticion(), contexto("otro"));
    expect(r.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("responde 404 y avisa sin revelar el valor si la configuración es inválida", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn(async () => new Response("ok"));
    const r = await conSecretoDeRuta(handler, () => "corto-123")(peticion(), contexto("corto-123"));
    expect(r.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).not.toContain("corto-123");
    error.mockRestore();
  });
});
