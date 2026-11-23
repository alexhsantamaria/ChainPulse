# Diseño de PR-A — generalización compartida del pipeline de KPIs

**Fecha:** 2026-11-23
**Base:** `main` @ `ee515a2c96b97d66dba53e703d911c0704ade593`
**Precondición cumplida:** Fase 0 de rendimiento cerrada y documentada en `cierre-fase0-pr4-rendimiento-2026-11-23.md`.

## 1. Objetivo

Preparar las capas compartidas para incorporar, sin copiar seis veces contratos acoplados, los pipelines de Stockout, Lead time, Variabilidad de lead time, Tiempo de detección, Tiempo de decisión y Tiempo de recuperación.

PR-A no añade persistencia ni endpoints para esos seis KPIs y no cambia la métrica 26/50. Su resultado es una base extensible y probada que preserva el comportamiento de OTIF, Fill Rate, Cobertura y OTIF Proveedor.

## 2. Problemas que debe resolver

1. El histórico compartido asume `ObservacionKpi` o modelos especiales conocidos manualmente.
2. La semántica de análisis está repartida entre ramas específicas y no existe un registro declarativo completo por KPI.
3. `OrigenAccionKpi` solo representa `OBSERVACION_KPI` e `IMPORTACION_CSV` mediante una unión cerrada y claves foráneas concretas.
4. La UI compartida abre detalles según listas manuales, lo que facilita rutas incompletas al agregar un KPI.
5. Cada nuevo modelo con `empresaId` debe registrarse simultáneamente en tenant scope, RLS y permisos; PR-A debe convertirlo en un criterio verificable, no ocultarlo.

## 3. Arquitectura propuesta

### 3.1 Registro declarativo de KPI

Crear un registro único, exhaustivo y tipado por `CodigoKpi` que declare:

- unidad y formato;
- dirección de mejora (`MAYOR_ES_MEJOR`, `MENOR_ES_MEJOR` o `CONTEXTUAL` cuando no existe un óptimo universal);
- política de comparabilidad y versión de regla;
- capacidades disponibles: histórico, detalle, acciones y origen;
- adaptador encargado de convertir persistencia específica a un punto histórico normalizado.

El registro debe fallar en compilación si falta un código conocido y debe rechazar combinaciones incoherentes en pruebas.

### 3.2 Contrato normalizado de histórico

Definir un tipo de lectura sin dependencia de Prisma, por ejemplo:

```ts
type PuntoHistoricoKpi = {
  id: string;
  periodoInicio: Date;
  periodoFin: Date;
  valor: number | null;
  estado: EstadoDatoNormalizado;
  fuente: string;
  ruleVersion: string;
};
```

Cada origen persistente implementará un adaptador que produzca este contrato. La capa de análisis consumirá puntos normalizados y semántica declarada, no modelos Prisma concretos.

### 3.3 Origen extensible de acciones

No se recomienda añadir una FK nullable nueva por cada KPI. PR-A debe introducir un identificador de origen lógico (`tipo`, `entidadId`) validado por un resolver registrado. Para conservar integridad:

- las referencias actuales siguen funcionando durante la transición;
- toda creación valida que el origen pertenece al mismo tenant y cadena;
- el resolver devuelve una vista normalizada y nunca expone acceso Prisma sin scope;
- cualquier migración compartida necesaria se diseña y autoriza por separado antes de ejecutarse.

PR-A no debe eliminar las FKs actuales ni migrar datos existentes en el mismo cambio sin una revisión específica.

### 3.4 Puertas explícitas de UI

La navegación debe depender de capacidades declaradas, no de listas negativas. Un KPI sin detalle registrado no muestra enlace ni acción. Los componentes compartidos reciben modelos de vista normalizados y no importan modelos Prisma.

### 3.5 Tenant scope

Agregar una prueba de contrato que obligue a todo modelo con `empresaId` a figurar en `TENANT_SCOPED_MODELS` o en una exclusión documentada. Las migraciones futuras de PR-B a PR-G seguirán incluyendo RLS, política y grants en el mismo PR que su tabla.

## 4. Corte de alcance confirmado por el código actual

