import type { Consulta, Db, Fila } from "@/db/cliente";

export const CATEGORIAS_SEMILLA = [
  "Comida", "Supermercado", "Transporte", "Gasolina", "Servicios", "Suscripciones",
  "Salud", "Entretenimiento", "Compras", "Hogar", "Educación", "Retiro de efectivo",
  "Comisiones", "Transferencia", "Otros",
].map((nombre) => ({ nombre, es_ingreso: false })).concat([{ nombre: "Nómina", es_ingreso: true }]);

export const AHORA = new Date("2026-10-18T18:00:00Z");

export function filaMovimiento(cambios: Partial<Fila> = {}): Fila {
  return {
    id: "1",
    tipo: "cargo",
    monto: "150.50",
    moneda: "MXN",
    fecha: new Date("2026-10-18T16:30:00Z"),
    concepto: "OXXO",
    categoria: "Comida",
    cuenta: "1234",
    origen: "correo",
    id_correo: "msg-1",
    notas: null,
    creado_en: new Date("2026-10-18T17:00:00Z"),
    actualizado_en: new Date("2026-10-18T17:00:00Z"),
    ...cambios,
  };
}

/**
 * Db en memoria que registra las consultas. Por defecto responde las
 * categorías semilla y simula INSERTs; `responder` permite sobrescribir.
 */
export function crearDbFalsa(responder?: (c: Consulta) => Fila[] | undefined) {
  const consultas: Consulta[] = [];
  const transacciones: Consulta[][] = [];
  const idsCorreoExistentes = new Set<string>();
  let siguienteId = 1;

  const responderPorDefecto = (c: Consulta): Fila[] => {
    if (c.texto.includes("FROM categorias")) return CATEGORIAS_SEMILLA;
    if (c.texto.includes("INSERT INTO movimientos")) {
      const v = c.valores ?? [];
      const idCorreo = v[8] as string | null;
      if (idCorreo && idsCorreoExistentes.has(idCorreo)) {
        return [{ ...filaMovimiento({ id: "999", id_correo: idCorreo }), insertado: false }];
      }
      if (idCorreo) idsCorreoExistentes.add(idCorreo);
      return [
        {
          ...filaMovimiento({
            id: String(siguienteId++),
            tipo: v[0], monto: v[1], moneda: v[2], fecha: v[3], concepto: v[4],
            categoria: v[5], cuenta: v[6], origen: v[7], id_correo: v[8], notas: v[9],
          }),
          insertado: true,
        },
      ];
    }
    return [];
  };

  const resolver = (c: Consulta) => responder?.(c) ?? responderPorDefecto(c);

  const db: Db = {
    async consultar<T extends Fila = Fila>(c: Consulta) {
      consultas.push(c);
      return resolver(c) as T[];
    },
    async transaccion(cs) {
      transacciones.push(cs);
      consultas.push(...cs);
      return cs.map(resolver);
    },
  };

  return { db, consultas, transacciones, idsCorreoExistentes };
}
