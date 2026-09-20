-- Incremento 3 -- Mapa y profundidad, Bloque A (Modelo de datos).
-- requirements.md Seccion 14 (RF27-RF39, RNF13-RNF15); MVP-DEFINITIVO.md
-- Seccion 6.2/20; PLAN-DE-TRABAJO.md (Incremento 3, Bloque A).
-- Cadena/Nodo/ConexionCadena/FlujoConexionCadena/HallazgoCadena son
-- entidades NUEVAS Y ADITIVAS (Seccion 5 de MVP-DEFINITIVO.md) -- no
-- reemplazan Empresa/Eslabon/Conexion del flujo de cuenta completa v1,
-- que sigue operando sin cambios. CREATE TYPE/CREATE TABLE puros:
-- ninguna migracion de datos, porque no existen filas previas en estas
-- tablas (mismo criterio que 20260916150000_incremento2_evaluacion_expres_v2).

-- CreateEnum
CREATE TYPE "TipoNodo" AS ENUM ('ORGANIZACION', 'AREA', 'INSTALACION', 'PROCESO', 'PERSONA_DECISORA', 'SISTEMA');

-- CreateEnum
CREATE TYPE "TipoFlujoV2" AS ENUM ('PRODUCTO_SERVICIO', 'INFORMACION', 'DINERO', 'DECISION', 'DEVOLUCION');

-- CreateEnum
CREATE TYPE "DimensionComparacionCadena" AS ENUM ('PRIORIDAD_ELEGIDA', 'CONOCIMIENTO_ENTRADAS_SALIDAS', 'MOMENTO_INFORMACION', 'FUENTE_DATOS', 'NODO_CRITICO', 'ALTERNATIVA_DISPONIBLE');

-- CreateEnum
CREATE TYPE "ResultadoComparacion" AS ENUM ('ACUERDO', 'ACUERDO_PARCIAL', 'DIFERENCIA', 'SIN_RESPUESTA_SUFICIENTE');

-- CreateTable
-- RF27 -- alcance de un producto/servicio y un periodo concretos.
CREATE TABLE "cadenas" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "productoServicio" TEXT NOT NULL,
    "periodoInicio" TIMESTAMP(3) NOT NULL,
    "periodoFin" TIMESTAMP(3) NOT NULL,
    "tipoOperacion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cadenas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- RF28 -- nodo del mapa: catalogo mas amplio que Eslabon (TipoNodo). El
-- puente opcional a Eslabon (eslabonRefId) NUNCA fuerza fusion de datos.
CREATE TABLE "nodos" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoNodo" NOT NULL,
    "eslabonRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nodos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- RF29-RF33 -- relacion dirigida entre dos Nodo de la MISMA Cadena.
-- Entidad nueva y distinta de la Conexion ya construida (RF2/RF3, flujo
-- de cuenta completa v1) -- no la extiende ni la reemplaza.
CREATE TABLE "conexiones_cadena" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "origenNodoId" TEXT NOT NULL,
    "destinoNodoId" TEXT NOT NULL,
    "requerimientoCantidad" BOOLEAN NOT NULL DEFAULT false,
    "requerimientoFecha" BOOLEAN NOT NULL DEFAULT false,
    "requerimientoEspecificacion" BOOLEAN NOT NULL DEFAULT false,
    "requerimientoAprobacion" BOOLEAN NOT NULL DEFAULT false,
    "requerimientoPago" BOOLEAN NOT NULL DEFAULT false,
    "coincidePrioridad" BOOLEAN,
    "coincideCantidad" BOOLEAN,
    "coincideFecha" BOOLEAN,
    "oportunidadInformacion" "DuracionCategorica",
    "responsableDecision" TEXT,
    "impactoFalla" "NivelImpacto",
    "tieneAlternativa" BOOLEAN,
    "alternativaProbada" BOOLEAN,
    "tiempoTolerable" "DuracionCategorica",
    "tiempoRecuperacion" "DuracionCategorica",
    "estadoEvidencia" "EstadoEvidencia" NOT NULL DEFAULT 'DECLARADO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conexiones_cadena_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- RF29 -- tabla hija SIN empresaId propio (mismo patron que