La revisión de `OrigenAccionKpi` y `AccionDecisionKpiFila` confirma que un origen genérico persistible no cabe en el esquema actual: la fila solo dispone de `observacionKpiId` e `importacionCsvId`. Agregar `tipoOrigen`/`entidadOrigenId`, sustituir FKs o conservar ambas representaciones exige una migración y una estrategia de compatibilidad.

Por ello PR-A se divide en dos decisiones, sin ocultar una migración dentro de la refactorización:

- **PR-A1, autorizado sin esquema:** registro declarativo, contratos normalizados, adaptadores de lectura, capacidades positivas de UI, prueba de tenant scope y regresiones.
- **PR-A2, condicionado:** persistencia extensible de orígenes de acciones. Solo se implementa tras aprobar un ADR, la migración, el backfill y la integridad referencial.

Mientras PR-A2 no se autorice, las acciones existentes continúan usando exclusivamente `OBSERVACION_KPI` e `IMPORTACION_CSV`; los nuevos tipos de KPI no anuncian capacidad de acciones.

## 5. Secuencia de implementación de PR-A1

1. Extraer tipos normalizados y registro declarativo sin cambiar comportamiento.
2. Adaptar OTIF y Fill Rate al contrato común.
3. Incorporar adaptadores de Cobertura y OTIF Proveedor sin forzar que compartan tabla.
4. Migrar análisis e histórico a los adaptadores.
5. Generalizar capacidades y puertas de UI.
6. Añadir pruebas de exhaustividad, tenant scope y regresión.

Cada paso debe ser revisable y mantener verdes las rutas existentes.

### Estado del primer corte

Este primer corte implementa el registro exhaustivo, declara las capacidades que ya existen y reemplaza la lista manual de acceso al detalle genérico. OTIF y Fill Rate conservan ese detalle compartido; Cobertura y OTIF Proveedor declaran sus rutas e históricos dedicados; los seis KPIs pendientes permanecen sin capacidades publicadas.

Los contratos históricos normalizados, sus adaptadores, la generalización del análisis y la prueba de tenant scope continúan pendientes dentro de PR-A1. Este corte no declara PR-A1 terminado ni habilita PR-B a PR-G.

## 6. Inventario inicial de archivos

La revisión de implementación debe empezar, como mínimo, por:

- `src/infra/kpis/estadoVisualizacion.ts`;
- `src/infra/kpis/historicoObservacionKpi.ts`;
- `src/infra/kpis/analisisDecision.ts`;
- `src/infra/kpis/acciones/tipos.ts`;
- `src/infra/kpis/acciones/derivarOrigenActual.ts`;
- `src/infra/kpis/acciones/servicio.ts`;
- registro de `TENANT_SCOPED_MODELS` y sus pruebas;
- páginas y componentes de detalle/histórico de OTIF, Fill Rate, Cobertura y OTIF Proveedor.

El diff definitivo se fija después de leer las implementaciones y pruebas completas; este inventario no autoriza una migración.

## 7. Pruebas obligatorias

- exhaustividad del registro para todos los `CodigoKpi`;
- equivalencia de histórico antes/después para OTIF y Fill Rate;
- adaptación correcta de Cobertura y OTIF Proveedor;
- comparabilidad por `ruleVersion` y dirección de mejora;
- conservación de las validaciones actuales para orígenes de acción inexistentes, de otra empresa o de otra cadena;
- ausencia de enlaces de detalle/acción cuando la capacidad no está registrada;
- contrato de tenant scope;
- regresión de APIs y UI de los cuatro KPIs ya completos;
- suite completa, typecheck, lint y `git diff --check` en Windows.

## 8. Límites

PR-A no debe:

- crear las seis tablas finales;
- añadir seeds o datos funcionales;
- ejecutar migraciones o conectarse a Neon sin autorización separada;
- cambiar resultados numéricos de los KPIs existentes;
- crear el índice de `HallazgoCadena` descartado por la medición;
- iniciar PR-B antes de que el contrato compartido esté validado.
- alterar la persistencia de `AccionDecisionKpi` hasta aprobar PR-A2 por separado.

## 9. Criterios de aceptación

PR-A1 queda listo cuando los cuatro pipelines existentes funcionan mediante los contratos generalizados, el registro es exhaustivo, las puertas de UI son positivas, tenant scope tiene verificación automática y no existen regresiones observables. PR-A2 permanece como decisión explícita separada; no es un efecto colateral ni una condición oculta de PR-A1.
