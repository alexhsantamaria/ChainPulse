# Auditoría corregida y diseño de la siguiente fase — pipeline de 6 KPIs

**Repositorio:** ChainPulse
**Base verificada:** `main` @ `cb6f88ed30ee0ff0272cafe9c6797b905614b737`
**Fecha:** 2026-11-22
**Alcance:** auditoría y diseño documental. No se modificó código, Prisma, Neon ni producción.

## 1. Resumen ejecutivo

- Quedan **6 KPIs con solo motor puro**, no 7: Stockout, Lead time, Variabilidad de lead time, Tiempo de detección, Tiempo de decisión y Tiempo de recuperación.
- OTIF, Fill Rate, Cobertura y OTIF Proveedor ya tienen pipeline funcional completo.
- El avance reproducible del **pipeline de los 10 KPIs** es `26/50 = 52%`. Esta cifra no representa el avance global de ChainPulse.
- La investigación del 401 sí llegó a una causa inmediata demostrada por logs de runtime: Auth.js emitió `JWTSessionError: no matching decryption secret`. El fallo ocurrió antes de `sessionVersion` y antes de Neon.
- PR #36 fue revisado, validado, fusionado y desplegado. GitHub y el clon nativo de Windows quedaron en `cb6f88e`; el repositorio del Mac apunta al mismo commit, pero presenta una discrepancia de finales de línea según qué implementación de Git lo inspeccione (Sección 2).
- Sigue pendiente la auditoría real de rendimiento de PR4: `EXPLAIN ANALYZE` y carga controlada con percentiles contra infraestructura temporal autorizada.
- La revisión de solo lectura de las capas compartidas confirma que **no son plenamente genéricas**. PR-A debe generalizar contratos y orígenes antes de construir los seis pipelines.

## 2. Estado verificado de Git y validación

Después de fusionar PR #36, la evidencia observada en las sesiones que realizaron cada operación es:

- GitHub `main`: `cb6f88ed30ee0ff0272cafe9c6797b905614b737`, verificado mediante el conector de GitHub en la sesión que fusionó PR #36.
- Repositorio autoritativo del Mac: `main` y `origin/main` en el mismo SHA, sin ahead/behind. Su estado de archivos requiere el matiz CRLF descrito debajo.
- Clon nativo de Windows: `main` en el mismo SHA, árbol limpio y sin ahead/behind, observado mediante comandos ejecutados directamente sobre `C:\Users\alx\Documents\BigDevelopment\Proyectos\ChainPulse` en la sesión de sincronización.
- Los stashes preexistentes de cada clon permanecieron intactos.
- CI de PR #36: lint, typecheck y pruebas unitarias, resultado exitoso, verificado mediante GitHub Checks.
- Vercel: despliegue de `cb6f88e` completado correctamente, verificado mediante el estado publicado por Vercel en el commit.

### Discrepancia CRLF reproducida

La anomalía CRLF sí se reproduce con Git nativo del Mac sobre la vista montada del repositorio:

- siete archivos aparecen modificados;
- el diff normal informa 3421 inserciones y 3421 eliminaciones;
- `git diff --ignore-all-space` queda vacío;
- los blobs comiteados usan LF y los archivos observados en disco usan CRLF;
- Git nativo del Mac no tiene `core.autocrlf` definido y el repositorio no contiene `.gitattributes`.

La inspección del mismo árbol mediante Git para Windows sobre `C:\Mac\Home\...` muestra el árbol limpio porque esa instalación resuelve `core.autocrlf=true`. Por tanto, no existe una diferencia lógica, pero sí una diferencia byte a byte y de interpretación entre las dos herramientas. Esta deuda queda congelada: no se descartarán archivos ni se añadirá `.gitattributes` dentro de esta entrega.

Los siete archivos afectados son los siete archivos modificados por PR #36:

