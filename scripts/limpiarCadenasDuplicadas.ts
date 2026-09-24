// Script de mantenimiento -- borra Cadenas duplicadas creadas por el bug
// de doble-submit en NuevaCadenaForm.tsx (corregido en el commit
// 4d8b09f, 2026-09-24): un click rapido y repetido en "Crear cadena"
// disparaba dos POST /api/cadenas antes de que React reflejara
// `disabled={cargando}` en el DOM, y cada peticion creaba una Cadena
// independiente y completa (crearCadenaCompleta() nunca se llama dos
// veces desde el mismo POST -- confirmado leyendo el codigo, el
// duplicado es de peticiones, no de logica de negocio). Los nodos del
// mapa se agregan despues, a mano, sobre la cadena a la que el usuario
// termino siendo redirigido -- la otra copia queda huerfana con 0
// nodos. Caso real reportado por Alex el 2026-09-24 ("Exportacion de
// palta" y "Importacion de zapatos" duplicadas, la copia huerfana con
// 0 nodos en ambos casos).
//
// Identidad de "duplicado": misma empresa + los 5 campos que llena el
// formulario de creacion (nombre, productoServicio, tipoOperacion,
// periodoInicio, periodoFin) -- exactamente los campos que un
// doble-submit del mismo click manda dos veces con el mismo valor.
//
// Criterio de borrado, a proposito conservador -- NUNCA borra a ciegas
// por nombre repetido, un usuario real puede crear dos cadenas con el
// mismo nombre para trabajos separados:
//   - Dentro de un grupo de duplicados, se borran SOLO las copias
//     totalmente vacias (0 nodos, 0 conexiones, 0 hallazgos, 0
//     respuestas) -- exactamente la huella que deja el bug ya
//     corregido -- y solo si el grupo tiene ademas al menos una copia
//     con contenido real (si no, no hay forma de saber cual conservar).
//   - Si TODAS las copias del grupo estan vacias, el grupo se imprime
//     como "revisar a mano" y no se toca.
//   - El cascade de Prisma (onDelete: Cascade desde Cadena hacia
//     Nodo/ConexionCadena/HallazgoCadena/RespuestaCadena, ver
//     schema.prisma) hace innecesario borrar las tablas hijas a mano --
//     de todos modos son 0 filas en toda copia que este script borra.
//
// Mismo patron de dos roles que limpiarTenantsPrueba.ts:
//   1. BUSCAR con SEED_DATABASE_URL (neondb_owner, bypassea RLS): hace
//      falta ver todas las empresas para encontrar duplicados sin saber
//      de antemano en que tenant estan. Es solo lectura, sin riesgo.
//   2. BORRAR con el prisma normal (DATABASE_URL, chainpulse_app) + un
//      set_config('app.tenant_id', <empresaId>, true) explicito por
//      cadena a borrar, para que RLS siga protegiendo el borrado igual
//      que cualquier mutacion normal de la app.
//
// Uso:
//   npm run limpiar:cadenas-duplicadas -- --dry-run   -- solo lista, no borra
//   npm run limpiar:cadenas-duplicadas                -- lista y borra las copias vacias
import "./_cargarEnv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../src/infra/prisma/client";

interface CadenaConConteo {
  id: string;
  empresaId: string;
  nombre: string;
  productoServicio: string;
  tipoOperacion: string;
  periodoInicio: Date;
  periodoFin: Date;
  createdAt: Date;
  nNodos: number;
  nConexiones: number;
  nHallazgos: number;
  nRespuestas: number;
}

// Forma cruda de cada fila que devuelve el findMany() de mas abajo --
// anotada a mano porque el stub de Prisma en la Mac (engineType="client",
// ver ADR-0003) no infiere tipos reales de retorno, mismo motivo por el
// que el resto del proyecto tipa a mano en vez de depender del tipo
// generado.
interface FilaCadenaCruda {
  id: string;
  empresaId: string;
  nombre: string;
  productoServicio: string;
  tipoOperacion: string;
  periodoInicio: Date;
  periodoFin: Date;
  createdAt: Date;
  _count: { nodos: number; conexiones: number; hallazgos: number; respuestas: number };
}

function claveGrupo(c: CadenaConConteo): string {
  return [
    c.empresaId,
    c.nombre.trim().toLowerCase(),
    c.productoServicio.trim().toLowerCase(),
    c.tipoOperacion,
    c.periodoInicio.toISOString(),
    c.periodoFin.toISOString(),
  ].join("|");
}

