import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  calcularPendientes,
  leerMigraciones,
  ordenarMigraciones,
} from "@/db/migraciones";

describe("ordenarMigraciones", () => {
  it("ordena y descarta archivos que no son migraciones", () => {
    expect(
      ordenarMigraciones(["010_b.sql", "README.md", "001_init.sql", "002_x.txt", "abc.sql"]),
    ).toEqual(["001_init.sql", "010_b.sql"]);
  });
});

describe("calcularPendientes", () => {
  it("devuelve solo las no aplicadas, en orden", () => {
    expect(
      calcularPendientes(["001_a.sql", "002_b.sql", "003_c.sql"], ["002_b.sql"]),
    ).toEqual(["001_a.sql", "003_c.sql"]);
  });

  it("devuelve vacío si todo está aplicado", () => {
    expect(calcularPendientes(["001_a.sql"], ["001_a.sql"])).toEqual([]);
  });
});

describe("leerMigraciones", () => {
  it("lee 001_init.sql del repositorio", async () => {
    const dir = fileURLToPath(new URL("../../db/migrations", import.meta.url));
    const migraciones = await leerMigraciones(dir);
    expect(migraciones[0]?.nombre).toBe("001_init.sql");
    expect(migraciones[0]?.sql).toContain("CREATE TABLE movimientos");
  });
});