- `scripts/perf/__tests__/cargaConsultas.test.ts`
- `scripts/perf/cargaConsultas.ts`
- `src/app/api/consultas/ejecutar/__tests__/route.test.ts`
- `src/infra/queries/rendimiento/__tests__/cargaConsultasHelpers.test.ts`
- `src/infra/queries/rendimiento/__tests__/sesionSinteticaHelpers.test.ts`
- `src/infra/queries/rendimiento/cargaConsultasHelpers.ts`
- `src/infra/queries/rendimiento/sesionSinteticaHelpers.ts`

Este documento todavía no forma parte de `cb6f88e`: es un archivo nuevo y no rastreado hasta que se autorice su staging y publicación.

### Validación nativa de Windows relevante

Sobre la rama previa a PR #36 se verificaron, entre otras compuertas:

- `npm ci`: código 0.
- `prisma generate`: código 0.
- `prisma validate`: código 0.
- Typecheck: código 0.
- Pruebas focalizadas: 4/4 archivos, 135/135 pruebas.
- Suite completa: 186/186 archivos, 1981/1981 pruebas.

Los 24 diagnósticos de typecheck y el fallo de carga de `gobernanzaVersiones.test.ts` observados anteriormente correspondían al entorno Mac con Prisma Client desactualizado. No se consideran defectos vigentes confirmados del código.

## 3. Corrección de alcance: 6 KPIs pendientes

| ID | KPI | Estado actual |
|---|---|---|
| I4-03 | Stockout | Motor puro |
| I4-05 | Lead time | Motor puro |
| I4-06 | Variabilidad de lead time | Motor puro |
| I4-08 | Tiempo de detección | Motor puro |
| I4-09 | Tiempo de decisión | Motor puro |
| I4-10 | Tiempo de recuperación | Motor puro |

Los cuatro KPIs con pipeline completo son OTIF, Fill Rate, Cobertura y OTIF Proveedor. OTIF Proveedor dejó de ser motor-puro con el PR3 de cierre del Incremento 5.

## 4. Avance del pipeline de KPIs

La métrica de esta auditoría se limita al pipeline funcional de los diez KPIs:

- 10 KPIs × 5 capas: Motor, Persistencia, API, UI y Detalle/Análisis/Acciones.
- Total: 50 casillas binarias verificables.
- Cuatro KPIs completos: `4 × 5 = 20`.
- Seis KPIs con solo motor: `6 × 1 = 6`.
- Resultado: **26/50 = 52%**.

Esta cifra no sustituye las matrices históricas del programa ni debe comunicarse como porcentaje global del proyecto.

Cada KPI que avance de 1/5 a 5/5 suma cuatro casillas, equivalentes a ocho puntos porcentuales de esta métrica. Los seis pipelines completos llevarían este eje a `50/50 = 100%`.

## 5. Investigación del 401 y alcance de PR #36

La causa inmediata del 401 fue investigada con evidencia directa de runtime:

- `/api/auth/session` registró `JWTSessionError: no matching decryption secret`.
- `/api/consultas/ejecutar` registró el mismo error antes de responder `401 NO_SESION`.
- El JWT no pudo descifrarse con el secreto efectivo del Preview.
- `sessionVersion` y Neon no llegaron a intervenir.
- El mismatch de salt quedó descartado como explicación principal de ese incidente.

Debe distinguirse entre tres asuntos:

1. **Problema operativo del secreto efectivo del Preview:** se diagnosticó el fallo inmediato —el secreto usado por el emisor no coincidía con el secreto efectivo del runtime—, pero no se determinó por qué divergieron (rotación, alcance de entorno, valor heredado u otra causa operacional). El “qué” está confirmado; el “por qué” sigue abierto.
2. **Soporte defensivo de cookie/salt y bypass:** implementado, validado, fusionado en PR #36 y desplegado.
3. **Auditoría real de rendimiento:** todavía pendiente; no queda satisfecha por los dos puntos anteriores.

## 6. Pendientes vigentes por severidad

### Crítica