-- RespuestaCruda, docs/PATRONES.md): una ConexionCadena soporta multiples
-- flujos simultaneos, cada uno una fila propia en vez de un array repetido.
CREATE TABLE "flujos_conexion_cadena" (
    "id" TEXT NOT NULL,
    "conexionCadenaId" TEXT NOT NULL,
    "tipo" "TipoFlujoV2" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flujos_conexion_cadena_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- RF38/RF39 -- resultado de una comparacion multi-rol. "contextoSnapshot"
-- sigue el patron de snapshot-JSON de docs/PATRONES.md Seccion 1: solo
-- variables no identificables, nunca un id de respuesta individual.
CREATE TABLE "hallazgos_cadena" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "cadenaId" TEXT NOT NULL,
    "conexionCadenaId" TEXT,
    "dimension" "DimensionComparacionCadena" NOT NULL,
    "resultado" "ResultadoComparacion" NOT NULL,
    "contextoSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hallazgos_cadena_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cadenas_empresaId_idx" ON "cadenas"("empresaId");

-- CreateIndex
CREATE INDEX "nodos_empresaId_idx" ON "nodos"("empresaId");

-- CreateIndex
CREATE INDEX "nodos_cadenaId_idx" ON "nodos"("cadenaId");

-- CreateIndex
CREATE UNIQUE INDEX "conexiones_cadena_origenNodoId_destinoNodoId_key" ON "conexiones_cadena"("origenNodoId", "destinoNodoId");

-- CreateIndex
CREATE INDEX "conexiones_cadena_empresaId_idx" ON "conexiones_cadena"("empresaId");

-- CreateIndex
CREATE INDEX "conexiones_cadena_cadenaId_idx" ON "conexiones_cadena"("cadenaId");

-- CreateIndex
CREATE UNIQUE INDEX "flujos_conexion_cadena_conexionCadenaId_tipo_key" ON "flujos_conexion_cadena"("conexionCadenaId", "tipo");

-- CreateIndex
CREATE INDEX "hallazgos_cadena_empresaId_idx" ON "hallazgos_cadena"("empresaId");

-- CreateIndex
CREATE INDEX "hallazgos_cadena_cadenaId_idx" ON "hallazgos_cadena"("cadenaId");

-- AddForeignKey
ALTER TABLE "cadenas" ADD CONSTRAINT "cadenas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodos" ADD CONSTRAINT "nodos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodos" ADD CONSTRAINT "nodos_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RF28/Seccion 14.0 -- puente opcional, sin fusion conceptual con Eslabon:
-- si el Eslabon referenciado se elimina, el puente se limpia (SET NULL),
-- el Nodo sobrevive intacto.
ALTER TABLE "nodos" ADD CONSTRAINT "nodos_eslabonRefId_fkey" FOREIGN KEY ("eslabonRefId") REFERENCES "eslabones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexiones_cadena" ADD CONSTRAINT "conexiones_cadena_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexiones_cadena" ADD CONSTRAINT "conexiones_cadena_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexiones_cadena" ADD CONSTRAINT "conexiones_cadena_origenNodoId_fkey" FOREIGN KEY ("origenNodoId") REFERENCES "nodos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conexiones_cadena" ADD CONSTRAINT "conexiones_cadena_destinoNodoId_fkey" FOREIGN KEY ("destinoNodoId") REFERENCES "nodos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flujos_conexion_cadena" ADD CONSTRAINT "flujos_conexion_cadena_conexionCadenaId_fkey" FOREIGN KEY ("conexionCadenaId") REFERENCES "conexiones_cadena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hallazgos_cadena" ADD CONSTRAINT "hallazgos_cadena_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hallazgos_cadena" ADD CONSTRAINT "hallazgos_cadena_cadenaId_fkey" FOREIGN KEY ("cadenaId") REFERENCES "cadenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Opcional: una comparacion puede ser de cadena completa (p. ej. "nodo
-- critico") o de una conexion especifica (p. ej. "prioridad elegida"). Si
-- la ConexionCadena se elimina, el hallazgo sobrevive como hallazgo de
-- cadena (SET NULL), nunca se borra en cascada (RF38/RF39: un hallazgo
-- es un registro de diagnostico, no un dato derivado descartable).
ALTER TABLE "hallazgos_cadena" ADD CONSTRAINT "hallazgos_cadena_conexionCadenaId_fkey" FOREIGN KEY ("conexionCadenaId") REFERENCES "conexiones_cadena"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (docs/PATRONES.md Seccion 5) -- toda tabla tenant-scoped nueva lleva
-- su politica en la MISMA migracion que la crea. cadenas/nodos/
-- conexiones_cadena/hallazgos_cadena tienen empresaId propio
-- denormalizado (mismo criterio que eslabones/conexiones/ciclos_pulso):
-- columna directa. flujos_conexion_cadena NO tiene empresaId propio
-- (tabla hija, mismo patron que respuestas_crudas via conexiones):
-- politica por subconsulta contra su padre tenant-scoped.
ALTER TABLE "cadenas" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_cadenas ON "cadenas"
  USING ("empresaId" = current_setting('app.tenant_id', true));

ALTER TABLE "nodos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_nodos ON "nodos"
  USING ("empresaId" = current_setting('app.tenant_id', true));

ALTER TABLE "conexiones_cadena" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_conexiones_cadena ON "conexiones_cadena"
  USING ("empresaId" = current_setting('app.tenant_id', true));

ALTER TABLE "hallazgos_cadena" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_hallazgos_cadena ON "hallazgos_cadena"
  USING ("empresaId" = current_setting('app.tenant_id', true));

ALTER TABLE "flujos_conexion_cadena" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_flujos_conexion_cadena ON "flujos_conexion_cadena"
  USING (
    "conexionCadenaId" IN (
      SELECT id FROM "conexiones_cadena"
      WHERE "empresaId" = current_setting('app.tenant_id', true)
    )
  );

-- Grants -- leccion de 20260916170000_grants_incremento2 (R5-16): las
-- migraciones corren con `neondb_owner`, que es dueño de toda tabla
-- nueva por defecto, pero el rol de runtime `chainpulse_app` (el que usa
-- la aplicacion via DATABASE_URL) NO hereda privilegios sobre una tabla
-- nueva solo por existir -- sin GRANT explicito, cualquier consulta de la
-- aplicacion contra estas 5 tablas fallaria con "permission denied" en
-- cuanto exista codigo que las use. Mismo nivel de privilegio que el
-- resto de las tablas "de aplicacion" tenant-scoped ya construidas
-- (eslabones, conexiones, etc.) -- SELECT/INSERT/UPDATE/DELETE normal,
-- acotado por las politicas RLS de arriba (ninguna de estas 5 tablas es
-- un "recibo" append-only como consentimientos_expres/consentimientos_cuenta,
-- que sí llevan el REVOKE UPDATE, DELETE mas restrictivo).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "cadenas",
  "nodos",
  "conexiones_cadena",
  "flujos_conexion_cadena",
  "hallazgos_cadena"
TO chainpulse_app;
