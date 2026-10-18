import { describe, expect, it } from "vitest";
import type { Db } from "@/db/cliente";
import { actualizarMovimiento } from "@/tools/actualizar-movimiento";
import { ejecutarHerramienta, esquemaAnunciado, type Contexto, type Herramienta } from "@/tools/herramienta";
import { herramientas } from "@/tools/index";
import { listarCategorias } from "@/tools/listar-categorias";
import { listarMovimientos } from "@/tools/listar-movimientos";
import { registrarMovimiento } from "@/tools/registrar-movimiento";
import { registrarMovimientosLote } from "@/tools/registrar-movimientos-lote";
import { resumenPeriodo } from "@/tools/resumen-periodo";
import { AHORA, crearDbFalsa, filaMovimiento } from "../helpers/db-falsa";

const contexto = (db: Db): Contexto => ({
  db,
  zonaHoraria: "America/Mexico_City",
  ahora: () => AHORA,
});

const ejecutar = (h: Herramienta<any, any>, args: unknown, db: Db) =>
  ejecutarHerramienta(h as Herramienta, args, contexto(db));

const texto = (r: { content: unknown }) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

const desdeCorreo = {
  tipo: "cargo",
  monto: 150.5,
  fecha: "2026-10-18T10:30:00-06:00",
  concepto: "OXXO Insurgentes",
  categoria: "comida",
  cuenta: "1234",
  origen: "correo",
  id_correo: "msg-1",
};

describe("registrar_movimiento", () => {
  it("inserta con ON CONFLICT, normaliza categoría y monto", async () => {
    const { db, consultas } = crearDbFalsa();
    const r = await ejecutar(registrarMovimiento, desdeCorreo, db);

    expect(r.isError).toBeUndefined();
    const insercion = consultas.find((c) => c.texto.includes("INSERT"))!;
    expect(insercion.texto).toContain("ON CONFLICT (id_correo) DO NOTHING");
    expect(insercion.valores).toEqual([
      "cargo", "150.50", "MXN", "2026-10-18T10:30:00-06:00", "OXXO Insurgentes",
      "Comida", "1234", "correo", "msg-1", null,
    ]);
    expect(r.structuredContent).toMatchObject({ insertado: true, movimiento: { id: 1, monto: 150.5 } });
    expect(texto(r)).toContain("Movimiento registrado");
  });

  it("es idempotente por id_correo", async () => {
    const { db, idsCorreoExistentes } = crearDbFalsa();
    idsCorreoExistentes.add("msg-1");
    const r = await ejecutar(registrarMovimiento, desdeCorreo, db);
    expect(r.structuredContent).toMatchObject({ insertado: false });
    expect(texto(r)).toContain("Ya existía");
  });

  it("fecha sin hora se guarda a mediodía local", async () => {
    const { db, consultas } = crearDbFalsa();
    await ejecutar(registrarMovimiento, { ...desdeCorreo, fecha: "2026-10-17" }, db);
    expect(consultas.find((c) => c.texto.includes("INSERT"))!.valores![3]).toBe(
      "2026-10-17T12:00:00-06:00",
    );
  });

  it("devuelve isError en español ante datos inválidos, sin tocar la BD", async () => {
    const { db, consultas } = crearDbFalsa();
    const r = await ejecutar(registrarMovimiento, { ...desdeCorreo, cuenta: "4152313412341234", monto: -1 }, db);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Datos inválidos");
    expect(texto(r)).toContain("cuenta: La cuenta solo puede contener los últimos 4 dígitos");
    expect(texto(r)).toContain("monto: El monto debe ser mayor que 0");
    expect(consultas).toHaveLength(0);
  });

  it("rechaza categoría inexistente listando las válidas", async () => {
    const { db } = crearDbFalsa();
    const r = await ejecutar(registrarMovimiento, { ...desdeCorreo, categoria: "Viajes" }, db);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("La categoría 'Viajes' no existe");
    expect(texto(r)).toContain("Supermercado");
  });

  it("rechaza fechas en el futuro", async () => {
    const { db } = crearDbFalsa();
    const r = await ejecutar(registrarMovimiento, { ...desdeCorreo, fecha: "2026-12-01" }, db);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("futuro");
  });

  it("convierte errores de BD en isError genérico sin lanzar", async () => {
    const db: Db = {
      consultar: async () => {
        throw new Error("conexión rechazada");
      },
      transaccion: async () => [],
    };
    const r = await ejecutar(registrarMovimiento, desdeCorreo, db);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Error interno");
    expect(texto(r)).not.toContain("conexión rechazada");
  });
});

