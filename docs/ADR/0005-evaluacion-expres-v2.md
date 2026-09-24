# ADR-0005 — Reemplazo de `EvaluacionExpres` por `EvaluacionExpresV2`

Fecha: 2026-09-16
Estado: Aceptado — decisión tomada e implementada el 2026-09-16 (Ronda 4 de revisión, `PLAN-DE-TRABAJO.md` Sección 13 vs. Sección 14). Este documento formaliza por escrito una decisión ya ejecutada, referenciada desde `README.md` y desde los comentarios de `prisma/schema.prisma` pero sin ADR propio hasta ahora. Originalmente iba a numerarse "ADR-0004", pero ese número ya estaba ocupado por la cola de jobs (`docs/ADR/0004-cola-de-jobs.md`, aceptado el 2026-09-16 también) — corregido a ADR-0005 al escribir este documento.

## Contexto

`EvaluacionExpres` (el modelo original de la evaluación pública anónima, RF11-RF18) fue diseñado contra el diagnóstico viejo de 4 valores (salud/criticidad/dependencia/riesgo promedio + un `dimensionMasDebil` único). El 2026-09-15 Alex subió `CHAINPULSE_ESPECIFICACION_FUNCIONAL_TECNICA_V2.md`, que redefine la puerta de entrada pública con un motor de 5 dimensiones (RF19-RF26) y un cuestionario versionado (`CuestionarioVersion`/`PreguntaVersion`) — un modelo de datos distinto, no una extensión incremental del original.

`EvaluacionExpres` nunca tuvo filas reales ni rutas públicas construidas sobre él (confirmado: no hay ninguna referencia a `prisma.evaluacionExpres` fuera de sus propios comentarios en todo `src/`) — todo lo que existe hoy bajo tráfico real usa `EvaluacionExpresV2`. Esto abre dos caminos igual de válidos en abstracto, y dos planes de revisión de la Ronda 4 llegaron a conclusiones distintas sobre cuál tomar:

- El plan de **Developer** (`PLAN-DE-TRABAJO.md` Sección 14) recomendó **reescribir `EvaluacionExpres` in place**: como no tiene ninguna fila real todavía, evita mantener dos tablas con el mismo propósito.
- El plan de **DDD** (Sección 13) llegó al mismo objetivo de fondo (separar el motor v2 del v1 sin tocar datos) por otro camino: un modelo **nuevo y paralelo**, `EvaluacionExpresV2`.

Ambos coinciden en que no hay datos reales que migrar — difieren solo en si la tabla se llama distinto o se reescribe.

## Opciones consideradas

**Opción A — Reescribir `EvaluacionExpres` in place.** Un solo modelo, sin tabla muerta. Pero el resto del Incremento 2 ya exige el patrón de catálogo versionado (`CuestionarioVersion`/`PreguntaVersion`, mismo criterio que `DefinicionKpi` del Incremento 4) para las preguntas del cuestionario — reescribir el modelo de evaluación in place no resuelve por sí solo la necesidad de versionar el cuestionario que la responde, así que de todos modos habría que agregar tablas nuevas alrededor de un `EvaluacionExpres` reescrito. Riesgo adicional: al reescribir in place, cualquier referencia futura a "cómo era el modelo viejo" desaparece del código (aunque nunca tuvo datos reales, el propio commit history y los tests existentes de RF11-18 sí referencian su forma original).

**Opción B — Modelo nuevo y paralelo, `EvaluacionExpresV2`.** `EvaluacionExpres` (v1) queda congelado, sin escribirse nunca más, pero sin borrarse. `EvaluacionExpresV2` nace ya con el patrón de versionado correcto (`CuestionarioVersion`/`PreguntaVersion`) desde el diseño inicial, sin arrastrar ninguna decisión de forma heredada del modelo viejo. Costo: una tabla (`evaluaciones_expres` y sus hijas) que va a quedar sin ninguna fila real para siempre, a menos que se borre explícitamente más adelante.

| Opción | Tablas muertas en el schema | Arrastra forma del modelo viejo | Resuelve versionado del cuestionario de una vez |
|---|---|---|---|
| A — Reescribir in place | No | Sí (parcialmente, aunque se reescriba) | No, igual hacen falta tablas nuevas |
| B — Modelo nuevo paralelo | Sí (`EvaluacionExpres` v1, sin filas) | No | Sí, desde el diseño inicial |

## Decisión

