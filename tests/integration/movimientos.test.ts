/**
 * Pruebas contra una rama de DESARROLLO de Neon (DATABASE_URL_TEST).
 * ¡Vacían la tabla movimientos! Nunca apuntar a la rama principal.
 */
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearDb, type Db } from "@/db/cliente";
import { aplicarMigraciones } from "@/db/migraciones";
import { actualizarMovimiento } from "@/tools/actualizar-movimiento";
import { ejecutarHerramienta, type Contexto, type Herramienta } from "@/tools/herramienta";
import { listarMovimientos } from "@/tools/listar-movimientos";
import { registrarMovimiento } from "@/tools/registrar-movimiento";
import { registrarMovimientosLote } from "@/tools/registrar-movimientos-lote";
import { resumenPeriodo } from "@/tools/resumen-periodo";

const url = process.env.DATABASE_URL_TEST;

if (url && url === process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL_TEST no puede ser igual a DATABASE_URL: usa una rama de desarrollo.");
}

describe.skipIf(!url)("integración con Neon", () => {
  let db: Db;
  let ctx: Contexto;
  const ejecutar = (h: Herramienta<any, any>, args: unknown) =>
    ejecutarHerramienta(h as Herramienta, args, ctx);

  const base = {
    tipo: "cargo",
    monto: 150.5,
    fecha: "2026-10-05T10:30:00-06:00",
    concepto: "OXXO Insurgentes",
    categoria: "Comida",
    cuenta: "1234",
    origen: "correo",
  };

  beforeAll(async () => {
    await aplicarMigraciones(url!, fileURLToPath(new URL("../../db/migrations", import.meta.url)));
    db = crearDb(url!);
    ctx = { db, zonaHoraria: "America/Mexico_City", ahora: () => new Date() };
  });

  beforeEach(async () => {
    await db.consultar({ texto: "TRUNCATE movimientos RESTART IDENTITY" });
  });

  it("inserta un movimiento y lo devuelve con id", async () => {
    const r = await ejecutar(registrarMovimiento, { ...base, id_correo: "int-1" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({
      insertado: true,
      movimiento: { id: 1, monto: 150.5, moneda: "MXN", cuenta: "1234", fecha: "2026-10-05T16:30:00.000Z" },
    });
  });

  it("no duplica por id_correo", async () => {
    const primero = await ejecutar(registrarMovimiento, { ...base, id_correo: "int-dup" });
    const segundo = await ejecutar(registrarMovimiento, { ...base, id_correo: "int-dup", monto: 999 });
    expect(segundo.structuredContent).toMatchObject({
      insertado: false,
      movimiento: { id: (primero.structuredContent as any).movimiento.id, monto: 150.5 },
    });
    const { total } = (await ejecutar(listarMovimientos, {})).structuredContent as any;
    expect(total).toBe(1);
  });

  it("lote mixto: inserta válidos, cuenta existentes y reporta errores", async () => {
    await ejecutar(registrarMovimiento, { ...base, id_correo: "lote-existente" });
    const r = await ejecutar(registrarMovimientosLote, {
      movimientos: [
        { ...base, id_correo: "lote-1" },
        { ...base, id_correo: "lote-existente" },
        { ...base, id_correo: "lote-2", cuenta: "4152313412341234" },
        { ...base, origen: "manual", tipo: "abono", categoria: "Nómina", monto: 20000 },
        { ...base, id_correo: "lote-1" }, // repetido dentro del mismo lote
      ],
    });
    expect(r.structuredContent).toMatchObject({ insertados: 2, existentes: 2, con_error: 1 });
    const { total } = (await ejecutar(listarMovimientos, {})).structuredContent as any;
    expect(total).toBe(3);
  });

  it("resumen del periodo con totales, balance y desglose", async () => {
    await ejecutar(registrarMovimientosLote, {
      movimientos: [
        { ...base, id_correo: "r1", monto: 100 },
        { ...base, id_correo: "r2", monto: 50.25 },
        { ...base, id_correo: "r3", monto: 1200, categoria: "Hogar" },
        { ...base, id_correo: "r4", monto: 20000, tipo: "abono", categoria: "Nómina" },
        // Fuera del periodo (1 de noviembre hora local).
        { ...base, id_correo: "r5", monto: 7, fecha: "2026-11-01T00:30:00-06:00" },
      ],
    });
    const r = await ejecutar(resumenPeriodo, { desde: "2026-10-01", hasta: "2026-10-31" });
    const [mxn] = (r.structuredContent as any).monedas;
    expect(mxn).toMatchObject({
      moneda: "MXN",
      total_cargos: 1350.25,
      total_abonos: 20000,
      balance: 18649.75,
      num_movimientos: 4,
    });
    expect(mxn.categorias[0]).toMatchObject({ categoria: "Hogar", total_cargos: 1200, num_movimientos: 1 });
    expect(mxn.categorias[1]).toMatchObject({ categoria: "Comida", total_cargos: 150.25, num_movimientos: 2 });
  });

  it("actualiza campos permitidos y actualizado_en", async () => {
    const creado = await ejecutar(registrarMovimiento, { ...base, id_correo: "upd-1" });
    const { id, actualizado_en } = (creado.structuredContent as any).movimiento;
    const r = await ejecutar(actualizarMovimiento, { id, categoria: "supermercado", notas: "despensa" });
    expect(r.structuredContent).toMatchObject({
      movimiento: { id, categoria: "Supermercado", notas: "despensa", id_correo: "upd-1" },
    });
    expect(Date.parse((r.structuredContent as any).movimiento.actualizado_en)).toBeGreaterThan(
      Date.parse(actualizado_en),
    );
  });

  it("filtra por texto con ILIKE", async () => {
    await ejecutar(registrarMovimientosLote, {
      movimientos: [
        { ...base, id_correo: "t1", concepto: "Uber viaje" },
        { ...base, id_correo: "t2", concepto: "UBER EATS" },
        { ...base, id_correo: "t3", concepto: "Netflix" },
      ],
    });
    const r = await ejecutar(listarMovimientos, { texto: "uber" });
    expect((r.structuredContent as any).total).toBe(2);
  });
});
