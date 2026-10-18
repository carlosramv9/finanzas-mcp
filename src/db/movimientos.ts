import type { Consulta, Db, Fila } from "./cliente";

export interface Movimiento {
  id: number;
  tipo: "cargo" | "abono";
  monto: number;
  moneda: string;
  fecha: string;
  concepto: string;
  categoria: string;
  cuenta: string | null;
  origen: "correo" | "manual";
  id_correo: string | null;
  notas: string | null;
  creado_en: string;
  actualizado_en: string;
}

/** Datos ya validados y normalizados para insertar (fecha como instante ISO). */
export interface DatosMovimiento {
  tipo: "cargo" | "abono";
  monto: number;
  moneda: string;
  fecha: string;
  concepto: string;
  categoria: string;
  cuenta?: string;
  origen: "correo" | "manual";
  id_correo?: string;
  notas?: string;
}

export interface ResultadoInsercion {
  movimiento: Movimiento;
  /** `false` si ya existía un movimiento con el mismo `id_correo`. */
  insertado: boolean;
}

const COLUMNAS =
  "id, tipo, monto, moneda, fecha, concepto, categoria, cuenta, origen, id_correo, notas, creado_en, actualizado_en";

const aIso = (valor: unknown) =>
  (valor instanceof Date ? valor : new Date(String(valor))).toISOString();

export function aMovimiento(fila: Fila): Movimiento {
  return {
    id: Number(fila.id),
    tipo: fila.tipo as Movimiento["tipo"],
    monto: Number(fila.monto),
    moneda: String(fila.moneda).trim(),
    fecha: aIso(fila.fecha),
    concepto: String(fila.concepto),
    categoria: String(fila.categoria),
    cuenta: (fila.cuenta as string | null) ?? null,
    origen: fila.origen as Movimiento["origen"],
    id_correo: (fila.id_correo as string | null) ?? null,
    notas: (fila.notas as string | null) ?? null,
    creado_en: aIso(fila.creado_en),
    actualizado_en: aIso(fila.actualizado_en),
  };
}

/**
 * Inserta o, si el `id_correo` ya existe, devuelve el existente. Una sola
 * sentencia: la rama `UNION ALL` solo aporta fila cuando el INSERT no insertó.
 */
export function consultaInsercion(m: DatosMovimiento): Consulta {
  return {
    texto: `
      WITH nuevo AS (
        INSERT INTO movimientos
          (tipo, monto, moneda, fecha, concepto, categoria, cuenta, origen, id_correo, notas)
        VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id_correo) DO NOTHING
        RETURNING ${COLUMNAS}
      )
      SELECT ${COLUMNAS}, true AS insertado FROM nuevo
      UNION ALL
      SELECT ${COLUMNAS}, false AS insertado FROM movimientos
      WHERE $9::text IS NOT NULL AND id_correo = $9 AND NOT EXISTS (SELECT 1 FROM nuevo)`,
    valores: [
      m.tipo,
      m.monto.toFixed(2),
      m.moneda,
      m.fecha,
      m.concepto,
      m.categoria,
      m.cuenta ?? null,
      m.origen,
      m.id_correo ?? null,
      m.notas ?? null,
    ],
  };
}

function aResultadoInsercion(filas: Fila[]): ResultadoInsercion {
  const fila = filas[0];
  if (!fila) throw new Error("La inserción no devolvió ninguna fila");
  return { movimiento: aMovimiento(fila), insertado: Boolean(fila.insertado) };
}

export async function insertarMovimiento(
  db: Db,
  m: DatosMovimiento,
): Promise<ResultadoInsercion> {
  return aResultadoInsercion(await db.consultar(consultaInsercion(m)));
}

/** Inserta todos en una sola transacción; resultado en el mismo orden. */
export async function insertarMovimientos(
  db: Db,
  movimientos: DatosMovimiento[],
): Promise<ResultadoInsercion[]> {
  const resultados = await db.transaccion(movimientos.map(consultaInsercion));
  return resultados.map(aResultadoInsercion);
}

export interface FiltrosConsulta {
  desde?: string;
  hastaExclusivo?: string;
  hastaInclusivo?: string;
  tipo?: "cargo" | "abono";
  categoria?: string;
  texto?: string;
  limite: number;
}

/** Escapa los comodines de LIKE para buscar el texto literal. */
export const escaparLike = (texto: string) => texto.replace(/[\\%_]/g, "\\$&");

