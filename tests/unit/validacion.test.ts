import { describe, expect, it } from "vitest";
import { resolverCategoria } from "@/db/categorias";
import { desfaseZona, fechaIso, monto } from "@/validation/comunes";
import { filtrosListado, normalizarRango, rangoResumen } from "@/validation/filtros";
import { cambiosMovimiento, cuenta, moneda, movimientoNuevo } from "@/validation/movimiento";
import { CATEGORIAS_SEMILLA } from "../helpers/db-falsa";

const mensajes = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message).join(" | ") ?? "";

const base = {
  tipo: "cargo",
  monto: 150.5,
  fecha: "2026-10-18T10:30:00-06:00",
  concepto: "OXXO",
  categoria: "Comida",
  origen: "manual",
};

describe("monto", () => {
  it.each([0.01, 1, 10.5, 0.07, 1234.56, 9_999_999_999.99])("acepta %s", (v) => {
    expect(monto.safeParse(v).success).toBe(true);
  });

  it("rechaza cero y negativos", () => {
    expect(mensajes(monto.safeParse(0))).toContain("mayor que 0");
    expect(monto.safeParse(-5).success).toBe(false);
  });

  it("rechaza más de 2 decimales", () => {
    expect(mensajes(monto.safeParse(1.234))).toContain("2 decimales");
    expect(monto.safeParse(0.001).success).toBe(false);
  });

  it("rechaza texto, NaN e infinito", () => {
    expect(monto.safeParse("100").success).toBe(false);
    expect(monto.safeParse(Number.NaN).success).toBe(false);
    expect(monto.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it("rechaza montos fuera de NUMERIC(12,2)", () => {
    expect(monto.safeParse(10_000_000_000).success).toBe(false);
  });
});

describe("fechaIso", () => {
  it.each(["2026-10-18T10:30:00-06:00", "2026-10-18T16:30:00Z", "2026-10-18T16:30:00.123Z", "2026-10-18"])(
    "acepta %s",
    (v) => expect(fechaIso.safeParse(v).success).toBe(true),
  );

  it("rechaza fecha-hora sin zona horaria", () => {
    expect(mensajes(fechaIso.safeParse("2026-10-18T10:30:00"))).toContain("ISO 8601");
  });

  it.each(["2026-02-30", "18/10/2026", "ayer", "2026-13-01"])("rechaza %s", (v) => {
    expect(fechaIso.safeParse(v).success).toBe(false);
  });

  it("rechaza fechas anteriores al 2000", () => {
    expect(mensajes(fechaIso.safeParse("1999-12-31"))).toContain("2000");
  });
});

describe("cuenta", () => {
  it("acepta exactamente 4 dígitos", () => {
    expect(cuenta.safeParse("1234").success).toBe(true);
  });

  it("rechaza números completos con mensaje explícito", () => {
    for (const v of ["12345", "4152313412341234", "4152 3134 1234 1234"]) {
      expect(mensajes(cuenta.safeParse(v))).toContain("Nunca envíes el número completo");
    }
  });

  it.each(["123", "abcd", "**1234", "12 34", ""])("rechaza %s", (v) => {
    expect(cuenta.safeParse(v).success).toBe(false);
  });
});

describe("moneda", () => {
  it("normaliza a mayúsculas", () => {
    expect(moneda.parse("usd")).toBe("USD");
  });

  it("rechaza códigos que no son ISO 4217", () => {
    expect(moneda.safeParse("ABC").success).toBe(false);
    expect(moneda.safeParse("PESOS").success).toBe(false);
  });
});

describe("movimientoNuevo", () => {
  it("acepta un movimiento manual y aplica MXN por defecto", () => {
    const r = movimientoNuevo.parse(base);
    expect(r.moneda).toBe("MXN");
  });

  it("exige id_correo cuando origen = correo", () => {
    const r = movimientoNuevo.safeParse({ ...base, origen: "correo" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["id_correo"]);
  });

  it("rechaza id_correo con origen manual", () => {
    expect(movimientoNuevo.safeParse({ ...base, id_correo: "x" }).success).toBe(false);
  });

  it("rechaza campos desconocidos", () => {
    expect(movimientoNuevo.safeParse({ ...base, numero_tarjeta: "4152..." }).success).toBe(false);
  });

  it("valida tipo, origen y longitud del concepto", () => {
    expect(movimientoNuevo.safeParse({ ...base, tipo: "gasto" }).success).toBe(false);
    expect(movimientoNuevo.safeParse({ ...base, origen: "api" }).success).toBe(false);
    expect(movimientoNuevo.safeParse({ ...base, concepto: "  " }).success).toBe(false);
    expect(movimientoNuevo.safeParse({ ...base, concepto: "x".repeat(201) }).success).toBe(false);
  });
});

describe("cambiosMovimiento", () => {
  it("exige al menos un campo", () => {
    expect(mensajes(cambiosMovimiento.safeParse({ id: 1 }))).toContain("al menos un campo");
  });

  it("no permite cambiar id_correo ni origen", () => {
    expect(cambiosMovimiento.safeParse({ id: 1, id_correo: "x" }).success).toBe(false);
    expect(cambiosMovimiento.safeParse({ id: 1, origen: "manual" }).success).toBe(false);
  });

  it("permite borrar notas con null", () => {
    expect(cambiosMovimiento.parse({ id: 1, notas: null }).notas).toBeNull();
  });
});

describe("filtros", () => {
  it("límite por defecto 50 y máximo 200", () => {
    expect(filtrosListado.parse({}).limite).toBe(50);
    expect(filtrosListado.safeParse({ limite: 201 }).success).toBe(false);
  });

  it("rechaza desde posterior a hasta", () => {
    expect(rangoResumen.safeParse({ desde: "2026-10-31", hasta: "2026-10-01" }).success).toBe(false);
  });

  it("normaliza fechas sin hora a la zona local con hasta exclusivo", () => {
    expect(normalizarRango({ desde: "2026-10-01", hasta: "2026-10-31" }, "America/Mexico_City")).toEqual({
      desde: "2026-10-01T00:00:00-06:00",
      hastaExclusivo: "2026-11-01T00:00:00-06:00",
    });
  });

  it("mantiene fecha-hora explícita como hasta inclusivo", () => {
    expect(normalizarRango({ hasta: "2026-10-31T23:00:00Z" }, "UTC")).toEqual({
      hastaInclusivo: "2026-10-31T23:00:00Z",
    });
  });
});

describe("desfaseZona", () => {
  it("calcula el desfase de la zona", () => {
    expect(desfaseZona("2026-10-18", "America/Mexico_City")).toBe("-06:00");
    expect(desfaseZona("2026-10-18", "UTC")).toBe("+00:00");
  });
});

describe("resolverCategoria", () => {
  it("ignora mayúsculas y acentos y devuelve el nombre canónico", () => {
    expect(resolverCategoria(CATEGORIAS_SEMILLA, "nomina")).toBe("Nómina");
    expect(resolverCategoria(CATEGORIAS_SEMILLA, " COMIDA ")).toBe("Comida");
    expect(resolverCategoria(CATEGORIAS_SEMILLA, "Viajes")).toBeUndefined();
  });
});
