---
title: Diseño final de implementación — Lead time (KPI #1 de los 6 pendientes)
fecha: 2026-11-27
tipo: diseño de solo lectura — ningún código fue modificado, ninguna migración/Neon/seed tocados
alcance: pipeline completo (captura → persistencia → detalle → histórico → análisis → acciones), siguiendo el patrón ya piloteado 3 veces por OTIF/Fill Rate/Cobertura, sobre `main @ b250086ddbf7015cafa5c4fef9f8038b5ce72f6d`
---

# Diseño de implementación — Lead time

Primer KPI del orden confirmado (Lead time → Stockout → Variabilidad de lead time → Tiempo de detección/decisión/recuperación). Este documento es el diseño final, listo para que una futura autorización lo convierta en PR — **no implementa nada**.

## 0. Por qué Lead time es el más simple de reproducir

El motor de cálculo ya existe y está probado (`src/engine/kpis/leadTime.ts`, `calcularLeadTime()`): recibe filas `{ proceso, inicio, fin }`, excluye las que no tienen `fin` o donde `fin < inicio`, y devuelve un `ResultadoCalculoKpi` con `valor` (promedio en días), `numerador` (suma de días) y `denominador` (conteo de filas válidas) — **la misma forma `valor/numerador/denominador` que OTIF/Fill Rate**, aunque la semántica de negocio sea distinta (promedio vs. ratio). Esto es lo que permite reutilizar, sin escribir una sola línea nueva, toda la capa compartida ya construida para OTIF/Fill Rate:

- **Histórico**: `historicoObservacionKpi.ts` (`cargarHistoricoObservacionesKpi()`) y el adaptador `adaptarPuntoObservacionKpi()` ya operan sobre cualquier fila de `ObservacionKpi` con `valor/numerador/denominador` — no les importa si el número es un ratio o un promedio.
- **Análisis/decisión**: `generarAnalisisObservacionKpi()` (la rama "Observación" de `analisisDecision.ts`, ya usada por OTIF/Fill Rate) compara contra el período anterior de la misma `ruleVersion` sobre el campo `valor` — funciona igual para un promedio de días.
- **Detalle**: `DetalleObservacionKpi.tsx` ya es un componente compartido parametrizado por `codigo` (usado hoy por OTIF y Fill Rate) — agregar Lead time es fijar `codigo="LEAD_TIME"` en un wrapper de pocas líneas, sin tocar el componente.
- **Acciones**: `OrigenAccionKpi` con `tipo: "OBSERVACION_KPI"` y el gate `esCodigoConAccionesHabilitado()` ya están generalizados (PR-A, cerrado — Fase 4).

Es decir: **no hay ninguna pieza de infraestructura compartida que construir**. El trabajo real es 100% específico de Lead time: validación de entrada (`declarar.ts`), persistencia (`persistir.ts`), las 3 rutas API, el wizard y las 4 líneas del catálogo.

## 1. Captura

Sigue el mismo patrón de 2 niveles que OTIF (RF del MVP: Nivel 1 manual, Nivel 2 pegado — Nivel 3 CSV queda fuera, igual que en OTIF/Fill Rate hoy).

### Nivel 1 — manual (decisión confirmada 2026-11-27)

El modo manual captura directamente el lead time promedio como un valor numérico (`valorPromedioDias`, positivo) + el período — **sin inventar un `numerador`/`denominador` sintético ni un ratio estimado**, a diferencia del agregado manual de OTIF. Verificado antes de fijar esta decisión, no asumido:

- `ObservacionKpi.numerador` y `ObservacionKpi.denominador` son `Float?` en `prisma/schema.prisma:1421-1422` — **el contrato sí admite su ausencia**, no hace falta ninguna migración ni cambio de esquema.
- `src/infra/kpis/historico/adaptadorObservacionKpi.ts` solo lee `punto.valor` (línea 19) para construir el punto histórico — nunca toca `numerador`/`denominador`. Indiferente a que sean `null`.
- `src/infra/kpis/analisisDecision.ts` (líneas 256-259) ya guarda explícitamente con `!== null` antes de calcular cualquier delta de `numerador`/`denominador` — el único efecto de dejarlos `null` es que el análisis omite el párrafo narrativo "el numerador/denominador pasó de X a Y", y sigue comparando `valor` con normalidad.

Es decir: la compuerta de compatibilidad que pediste verificar **no se activa** — se persiste `valor = <promedio capturado>`, `numerador = null`, `denominador = null`, sin tocar ningún contrato ni código compartido.

**Unidad obligatoria y explícita**: el formulario de captura Nivel 1 debe mostrar la unidad junto al campo numérico de forma fija y no editable (`"días"`, tomada de `DefinicionKpi.unidad` del seed ya existente para `LEAD_TIME`) — nunca un campo numérico desnudo ni un selector de unidad libre (no hay otra unidad válida para este KPI). Esto cumple "unidad obligatoria y explícita" sin agregar ningún campo nuevo al esquema: es una restricción de UI, no de datos.

### Nivel 2 — pegado
Tabla de filas `{ proceso, inicio, fin }`, un proceso por fila. Validación calcada de `construirFilaOtif()` en `declarar.ts` de OTIF, adaptada a 3 campos en vez de 5:

```ts
interface FilaLeadTimeEntrada {
  proceso: string;
  inicio: string; // ISO AAAA-MM-DD estricto, mismo parsearFechaCalendarioEstricta() reexportado de otif/declarar.ts o duplicado localmente
  fin: string | null; // null = proceso todavia no cerrado -> fila excluida por el motor, no rechaza la carga
}
```

**Diferencia confirmada frente a OTIF (decisión 2026-11-27), justificada por la semántica del dominio**: OTIF rechaza la carga completa si hay un `pedido` duplicado (C1) porque un pedido es una entidad única que no debería aparecer dos veces en el mismo período. Un "proceso" de Lead time (ej. "Recepción de mercadería") **sí puede repetirse legítimamente varias veces dentro de un mismo período** — varias observaciones del mismo proceso son válidas, cada una es una instancia distinta que se promedia. **No se aplica la regla de "proceso duplicado" de OTIF** — el nombre `proceso` es solo una etiqueta descriptiva, no una clave de negocio única como `pedido`.

**Compuerta explícitamente pendiente, documentada y no implementada por mi cuenta**: la prevención de duplicados reales (ej. la misma fila cargada dos veces por accidente al pegar la tabla) debe basarse, cuando se necesite, en la identidad estable del registro o evento de origen (ej. un ID de orden de trabajo, un ticket, un identificador del sistema de origen) — **no en el nombre del proceso ni en la combinación `proceso+inicio+fin`**, porque dos procesos distintos legítimamente pueden compartir ese triple exacto. Hoy la forma mínima de captura (`proceso`, `inicio`, `fin`, Sección 1) **no tiene ningún campo que porte esa identidad** — no existe todavía. Por eso esta compuerta se documenta aquí como pendiente y **no se improvisa un campo nuevo ni una regla de deduplicación por mi cuenta**: si en el futuro se decide que hace falta, requiere su propia decisión de producto (qué campo de identidad capturar, si es opcional u obligatorio, si rompe la forma mínima actual) antes de construirse. El MVP de Lead time, tal como está diseñado aquí, **no deduplica filas pegadas en ningún nivel** — cada fila válida se promedia tal cual.

Validaciones que SÍ se replican de OTIF sin cambios de criterio: fechas calendario estrictas (mismo `parsearFechaCalendarioEstricta()`), límite de filas (`MAX_FILAS_PEGADO_LEAD_TIME`, mismo patrón de `domain/limitesDeclaracionOtif.ts`), `fin` ausente (`undefined`) rechaza la fila completa igual que en OTIF (forma inválida ≠ dato de negocio incompleto), `fin: null` explícito se pasa al motor y éste decide excluirla (dato de negocio incompleto, no error de forma). **No se replica** la validación de pertenencia al período (A1/B2 de OTIF, `fechaPrometida` dentro de `[periodoInicio, periodoFin]`): Lead time no tiene un campo equivalente a `fechaPrometida` que deba caer dentro del período declarado — `inicio`/`fin` son las fechas reales del proceso, y es razonable que un proceso empiece en un período y termine en otro (ej. un lead time de 45 días que cruza el cierre de mes). Esto también queda como decisión explícita a confirmar antes de construir, no asumida.

## 2. Persistencia

`prisma/seedDefinicionesKpi.ts` ya tiene la entrada `LEAD_TIME` (nombre, descripción, fórmula, unidad, `periodoDefecto: "mensual"`) — **no hace falta ninguna migración ni cambio de seed**, solo publicarla (`estado: PUBLICADA`) si no lo está ya (confirmar en la base, fuera del alcance de este diseño de solo lectura). `src/infra/kpis/leadTime/persistir.ts` sigue exactamente el patrón de `otif/persistir.ts`: `tenantClient(empresaId)`, resolver `cadena`, resolver `DefinicionKpi` por `codigo: "LEAD_TIME"`, upsert de `ObservacionKpi` por la clave única existente (`[cadenaId, definicionKpiId, periodoInicio, periodoFin, fuente]`) — mismo RF-K2 de idempotencia, mismo recálculo server-side obligatorio (nunca confiar en un `valor` del cliente), mismo `ruleVersion` tomado de `ResultadoCalculoKpi.ruleVersion`. **Cero cambios de esquema.**

## 3. Detalle

Catálogo: `LEAD_TIME.detalle = "OBSERVACION_KPI"` (hoy `null`). Archivo nuevo: `src/app/dashboard/kpis/lead-time/observaciones/[id]/page.tsx`, un wrapper de pocas líneas que llama a `DetalleObservacionKpi` con `codigo="LEAD_TIME"` — mismo patrón exacto que los wrappers de OTIF/Fill Rate, **sin tocar el componente compartido**.

## 4. Histórico

Catálogo: `LEAD_TIME.historico = "OBSERVACION_KPI"` (hoy `null`). **No se crea ningún adaptador nuevo** — `adaptarPuntoObservacionKpi()` ya convierte cualquier `PuntoObservacionKpi` (OTIF, Fill Rate, o ahora Lead time) al contrato `PuntoHistoricoKpi`. El único archivo nuevo es el wrapper de página/consulta que reutiliza `cargarHistoricoObservacionesKpi()` filtrando por `definicionKpi.codigo = "LEAD_TIME"`.

## 5. Análisis y decisión

Catálogo: no existe un campo propio para esto (ver Fase 4 — deliberadamente no generalizado). Se reutiliza `generarAnalisisObservacionKpi()` tal cual, igual que ya hace `DetalleObservacionKpi.tsx` para OTIF/Fill Rate (la misma sección "Análisis y decisión" de esa página ya es genérica por `codigo`). **Cero código nuevo en esta capa.**

## 6. Acciones

Catálogo: `LEAD_TIME.acciones = "OBSERVACION_KPI"` (hoy `null`). `AccionesDecisionKpi.tsx` y `crearAccionDecisionKpi()`/`idsDeOrigenAccionKpi()` ya aceptan `OrigenAccionKpi.tipo = "OBSERVACION_KPI"` de forma genérica (PR-A, tercer corte) — conectar Lead time es agregar la llamada al componente ya existente en la página de detalle de Lead time (paso 3), con `observacionKpiId` como origen. **Cero código nuevo en esta capa tampoco**, solo wiring.

## 7. Inventario exacto de archivos

**Crear (puros, sin Prisma — probables en `declarar.test.ts` sin DB):**
- `src/infra/kpis/leadTime/declarar.ts` — validación + `previsualizarObservacionLeadTime()`, calcado de `otif/declarar.ts` con las 2 diferencias de la Sección 1 (sin regla de duplicados, sin regla de pertenencia al período).
- `src/domain/limitesDeclaracionLeadTime.ts` — `MAX_FILAS_PEGADO_LEAD_TIME`, `MAX_LONGITUD_PROCESO` (mismo patrón que `limitesDeclaracionOtif.ts`).

**Crear (con Prisma):**
- `src/infra/kpis/leadTime/persistir.ts` — `confirmarObservacionLeadTime()`, calcado de `otif/persistir.ts`.

**Crear (rutas API, mismo patrón de OTIF):**
- `src/app/api/kpis/lead-time/observaciones/route.ts`
- `src/app/api/kpis/lead-time/observaciones/previsualizar/route.ts`
- `src/app/api/kpis/lead-time/observaciones/confirmar/route.ts`

**Crear (UI):**
- `src/app/dashboard/kpis/lead-time/page.tsx` + `DeclaracionLeadTimeWizard.tsx` (historial + wizard, mismo patrón de `kpis/otif/page.tsx` + `DeclaracionOtifWizard.tsx`).
- `src/app/dashboard/kpis/lead-time/observaciones/[id]/page.tsx` (wrapper de detalle, Sección 3).

**Modificar (1 línea × 4 campos):**
- `src/infra/kpis/catalogoPipelineKpi.ts` — `LEAD_TIME`: `persistencia/detalle/historico/acciones` pasan de `null` a `"OBSERVACION_KPI"`.

**No se toca:** `prisma/schema.prisma`, ninguna migración, `historicoObservacionKpi.ts`, `adaptadorObservacionKpi.ts` (del contrato de histórico), `analisisDecision.ts`, `estadoVisualizacion.ts` (los 3 gates ya son genéricos, solo leen el catálogo), `AccionesDecisionKpi.tsx`, `acciones/servicio.ts`/`tipos.ts`.

## 8. Pruebas previstas (mismo patrón que OTIF)

- `src/engine/kpis/__tests__/leadTime.test.ts` — **ya existe y ya pasa**, no se toca.
- `src/infra/kpis/leadTime/__tests__/declarar.test.ts` — unitarias puras, sin DB: casos de forma inválida, fila con `fin` ausente vs. `fin: null`, límite de filas, y el caso de regresión confirmado en la Sección 1/Criterio 8: dos filas con el mismo `proceso` se aceptan ambas, sin rechazo ni deduplicación.
- `src/infra/kpis/leadTime/__tests__/confirmarObservacionLeadTime.integration.test.ts` — con DB real (Windows/Neon), mismo formato que `declararObservacionOtif.integration.test.ts`: upsert idempotente, aislamiento de tenant.
- `src/app/api/kpis/lead-time/observaciones/**/__tests__/route.test.ts` ×3 — mismo patrón de mocks que las rutas de OTIF.
- `src/infra/kpis/__tests__/catalogoPipelineKpi.test.ts` — actualizar los 4 valores esperados de `LEAD_TIME` (de `null` a `"OBSERVACION_KPI"`), sin romper ningún otro caso.
- `src/infra/kpis/__tests__/estadoVisualizacion.test.ts` — ningún caso nuevo necesario (los 3 gates ya son exhaustivos sobre los 10 códigos vía el catálogo; al cambiar el catálogo, `LEAD_TIME` empieza a devolver `true` automáticamente en los 3 — **confirmar que la prueba de regresión existente, que hoy fija `LEAD_TIME` en `false`, se actualiza como parte de este PR, no se rompe por sorpresa**).

## 9. Riesgos

- **Bajo, estructuralmente**: no se toca ninguna pieza compartida, solo se activa un KPI ya modelado en el catálogo y se replica un patrón usado 3 veces. El motor de cálculo ya está probado desde antes de este diseño.
- Las 2 decisiones de producto de la Sección 1 ya están **confirmadas** (2026-11-27): captura manual como valor directo con unidad explícita, sin ratio sintético; sin regla de "proceso duplicado". El riesgo que queda no es de ambigüedad sino de alcance: el MVP **no deduplica filas pegadas** (compuerta de identidad de origen explícitamente pendiente, Sección 1) — si una fila se pega dos veces por error de usuario, hoy se cuenta dos veces en el promedio. Esto es una limitación conocida y documentada, no un defecto oculto.
- Riesgo de regresión en pruebas ya existentes que fijan el estado actual de `LEAD_TIME: null` en el catálogo (Sección 8) — mitigado por ser cambios de expectativa explícitos y acotados, no sorpresivos.

## 10. Criterios de aceptación

1. `previsualizarObservacionLeadTime()` nunca persiste; `confirmarObservacionLeadTime()` recalcula server-side y nunca confía en un `valor` del cliente.
2. Upsert idempotente por `[cadenaId, definicionKpiId, periodoInicio, periodoFin, fuente]` — confirmar dos veces el mismo período actualiza la misma fila.
3. Aislamiento de tenant: mismo criterio que OTIF (`tenantClient` + RLS).
4. Los 4 campos de `LEAD_TIME` en el catálogo pasan a `"OBSERVACION_KPI"`, con la prueba de contrato existente (`catalogoPipelineKpi.test.ts`) actualizada, no rota.
5. Ninguna prueba existente de OTIF, Fill Rate, Cobertura, OTIF Proveedor, histórico, acciones o análisis cambia su expectativa.
6. Typecheck en el baseline conocido (0 errores nuevos), lint 0, suite completa sin integraciones en verde, `git diff --check` 0.
7. Captura manual (Nivel 1): persiste `valor` no nulo, `numerador`/`denominador` explícitamente `null`; la unidad `"días"` se muestra de forma fija y no editable en el formulario.
8. Captura pegada (Nivel 2): ninguna fila se rechaza ni se fusiona por compartir `proceso` con otra — cada fila válida es una observación independiente que entra al promedio. Una prueba de regresión explícita confirma esto (`declarar.test.ts`): dos filas con el mismo `proceso` y fechas distintas se aceptan ambas.
9. El PR no agrega ningún campo de identidad de origen ni ninguna regla de deduplicación por su cuenta — la compuerta de la Sección 1 queda documentada como pendiente, no resuelta de forma improvisada.

## 11. Lo que queda explícitamente pendiente para los siguientes 3 KPIs (no se diseña aquí)

- **Stockout**: pendiente tu decisión sobre de dónde sale `zonaHoraria` por cadena (hoy solo hay un default por `DefinicionKpi`, no un campo por `Cadena`).
- **Variabilidad de lead time**: pendiente tu decisión sobre cómo comunicar en la UI un KPI cuyo `numerador`/`denominador` son siempre `null` por diseño (no hay un ratio natural).
- **Tiempo de detección / decisión / recuperación** (los 3 juntos): pendiente diseñar el objeto de dominio "incidente" (ocurrencia → detección → decisión → recuperación) — hoy no existe ningún objeto que modele esa línea de tiempo, y `ObservacionKpi.periodoInicio/periodoFin` fue pensado para períodos de calendario, no para esto.

Ninguno de estos 3 diseños se abre todavía — quedan para cuando confirmes cada decisión de producto.