1. **Medición real de PR4:** falta ejecutar `EXPLAIN ANALYZE` real a las escalas autorizadas y la carga controlada con p50/p97.5/p99 contra una rama temporal y un Preview inequívocamente conectados entre sí.
2. **Seis KPIs sin pipeline funcional:** no tienen persistencia, API, UI ni detalle/análisis/acciones.

### Alta

3. **Generalización de capas compartidas:** la revisión D1 demostró que las capas existentes no admiten automáticamente los seis modelos nuevos.
4. **Índice candidato de `HallazgoCadena`:** queda diferido hasta disponer de `EXPLAIN ANALYZE`; no se creará basándose solo en análisis estático.
5. **Normalización de finales de línea:** siete archivos se ven modificados desde Git nativo del Mac aunque no contienen cambios lógicos. Debe resolverse en una tarea separada, con respaldo y una política `.gitattributes` revisada, antes de mezclar nuevos cambios sobre esos mismos archivos.

### Baja / administrativa

6. Ramas, worktrees y residuos diagnósticos no se eliminarán todavía. Su limpieza requiere una autorización separada después de cerrar la medición real.

No se mantienen como defectos de código vigentes los 24 errores del Mac ni el fallo aislado de Prisma de la suite del Mac: la evidencia posterior de Windows y CI los supera. La discrepancia CRLF sí se mantiene como deuda operativa del árbol del Mac, no como regresión lógica del código.

## 7. Resultado de D1: las capas compartidas no son plenamente genéricas

La revisión fue exclusivamente de lectura.

### 7.1 Estado de visualización y detalle

`src/infra/kpis/estadoVisualizacion.ts` contiene lógica específica para:

- `ObservacionKpi` de OTIF/Fill Rate.
- `ObservacionCobertura` e `ImportacionCsv`.
- Una puerta explícita `CODIGOS_CON_DETALLE_HABILITADO` limitada a `OTIF` y `FILL_RATE`.

Por tanto, un KPI nuevo no obtiene detalle genérico por registrar una nueva definición.

### 7.2 Histórico

`src/infra/kpis/historicoObservacionKpi.ts` consulta directamente `client.observacionKpi` y filtra por `definicionKpiId`. Es reutilizable para KPIs almacenados en esa misma tabla y con esa forma, pero no para seis tablas dedicadas `Observacion<Kpi>` sin un adaptador o un repositorio común.

### 7.3 Análisis y decisión

`src/infra/kpis/analisisDecision.ts` tiene dominios diferenciados:

- OTIF/Fill Rate mediante `PuntoObservacionKpi`.
- Cobertura mediante su resumen propio.

Incluye reglas semánticas como `masAltoEsMejor`, comparabilidad por `ruleVersion`, umbrales y motivos de información insuficiente. No es un motor completamente declarativo para cualquier KPI.

### 7.4 Acciones

`src/infra/kpis/acciones/tipos.ts` limita `OrigenAccionKpi` a:

- `OBSERVACION_KPI` mediante `observacionKpiId`.
- `IMPORTACION_CSV` mediante `importacionCsvId`.

`derivarOrigenActual.ts`, `servicio.ts` y la consulta de historial siguen esos dos orígenes. Los modelos dedicados de OTIF Proveedor y de los seis KPIs futuros no entran automáticamente en este contrato.

### 7.5 Tenant scope

`TENANT_SCOPED_MODELS` exige registrar cada modelo que tenga `empresaId` propio. Esto debe ocurrir en el mismo PR y migración que cree cada tabla, junto con RLS, política y permisos.

### Conclusión D1

PR-A no puede reducirse a una simple confirmación. Debe diseñar una abstracción compartida que permita:

- representar orígenes de observaciones heterogéneas sin ampliar manualmente una unión y varias FK por cada KPI;
- normalizar puntos históricos comparables;
- declarar semántica del KPI (`masAltoEsMejor`, unidad, comparabilidad y estados);
- reutilizar UI y acciones sin abrir accidentalmente detalles incompletos;
- preservar RLS y tenant-scope.

No se recomienda copiar seis veces la lógica actual antes de resolver este contrato.