function vacia(c: CadenaConConteo): boolean {
  return c.nNodos === 0 && c.nConexiones === 0 && c.nHallazgos === 0 && c.nRespuestas === 0;
}

async function buscarTodas(): Promise<CadenaConConteo[]> {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "SEED_DATABASE_URL no esta configurado (ver .env.example) -- hace falta el rol neondb_owner para ver todas las empresas sin conocer el tenant de antemano (RLS bloquea cualquier SELECT sin app.tenant_id ya fijado).",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  const ownerPrisma = new PrismaClient({ adapter });
  try {
    const cadenas = await ownerPrisma.cadena.findMany({
      select: {
        id: true,
        empresaId: true,
        nombre: true,
        productoServicio: true,
        tipoOperacion: true,
        periodoInicio: true,
        periodoFin: true,
        createdAt: true,
        _count: {
          select: { nodos: true, conexiones: true, hallazgos: true, respuestas: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return cadenas.map((c: FilaCadenaCruda) => ({
      id: c.id,
      empresaId: c.empresaId,
      nombre: c.nombre,
      productoServicio: c.productoServicio,
      tipoOperacion: c.tipoOperacion,
      periodoInicio: c.periodoInicio,
      periodoFin: c.periodoFin,
      createdAt: c.createdAt,
      nNodos: c._count.nodos,
      nConexiones: c._count.conexiones,
      nHallazgos: c._count.hallazgos,
      nRespuestas: c._count.respuestas,
    }));
  } finally {
    await ownerPrisma.$disconnect();
  }
}

async function borrarCadena(empresaId: string, cadenaId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.cadena.delete({ where: { id: cadenaId } });
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const todas = await buscarTodas();
  const grupos = new Map<string, CadenaConConteo[]>();
  for (const c of todas) {
    const clave = claveGrupo(c);
    const lista = grupos.get(clave) ?? [];
    lista.push(c);
    grupos.set(clave, lista);
  }

  const duplicados = [...grupos.values()].filter((g) => g.length > 1);

  if (duplicados.length === 0) {
    console.log("Sin cadenas duplicadas.");
    return;
  }

  const aBorrar: CadenaConConteo[] = [];
  const revisarAMano: CadenaConConteo[][] = [];

  for (const grupo of duplicados) {
    const vacias = grupo.filter(vacia);
    const conContenido = grupo.filter((c) => !vacia(c));
    if (vacias.length > 0 && conContenido.length >= 1) {
      // Caso esperado del bug: al menos una copia vacia + al menos una
      // con contenido real -- se borran solo las vacias.
      aBorrar.push(...vacias);
    } else {
      // O todas vacias (no se sabe cual conservar) o mas de un caso raro
      // -- se deja para revision manual, nunca se borra a ciegas.
      revisarAMano.push(grupo);
    }
  }

  console.log(`Grupos duplicados encontrados: ${duplicados.length}`);
  console.log(`Copias vacias a borrar: ${aBorrar.length}`);
  for (const c of aBorrar) {
    console.log(`  - [BORRAR] ${c.id}  "${c.nombre}"  empresa=${c.empresaId}  creada=${c.createdAt.toISOString()}`);
  }

  if (revisarAMano.length > 0) {
    console.log(`\nGrupos que requieren revision manual (no se tocan): ${revisarAMano.length}`);
    for (const grupo of revisarAMano) {
      const primero = grupo[0];
      if (!primero) continue; // no deberia pasar -- todo grupo aca tiene 2+ elementos
      console.log(`  Grupo "${primero.nombre}" (empresa=${primero.empresaId}):`);
      for (const c of grupo) {
        console.log(
          `    - ${c.id}  creada=${c.createdAt.toISOString()}  nodos=${c.nNodos} conexiones=${c.nConexiones} hallazgos=${c.nHallazgos} respuestas=${c.nRespuestas}`,
        );
      }
    }
  }

  if (dryRun) {
    console.log("\n(--dry-run: no se borro nada)");
    return;
  }

  for (const c of aBorrar) {
    await borrarCadena(c.empresaId, c.id);
    console.log(`Borrado: ${c.id}  "${c.nombre}"`);
  }

  console.log("Listo.");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
