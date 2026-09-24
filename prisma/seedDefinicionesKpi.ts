// Script — publica los 10 DefinicionKpi del catalogo inicial (numero 1,
// PUBLICADA) segun MVP-DEFINITIVO Seccion 6.3/Especificacion V2 Seccion
// 11.1 ("Decision #6 confirmada por Alex el 2026-09-15"). Incremento 4
// Bloque A.
//
// STOCKOUT y COBERTURA: descripcion/formula/reglasExclusion actualizadas
// 2026-09-24 segun la revision de Alex (segunda ronda, mas precisa que la
// primera) -- ver src/engine/kpis/stockout.ts y cobertura.ts para el
// detalle completo de las reglas y su razonamiento. Estas dos definiciones
// siguen siendo "codigo" v1 (numero 1): el cambio corrige la
// descripcion/formula/reglas del catalogo funcional para que coincidan
// exactamente con el motor de calculo antes de su primera publicacion real
// contra datos -- no es una revision posterior a una version ya en uso.
//
// Bootstrap deliberado: igual que seedCuestionarioV2.ts, RF19 (Curador
// Metodologico) todavia no tiene UI de publicacion, asi que este script
// hace ese primer paso a mano, sin asignar curadorId (columna nullable a
// proposito, ver comentario en prisma/schema.prisma). Cuando exista la UI
// de curaduria, las versiones siguientes se publican desde ahi, no desde
// un script.
//
// Corre siempre contra SEED_DATABASE_URL (rol neondb_owner), igual
// criterio que prisma/seed.ts y prisma/seedCuestionarioV2.ts: publicar
// contenido versionado es equivalente a una migracion, no una escritura
// de la app en runtime. Idempotente: upsert por codigo_numero (mismo
// patron) -- volver a correrlo no duplica ni pisa datos.
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const seedDatabaseUrl = process.env.SEED_DATABASE_URL;
if (!seedDatabaseUrl) {
  throw new Error(
    "Falta SEED_DATABASE_URL en .env -- ver prisma/seed.ts para el mismo requisito.",
  );
}

const adapter = new PrismaPg({ connectionString: seedDatabaseUrl });
const prisma = new PrismaClient({ adapter });

interface DefinicionKpiSeed {
  codigo: string;
  nombre: string;
  descripcion: string;
  formula: string;
  unidad: string;
  periodoDefecto: string;
  // Reglas de exclusion/tratamiento de datos del calculo -- formato libre
  // por KPI (ver comentario de reglasExclusion en schema.prisma). Solo
  // STOCKOUT y COBERTURA lo tienen poblado por ahora (son los dos KPIs
  // cuyas reglas fueron revisadas y cerradas explicitamente por Alex el
  // 2026-09-24); el resto queda sin este campo hasta que se revisen igual.
  reglasExclusion?: Record<string, unknown>;
}