Se adopta la **Opción B**: `EvaluacionExpresV2` + `Respuesta` (referencia `PreguntaVersion`, `onDelete: Restrict`) + `CuestionarioVersion`/`PreguntaVersion` (versionado del cuestionario) + `ConsentimientoExpres`/`ConsentimientoCuenta` (append-only, reemplaza los dos booleans legacy) + `HallazgoExpres`/`HallazgoExpresTraza` (patrón snapshot-JSON, separación operacional/investigación) — los 9 modelos y 6 enums nuevos descritos en `PLAN-DE-TRABAJO.md` Sección 18 (Ronda 4).

`EvaluacionExpres` (v1) **no se toca**: sus dos columnas de consentimiento (`consentimientoEnvio`/`consentimientoMejoraAlgoritmo`) quedan tal cual, sin backfill retroactivo — no se fabrica ningún `ConsentimientoExpres` con `textoVersion`/`jurisdiccion`/`vigenteDesde` reales para filas v1, porque esos metadatos nunca se capturaron y hacerlo falsificaría el histórico. Regla de lectura ya documentada en `schema.prisma`: cualquier código que necesite "¿esta evaluación consintió X?" rama por fecha/modelo — `EvaluacionExpres` consulta sus dos booleans, `EvaluacionExpresV2` consulta `ConsentimientoExpres` — nunca se mezclan en una sola consulta.

Mismo régimen de tenant que v1: ambos modelos quedan con **tenant nulo explícito, sin RLS** (aggregate root público, protegido por `LimiteTasa` + huella de origen + disciplina de nunca exponer un endpoint de lectura directa — no por política de fila). `EvaluacionExpresV2` está en la lista de excepciones documentada de la regla general de `TENANT_SCOPED_MODELS` (`PLAN-DE-TRABAJO.md`, comentario sobre denormalización de `empresaId`).

**Dónde vive en el código:** `prisma/schema.prisma` (los 9 modelos, junto al modelo `EvaluacionExpres` original sin modificar); `prisma/migrations/20260916150000_incremento2_evaluacion_expres_v2/` (migración escrita a mano, incluye el índice único parcial de versionado, la política RLS de `ConsentimientoCuenta` — única tabla tenant-scoped de este bloque — y los `REVOKE UPDATE/DELETE` de append-only sobre las dos tablas de consentimiento); las rutas públicas de `src/app/api/public/evaluations/**` (Bloque C) ya consumen exclusivamente `EvaluacionExpresV2`, nunca `EvaluacionExpres`.

## Consecuencias

**Positivas:** separación limpia entre el diagnóstico viejo (4 valores) y el nuevo (5 dimensiones), sin arrastrar ninguna decisión de forma heredada; `EvaluacionExpresV2` nace con el patrón de catálogo versionado correcto desde el inicio, coherente con `DefinicionKpi`/`CuestionarioVersion` (mismo criterio, `PLAN-DE-TRABAJO.md` Sección 18.3.A); cero riesgo de migración de datos reales, porque no existen filas v1 que migrar; las rutas públicas ya construidas (Bloque C) solo conocen `EvaluacionExpresV2`, así que no hay ninguna rama de código que tenga que decidir en runtime "cuál versión uso" — la ambigüedad quedó resuelta en el schema, no en el código de aplicación.

**Negativas / aceptadas conscientemente:** `EvaluacionExpres` (v1) y sus dos tablas hijas (`EvaluacionExpresEslabon`/`EvaluacionExpresConexion`) quedan en el schema para siempre sin ninguna fila real ni ningún camino de código que las escriba — es deuda de schema, no de datos ni de comportamiento. No hay backfill retroactivo posible sin falsificar histórico (ver arriba), así que la única forma de "limpiar" esta tabla es una migración `DROP` explícita el día que se confirme que nada la necesita ni siquiera como referencia histórica — no se hizo en esta decisión porque borrar algo que documenta de dónde vino RF11-18 tiene su propio valor mientras el costo de mantenerla (una tabla vacía) sea cercano a cero.

**Reversibilidad:** alta para agregar cosas nuevas sobre `EvaluacionExpresV2` (no hay ninguna referencia externa al modelo viejo que romper). Baja/nula para "deshacer" esta decisión en el sentido de volver a un solo modelo — eso exigiría fusionar dos schemas de preguntas ya divergentes (el cuestionario fijo original vs. el versionado nuevo), no es una operación mecánica.

## Referencias

- `PLAN-DE-TRABAJO.md` Sección 13 (plan DDD) y Sección 14 (plan Developer), Ronda 4.
- `CHAINPULSE_ESPECIFICACION_FUNCIONAL_TECNICA_V2.md` (RF19-RF26, motor de 5 dimensiones).
- `README.md`, "Resto del schema del Incremento 2... 2026-09-16".
- ADR-0001 (régimen de tenant nulo para aggregates públicos, ya establecido para `EvaluacionExpres` v1).