describe("registrar_movimientos_lote", () => {
  it("inserta los válidos en una transacción y reporta errores por índice", async () => {
    const { db, transacciones, idsCorreoExistentes } = crearDbFalsa();
    idsCorreoExistentes.add("msg-dup");
    const r = await ejecutar(
      registrarMovimientosLote,
      {
        movimientos: [
          desdeCorreo,
          { ...desdeCorreo, id_correo: "msg-2", monto: 1.234 },
          { ...desdeCorreo, id_correo: "msg-dup" },
          { ...desdeCorreo, id_correo: "msg-3", categoria: "Viajes" },
          { ...desdeCorreo, id_correo: "msg-4" },
        ],
      },
      db,
    );

    expect(r.isError).toBeUndefined();
    expect(transacciones).toHaveLength(1);
    expect(transacciones[0]).toHaveLength(3);
    expect(r.structuredContent).toMatchObject({
      insertados: 2,
      existentes: 1,
      con_error: 2,
      resultados: [
        { indice: 0, estado: "insertado" },
        { indice: 1, estado: "error" },
        { indice: 2, estado: "existente", id: 999 },
        { indice: 3, estado: "error" },
        { indice: 4, estado: "insertado" },
      ],
    });
    expect(texto(r)).toContain("[1] monto: El monto admite como máximo 2 decimales");
    expect(texto(r)).toContain("[3] categoria: La categoría 'Viajes' no existe");
  });

  it("rechaza lotes vacíos o de más de 50", async () => {
    const { db } = crearDbFalsa();
    expect((await ejecutar(registrarMovimientosLote, { movimientos: [] }, db)).isError).toBe(true);
    const grande = Array.from({ length: 51 }, (_, i) => ({ ...desdeCorreo, id_correo: `m${i}` }));
    const r = await ejecutar(registrarMovimientosLote, { movimientos: grande }, db);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Máximo 50");
  });

  it("anuncia la forma completa de cada elemento en el JSON Schema", () => {
    const h = registrarMovimientosLote as Herramienta;
    const esquema = esquemaAnunciado(h.anuncio!)["~standard"].jsonSchema.input({
      target: "draft-2020-12",
    }) as any;
    expect(esquema.properties.movimientos.items.properties.monto.type).toBe("number");
    expect(esquema.properties.movimientos.maxItems).toBe(50);
  });
});

describe("listar_movimientos", () => {
  it("aplica filtros parametrizados, escapa comodines y ordena por fecha", async () => {
    const { db, consultas } = crearDbFalsa((c) =>
      c.texto.includes("FROM movimientos") ? [filaMovimiento()] : undefined,
    );
    const r = await ejecutar(
      listarMovimientos,
      { desde: "2026-10-01", hasta: "2026-10-31", tipo: "cargo", categoria: "comida", texto: "50%_off", limite: 10 },
      db,
    );

    const consulta = consultas.find((c) => c.texto.includes("FROM movimientos"))!;
    expect(consulta.texto).toContain("ORDER BY fecha DESC");
    expect(consulta.texto).toContain("concepto ILIKE $5");
    expect(consulta.valores).toEqual([
      "2026-10-01T00:00:00-06:00", "2026-11-01T00:00:00-06:00", "cargo", "Comida", "%50\\%\\_off%", 10,
    ]);
    expect(r.structuredContent).toMatchObject({ total: 1, limite: 10 });
    expect(texto(r)).toContain("#1 2026-10-18 cargo");
  });

  it("usa límite 50 por defecto", async () => {
    const { db, consultas } = crearDbFalsa();
    await ejecutar(listarMovimientos, {}, db);
    expect(consultas[0]!.valores).toEqual([50]);
  });
});