/** Construye un WHERE parametrizado; solo los nombres de columna son fijos. */
function construirWhere(f: Omit<FiltrosConsulta, "limite">, valores: unknown[]): string {
  const param = (v: unknown) => {
    valores.push(v);
    return `$${valores.length}`;
  };
  const condiciones: string[] = [];
  if (f.desde) condiciones.push(`fecha >= ${param(f.desde)}::timestamptz`);
  if (f.hastaExclusivo) condiciones.push(`fecha < ${param(f.hastaExclusivo)}::timestamptz`);
  if (f.hastaInclusivo) condiciones.push(`fecha <= ${param(f.hastaInclusivo)}::timestamptz`);
  if (f.tipo) condiciones.push(`tipo = ${param(f.tipo)}`);
  if (f.categoria) condiciones.push(`categoria = ${param(f.categoria)}`);
  if (f.texto) condiciones.push(`concepto ILIKE ${param(`%${escaparLike(f.texto)}%`)}`);
  return condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
}

export async function listarMovimientos(db: Db, f: FiltrosConsulta): Promise<Movimiento[]> {
  const valores: unknown[] = [];
  const where = construirWhere(f, valores);
  valores.push(f.limite);
  const filas = await db.consultar({
    texto: `SELECT ${COLUMNAS} FROM movimientos ${where} ORDER BY fecha DESC, id DESC LIMIT $${valores.length}`,
    valores,
  });
  return filas.map(aMovimiento);
}

export interface TotalCategoria {
  categoria: string;
  total_cargos: number;
  total_abonos: number;
  num_movimientos: number;
}

export interface ResumenMoneda {
  moneda: string;
  total_cargos: number;
  total_abonos: number;
  balance: number;
  num_movimientos: number;
  categorias: TotalCategoria[];
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Totales del periodo agrupados por moneda (no se suman monedas distintas). */
export async function resumirPeriodo(
  db: Db,
  rango: Pick<FiltrosConsulta, "desde" | "hastaExclusivo" | "hastaInclusivo">,
): Promise<ResumenMoneda[]> {
  const valores: unknown[] = [];
  const where = construirWhere(rango, valores);
  const filas = await db.consultar({
    texto: `
      SELECT moneda, categoria,
        COALESCE(SUM(monto) FILTER (WHERE tipo = 'cargo'), 0) AS total_cargos,
        COALESCE(SUM(monto) FILTER (WHERE tipo = 'abono'), 0) AS total_abonos,
        COUNT(*) AS num_movimientos
      FROM movimientos ${where}
      GROUP BY moneda, categoria`,
    valores,
  });

  const porMoneda = new Map<string, ResumenMoneda>();
  for (const fila of filas) {
    const moneda = String(fila.moneda).trim();
    const categoria: TotalCategoria = {
      categoria: String(fila.categoria),
      total_cargos: Number(fila.total_cargos),
      total_abonos: Number(fila.total_abonos),
      num_movimientos: Number(fila.num_movimientos),
    };
    let resumen = porMoneda.get(moneda);
    if (!resumen) {
      resumen = { moneda, total_cargos: 0, total_abonos: 0, balance: 0, num_movimientos: 0, categorias: [] };
      porMoneda.set(moneda, resumen);
    }
    resumen.total_cargos += categoria.total_cargos;
    resumen.total_abonos += categoria.total_abonos;
    resumen.num_movimientos += categoria.num_movimientos;
    resumen.categorias.push(categoria);
  }

  return [...porMoneda.values()]
    .map((r) => ({
      ...r,
      total_cargos: redondear(r.total_cargos),
      total_abonos: redondear(r.total_abonos),
      balance: redondear(r.total_abonos - r.total_cargos),
      categorias: r.categorias.sort(
        (a, b) => b.total_cargos - a.total_cargos || b.total_abonos - a.total_abonos,
      ),
    }))
    .sort((a, b) => b.num_movimientos - a.num_movimientos);
}

export interface CambiosDatos {
  categoria?: string;
  concepto?: string;
  notas?: string | null;
  fecha?: string;
  monto?: number;
}

/** Actualiza solo los campos presentes; `null` si el id no existe. */
export async function actualizarMovimiento(
  db: Db,
  id: number,
  cambios: CambiosDatos,
): Promise<Movimiento | null> {
  const valores: unknown[] = [];
  const asignaciones: string[] = [];
  const asignar = (columna: string, valor: unknown, conversion = "") => {
    valores.push(valor);
    asignaciones.push(`${columna} = $${valores.length}${conversion}`);
  };
  if (cambios.categoria !== undefined) asignar("categoria", cambios.categoria);
  if (cambios.concepto !== undefined) asignar("concepto", cambios.concepto);
  if (cambios.notas !== undefined) asignar("notas", cambios.notas);
  if (cambios.fecha !== undefined) asignar("fecha", cambios.fecha, "::timestamptz");
  if (cambios.monto !== undefined) asignar("monto", cambios.monto.toFixed(2));
  valores.push(id);

  const filas = await db.consultar({
    texto: `
      UPDATE movimientos SET ${asignaciones.join(", ")}, actualizado_en = now()
      WHERE id = $${valores.length}
      RETURNING ${COLUMNAS}`,
    valores,
  });
  return filas[0] ? aMovimiento(filas[0]) : null;
}
