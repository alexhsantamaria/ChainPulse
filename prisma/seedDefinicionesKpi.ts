// Script — publica los 10 DefinicionKpi del catalogo inicial (numero 1,
// PUBLICADA) segun MVP-DEFINITIVO Seccion 6.3/Especificacion V2 Seccion
// 11.1 ("Decision #6 confirmada por Alex el 2026-09-15"). Incremento 4
// Bloque A.
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
import { PrismaClient } from "@prisma/client";
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
    nombre: "Stockout",
    descripcion: "Proporción de observaciones (SKU/ubicación/fecha) sin stock disponible sobre el total evaluado.",
    formula: "observaciones sin stock / observaciones evaluadas",
    unidad: "%",
    periodoDefecto: "mensual",
  },
  {
    codigo: "COBERTURA",
    nombre: "Cobertura de inventario",
    descripcion: "Días de inventario disponible frente al consumo diario esperado.",
    formula: "inventario disponible / consumo diario esperado",
    unidad: "días",
    periodoDefecto: "mensual",
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
