// Script de mantenimiento -- SOLO LECTURA. Muestra el estado real de una
// ImportacionCsv de Cobertura y las ObservacionCobertura que produjo,
// para la validacion manual del wizard (Incremento 4 Bloque B).
//
// Por que hace falta: el wizard (src/app/dashboard/kpis/cobertura) todavia
// no tiene ninguna pantalla que muestre el detalle por SKU (estado,
// coberturaDias, vigente) ni el contenido de erroresMuestra -- ver
// src/app/dashboard/kpis/cobertura/page.tsx, que solo muestra el
// historial de ImportacionCsv (estado agregado + conteo de filas), nunca
// las ObservacionCobertura en si. Sin este script, la unica forma de ver
// esos valores es una consulta manual a Neon.
//
// Usa SEED_DATABASE_URL (neondb_owner, bypassea RLS) -- mismo patron que
// scripts/limpiarTenantsPrueba.ts: buscar por nombre de cadena (o por
// importId) sin conocer el empresaId de antemano es exactamente lo que
// RLS bloquea con el rol normal de la app. Es SOLO LECTURA (ningun
// UPDATE/DELETE en todo el archivo) -- seguro de correr contra la base de
// desarrollo en cualquier momento, incluida produccion si hiciera falta
// (aunque no deberia hacer falta ahi).
//
// Uso:
//   npx tsx scripts/verificarObservacionesCobertura.ts --cadena "texto del nombre"
//   npx tsx scripts/verificarObservacionesCobertura.ts --import <importId>
import "./_cargarEnv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function leerArgumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado (ver .env.example) -- hace falta el rol neondb_owner para buscar sin conocer el tenant de antemano (RLS bloquea cualquier SELECT sin app.tenant_id ya fijado).",
    );
  }
  const cadenaTexto = leerArgumento("cadena");
  const importId = leerArgumento("import");
  if (!cadenaTexto && !importId) {
    throw new Error("Falta --cadena \"texto\" o --import <importId>. Ver el comentario de cabecera para el uso exacto.");
  }

  const adapter = new PrismaPg({ connectionString });
  const ownerPrisma = new PrismaClient({ adapter });
  try {
    const importaciones = await ownerPrisma.importacionCsv.findMany({
      where: importId ? { id: importId } : { cadena: { nombre: { contains: cadenaTexto! } } },
      orderBy: { createdAt: "desc" },
      include: { cadena: { select: { nombre: true } } },
    });

    if (importaciones.length === 0) {
      console.log("Ninguna ImportacionCsv encontrada con ese filtro.");
      return;
    }

    for (const imp of importaciones) {
      console.log(`\n=== ImportacionCsv ${imp.id} (cadena "${imp.cadena.nombre}") ===`);
      console.log(`  estado=${imp.estado}  estrategia=${imp.estrategia}  procesadaEn=${imp.procesadaEn ?? "null"}`);
      console.log(`  filasDetectadas=${imp.filasDetectadas}  filasConError=${imp.filasConError}`);
      console.log(`  fuenteConsumo=${imp.fuenteConsumo ?? "null"}  periodo=${imp.periodoReferenciaConsumoInicio?.toISOString().slice(0, 10) ?? "?"} a ${imp.periodoReferenciaConsumoFin?.toISOString().slice(0, 10) ?? "?"}`);
      if (imp.erroresMuestra) {
        console.log("  erroresMuestra:", JSON.stringify(imp.erroresMuestra, null, 2));
      }

      const observaciones = await ownerPrisma.observacionCobertura.findMany({
        where: { cadenaId: imp.cadenaId, fuente: "csv" },
        orderBy: [{ sku: "asc" }, { fechaCorte: "asc" }],
        select: {
          sku: true,
          ubicacion: true,
          fechaCorte: true,
          estado: true,
          coberturaDias: true,
          vigente: true,
          inventarioDisponible: true,
          consumoDiarioEsperado: true,
        },
      });
      console.log(`  ObservacionCobertura (fuente=csv) de esta cadena: ${observaciones.length} fila(s)`);
      for (const o of observaciones) {
        console.log(
          `    sku=${o.sku} ubicacion=${o.ubicacion} fechaCorte=${o.fechaCorte.toISOString().slice(0, 10)} ` +
            `estado=${o.estado} coberturaDias=${o.coberturaDias ?? "null"} vigente=${o.vigente} ` +
            `(inventario=${o.inventarioDisponible ?? "null"} consumo=${o.consumoDiarioEsperado ?? "null"})`,
        );
      }
    }
  } finally {
    await ownerPrisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