## 8. Secuencia aprobada

### Fase 0 — cerrar PR4 real (completada 2026-11-23)

Antes de PR-A:

1. Crear infraestructura temporal autorizada y aislada.
2. Confirmar Git SHA, host, base, usuario, deployment y variables.
3. Ejecutar la siembra sintética y `EXPLAIN ANALYZE` en escalas autorizadas.
4. Ejecutar carga controlada dentro de los límites del script.
5. Reportar p50/p97.5/p99 y planes de consulta saneados.
6. Limpiar fixtures y verificar su ausencia mediante consultas reales.
7. Decidir el índice de `HallazgoCadena` basándose en evidencia medida.

La fase fue ejecutada sobre `main` @ `ee515a2c96b97d66dba53e703d911c0704ade593`. Las nueve mediciones fueron válidas, el peor p97.5 fue 2.417 ms y no se justificó crear el índice candidato de `HallazgoCadena`. Evidencia y limpieza: [`cierre-fase0-pr4-rendimiento-2026-11-23.md`](./cierre-fase0-pr4-rendimiento-2026-11-23.md).

### PR-A — generalización compartida

PR-A fue diseñado después de cerrar la línea base de rendimiento y antes de cualquier tabla nueva. Véase [`diseno-pr-a-generalizacion-pipeline-kpis-2026-11-23.md`](./diseno-pr-a-generalizacion-pipeline-kpis-2026-11-23.md). Debe incluir, como mínimo:

- contrato normalizado de observación/histórico;
- registro declarativo de semántica por KPI;
- estrategia extensible para orígenes de acciones;
- componentes compartidos de UI con puertas explícitas;
- regresión de OTIF, Fill Rate, Cobertura y OTIF Proveedor;
- ninguna migración de los seis KPIs todavía, salvo que el diseño de orígenes requiera una migración compartida y se autorice por separado.

PR-A no suma casillas a la métrica 26/50; prepara una implementación segura.

### PR-B a PR-G — un pipeline por KPI

Cada PR debe incorporar las cuatro capas faltantes de un KPI:

- persistencia y migración;
- API;
- UI;
- detalle/análisis/acciones;
- registro simultáneo en tenant-scope, RLS, política y grants;
- pruebas unitarias, API, UI y aislamiento de tenant;
- integración con consultas determinísticas cuando corresponda.

## 9. Orden B–G todavía no fijado

Antes de priorizar se construirá una matriz por KPI con:

- dependencias entre motores y preguntas determinísticas;
- origen real de los datos y semántica de captura;
- complejidad de migración;
- riesgo de aislamiento y privacidad;
- valor de negocio y frecuencia de uso;
- posibilidad de derivar el KPI de eventos existentes en vez de capturarlo manualmente.

Solo después se propondrá el orden definitivo. El listado Stockout → Lead time → Variabilidad → Detección → Decisión → Recuperación no queda aprobado todavía.

## 10. Decisiones cerradas

- **D1:** revisión de solo lectura completada; las capas no son plenamente genéricas y PR-A necesita generalización.
- **D2:** cerrar primero la medición real de PR4 y después iniciar PR-A.
- **D3:** la discrepancia de finales de línea fue reproducida. No se modifica todavía; queda como tarea separada de normalización segura antes de tocar nuevamente esos siete archivos.
- **D4:** diferir el índice de `HallazgoCadena` hasta contar con `EXPLAIN ANALYZE`.
- **D5:** no fijar todavía B–G; primero elaborar la matriz de dependencias, captura y valor de negocio.

## 11. Límites de esta entrega

Esta entrega no:

- modifica código ni configuración;
- ejecuta Prisma, migraciones o seeds;
- se conecta a Neon;
- despliega ni genera carga;
- elimina ramas, worktrees, stashes o residuos;
- declara un porcentaje global de ChainPulse.

Fase 0 quedó cerrada. El siguiente paso es revisar y ejecutar PR-A conforme al diseño enlazado, sin iniciar todavía PR-B a PR-G.