describe("resumen_periodo", () => {
  it("agrupa por moneda, calcula balance y ordena por gasto", async () => {
    const { db } = crearDbFalsa((c) =>
      c.texto.includes("GROUP BY")
        ? [
            { moneda: "MXN", categoria: "Comida", total_cargos: "300.00", total_abonos: "0", num_movimientos: "3" },
            { moneda: "MXN", categoria: "Hogar", total_cargos: "1200.10", total_abonos: "0", num_movimientos: "1" },
            { moneda: "MXN", categoria: "Nómina", total_cargos: "0", total_abonos: "20000.00", num_movimientos: "1" },
          ]
        : undefined,
    );
    const r = await ejecutar(resumenPeriodo, { desde: "2026-10-01", hasta: "2026-10-31" }, db);
    const datos = r.structuredContent as any;
    expect(datos.monedas[0]).toMatchObject({
      moneda: "MXN",
      total_cargos: 1500.1,
      total_abonos: 20000,
      balance: 18499.9,
      num_movimientos: 5,
    });
    expect(datos.monedas[0].categorias.map((c: any) => c.categoria)).toEqual(["Hogar", "Comida", "Nómina"]);
  });

  it("exige desde y hasta", async () => {
    const { db } = crearDbFalsa();
    expect((await ejecutar(resumenPeriodo, { desde: "2026-10-01" }, db)).isError).toBe(true);
  });
});

describe("actualizar_movimiento", () => {
  it("actualiza solo los campos enviados y actualizado_en", async () => {
    const { db, consultas } = crearDbFalsa((c) =>
      c.texto.includes("UPDATE") ? [filaMovimiento({ categoria: "Hogar" })] : undefined,
    );
    const r = await ejecutar(actualizarMovimiento, { id: 7, categoria: "hogar", monto: 99.9 }, db);
    const update = consultas.find((c) => c.texto.includes("UPDATE"))!;
    expect(update.texto).toContain("categoria = $1, monto = $2, actualizado_en = now()");
    expect(update.texto).not.toContain("id_correo =");
    expect(update.valores).toEqual(["Hogar", "99.90", 7]);
    expect(r.isError).toBeUndefined();
  });

  it("isError si el id no existe", async () => {
    const { db } = crearDbFalsa();
    const r = await ejecutar(actualizarMovimiento, { id: 404, concepto: "x" }, db);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("No existe ningún movimiento con id 404");
  });

  it("rechaza cambiar id_correo u origen", async () => {
    const { db, consultas } = crearDbFalsa();
    const r = await ejecutar(actualizarMovimiento, { id: 1, id_correo: "otro" }, db);
    expect(r.isError).toBe(true);
    expect(consultas).toHaveLength(0);
  });
});

describe("listar_categorias", () => {
  it("devuelve categorías separando las de ingreso", async () => {
    const { db } = crearDbFalsa();
    const r = await ejecutar(listarCategorias, {}, db);
    expect(texto(r)).toContain("Categorías de ingreso: Nómina.");
    expect((r.structuredContent as any).categorias).toHaveLength(16);
  });
});

describe("catálogo de herramientas", () => {
  it("expone las 6 herramientas con anotaciones coherentes", () => {
    expect(herramientas.map((h) => h.nombre)).toEqual([
      "registrar_movimiento",
      "registrar_movimientos_lote",
      "listar_movimientos",
      "resumen_periodo",
      "actualizar_movimiento",
      "listar_categorias",
    ]);
    for (const h of herramientas) {
      const soloLectura = ["listar_movimientos", "resumen_periodo", "listar_categorias"].includes(h.nombre);
      expect(h.anotaciones.readOnlyHint).toBe(soloLectura);
      expect(typeof h.anotaciones.destructiveHint).toBe("boolean");
      expect(typeof h.anotaciones.idempotentHint).toBe("boolean");
    }
  });
});