// Los 10 KPIs, en el mismo orden que MVP-DEFINITIVO Seccion 6.3 (§11.1) --
// codigo estable, consumido tal cual por src/engine/kpis/index.ts
// (KPIS_POR_CODIGO) para elegir la funcion de calculo correspondiente.
const DEFINICIONES: DefinicionKpiSeed[] = [
  {
    codigo: "OTIF",
    nombre: "OTIF (On Time In Full)",
    descripcion: "Proporción de pedidos entregados completos y a tiempo sobre el total de pedidos evaluados.",
    formula: "pedidos completos y a tiempo / pedidos evaluados",
    unidad: "%",
    periodoDefecto: "mensual",
  },
  {
    codigo: "FILL_RATE",
    nombre: "Fill Rate",
    descripcion: "Proporción de unidades servidas sobre las unidades solicitadas.",
    formula: "unidades servidas / unidades solicitadas",
    unidad: "%",
    periodoDefecto: "mensual",
  },
  {
    codigo: "STOCKOUT",
    nombre: "Porcentaje de observaciones sin stock",
    descripcion:
      "Proporción de observaciones válidas (SKU + ubicación + fecha de corte) con stock disponible igual o " +
      "inferior a cero, sobre el total de observaciones válidas evaluadas en el periodo. No mide días sin stock " +
      "ni demanda no atendida -- describe la muestra registrada. Limitación que debe mostrarse: es una tasa de " +
      "observaciones, no un promedio de tasas por SKU -- un SKU observado más veces en el periodo pesa más en " +
      "el resultado.",
    formula: "100 × (observaciones válidas con stock disponible ≤ 0) / (observaciones válidas evaluadas)",
    unidad: "%",
    periodoDefecto: "mensual",
    reglasExclusion: {
      observacionUnica: "SKU + ubicación + fecha de corte (día calendario; la hora, si existe, se ignora).",
      tratamientoDuplicados:
        "Si dos o más filas de la misma observación coinciden exactamente, se colapsan a una sola (redundancia " +
        "de captura). Si difieren (mismo SKU/ubicación/fecha con valores distintos), es un conflicto real: se " +
        "excluyen todas y se señalan para resolver a mano -- nunca se elige una ganadora en silencio.",
      datosFaltantes:
        "Un stock faltante o no numérico se excluye y se informa; nunca se convierte en 0 (ni 'con stock' ni " +
        "'sin stock').",
      productosInactivos: "Las observaciones de productos marcados como inactivos se excluyen del cálculo.",
      sinObservacionesValidas: "Si no hay observaciones válidas en el periodo, el resultado es 'Sin datos suficientes'.",
      relleno: "No se completan fechas sin registro -- esta métrica no es una serie temporal continua.",
      limitacionPeso:
        "Es una tasa de observaciones, no un promedio de tasas por SKU: un SKU observado más veces pesa más.",
      version: "kpis-v1",
      cerradoPor: "Alex, 2026-09-24 (segunda revisión, sustituye la primera)",
      estadoValidacion: "Regla propuesta para el MVP, no validada aún con datos reales.",
    },
  },
  {
    codigo: "COBERTURA",
    nombre: "Cobertura de inventario",
    descripcion:
      "Días de inventario disponible frente al consumo diario esperado, calculado siempre por SKU y ubicación " +
      "-- nunca como agregado entre SKU. La agregación de cobertura entre SKU distintos queda fuera de esta " +
      "definición hasta acordar su metodología (unidades comparables, agrupación y ponderación); no debe " +
      "leerse ni mostrarse un promedio o suma entre SKU heterogéneos.",
    formula: "inventario disponible a la fecha de corte / consumo diario esperado, por SKU y ubicación",
    unidad: "días",
    periodoDefecto: "mensual",
    reglasExclusion: {
      granularidad: "Cálculo por SKU + ubicación únicamente. No existe agregado general en esta implementación.",
      unidades:
        "Inventario y consumo deben declarar la misma unidad; si no coinciden (o no se declaran), la fila queda " +
        "en 'Unidades incompatibles' sin resultado numérico.",
      inventarioCeroConConsumo: "Consumo positivo e inventario cero produce 0 días de cobertura (resultado válido, no un caso especial).",
      consumoCero: "Consumo diario esperado igual a cero produce 'Sin consumo de referencia', nunca 0 días.",
      datosFaltantes: "Inventario o consumo faltante produce 'Datos incompletos'.",
      valoresNegativos: "Inventario o consumo negativo se señala para revisión; nunca se convierte silenciosamente.",
      tratamientoDuplicados:
        "Filas duplicadas (mismo SKU/ubicación) que coinciden exactamente se colapsan a una sola. Si difieren, " +
        "se marcan todas como duplicado en conflicto y se excluyen del cálculo -- mismo criterio que Stockout.",
      agregacionEntreSku:
        "Fuera de alcance hasta acordar metodología (unidades comparables, agrupación, ponderación). No sumar " +
        "inventarios ni consumos de SKU distintos, ni presentar Σinventario/Σconsumo como cobertura general.",
      version: "kpis-v1",
      cerradoPor: "Alex, 2026-09-24 (segunda revisión, sustituye la primera)",
      estadoValidacion: "Regla propuesta para el MVP, no validada aún con datos reales.",
    },
  },
  {
    codigo: "LEAD_TIME",
    nombre: "Lead time",
    descripcion: "Tiempo promedio transcurrido entre el inicio y el fin de un proceso.",
    formula: "fecha fin − fecha inicio",
    unidad: "días",
    periodoDefecto: "mensual",
  },
  {
    codigo: "VARIABILIDAD_LEAD_TIME",
    nombre: "Variabilidad de lead time",
    descripcion: "Dispersión (desviación estándar) de los lead times de procesos comparables.",
    formula: "desviación estándar de los lead times comparables",
    unidad: "días (desviación estándar)",
    periodoDefecto: "mensual",
  },
  {
    codigo: "OTIF_PROVEEDOR",
    nombre: "OTIF proveedor",
    descripcion: "Proporción de recepciones de proveedor completas y a tiempo sobre el total de recepciones.",
    formula: "recepciones completas y a tiempo / recepciones",
    unidad: "%",
    periodoDefecto: "mensual",
  },
  {
    codigo: "TIEMPO_DETECCION",
    nombre: "Tiempo de detección",
    descripcion: "Tiempo promedio entre la ocurrencia de un incidente y su detección.",
    formula: "detección − ocurrencia",
    unidad: "horas",
    periodoDefecto: "por incidente",
  },
  {
    codigo: "TIEMPO_DECISION",
    nombre: "Tiempo de decisión",
    descripcion: "Tiempo promedio entre la detección de un incidente y la decisión tomada.",
    formula: "decisión − detección",
    unidad: "horas",
    periodoDefecto: "por incidente",
  },
  {
    codigo: "TIEMPO_RECUPERACION",
    nombre: "Tiempo de recuperación",
    descripcion: "Tiempo promedio entre la interrupción y la recuperación completa.",
    formula: "recuperación − interrupción",
    unidad: "horas",
    periodoDefecto: "por incidente",
  },
];

async function main() {
  for (const definicion of DEFINICIONES) {
    const kpi = await prisma.definicionKpi.upsert({
      where: { codigo_numero: { codigo: definicion.codigo, numero: 1 } },
      update: {},
      create: {
        codigo: definicion.codigo,
        numero: 1,
        estado: "PUBLICADA",
        publicadaEn: new Date(),
        nombre: definicion.nombre,
        descripcion: definicion.descripcion,
        formula: definicion.formula,
        unidad: definicion.unidad,
        periodoDefecto: definicion.periodoDefecto,
        reglasExclusion: definicion.reglasExclusion
          ? (definicion.reglasExclusion as unknown as Prisma.InputJsonValue)
          : undefined,
        notasCambio: "Version inicial -- catálogo de 10 KPIs confirmado por Alex el 2026-09-15 (MVP-DEFINITIVO Decisión #6).",
      },
    });
    console.log(`DefinicionKpi "${kpi.codigo}" v${kpi.numero} (${kpi.estado}) lista.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
