# ChainPulse — Plan de Trabajo hasta Completar el Proyecto

Fecha: 2026-09-16
Estado: **Revisión de viabilidad completada en 4 rondas.** Ronda 1: arquitectura, herramientas, seguridad, DDD + auditoría final. Veredicto global: **Viable con condiciones.** Alex confirmó las 3 decisiones de infraestructura pendientes (cola de jobs Postgres-nativa, Cloudflare R2, `ConexionCadena` como tabla nueva) el 2026-09-15. Ronda 2: las mismas 4 dimensiones más un quinto agente de **implementación práctica/developer** entregaron cada una su plan de trabajo detallado y accionable hasta el cierre del proyecto (Secciones 10-14). Ronda 3: **Calidad 1 (QA/testing)**, **Calidad 2 (calidad de código/ingeniería)** y **Finanzas (costos de infraestructura y operación)** revisaron el documento completo en paralelo, y **Auditoría** consolidó y verificó sus hallazgos (Sección 17) — veredicto: **viable con condiciones, aprobado con correcciones documentales obligatorias.** La corrección crítica (H1, inconsistencia de la tabla `LimiteTasa`) ya está aplicada en las Secciones 10-14. Alex confirmó el 2026-09-16 la autenticación de `UsuarioPlataforma` (correo+contraseña+autenticador), el presupuesto de infraestructura ($0/mes, evaluar mes a mes) y el umbral de k-anonimato (20 organizaciones), y pidió cerrar todas las brechas, errores y vacíos antes de empezar. Ronda 4: 4 agentes (arquitectura, seguridad, DDD, developer/tooling) resolvieron, con esas 3 decisiones como fijas, prácticamente todos los ítems abiertos de las Secciones 4/15/17 con diseños concretos y listos para implementar (Sección 18) — de 16 hallazgos de Ronda 3, solo la revisión legal Ley 29733 sigue [HUMANO]. Ninguna condición de ninguna ronda exige cambiar el alcance ya aprobado en `MVP-DEFINITIVO.md` — todas son decisiones de "cómo construir", no de "qué construir" (la única excepción, el umbral de k-anonimato, ya se propagó a `MVP-DEFINITIVO.md` §6.6 como 20 organizaciones). Este documento fija el plan de tareas concreto, ordenado, hasta terminar el proyecto (Incrementos 2 a 7). Cada tarea es una casilla `- [ ]` que se marca `[x]` solo cuando está resuelta y validada, mismo mecanismo que `MVP-DEFINITIVO.md`.
Versión: 4.0

## 0. Cómo se hizo esta revisión

A pedido de Alex, cuatro agentes especializados revisaron `MVP-DEFINITIVO.md` v1.3 en paralelo, cada uno desde su dimensión, inspeccionando tanto los documentos del proyecto como el código real del repositorio (no solo la documentación):

- **Arquitectura** — viabilidad del stack actual para soportar los Incrementos 2-7.
- **Herramientas y stack tecnológico** — qué librerías/servicios concretos usar.
- **Seguridad y privacidad** — riesgos y controles por incremento.
- **DDD y modelo de datos** — límites de agregado, versionado, migración.

Un quinto agente de auditoría revisó los cuatro reportes en conjunto: buscó contradicciones entre ellos, verificó que los hallazgos graves fueran reales (no ruido), identificó huecos de cobertura, y produjo un veredicto único más una lista consolidada de bloqueantes sin duplicados. Los cuatro reportes completos y la auditoría están archivados como respaldo de este plan (disponibles en la sesión de Claude que los generó); este documento resume sus conclusiones accionables.

## 1. Análisis de lo que ya tenemos

**Incremento 1 — completo, validado, en producción parcial.** Registro de cuenta y MFA, invitación de responsables, declarar eslabones/conexiones, ciclo de pulso completo, recomendación priorizada, panel con tendencia, cobertura de respuesta, aislamiento multi-tenant probado contra Neon real con datos de dos tenants, motor de reglas v1 como funciones puras versionadas. 56 pruebas unitarias + 24 de integración, todas verdes.

**Lo que la revisión encontró que NO está tan completo como se pensaba:**

- La Sección 9 de `MVP-DEFINITIVO.md` marcaba `[x]` "Rate limiting para acceso anónimo — ya cumplido (RF15/RF17)". **Es incorrecto.** El código solo tiene `rateLimit.ts` para proteger el login con contraseña; no existe ninguna entidad `EvaluacionExpres` en el código todavía, ni el job de purga de `huellaOrigen` a 48-72h que `requirements.md` Sección 12 exige (`src/infra/retencion.ts` no existe). Este checkbox se corrige a `[ ]` en `MVP-DEFINITIVO.md` como parte de este plan.
- No existe ningún mecanismo de trabajos diferidos (cola de jobs), almacenamiento de objetos, capa de analítica separada, ni observabilidad (logging estructurado/tracking de errores) en el repo. La Sección 8 de `MVP-DEFINITIVO.md` ya lo señalaba como pendiente; la revisión confirma que es más urgente de lo previsto porque una de esas piezas (la cola de jobs) ya la necesita una obligación vencida del Incremento 1.
- `tenantClient()` no da atomicidad en escrituras multi-modelo — importante porque varios incrementos nuevos (Incremento 3: crear una `Cadena` con varios `Nodo`/`Conexión` en una operación; Incremento 4: persistir un CSV completo) necesitan justamente eso.

Ninguno de estos hallazgos pone en duda lo ya construido — son piezas de infraestructura transversal que faltan y que ahora se ordenan explícitamente en este plan.

## 2. Veredicto de viabilidad por dimensión

| Dimensión | Veredicto | Condición principal |
|---|---|---|
| Arquitectura | Viable con condiciones | Resolver infraestructura transversal (jobs, storage, observabilidad) antes del Incremento 4 |
| Herramientas/stack | Viable con condiciones | Elegir librerías concretas compatibles con los binarios nativos y el runtime Node ya usado |
| Seguridad | Viable con condiciones | Corregir el gap de rate limiting/purga; revisión legal Ley 29733 antes de tráfico público |
| DDD/modelo de datos | Viable con condiciones | Resolver una contradicción textual del propio documento sobre `Conexión`; diseñar versionado nativo en BD |
| **Auditoría (global)** | **Viable con condiciones** | Ninguna requiere cambiar el alcance aprobado — todas son decisiones técnicas de implementación |

## 3. Decisión de infraestructura — CONFIRMADA por Alex el 2026-09-15

- [x] **Confirmado:** cola de jobs sobre Postgres/Neon (`pg-boss` o `graphile-worker`), no Inngest, como mecanismo inicial.
- [x] **Confirmado:** almacenamiento de objetos privado — Cloudflare R2.
- [x] **Confirmado:** la entidad "Conexión" del mapa de cadena (Incremento 3) se resuelve con una tabla nueva `ConexionCadena`, aditiva, sin tocar la tabla `conexiones` existente — ver Sección 4.

La Ronda 2 (Secciones 10-14) profundizó estas tres decisiones y encontró **decisiones técnicas nuevas y más finas** que quedaron abiertas — ver Sección 15.

## 4. Bloqueantes antes de tocar el schema de Prisma o escribir el detalle EARS del Incremento 2

Cada ítem es una casilla que se marca `[x]` cuando está resuelto (documentado como decisión o implementado, según corresponda) y validado.

- [ ] **Corregir el checkbox de rate limiting en `MVP-DEFINITIVO.md` Sección 9** (de `[x]` a `[ ]`) — pendiente, es una construcción real (Incremento 2), no una decisión de diseño; el diseño de `LimiteTasa` en sí ya está cerrado (ver H1 abajo).
- [x] **ADR-0004 — infraestructura transversal (cola de jobs + storage) — confirmado (Sección 3)**; el detalle de dónde corre el worker de la cola quedó resuelto en la Sección 15 y formalizado como `docs/ADR/0004-worker-cola-jobs.md` en la Sección 18.1.
- [x] **Observabilidad mínima (Sentry) — especificación cerrada, lista para implementar en la Sección 18.1.B**: paquete, plan (Developer, gratuito — coherente con presupuesto $0/mes), variables de entorno, y scrubbing explícito de PII por nombre de campo real del schema.
- [x] **Resuelto con Alex el 2026-09-15:** la contradicción entre la Sección 6.2 y la Sección 7 de `MVP-DEFINITIVO.md` se resuelve con una tabla nueva `ConexionCadena` (aditiva, sin tocar `conexiones`) — diseño completo de esta tabla y sus relaciones en la Sección 12 (DDD).
- [x] **Diseñar `Consentimiento`** — resuelto en la Sección 18.2.A: dos tablas (`ConsentimientoExpres`, `ConsentimientoCuenta`), append-only garantizado a nivel de permisos de Postgres (`REVOKE UPDATE, DELETE`), estrategia de congelamiento exacta de los booleanos legacy de `EvaluacionExpres` (sin backfill, sin mezclar regímenes).
- [x] **Diseñar versionado nativo en base de datos** — resuelto en la Sección 18.3.A: aggregate `codigo`+`numero`+`estado`, filas hijas inmutables, inmutabilidad garantizada por módulo único de escritura + índice único parcial en Postgres (`WHERE estado = 'PUBLICADA'`).
- [x] **Confirmar aggregate root y política RLS de `Respuesta`** — resuelto en la Sección 18.2.B: aggregate root es `EvaluacionExpresV2`, sin RLS (mismo régimen tenant-nulo que `EvaluacionExpres`), protegida por cascada + `LimiteTasa` + disciplina de nunca exponer un endpoint de lectura directa.
- [x] **Fijar el patrón snapshot-JSON para `Hallazgo`** — resuelto en la Sección 18.2.C: `HallazgoExpres.contextoSnapshot` (solo variables no identificables) separado en una tabla propia, `HallazgoExpresTraza`, de la lista de `respuestaIds` — Investigación (Incremento 6) nunca tiene acceso, ni siquiera por JOIN accidental, a la segunda tabla.
- [ ] **Revisión legal formal (Ley 29733, Perú)** — sigue [HUMANO], no se puede cerrar sin abogado. Checklist concreto y accionable ya preparado en la Sección 18.2.D (4 bloques: registro de banco de datos, transferencia internacional, suficiencia de los 4 textos de consentimiento, validación del umbral de k-anonimato = 20 organizaciones) — antes de abrir el Incremento 2 a tráfico público general.
- [x] **Fijar regla de denormalización de `empresaId`** — resuelto en la Sección 18.1.C: regla formal redactada, lista para `docs/PATRONES.md`.
- [x] **Declarar como estándar oficial** el patrón de transacción manual + `set_config` (`tenantTransaction()`) — resuelto en la Sección 18.3.B: firma de función concreta, tabla de "cuándo usar cada uno", y el cambio previo necesario en `tenantClient.ts` (exportar `TENANT_SCOPED_MODELS`/`injectTenantFilter`).
- [x] **[Ronda 3 — H1, CRÍTICO, ya corregido en este documento]** La tabla de rate limiting anónimo (RF15/RF17) tenía 4 nombres distintos entre Secciones 10/11/12/13/14 (`LimiteTasa`, `LimiteTasaEvaluacion`, `LimiteTasaContador`) y una de las versiones omitía la columna `bucket` que distingue RF15 de RF17. `grep -rn "LimiteTasa" .` contra el repo real confirmó que la tabla no existe aún en código, así que la corrección es de costo cero. Ya unificado en todo el documento como `LimiteTasa` (`huellaOrigenHash`, `bucket`, `ventanaInicio`, `contador`) — ver Sección 12 para el diseño canónico.
- [x] **[Ronda 3 — H2] No existía CI — resuelto y ya aplicado al repo.** `.github/workflows/ci.yml` (lint+typecheck+test en cada push/PR a `main`), `.husky/pre-commit` (lint+typecheck en cada commit) — ver Sección 18.4 para el detalle y la justificación de cada elección.
- [x] **[Ronda 3 — H3] Sin guardas contra mezclar `tenantClient()`/`tenantTransaction()` — resuelto en la Sección 18.3.B**: tabla de "cuándo usar cada uno" + convención de nombre de función (`xxxAtomico`) como heurística barata de revisión, documentada en `docs/PATRONES.md` (ya aplicado al repo, Sección 18.4.C).
- [x] **[Ronda 3 — H4] `ObservacionKpi` sin restricción de idempotencia — resuelto en la Sección 18.3.F**: dos `@@unique` distintos (uno para carga manual/pegada por período, otro para reintentos de importación CSV vía `importId`+`importFilaHash`), listos para la migración del Incremento 4.

## 5. Recomendado, no bloqueante (se resuelve en el incremento correspondiente, no antes)

- [ ] `Nodo.eslabonRefId` opcional (FK nullable) para enlazar con `Eslabón` sin forzar migración ni fusión conceptual.
- [ ] Capa de analítica: vistas/tablas resumen en el mismo Neon (no un warehouse separado — sería sobre-ingeniería para el volumen actual).
- [ ] Reutilizar el patrón `SECURITY DEFINER` (ya usado para `Usuario.email`) para el acceso acotado y cross-tenant del Curador metodológico y, más adelante, de Investigador/Comprador de estadísticas.
- [ ] `eslint-plugin-jsx-a11y` + `@axe-core/playwright` en CI, para WCAG 2.2 AA (Sección 10 de `MVP-DEFINITIVO.md`).
- [ ] Pseudonimización de `RespuestaCruda` con texto libre a 24-36 meses (o antes si hay consentimiento de INVESTIGACION que lo permita de otra forma).
- [ ] Auditar expiración real de tokens de invitación de un solo uso (Incremento 3).
- [ ] CSRF adicional y validación de entrada transversal en los endpoints nuevos.
- [ ] Confirmar `DefinicionKpi` como catálogo de plataforma sin `empresaId` (es contenido compartido, no por tenant) y `ObservacionKpi` como el aggregate tenant-scoped que lo referencia.

## 6. Huecos de cobertura detectados por la auditoría (para revisar antes de dar el plan por cerrado)

La auditoría señaló temas de `MVP-DEFINITIVO.md` que ningún reporte evaluó en profundidad. Se listan aquí para resolverlos a medida que se detalle cada incremento en EARS, no como bloqueo general:

- [ ] RNFs de rendimiento (resultado <2s, consultas <5s) contra la arquitectura serverless real — validar con una prueba de carga simple antes de cerrar el Incremento 2 y el 5.
- [ ] Disponibilidad 99% y prueba de restauración de respaldo en Neon — confirmar que el plan de Neon usado la soporta.
- [ ] Diseño móvil desde 320px y WCAG 2.2 AA a nivel de componentes reales (el tooling ya está listado en la Sección 5; falta la revisión de UI en sí, en su momento).
- [ ] Internacionalización "preparada, no implementada" — definir cómo se modela en BD (texto versionado con locale) cuando se detalle el Incremento 2.
- [ ] Modelo de permisos técnico del actor "Administrador de plataforma" (transversal desde el Incremento 2) — nunca definido en detalle, definirlo junto con el Incremento 2.

## 7. Plan de trabajo por incremento

Cada incremento sigue el mismo procedimiento: (a) redactar el detalle EARS como actualización de `requirements.md`, (b) resolver el diseño de schema pendiente de ese incremento (Sección 4), (c) construir, (d) validar contra Neon real igual que el Incremento 1, (e) marcar las casillas correspondientes en `MVP-DEFINITIVO.md`. Nada se construye sin que Alex confirme el detalle EARS primero, igual que se ha hecho hasta ahora.

### Incremento 2 — Evaluación exprés v2
Depende de: Sección 4 completa (bloqueantes transversales) + Sección 3 (decisión de infraestructura).
- [ ] Redactar detalle EARS (`requirements.md` Sección 4bis).
- [ ] Resolver diseño de `Consentimiento`, `CuestionarioVersion`/`PreguntaVersion`, `Respuesta`, `Hallazgo` (snapshot-JSON).
- [ ] Construir rate limiting real + job de purga.
- [ ] Construir motor de diagnóstico V2 en `src/engine/v2/` (aislado del motor v1).
- [ ] Validar contra Neon real (mismo estándar que Incremento 1).

### Incremento 3 — Mapa y profundidad
Depende de: Incremento 2 cerrado + decisión de `ConexionCadena` (Sección 4) + patrón de transacción atómica declarado.
- [ ] Redactar detalle EARS.
- [ ] Resolver denormalización de `empresaId` para `Cadena`/`Nodo`/`ConexionCadena`/`Flujo`.
- [ ] Instalar `@xyflow/react` para el mapa visual.
- [ ] Añadir `Nodo.eslabonRefId` opcional.
- [ ] Construir y validar.

### Incremento 4 — Indicadores
Depende de: ADR-0004 (jobs + storage) resuelto.
- [ ] Redactar detalle EARS.
- [ ] Instalar PapaParse + sanitizador de fórmulas CSV (función pura en `domain/`).
- [ ] Resolver almacenamiento de objetos (R2/Blob) con URL temporal.
- [ ] Confirmar `DefinicionKpi` sin `empresaId` / `ObservacionKpi` tenant-scoped.
- [ ] Construir y validar (10 KPIs confirmados por Alex).

### Incremento 5 — Consultas en lenguaje natural
Depende de: capa de analítica (vistas materializadas) + adapter de IA aislado.
- [ ] Redactar detalle EARS.
- [ ] Elegir proveedor LLM (Claude API recomendado) + catálogo semántico cerrado validado por Zod.
- [ ] Construir filtro de tenant en la capa determinística (nunca en el prompt).
- [ ] Construir `ConsultaAnalitica` como log append-only.
- [ ] Instrumentar Sentry antes de exponer el endpoint.
- [ ] Construir y validar (incluye prueba de que ningún usuario consulta datos de otro tenant).

### Incremento 6 — Investigación
Depende de: patrón snapshot-JSON de `Hallazgo` + `Consentimiento` append-only, ambos ya resueltos en el Incremento 2.
- [ ] Redactar detalle EARS.
- [ ] Construir camino de acceso separado (no-tenant) para Investigador.
- [ ] Construir k-anonimato/generalización antes de cada `DatasetVersion`.
- [ ] Confirmar que `DatasetVersion`/`DatasetContribution` no tienen FK directa a filas identificables.
- [ ] Construir y validar.

### Incremento 7 — Market Signals (aprobado por Alex el 2026-09-15)
Depende de: Incremento 6 cerrado + gate de privacidad.
- [ ] Redactar detalle EARS.
- [ ] Construir camino de acceso separado para Comprador de estadísticas.
- [ ] Implementar regla de dominancia + agregación por rango + supresión de celdas pequeñas + recómputo dinámico del umbral de 20 organizaciones.
- [ ] Evaluación de impacto de privacidad por segmento (gate obligatorio antes de publicar cada segmento, no una sola vez).
- [ ] Construir y validar.

## 8. Gobernanza de este documento

Este plan no cambia el alcance de `MVP-DEFINITIVO.md` — fija cómo y en qué orden se construye lo ya aprobado. Cambios de alcance siguen requiriendo aprobación explícita de Alex en `MVP-DEFINITIVO.md`. Este documento se actualiza a medida que se resuelven bloqueantes y se cierran incrementos, con el mismo mecanismo de checklist.

## 9. Próximo paso concreto (Ronda 1 — superado por la Sección 16)

Con este plan, el siguiente paso es que Alex confirme la Sección 3 (cola de jobs y storage) y la contradicción de `Conexión` (Sección 4). En cuanto lleguen esas confirmaciones, se redacta el detalle EARS del Incremento 2 como actualización de `requirements.md` Sección 4bis, y recién ahí se toca el schema de Prisma.

*(Estado al 2026-09-15: las tres confirmaciones de arriba ya llegaron. Ver Sección 16 para el próximo paso vigente, que incorpora la Ronda 2 de planes detallados.)*

## 10. Plan detallado — Arquitectura de sistema

Fecha: 2026-09-15
Perspectiva: Arquitectura de sistema. Complementa `PLAN-DE-TRABAJO.md` (que ya resolvió DDD/modelo de datos, seguridad funcional y stack de librerías) con el detalle de **cómo se despliega, escala y opera** cada pieza nueva sobre Vercel + Neon serverless. No reabre decisiones de alcance (`MVP-DEFINITIVO.md` v1.3) ni las 3 decisiones de infraestructura ya confirmadas por Alex (cola Postgres-nativa, Cloudflare R2, `ConexionCadena` como tabla nueva).

### 0. Lo que el repo real confirma (evidencia, no supuestos)

Inspección directa vía `device_bash` sobre `~/Documents/BigDevelopment/Proyectos/ChainPulse`:

- **No existe `vercel.json`** ni carpeta `.vercel/` en el repo — el despliegue en Vercel corre hoy con configuración 100% por defecto (framework preset Next.js), sin `functions.maxDuration`, sin cron jobs, sin regiones fijadas. Esto es una superficie de configuración completa por resolver, no un detalle menor.
- **Prisma corre sin motor Rust** (`engineType = "client"` en `prisma/schema.prisma`, `@prisma/adapter-pg` sobre `pg` puro) — necesario por la incompatibilidad ARM64 ya documentada, pero además es la configuración correcta para runtime serverless (sin binario nativo que empaquetar en cada función).
- **`tenantClient()`** (`src/infra/prisma/tenantClient.ts`) inyecta el filtro de tenant envolviendo cada operación en su propia `prisma.$transaction()` con `set_config('app.tenant_id', ...)` — es decir, **cada llamada a un modelo tenant-scoped abre su propia transacción/conexión**. Esto multiplica el número de round-trips a Postgres por request, relevante para el presupuesto de latencia de RNF3 (dashboard <2s) y RNF de resultado <2s del Incremento 2.
- **Ya hay evidencia empírica de que Neon "duerme"**: el README documenta que `aislamientoMultitenant.integration.test.ts` falló la primera vez por el `maxWait` default de Prisma (2s) siendo insuficiente para despertar la base tras autosuspend, y que se resolvió con más margen y creación secuencial. Esto **no es una hipótesis de este plan, es un incidente real ya ocurrido** contra el mismo Neon que va a servir tráfico público en el Incremento 2.
- **`RATE_LIMIT_STORE_URL`** ya existe en `.env.example` desde el Incremento 1, comentado como "store externo requerido en despliegues serverless... (p. ej. Redis/Upstash)" — pero **nunca se implementó, ni siquiera para el login** (`src/infra/auth/rateLimit.ts` guarda `intentosFallidos`/`bloqueadoHasta` como columnas de `Usuario` vía `tenantClient()`, no en ningún store externo). El proyecto ya evitó Redis una vez usando Postgres; es la señal más fuerte del propio código sobre qué patrón prefiere este proyecto.
- **`prisma/schema.prisma` documenta el bug P3014** (Neon no da `CREATEDB` a ningún rol) — cualquier objeto nuevo a nivel de base de datos (tablas de `pg-boss`, funciones `SECURITY DEFINER`, RLS de tablas nuevas) va a tropezar con el mismo patrón de permisos y va a necesitar el rol `neondb_owner`, nunca `chainpulse_app`.
- **`src/middleware.ts` corre en Edge runtime** y ya tuvo que separarse de `src/auth.ts` (Node runtime) porque Argon2/Postgres no cargan en Edge — cualquier pieza nueva que dependa de un cliente de R2 (SDK de AWS S3) o de un cliente de `pg-boss` tiene la misma restricción: no puede vivir en código que el Edge runtime ejecute.
- **No hay ninguna pieza de observabilidad** (`grep` no encuentra Sentry, pino, ni ningún logger estructurado en `src/`) — confirma el hallazgo de `PLAN-DE-TRABAJO.md`.

---

### Decisión de arquitectura no resuelta y previa a todo lo demás: dónde vive el worker de `pg-boss`

Esta es la pieza que `PLAN-DE-TRABAJO.md` deja pendiente al decir "cola Postgres-nativa" sin decir *quién la consume*. Vercel Functions son invocaciones por request con timeout duro (10s en Hobby; hasta 300s configurable en Pro con Fluid Compute) y sin proceso persistente entre invocaciones — el modelo estándar de `pg-boss` (`boss.work(queue, handler)`, una suscripción de larga duración con `LISTEN/NOTIFY`) **no puede correr así**.

**Dos formas reales de resolverlo, con trade-offs concretos:**

**Opción A — Polling por lotes disparado por Vercel Cron (recomendada como default).**
Un Route Handler (`/api/internal/jobs/run`) hace, en cada invocación: `boss.fetch(queue, batchSize)` (no `boss.work()`), procesa cada job con un presupuesto de tiempo que deja margen bajo `maxDuration`, marca `complete()`/`fail()` y retorna. Un Vercel Cron Job lo invoca cada minuto (mínimo soportado; requiere plan Pro — Hobby limita a 2 crons con cadencia diaria, insuficiente). Mantiene todo en un solo despliegue, coherente con la filosofía de ADR-0001 ("un desarrollador solo"). Latencia de job: hasta ~60-90s, aceptable para purga de `huellaOrigen`, importación CSV, anonimización, agregados de Market Signals — ninguno de estos exige tiempo real.
Requisito técnico no trivial: `pg-boss` en modo *fetch* no necesita mantener la conexión `LISTEN` abierta, así que puede usar el **endpoint pooled de Neon** (`-pooler` en el host) igual que el resto de la app — evita agotar el límite de conexiones directas de Neon bajo invocaciones concurrentes.

**Opción B — Proceso worker externo persistente.**
Un proceso Node pequeño (`boss.start()` + `boss.work()`) desplegado en un host aparte siempre encendido (Railway, Fly.io, Render) que sí mantiene la conexión `LISTEN/NOTIFY` y procesa en tiempo real. Da latencia sub-segundo, pero **introduce un segundo despliegue, una segunda superficie de secretos (`DATABASE_URL`) y un segundo objetivo de observabilidad** — contradice el criterio de "bajo mantenimiento para un desarrollador solo" que ya guió ADR-0001 a descartar la Opción B (backend separado) para el monolito principal.

**Recomendación:** empezar con la Opción A (Vercel Cron + fetch por lotes) para todos los jobs de los Incrementos 2, 4 y 6. Revaluar la Opción B únicamente si aparece un job con requisito real de latencia sub-minuto que el polling no pueda cumplir — mismo criterio de "no invertir en la etapa siguiente hasta que el trigger ocurra de verdad" que ya usa ADR-0001 para la ruta de crecimiento del multi-tenant.

- [ ] **Confirmar con Alex:** Opción A (Vercel Cron + polling por lotes, requiere plan Vercel Pro) como mecanismo por defecto, documentado como ADR-0004.
- [ ] Instalar `pg-boss`, ejecutar su migración de esquema interno (`CREATE SCHEMA pgboss...`) con el rol `neondb_owner` (mismo patrón que `shadowDatabaseUrl`), nunca con `chainpulse_app`.
- [ ] Crear `src/infra/jobs/boss.ts` — instancia singleton de `PgBoss` reutilizada entre invocaciones warm (mismo patrón `globalForPrisma` de `src/infra/prisma/client.ts`), conectada al endpoint **pooled** de Neon, con `LISTEN/NOTIFY` explícitamente deshabilitado (`noSupervisor: true` / usar solo `send()`+`fetch()`, nunca `work()`).
- [ ] Crear `/api/internal/jobs/run` (Route Handler, Node runtime, protegido por un secreto compartido con el Cron, nunca público) que hace `fetch()` de un lote acotado, procesa con presupuesto de tiempo, y responde antes de `maxDuration`.
- [ ] Configurar Vercel Cron (`vercel.json` nuevo — primer archivo de configuración de despliegue explícito del proyecto) apuntando a `/api/internal/jobs/run` cada 1 minuto.
- [ ] Definir `maxDuration` explícito por ruta en `vercel.json`/`route.ts` (`export const maxDuration = ...`) — hoy no existe ninguno, todo corre con el default implícito.
- [ ] Verificar el plan de Vercel activo hoy (Hobby vs. Pro) — la cadencia de 1 minuto de Cron y `maxDuration` >10s **requieren Pro**. Si el proyecto sigue en Hobby, esto es un bloqueante de infraestructura antes de construir nada de jobs.

**Riesgo:** si Alex prefiere no subir a Vercel Pro, la Opción A deja de ser viable con cadencia de 1 minuto (Hobby solo permite cron diario) y hay que reabrir esta decisión hacia la Opción B. Marcar como dependencia explícita del resto del plan.

---

### Incremento 2 — Evaluación exprés v2

Depende de: decisión de worker de jobs (arriba) resuelta y `pg-boss` instalado — el job de purga de `huellaOrigen` a 48-72h (`RF15/RF17`, ya vencido según `PLAN-DE-TRABAJO.md`) es exactamente el primer caso de uso de la cola, así que **no puede posponerse al Incremento 4** como sugiere la agrupación original; debe estar listo antes de abrir este incremento a tráfico real.

**Tareas — infraestructura transversal que este incremento activa por primera vez:**
- [x] Job `purgarHuellasOrigen` (`src/infra/retencion.ts`) — **construido 2026-09-16, Bloque A del Incremento 2** — purga `huellaOrigen`/`huellaOrigenPurgadaEn` de `EvaluacionExpres` a las 48h (peor caso real ~96h con cadencia diaria de Vercel Hobby Cron, ver ADR-0004). Disparado por `src/app/api/internal/jobs/run` (Vercel Cron diario + GitHub Actions cada 15min de respaldo), no por un Cron horario propio como se planteaba aquí originalmente. Con pruebas unitarias verdes (`src/infra/__tests__/retencion.test.ts`) y **validado en Windows contra Neon real el 2026-09-16**: `npm run jobs:bootstrap`, `prisma:generate`, `typecheck`, `lint`, `test` (66/66) y `test:integration` (24/24) todos en verde.
- [x] **Rate limiting real, Postgres-nativo, no Redis** — **construido 2026-09-16, Bloque A del Incremento 2**: tabla `LimiteTasa` (`prisma/schema.prisma`), UPSERT atómico (`src/infra/rateLimit/limiteTasa.ts`, función `registrarIntento`). Diferencia con el diseño original de esta línea: se implementó con **ventana fija por hora** (`ventanaInicio` truncado al inicio de la hora UTC), no ventana deslizante — decisión documentada en el comentario de cabecera de `limiteTasa.ts` (alcanza el propósito de RF15/RF17 sin estado en memoria del proceso). Cubre los dos límites independientes (RF15/RF17) vía el enum `BucketLimiteTasa`. La ruta pública que efectivamente llama a `registrarIntento()` en `POST /api/public/evaluations` y en el endpoint de desbloqueo **todavía no existe** — eso es scope de RF19-26/motor v2, fuera de este Bloque A.
  - [x] Decisión técnica confirmada — **tabla Postgres dedicada** (`LimiteTasa`), sin Redis/Upstash. Implementada como tal el 2026-09-16 (Bloque A del Incremento 2), con el go-ahead explícito de Alex para ese bloque.
- [ ] Observabilidad mínima (Sentry + Next.js, integración oficial de Vercel; logging estructurado con scrubbing explícito de `correo`/`telefono`/`nombreCompleto`/`huellaOrigen`) — bloqueante antes de exponer `/api/public/evaluations/*` a tráfico anónimo de internet, tal como ya señaló `PLAN-DE-TRABAJO.md`.
- [ ] Revisar el plan de Neon activo y **desactivar o extender el autosuspend** en la rama de producción, o agregar un ping de mantenimiento (Cron cada 4-5 min hacia una ruta trivial) — sin esto, el primer visitante tras un período de inactividad puede exceder el RNF de "<2s tras completar las 7 preguntas" solo por el cold-start de cómputo de Neon (ya observado en los tests de integración). Confirmar también si el plan de Neon tiene SLA contractual (los planes gratuitos/Launch no lo tienen) — condición para el objetivo de disponibilidad 99% (ver Sección de NFRs más abajo).
- [x] Confirmar que `DATABASE_URL` de producción apunta al **endpoint pooled** de Neon (host con sufijo `-pooler`) — **confirmado 2026-09-16**: la variable cargada en Vercel usa el connection string pooled (rol `chainpulse_app`, host con sufijo `-pooler`), obtenido desde el panel "Connect" de Neon con el toggle "Pooled connection" activado.
- [x] **Primer despliegue real en Vercel — completado 2026-09-16.** Al revisar este mismo punto se descubrió que ChainPulse nunca había sido desplegado en Vercel (todas las validaciones previas eran locales contra Neon). Se agregó `"postinstall": "prisma generate"` a `package.json` (commit `f7d51b1`, imprescindible para que el build de Vercel genere el cliente de Prisma), se importó `alexhsantamaria/ChainPulse` como proyecto nuevo (equipo `alex-2477`, plan Hobby, proyecto `chain-pulse`) con las 12 variables de entorno cargadas (las 11 detectadas más `NEXTAUTH_URL`, completada después de conocer el dominio asignado `chain-pulse-steel.vercel.app`), y se agregaron los secretos `APP_BASE_URL`/`CRON_SECRET` en GitHub Actions para el workflow de respaldo. Build en verde; verificado en el navegador que `/login` renderiza correctamente contra la base de Neon real en producción. El Vercel Cron diario de `vercel.json` (ya existente desde Bloque A) queda operativo desde este despliegue.

**Tareas — motor y endpoints de V2:**
- [ ] Construir `src/engine/v2/` (función pura versionada, mismo patrón que `src/engine/`) — dimensiones Alineación/Coordinación/Integración/Evidencia/Resiliencia, `diagnosticRuleVersion = "v2-preliminary"`, sin tocar `src/engine/` v1.
- [ ] Endpoints `POST /api/public/evaluations`, `POST .../answers`, `POST .../complete`, `GET .../result` — cada uno debe declarar `maxDuration` explícito y correr en Node runtime (Prisma no corre en Edge).
- [ ] `Consentimiento` (append-only, 4 finalidades), `CuestionarioVersion`/`PreguntaVersion`, `Respuesta`, `Hallazgo` (snapshot-JSON) — diseño ya resuelto en `PLAN-DE-TRABAJO.md` Sección 4; aquí solo aplica el patrón transversal: cada tabla nueva sin `empresaId` propio sigue el mismo patrón de `EvaluacionExpres` (tenant nulo explícito en RLS), y cada migración de schema se corre con `neondb_owner`.
- [ ] Prueba de carga simple (k6/autocannon) contra `POST .../complete` → `GET .../result` para validar el RNF de <2s **bajo el runtime real** (función fría y caliente), no solo en local — este es el hueco de cobertura que la auditoría del plan anterior dejó pendiente de validar.

**Decisiones técnicas no resueltas (además de la de rate limiting):**
- [ ] ¿El Cron de purga corre cada hora o cada 15 min? Afecta cuán ajustado queda el plazo de 48-72h frente al costo de invocaciones extra.
- [ ] ¿Se sube a Vercel Pro ahora (necesario para Cron de 1 min y `maxDuration` >10s) o se difiere hasta el Incremento 4? Recomendación: subir ahora, porque el job de purga y el rate limiter ya lo necesitan.

**Riesgos:**
- Cold start de Neon + función serverless en cadena puede violar el RNF de <2s en el primer request tras inactividad — mitigar con ping de mantenimiento, pero eso tiene costo de cómputo continuo en Neon (trade-off a decidir con Alex, no solo técnico).
- Rate limiter Postgres bajo alta concurrencia real (picos virales) compite por las mismas conexiones pooled que el resto de la app — vigilar el límite de conexiones del plan Neon activo.

---

### Incremento 3 — Mapa y profundidad

Depende de: Incremento 2 cerrado; `ConexionCadena` ya confirmada como tabla nueva aditiva (no reabrir).

**Tareas:**
- [ ] Migración `Cadena`/`Nodo`/`ConexionCadena`/`Flujo` — correr con `neondb_owner` (patrón P3014 ya documentado), agregar las 4 tablas a `TENANT_SCOPED_MODELS` en `tenantClient.ts` y sus políticas RLS correspondientes en `prisma/rls.sql`.
- [ ] Declarar y aplicar el patrón de **transacción manual + `set_config`** (ya usado en `registrarEmpresaYAdmin()`) como estándar oficial para crear `Cadena`+`Nodo`(s)+`ConexionCadena`(s) en una sola operación atómica — `tenantClient()` por sí solo no da atomicidad multi-modelo (cada llamada abre su propia transacción individual, ver Sección 0). Sin esto, un fallo a mitad de creación del mapa deja nodos huérfanos.
- [ ] Instalar `@xyflow/react` (React Flow) — corre 100% en cliente, sin implicancia de runtime serverless; verificar tamaño de bundle contra el budget de performance del dashboard (RNF3, <2s).
- [ ] `Nodo.eslabonRefId` opcional (FK nullable), sin migrar datos históricos.
- [ ] Token de invitación de un solo propósito — reutiliza el mecanismo JWT ya usado en `invitacion.ts`/`recuperacion.ts` (sin tabla nueva), mismo patrón, no requiere infraestructura adicional.
- [ ] Endpoints `POST /api/chains`, `.../nodes`, `.../connections`, `.../invitations`, `GET .../comparison` — `maxDuration` por defecto alcanza aquí (operaciones CRUD simples), sin necesidad de cola de jobs.

**Decisión técnica no resuelta:**
- [ ] Confirmar regla de denormalización de `empresaId` en las 4 tablas nuevas (recomendado: sí, columna propia + índice, igual que `Eslabon`/`Conexion`) — ya señalada como pendiente en `PLAN-DE-TRABAJO.md`, se resuelve aquí antes de escribir la migración.

**Riesgos:**
- Ninguno nuevo de arquitectura de despliegue; el riesgo principal de este incremento es de modelo de datos (ya cubierto por el reporte DDD), no de infraestructura.

---

### Incremento 4 — Indicadores

Depende de: ADR-0004 (worker de jobs) resuelto y operativo (Incremento 2); **Cloudflare R2 configurado** (nuevo, se construye aquí por primera vez).

#### Setup concreto de Cloudflare R2

- [ ] Crear bucket `chainpulse-imports` (o `chainpulse-uploads` genérico reutilizable también para exportaciones de investigación del Incremento 6) en la cuenta de Cloudflare, región automática.
- [ ] Generar un API Token de R2 con scope de cuenta (Access Key ID/Secret Access Key, compatibles S3) — **guardarlo solo como variable de entorno de Vercel** (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`), nunca expuesto al cliente.
- [ ] Instalar `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2 es S3-compatible; no hace falta un SDK propio de Cloudflare).
- [ ] Definir el esquema de claves de objeto por tenant: `empresas/{empresaId}/imports/{importId}/{filename}` — el aislamiento por tenant en R2 **se aplica a nivel de aplicación**, no de política de bucket: el servidor es el único que firma URLs, y solo firma claves bajo el prefijo del `empresaId` de la sesión activa. R2 no tiene políticas IAM por-prefijo equivalentes a S3 de forma nativa y sencilla — confiar en eso sería una falsa sensación de aislamiento; el control real es "el servidor nunca firma una clave fuera del prefijo del tenant que hace la solicitud", verificado con una prueba de integración dedicada (mismo criterio que RNF1 para el resto del sistema).
- [ ] Endpoint `POST /api/chains/:id/imports/presign` — genera una URL PUT firmada (TTL corto, 5-10 min), con `Content-Type` y tamaño máximo restringidos en la política de firma, para que el navegador suba el CSV **directo a R2**, evitando el límite de tamaño de body de las Route Handlers de Vercel (4.5MB en Hobby; sigue siendo restrictivo incluso en Pro para un CSV grande).
- [ ] URLs de descarga: GET firmadas con TTL corto, generadas bajo demanda, nunca URLs públicas permanentes del bucket.
- [ ] Regla de ciclo de vida (lifecycle rule) en el bucket: expirar automáticamente objetos de `imports/` sin persistir a los N días (a definir con la política de retención pendiente de `MVP-DEFINITIVO.md` Sección 9) — evita acumular CSVs abandonados indefinidamente.
- [ ] CORS del bucket: permitir `PUT` desde el dominio de producción de Vercel (y `localhost` en desarrollo) únicamente.

#### Resto de tareas del incremento

- [ ] Instalar PapaParse + sanitizador de fórmulas CSV (función pura en `domain/`, mitiga inyección de fórmulas tipo Excel) — corre **después** de que el archivo ya está en R2, nunca antes de mostrar filas/errores/mapeo al usuario (regla dura ya fijada en `MVP-DEFINITIVO.md`).
- [ ] Job `procesarImportacionCsv` encolado vía `pg-boss` — descarga el objeto de R2, parsea, valida, y solo persiste tras confirmación explícita del usuario (segundo paso, otro job o la misma Route Handler si el volumen es chico). Debe ir por cola, no ejecutarse síncronamente en la Route Handler que recibe el "confirmar importación": un CSV grande puede exceder cualquier `maxDuration` razonable.
- [ ] Endpoint de estado de importación (`GET /api/chains/:id/imports/:importId`) para que el cliente haga *polling* del resultado del job — patrón obligatorio dado que el procesamiento es asíncrono.
- [ ] `DefinicionKpi` (catálogo de plataforma, sin `empresaId`) / `ObservacionKpi` (tenant-scoped) — confirmar el patrón sin `empresaId` antes de migrar.
- [ ] Endpoints `GET /api/kpis/definitions`, `POST .../kpi-observations`, `POST .../imports`.

**Riesgos:**
- Si el volumen de CSV es mayor al esperado, un solo job puede exceder el `maxDuration` del worker de jobs (Opción A del ADR-0004) — mitigar con procesamiento por lotes dentro del job (leer N filas, hacer `checkpoint`, reencolarse) desde el diseño inicial, no como parche posterior.
- Idempotencia de importación (NFR ya listado en `MVP-DEFINITIVO.md`) exige que reintentar un job fallido de `pg-boss` no duplique filas — usar una clave de idempotencia (`importId` + hash de fila) en la restricción única de `ObservacionKpi`.

---

### Incremento 5 — Consultas en lenguaje natural

Depende de: capa de analítica (vistas/tablas derivadas) construida; Incremento 4 cerrado (KPIs con datos reales para consultar).

**Tareas:**
- [ ] Capa de analítica: vistas materializadas en el mismo Neon (decisión ya recomendada como no-bloqueante en `PLAN-DE-TRABAJO.md` — sin warehouse separado). Refresco de las vistas materializadas vía el mismo mecanismo de jobs (`pg-boss` + Cron), no en cada consulta.
- [ ] Adapter de IA aislado (`src/infra/ia/`) — proveedor Claude API (recomendado, consistente con el resto del entorno de trabajo), nunca acoplado a `domain/`/`engine/`.
- [ ] Catálogo semántico cerrado validado con Zod — el modelo de lenguaje elige de un enum fijo de KPIs/dimensiones, nunca genera SQL libre (principio 10, ya adoptado).
- [ ] Filtro de tenant, permisos y periodo aplicado en la **capa determinística de construcción de consulta**, nunca en el prompt — auditar con una prueba específica de "ningún usuario consulta datos de otro tenant" (criterio de aceptación ya definido en V2).
- [ ] `ConsultaAnalitica` como log append-only (auditoría de cada consulta ejecutada).
- [ ] Endpoint `POST /api/chains/:id/queries`.

**Gap de arquitectura serverless vs. NFR "<5 segundos" (a resolver explícitamente, no asumir):**
El contrato de respuesta de V2 (§12.3) exige 10 elementos, incluida una interpretación generada — esto implica, como mínimo, un flujo de: (1) clasificación de intención (llamada LLM), (2) construcción y ejecución de consulta determinística contra Postgres, (3) generación de explicación (segunda llamada LLM). Dos round-trips a un LLM en serie son el riesgo dominante para el presupuesto de 5s, no la consulta SQL en sí.
- [ ] Definir presupuesto de latencia por etapa (p. ej. clasificación ≤1s, query ≤1s, explicación ≤2.5s, margen ≤0.5s) y elegir modelos/tamaños de contexto acordes — no un modelo grande para ambas llamadas por defecto.
- [ ] Configurar `maxDuration` explícito en la Route Handler de consultas (requiere Vercel Pro para superar 10s con margen de seguridad real).
- [ ] Prueba de carga simple específica para este endpoint antes de cerrar el incremento (hueco de cobertura ya señalado por la auditoría anterior).
- [ ] Caso "no puedo responder todavía": debe resolverse **antes** de invocar el LLM de explicación (si la query determinística no tiene datos suficientes, cortar el flujo ahí) — evita gastar el presupuesto de latencia en una llamada innecesaria.
- [ ] Instrumentar Sentry/logging específico para este endpoint antes de exponerlo (ya construido para el Incremento 2, se extiende aquí).

**Riesgos:**
- Costo variable e impredecible de llamadas LLM por consulta — no es un riesgo de arquitectura de sistema per se, pero si no se limitan filas/tokens por consulta (ya listado como requisito en V2 §12.2), puede degradar tanto costo como latencia simultáneamente.

---

### Incremento 6 — Investigación

Depende de: patrón snapshot-JSON de `Hallazgo` y `Consentimiento` append-only (ya resueltos en Incremento 2); worker de jobs operativo.

**Tareas:**
- [ ] Camino de acceso separado (no-tenant) para el actor Investigador — nueva capa de autorización distinta de `tenantClient()`, análoga al patrón `SECURITY DEFINER` ya usado para `Usuario.email` (recomendación no-bloqueante de `PLAN-DE-TRABAJO.md`).
- [ ] k-anonimato/generalización **como job en cola**, no como cálculo síncrono — construir un `DatasetVersion` sobre el dataset completo de evaluaciones puede recorrer toda la tabla y exceder cualquier `maxDuration` de función serverless; debe ser un job de `pg-boss` con checkpointing, igual que la importación CSV del Incremento 4.
- [ ] Exportación CSV/JSON de datasets: generar el archivo como job, subirlo a R2 (mismo bucket/patrón del Incremento 4, prefijo `research/exports/{datasetVersion}/`), y entregar solo una URL firmada de descarga — nunca servir el archivo completo desde una Route Handler (mismo límite de tamaño de respuesta que el de subida).
- [ ] `DatasetVersion`/`DatasetContribution` sin FK directa a filas identificables — confirmar el diseño ya señalado en `PLAN-DE-TRABAJO.md`.
- [ ] Auditoría de acceso a datos de investigación (tabla append-only, reutilizando el mismo patrón de `ConsultaAnalitica`).
- [ ] Endpoints `POST /api/question-suggestions`, `POST /api/consents`, `POST /api/follow-ups`, `GET /api/research/datasets/:version`, `POST /api/research/exports`.
- [ ] **Gate de acceso a `HallazgoExpres` (R5-3, Ronda 5 de revisión — ver el comentario largo sobre `evaluacionExpresV2Id` en `prisma/schema.prisma`, modelo `HallazgoExpres`):** `HallazgoExpres.evaluacionExpresV2Id` es un FK real hacia `EvaluacionExpresV2` (necesario para que el propio visitante vea su resultado detallado, RF22) — esa tabla puede tener `correo`/`nombreCompleto`/`telefono` si `detalleDesbloqueado=true`. Quitar el FK no reduce el riesgo (el mismo JOIN por id funciona igual a nivel de aplicación); el gate real es de **permisos de Postgres**, no de schema: la función `SECURITY DEFINER` de agregación de este incremento tiene que exponer solo `contextoSnapshot` + los campos no identificables ya documentados en el modelo, **sin `GRANT SELECT` sobre `evaluaciones_expres_v2`** para el rol que la ejecuta — mismo criterio ya aplicado a `hallazgos_expres_traza` (Sección 18.2.C), extendido explícitamente a esta relación. Bloqueante antes de dar por cerrado el camino de acceso del Investigador (primera tarea de esta lista).

**Riesgos:**
- Un job de anonimización sobre un dataset que crece cada ciclo puede volverse cada vez más largo — vigilar desde el diseño si necesita procesamiento incremental (solo lo nuevo desde la última `DatasetVersion`) en vez de recomputar todo cada vez, antes de que se vuelva un problema de escala real.

---

### Incremento 7 — Market Signals (aprobado, gate de privacidad obligatorio)

Depende de: Incremento 6 cerrado (mismo camino de acceso no-tenant y patrón de jobs); evaluación de impacto de privacidad y revisión legal por jurisdicción **antes de publicar cada segmento**, no una sola vez.

**Tareas:**
- [ ] Camino de acceso separado para el actor Comprador de estadísticas — mismo patrón que Investigador, permisos distintos.
- [ ] Job de agregación (`pg-boss`, recomputado periódicamente vía Cron, no on-demand por cada consulta pública) que calcula: regla de dominancia, agregación por rango, supresión de celdas pequeñas, y **recómputo dinámico del umbral de 20 organizaciones** — un cálculo caro sobre todo el dataset relevante, mismo motivo que en el Incremento 6 debe ir en cola, no en una Route Handler síncrona.
- [ ] Pipeline en dos etapas: el job escribe a una tabla/vista de **staging** (no publicada); un paso de revisión de privacidad (evaluación de impacto por segmento, gate ya definido en `MVP-DEFINITIVO.md` Sección 9) aprueba explícitamente antes de que el segmento pase a la vista pública que sirve `GET /api/market-signals`. Este gate es un paso humano, no se automatiza — la arquitectura solo necesita dejar un estado intermedio (`PENDIENTE_REVISION` / `PUBLICADO`) para que ese paso exista.
- [ ] Endpoint `GET /api/market-signals` — solo lee de la vista ya aprobada, nunca de la tabla de staging.
- [ ] Nunca exponer respuestas individuales/texto libre/PII ni combinaciones re-identificables — validar con una prueba de re-identificación básica (no solo revisión manual) antes de marcar el incremento como cerrado.

**Riesgos:**
- El umbral de 20 organizaciones "dinámico" implica que un segmento publicado puede dejar de cumplir el umbral si organizaciones se dan de baja o retiran consentimiento — el job de recómputo periódico debe poder **despublicar** un segmento automáticamente, no solo publicar; si esto no se diseña desde el inicio, es un gap de cumplimiento, no solo de producto.

---

### Requisitos no funcionales declarados vs. arquitectura serverless real — resumen de gaps y cierre

| RNF (`MVP-DEFINITIVO.md` Sección 10) | Gap real identificado | Cómo se cierra |
|---|---|---|
| Resultado inicial <2s (Incremento 2) | Cold start de función Vercel + autosuspend de Neon (ya observado empíricamente en tests de integración) + `tenantClient()` abre una transacción por operación | Ping de mantenimiento / plan Neon sin autosuspend agresivo en producción; endpoint pooled; prueba de carga real antes de cerrar el incremento |
| Consultas <5s (Incremento 5) | Dos llamadas LLM en serie dentro de una función con `maxDuration` limitado | Presupuesto de latencia por etapa, `maxDuration` explícito, corte temprano en "sin datos suficientes" antes de gastar la llamada de explicación |
| Disponibilidad 99% | Neon es un compute único por región (São Paulo); planes gratuitos/Launch no tienen SLA contractual | Confirmar plan de Neon con SLA antes de tráfico público general; documentar que Vercel + Neon sin plan pago no puede prometer 99% con respaldo contractual |
| Backups y prueba de restauración | Point-in-time recovery de Neon tiene ventana de retención según plan; nunca se probó una restauración real | Ejecutar y documentar un ejercicio de restauración real contra una rama de Neon antes de dar el Incremento 2 por cerrado; considerar export periódico a R2 para retención más allá de la ventana de PITR, dado que el mismo bucket ya existe desde el Incremento 4 |
| Importación idempotente (CSV, Incremento 4) | Reintentos de `pg-boss` pueden duplicar filas si no hay clave de idempotencia | Restricción única por `importId` + hash de fila en `ObservacionKpi` |
| Toda operación sensible auditable | No hay logging estructurado hoy | Observabilidad mínima (Sentry + logs estructurados) antes del Incremento 2 público, extendida a cada incremento nuevo |

---

### Orden recomendado de ejecución (arquitectura)

1. **Sprint de infraestructura transversal** (antes de que el Incremento 2 reciba tráfico público, en paralelo a redactar el detalle EARS del Incremento 2):
   - ADR-0004: confirmar Opción A (Vercel Cron + polling por lotes) vs. Opción B (worker externo) para `pg-boss`; confirmar plan de Vercel (Pro necesario para Cron de 1 min y `maxDuration` extendido).
   - Instalar `pg-boss` (esquema vía `neondb_owner`), crear el runner de jobs y el primer Cron.
   - Construir el job de purga de `huellaOrigen` (deuda ya vencida del Incremento 1).
   - Rate limiting Postgres-nativo para la evaluación pública (RF15/RF17) — decisión a confirmar: tabla propia vs. Upstash.
   - Observabilidad mínima (Sentry + logging estructurado con scrubbing de PII).
   - Revisar plan de Neon (autosuspend, SLA, pooler) y confirmar `DATABASE_URL` de producción sobre el endpoint pooled.
   - Revisión legal Ley 29733 (gate ya identificado, no técnico pero bloquea el mismo lanzamiento).
2. **Incremento 2** — construye sobre la infraestructura anterior; sin esto, no puede abrirse a tráfico público de forma segura ni cumplir sus propios RNF.
3. **Incremento 3** — solo necesita el patrón de transacción atómica (independiente de jobs/R2); puede avanzar en paralelo al cierre del punto 1 si Alex lo prioriza, ya que no depende de la cola de jobs.
4. **Setup de Cloudflare R2** — antes de empezar el Incremento 4 en serio (bucket, credenciales, presigned URLs, CORS, lifecycle rules). Puede adelantarse durante el Incremento 3 sin riesgo, dado que no depende de nada de ese incremento.
5. **Incremento 4** — depende de R2 (punto 4) y de la cola de jobs (punto 1) para el procesamiento asíncrono de CSV.
6. **Capa de analítica (vistas materializadas)** — antes de empezar el Incremento 5, refrescada vía el mismo mecanismo de Cron/jobs ya construido.
7. **Incremento 5** — depende del punto 6 y de definir el presupuesto de latencia LLM.
8. **Incremento 6** — reutiliza jobs (punto 1) y R2 (punto 4) para anonimización y exportaciones; ningún setup nuevo de infraestructura, solo de dominio/DDD (ya resuelto en `PLAN-DE-TRABAJO.md`).
9. **Incremento 7** — depende del pipeline de jobs con estado staging/publicado (patrón nuevo, construido específicamente aquí) y del gate de privacidad humano; es el único incremento donde la arquitectura debe modelar explícitamente un paso de aprobación manual antes de publicar datos.

La única decisión de arquitectura que, si se pospone, bloquea en cascada casi todo lo demás es la del punto 1 (dónde vive el worker de `pg-boss`) — todos los incrementos desde el 2 en adelante dependen de tener una cola de jobs realmente operativa en el runtime serverless real, no solo la librería elegida.

## 11. Plan detallado — Herramientas y stack

Fecha: 2026-09-15. Perspectiva: herramientas/stack, un nivel más profundo que `PLAN-DE-TRABAJO.md`. Convenciones verificadas en el repo real que este plan respeta en cada tarea: `domain/` sin Prisma/Next (funciones y tipos puros, ver `src/domain/types.ts`), `engine/` funciones puras versionadas con `RULE_VERSION` centralizado en `constantes.ts` (`src/engine/constantes.ts`) y reexportadas desde un barrel `index.ts`, `infra/<área>/` con `__tests__/` colateral, rutas en `src/app/api/**/route.ts` que llaman a `infra/` y devuelven `{ ok, error }` con status HTTP explícito, `tenantClient()` + `TENANT_SCOPED_MODELS` (`src/infra/prisma/tenantClient.ts`) para RLS de capa 1, políticas SQL a mano en `prisma/rls.sql`/`prisma/auth_functions.sql` aplicadas manualmente en el SQL Editor de Neon, y el patrón de transacción manual + `set_config` (`registrarEmpresaYAdmin()` en `src/infra/auth/registro.ts`) para escrituras atómicas multi-modelo, ya que `tenantClient()` no da atomicidad entre operaciones.

Tres restricciones de entorno **ya documentadas en el propio README** que condicionan casi todas las tareas de instalación de abajo, y que no son genéricas sino un hallazgo real de este repo:

1. **`binaries.prisma.sh` está bloqueado en las sesiones de Claude** (403 `blocked-by-allowlist`) — `prisma generate`/`migrate`/`build`/`test:integration` solo corren desde la PC Windows de Alex, fuera de cualquier sesión de Claude. Cualquier paquete nuevo cuyo `postinstall` descargue un binario desde un CDN propio (no el registro de npm) tiene el mismo riesgo y debe asumirse "solo instalable/verificable en Windows" hasta probar lo contrario.
2. **El Edge runtime no soporta el driver de Postgres** (`middleware.ts` usa `auth.config.ts`, no `auth.ts`, precisamente por esto). Cualquier herramienta nueva que tape la base de datos, cole trabajos o haga tracing con acceso a Postgres debe vivir en rutas Node (`route.ts` normal), nunca en `middleware.ts`.
3. **`engineType = "client"` (sin motor Rust nativo)**, adoptado por incompatibilidad de Windows ARM64. No es un riesgo para las herramientas de este plan (todas son JS puro o hablan por HTTP/REST), pero sí es la razón por la que este plan evita cualquier librería con binario nativo evitable (ver Incremento 2 y transversales, Sentry/Playwright).

---

### Incremento 2 — Evaluación exprés v2

Esta es la primera vez que el sistema expone una superficie pública nueva a tráfico real (7 preguntas, sin cuenta). Por eso **toda la observabilidad transversal entra aquí, al principio, no al final** — coincide con lo que ya pide `PLAN-DE-TRABAJO.md` Sección 4 ("Observabilidad mínima... antes de exponer el motor V2 a tráfico público").

#### Sentry (`@sentry/nextjs`) con scrubbing de PII

- [ ] Instalar `@sentry/nextjs` (paquete JS puro para el SDK base — **no instalar `@sentry/profiling-node`**, que trae un addon nativo prebuild descargado por CDN propio, mismo patrón de riesgo que `binaries.prisma.sh`; no hace falta profiling para un servicio de este tamaño).
- [ ] Configurar manualmente (`sentry.server.config.ts`, `sentry.client.config.ts`, `instrumentation.ts` de Next 15) en vez de correr `npx @sentry/wizard`: el wizard es interactivo, pide login/selección de proyecto contra sentry.io y edita archivos automáticamente — mala idea en una sesión sin terminal interactiva y con el mismo riesgo de red que Prisma. Verificar primero si `sentry.io`/`*.ingest.sentry.io` están en el allowlist del proxy de la sesión (`$HTTPS_PROXY/__agentproxy/status`) antes de asumir que el `npm install` en sí funciona.
- [ ] `sendDefaultPii: false` explícito — Sentry por defecto adjunta el body del request a los eventos de error; sin esto, un error en `POST /api/public/evaluations` filtraría `correo`, `telefono`, `nombreCompleto` (campos reales de `EvaluacionExpres`) a Sentry.
- [ ] `beforeSend`/`beforeSendTransaction` que scrubbee explícitamente: `correo`, `telefono`, `nombreCompleto`, `empresaNombre`, `huellaOrigen`, `descripcionLibre` (los mismos campos que `EvaluacionExpresConexion`/`EvaluacionExpres` ya marcan como sensibles en el schema) — nunca depender solo del scrubbing genérico por nombre de campo de Sentry, listar los campos reales del modelo.
- [ ] Integrar en `withSentryConfig(nextConfig)` sobre `next.config.ts` (hoy solo tiene `reactStrictMode: true` — cambio mínimo y localizado).
- [ ] Wrappear los `route.ts` nuevos del Incremento 2 (`api/public/evaluations/**`) con `Sentry.withServerActionInstrumentation` o el patrón de captura ya usado (`catch (err) { console.error(err); ... }` en `src/app/api/ciclos/route.ts` y hermanos) — reemplazar ese `console.error(err)` por `Sentry.captureException(err)` en las rutas nuevas primero, migrar las rutas del Incremento 1 después, no en el mismo commit.
- **Testeo:** una prueba de humo (`src/infra/__tests__/sentryScrub.test.ts` o similar) que llame a `beforeSend` con un evento sintético que contenga los campos sensibles y verifique que salen limpios — esto sí es testeable sin red, es lógica pura de transformación.
- **Riesgo concreto:** si el allowlist de red de la sesión de Claude bloquea `sentry.io` igual que bloquea `binaries.prisma.sh`, la instalación/config debe hacerse y validarse desde Windows, mismo flujo ya establecido para `prisma generate`.

#### pino (logging estructurado)

- [ ] Instalar `pino` (JS puro, sin binario nativo — sin riesgo de allowlist).
- [ ] Crear `src/infra/log.ts`: instancia única, exportada, con el mismo patrón de singleton dev que ya usa `src/infra/prisma/client.ts` (`globalForPrisma`/`NODE_ENV !== "production"`) para no crear una instancia nueva en cada hot-reload de `next dev`.
- [ ] **Sin `transport` de `pino-pretty` en producción** — en runtimes serverless (Vercel) los transports de pino usan worker threads que no siempre están disponibles; salida JSON plana a stdout en producción, `pino-pretty` solo si `NODE_ENV !== "production"` (mismo criterio de branching por entorno que ya usa `client.ts`).
- [ ] Reemplazar `console.error(err)` por `log.error({ err }, "...")` empezando por las rutas nuevas de Incremento 2, no retroactivamente en el Incremento 1 en el mismo cambio.
- [ ] **No usar `pino` en `middleware.ts`** (Edge runtime) — si más adelante se necesita logging ahí, usar `console.log` con forma de objeto JSON a mano (`console.log(JSON.stringify({...}))`), nunca pino directo: es exactamente la misma razón por la que `middleware.ts` importa `auth.config.ts` y no `auth.ts` (Argon2/Prisma no corren en Edge).
- **Testeo:** no hace falta test unitario de pino en sí; lo que sí se testea es que las funciones de `infra/` que ahora loguean sigan devolviendo lo mismo (no debería tocar ningún test existente si el logging es aditivo).
- **Riesgo concreto:** ninguno de red — el riesgo real es de disciplina: sin una regla de lint que lo fuerce, `console.error` va a seguir apareciendo en rutas nuevas. Vale la pena un `no-console` de ESLint acotado a `src/app/api/**` una vez migradas las rutas existentes (no en este incremento, para no bloquear el resto del plan).

#### eslint-plugin-jsx-a11y — activar, no instalar

- [ ] **Hallazgo real:** `eslint-plugin-jsx-a11y` ya está instalado como dependencia transitiva de `eslint-config-next` (confirmado en `node_modules/eslint-config-next/package.json`, `"eslint-plugin-jsx-a11y": "^6.10.0"`). `next/core-web-vitals` (lo único que hoy carga `eslint.config.mjs`) solo activa un subconjunto curado de sus reglas, no el set `recommended` completo. La tarea no es `npm install`, es sumar explícitamente el plugin al array de `eslint.config.mjs`:
  ```js
  import jsxA11y from "eslint-plugin-jsx-a11y";
  // ...
  const config = [
    ...compat.extends("next/core-web-vitals", "next/typescript"),
    jsxA11y.flatConfigs.recommended,
    { ignores: [...] },
  ];
  ```
- [ ] Correr `npm run lint` contra el componente real ya existente (`ResponderCuestionarioForm.tsx`) como caso de prueba — **hallazgo esperado**: los botones de Likert/"No sé"/"No aplica" no tienen `aria-pressed` ni agrupación semántica (`role="radiogroup"`), y no hay ningún `<label>` asociado — activar el plugin en este incremento va a marcar ese componente ya existente, no solo el nuevo. Corregirlo de paso es barato y da un ejemplo real para el patrón del cuestionario de 7 preguntas nuevo.
- **Testeo:** el propio `npm run lint` (ya en CI/pre-commit implícito por convención del repo).
- **Riesgo concreto:** ninguno de instalación (ya está en `node_modules`). El riesgo es de alcance: activar `recommended` completo puede generar ruido en componentes viejos no relacionados con este incremento — si eso pasa, usar `flatConfigs.recommended` igual pero silenciar reglas puntuales con comentario explicando por qué, no bajar a un subset ad hoc.

#### `@axe-core/playwright` — arranca aquí, no es tooling de "al final"

- [ ] Instalar `playwright` + `@axe-core/playwright` como devDependencies.
- [ ] `npx playwright install chromium` **descarga binarios de navegador desde un CDN propio de Playwright** — mismo patrón de riesgo que `binaries.prisma.sh`. No asumir que corre en la sesión de Claude; probar primero, y si falla, es tarea de Windows como `prisma generate`.
- [ ] Nuevo directorio `e2e/` (no existe hoy ningún test de UI, solo `vitest` unitario y de integración) con su propio `playwright.config.ts` — **decisión explícita**: esta suite corre en GitHub Actions (o el CI que se use), **no** en las sesiones de Claude ni depende de la PC de Windows, porque un runner de CI normal sí tiene acceso de red completo a los CDNs de Playwright. Documentar esto en el mismo README junto a la explicación ya existente de por qué `test:integration` es Windows-only, para no confundir ambos casos.
- [ ] Primera prueba real: el cuestionario de 7 preguntas de este mismo incremento (`npx playwright test e2e/evaluacion-express.a11y.spec.ts` corriendo `AxeBuilder` contra `/evaluacion` — la ruta pública nueva). Cada incremento siguiente con UI nueva (mapa de Incremento 3, wizard de CSV de Incremento 4, workspace de investigador de Incremento 6) agrega su propio `.a11y.spec.ts` a la misma suite — nunca se acumula para "revisar accesibilidad al final".
- **Testeo:** el test en sí es el mecanismo de testeo (assert de cero violaciones `critical`/`serious` de axe).
- **Riesgo concreto:** Next.js 15 + React 19 son relativamente nuevos para el ecosistema de Playwright — verificar que la versión de `@axe-core/playwright` fijada soporte React 19 sin warnings de hidratación falsos positivos antes de bloquear el pipeline con esto.

#### Rate limiting real para la evaluación pública (RF15/RF17) — sin librería nueva, Postgres-nativo

- [ ] **Hallazgo real:** `.env.example` ya tiene `RATE_LIMIT_STORE_URL=""` con el comentario "Store externo requerido en despliegues serverless", pero **nunca se usó** — el único rate limiting que existe hoy (`src/infra/auth/rateLimit.ts`) cuenta `intentosFallidos`/`bloqueadoHasta` como columnas de `Usuario` vía `tenantClient()`, lo cual no sirve para un visitante anónimo sin fila de `Usuario`. No hay ningún dependency de Redis/Upstash en `package.json`.
- [ ] Dado que Alex ya confirmó cola de trabajos Postgres-nativa (evitando sumar Redis), la recomendación coherente es **no introducir un store externo nuevo**: la tabla `LimiteTasa` (nombre canónico — ver Sección 12, único a usar en todo el documento) en `schema.prisma`, sin `empresaId` (mismo caso de "tenant nulo" que `EvaluacionExpres`, sin política RLS de tenant — ver comentario final de `prisma/rls.sql`), con columnas `huellaOrigenHash`, `bucket` (`INICIO_EVALUACION` / `DESBLOQUEO_DETALLE` — distingue RF15 de RF17 en la misma tabla), `ventanaInicio`, `contador`, consultada con el cliente Prisma base (no `tenantClient()`, mismo patrón que `EvaluacionExpres`).
- [ ] Retirar o resolver `RATE_LIMIT_STORE_URL` de `.env.example` en el mismo cambio — una variable de entorno documentada pero nunca leída por ningún código es un hallazgo de higiene que vale la pena cerrar de paso, no dejarla como deuda silenciosa.
- **Dónde en el código:** `src/infra/public/rateLimit.ts` (nuevo subárbol `infra/public/`, ya que `EvaluacionExpres` y sus hijas son el único caso sin tenant del proyecto y hoy no tienen carpeta `infra/` propia).
- **Testeo:** unitario puro sobre la función de ventana deslizante (sin DB, con timestamps inyectados) + un test de integración (`*.integration.test.ts`, Windows) que ejercite el límite real contra Neon.
- **Riesgo concreto:** una tabla de rate limiting con updates frecuentes desde tráfico público genera contención de filas (mismo síntoma ya documentado en el README para pruebas de integración en paralelo contra Neon — "la base duerme", contención de conexiones). Diseñar la ventana con `INSERT`s cortos + limpieza periódica (vía el job de purga de abajo) en vez de `UPDATE` de una sola fila contador, para minimizar locks.

#### Cola de trabajos — pg-boss, adoptada **en este incremento**, no en el 4

- [ ] **Corrección importante respecto a una lectura superficial de `MVP-DEFINITIVO.md` Sección 8** (que lista la cola de jobs bajo "arquitectura técnica" sin atarla a un incremento específico): `PLAN-DE-TRABAJO.md` Sección 4 ya deja explícito que el job de purga de `huellaOrigen` a 48-72h es **una obligación vencida del Incremento 1**, y la Sección 7 confirma "Construir rate limiting real + job de purga" dentro del Incremento 2. **pg-boss entra aquí**, no en el Incremento 4 — el catálogo de KPIs/CSV lo reutiliza, no lo estrena.
- [ ] Instalar `pg-boss` (JS puro sobre `pg`, ya presente como dependencia — sin riesgo de binario nativo).
- [ ] `pg-boss` gestiona su propio schema (`pgboss`) con sus propias tablas internas vía `boss.start()` — esto necesita permisos de `CREATE` sobre la base, igual que las migraciones de Prisma. **Correr la inicialización con el rol `neondb_owner`** (el mismo rol ya usado para `prisma:migrate`/`prisma:seed`, ver `.env.example`), nunca con `chainpulse_app` (rol restringido, sujeto a RLS, sin privilegios de owner) — documentar esto en `.env.example` junto a `SHADOW_DATABASE_URL`/`SEED_DATABASE_URL`, mismo criterio ya establecido ahí.
- [ ] **Riesgo arquitectónico real, específico de este repo:** pg-boss está pensado para un proceso Node de larga duración (`boss.work()` en loop), pero el proyecto asume despliegue serverless (el propio comentario de `RATE_LIMIT_STORE_URL` en `.env.example` lo dice explícito: "Store externo requerido en despliegues serverless"). Next.js en Vercel no sostiene un worker persistente. Dos caminos, a decidir con Alex antes de escribir código (no es una decisión que resuelva sola esta revisión):
  - (a) un proceso Node separado (`scripts/worker.ts`, ejecutado fuera de Next.js — un servicio/contenedor propio), o
  - (b) `boss.fetch()`/`boss.work({ pollingIntervalSeconds })` invocado una sola vez por una ruta API disparada por un cron externo (Vercel Cron u otro), procesando el lote disponible y terminando — encaja mejor con el resto del stack serverless ya asumido, a costa de latencia de job (no near-real-time).
  - **Se recomienda (b)** por consistencia con el resto de la arquitectura ya construida (todo el proyecto hoy son Route Handlers sin proceso propio) — pero es una confirmación pendiente de Alex, mismo criterio que la Sección 3 de `PLAN-DE-TRABAJO.md` para la elección misma de pg-boss vs. Inngest.
- [ ] Encolar el job de purga de `huellaOrigen` **dentro de la misma transacción** que crea/actualiza la fila de `EvaluacionExpres` (patrón outbox: si la transacción de negocio hace rollback, el job tampoco debe quedar encolado) — mismo patrón de transacción manual + `set_config` ya usado en `registrarEmpresaYAdmin()`, adaptado a `pg-boss.send()` con el mismo cliente de transacción `tx`.
- **Dónde en el código:** `src/infra/jobs/boss.ts` (instancia singleton, mismo patrón dev/prod que `client.ts`), `src/infra/jobs/purgaHuellaOrigen.ts` (handler del job).
- **Testeo:** unitario del handler puro (dado un registro con `createdAt` viejo, produce el `UPDATE` esperado que nulea `huellaOrigen`) + integración contra Neon real para el ciclo completo encolar→ejecutar→verificar purgado.

#### Motor de diagnóstico V2 (`src/engine/v2/`)

- [ ] Sin librería nueva — funciones puras, mismo patrón que `engine/` v1: `src/engine/v2/constantes.ts` con su propio `RULE_VERSION_V2 = "engine-v2-preliminary.1.0.0"` (nunca reutilizar `RULE_VERSION` de v1, son motores aislados por diseño de `MVP-DEFINITIVO.md` Sección 1), `src/engine/v2/index.ts` como barrel nuevo.
- [ ] Zod (ya instalado) para validar la forma de entrada de las 7 respuestas antes de que lleguen al motor — mismo lugar donde hoy `route.ts` valida bodies a mano (revisar si el proyecto ya usa Zod en algún `route.ts` existente; si no, este es el primer punto de entrada que lo adopta para validación de input, no solo para LLM del Incremento 5).
- **Testeo:** mismo patrón que `src/engine/__tests__/*.test.ts` — un archivo por dimensión (`salud.test.ts` → aquí, `alineacion.test.ts`, `coordinacion.test.ts`, etc.), sin red, en `vitest.config.ts` normal.

---

### Incremento 3 — Mapa y profundidad

#### `@xyflow/react` (React Flow)

- [ ] Instalar `@xyflow/react` (JS puro, sin binarios nativos, sin riesgo de allowlist).
- [ ] Componente cliente nuevo, mismo patrón `"use client"` que `ResponderCuestionarioForm.tsx`: `src/app/dashboard/cadenas/[id]/MapaCadenaCanvas.tsx`, recibiendo `nodos`/`conexiones` ya resueltos por el servidor (Server Component padre hace el `tenantClient().cadena.findUnique(...)` y pasa los datos como props, igual que `page.tsx` de `ciclos/[id]/responder` le pasa `asignaciones` al form).
- [ ] Tipos de nodo custom de React Flow (`nodeTypes`) para distinguir visualmente `Nodo` de tipo organización/persona/sistema (§9.1 de `MVP-DEFINITIVO.md`) — CSS con Tailwind, consistente con el resto del proyecto (no hay ninguna librería de componentes UI instalada hoy, todo es Tailwind a mano).
- [ ] Indicador "foto puntual vs. serie temporal" (§9.3) como badge en cada nodo/arista — dato que ya debe venir resuelto del backend (`estado: EstadoDato` existe en el schema desde el Incremento 1 para `Eslabon`/`Conexion`; `ConexionCadena` nueva necesita el mismo campo).
- **Testeo:** sin lógica de negocio propia (es presentación), sin test unitario dedicado; sí lo cubre la suite nueva de `@axe-core/playwright` de este mismo incremento (navegación por teclado del mapa es un riesgo real de a11y con librerías de canvas/drag-and-drop — React Flow tiene soporte de teclado pero hay que activarlo explícitamente, no es automático).
- **Riesgo concreto:** React Flow renderiza con posicionamiento absoluto y no tiene SSR real (necesita medir el DOM) — el componente debe ser `"use client"` puro sin intentar `next/dynamic` con SSR habilitado, o el primer render en servidor va a mostrar un layout roto antes de hidratar. Confirmar además que la versión fijada de `@xyflow/react` sea compatible con React 19 (paquete relativamente joven en adoptar React 19 sin warnings) antes de fijarla en `package.json`.

#### `ConexionCadena` (tabla nueva, ya confirmada por Alex — no es una herramienta externa, pero es la pieza de infraestructura que habilita el resto del incremento)

- [ ] Agregar `ConexionCadena` a `schema.prisma` con `empresaId` propio (denormalizado, mismo patrón que `Eslabon`/`Conexion`) y sumarla a `TENANT_SCOPED_MODELS` en `src/infra/prisma/tenantClient.ts` — si se omite este paso, la tabla queda sin la capa 1 de aislamiento (el bug exacto que ADR-0001 fue diseñado para prevenir).
- [ ] Política RLS nueva en `prisma/rls.sql`, mismo patrón que `tenant_isolation_conexiones` (comparación directa contra `current_setting('app.tenant_id', true)`, ya que `ConexionCadena` sí tiene `empresaId` propio, a diferencia de `RespuestaCruda`/`ResultadoConexion`).
- [ ] Usar el patrón de transacción manual + `set_config` (no `tenantClient()` suelto) para crear `Cadena` + varios `Nodo` + `ConexionCadena` en una sola operación atómica — exactamente el caso que `PLAN-DE-TRABAJO.md` Sección 4 ya identificó como el motivo para declarar ese patrón "estándar oficial".

---

### Incremento 4 — Indicadores

#### PapaParse + sanitizador de inyección de fórmulas (en `domain/`)

- [ ] Instalar `papaparse` + `@types/papaparse` (JS puro).
- [ ] Sanitizador nuevo en `src/domain/csvImport.ts` (pure function, mismo criterio que `src/domain/types.ts`: sin Prisma, sin Next, sin PapaParse siquiera si se puede — la función de sanitización debería tomar `string[][]` ya parseado, no el motor de parseo, para poder testearla sin la librería como dependencia de test). Cubre el patrón OWASP de CSV injection: celdas que empiezan con `=`, `+`, `-`, `@`, tab (`\t`) o retorno de carro se neutralizan (prefijo `'` o similar) antes de exponerlas en cualquier exportación futura (Incremento 6 exporta CSV/JSON — este sanitizador se reutiliza ahí, no se reescribe).
- [ ] **Parseo server-side obligatorio antes de persistir, nunca confiar en el preview del cliente:** el flujo de 3 niveles de `MVP-DEFINITIVO.md` §11.2 pide mostrar filas detectadas/mapeo/errores antes de persistir. Es válido parsear con PapaParse en el navegador para ese preview (UX rápida), pero el servidor debe **re-parsear y re-sanitizar el archivo real** desde R2 antes de persistir — un preview del cliente manipulado (DevTools) no debe poder llegar a `ObservacionKpi` sin pasar de nuevo por el sanitizador del lado servidor. Esto es una regla de arquitectura, no solo una nota de seguridad: el endpoint de confirmación de importación no debe aceptar las filas ya parseadas como payload, solo la referencia al objeto en R2.
- **Dónde en el código:** parseo/orquestación en `src/infra/kpis/importarCsv.ts` (usa PapaParse + llama al sanitizador de `domain/`), sanitizador puro en `src/domain/csvImport.ts`.
- **Testeo:** el sanitizador es 100% testeable sin red en `src/domain/__tests__/csvImport.test.ts` (no existe hoy carpeta `__tests__` bajo `domain/` — nueva, mismo patrón que `engine/__tests__`). Casos: celda `=1+1`, `+SUM(A1)`, `-2+3`, `@cmd`, celda con tab inicial, celda normal sin tocar.
- **Riesgo concreto:** PapaParse en el navegador con archivos grandes (varios MB) puede bloquear el hilo principal si no se usa `worker: true` — activar esa opción explícitamente en el preview client-side, ya que la UX de "una pregunta por pantalla" del Incremento 2 fija un estándar de responsividad que un freeze de UI en el importador de CSV rompería visiblemente.

#### Cloudflare R2 (almacenamiento de objetos, decisión ya confirmada)

- [ ] Instalar `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (API S3-compatible de R2; JS puro, sin binarios nativos — la Node runtime lo soporta sin problema, pero **no en Edge**, ídem restricción ya documentada para Prisma).
- [ ] Variables nuevas en `.env.example`, mismo estilo de comentario explicativo que las existentes: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.
- [ ] Flujo de subida: URL prefirmada (`PutObjectCommand` + `getSignedUrl`) generada en `src/infra/storage/r2.ts`, el cliente sube el archivo directo a R2 (nunca lo enruta a través de la función serverless de Next.js — evita el límite de tamaño de body de Vercel/Next), y solo después el servidor confirma la existencia del objeto antes de encolar el job de parseo en pg-boss.
- **Dónde en el código:** `src/infra/storage/r2.ts` (cliente + helpers de URL firmada), llamado desde `src/app/api/chains/:id/imports/route.ts`.
- **Testeo:** unitario de la construcción de la key del objeto (convención de nombres, ej. `empresaId/cadenaId/uuid.csv` — nunca el nombre de archivo original del usuario, para evitar path traversal) sin red; integración real contra R2 solo puede correr con credenciales reales, mismo criterio "Windows-only" que `test:integration` de Neon — documentarlo igual en el README cuando se agregue.
- **Riesgo concreto:** R2 no tiene la misma consistencia fuerte inmediata que S3 en todos los casos de listado, pero para `PutObject`+lectura directa por key (el único patrón que este incremento necesita) no es un problema real — el riesgo concreto más relevante es de **cifrado en reposo**: R2 cifra por defecto a nivel de infraestructura, pero `MVP-DEFINITIVO.md` Sección 8 pide "cifrado" como requisito explícito para este storage — confirmar que el cifrado default de R2 satisface esa redacción o si Alex espera cifrado a nivel de aplicación (client-side) antes de subir, lo cual sí sería trabajo adicional real, no cosmético.

#### Vistas materializadas (capa analítica, mismo Postgres de Neon)

- [ ] Sin librería nueva — SQL puro. Mismo patrón ya establecido para `prisma/rls.sql`/`prisma/auth_functions.sql`: un archivo `prisma/analytics_views.sql` versionado en el repo, aplicado a mano en el SQL Editor de Neon (Prisma Migrate no expresa vistas materializadas en `schema.prisma`, exactamente la misma limitación ya documentada para RLS).
- [ ] Refresh programado vía `boss.schedule()` de pg-boss (ya adoptado en Incremento 2) — un job recurrente que corre `REFRESH MATERIALIZED VIEW CONCURRENTLY` sobre cada vista de KPIs. `CONCURRENTLY` requiere un índice único sobre la vista — no olvidarlo en el DDL o el refresh bloquea lecturas durante el recálculo.
- **Testeo:** integración contra Neon real (no hay forma de testear una vista materializada sin Postgres real) — se suma a `vitest.integration.config.ts`, mismo archivo/proceso ya usado para RNF1.
- **Riesgo concreto:** el rol `chainpulse_app` (restringido, sin privilegios de owner) probablemente no tiene permiso de `REFRESH MATERIALIZED VIEW` por defecto si no es dueño de la vista — mismo tipo de problema de roles que ya resolvió `login_lookup()` como función `SECURITY DEFINER`. Puede necesitar una función `SECURITY DEFINER` propia para el refresh, o correr el refresh con un rol distinto reservado para el worker de pg-boss — decidirlo cuando se diseñe el DDL, no asumir que "aplicar el SQL" alcanza.

---

### Incremento 5 — Consultas en lenguaje natural

#### Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) sobre Zod, no `@anthropic-ai/sdk` a mano

- [ ] Instalar `ai` + `@ai-sdk/anthropic` (recomendado sobre usar `@anthropic-ai/sdk` directo): `generateObject()` del AI SDK valida la salida del modelo contra un schema Zod **del lado del SDK**, con reintento automático si la salida no matchea — esto es exactamente el mecanismo que hace cumplible el principio 10 de `MVP-DEFINITIVO.md` ("la IA explica, el motor calcula", nunca SQL libre): el catálogo semántico permitido se modela como un enum/union de Zod, y el clasificador de intención literalmente no puede devolver algo fuera de ese catálogo sin que el SDK lo rechace antes de que llegue a la capa de construcción de consulta.
- [ ] Zod ya está instalado (`^3.24.0`) — el catálogo semántico (`src/domain/consultas/catalogoSemantico.ts`, pure, sin Prisma) define el `z.union([...])` de intents/KPIs/dimensiones permitidos, reutilizable tanto por el clasificador (Incremento 5) como, potencialmente, por validación de filtros del investigador (Incremento 6).
- [ ] **El filtro de tenant y el control de permisos nunca deben pasar por el prompt ni por el modelo** — se aplican en la capa determinística de construcción de consulta, después de que el LLM devolvió el objeto Zod-validado (intención + parámetros), nunca antes. Esto es tanto un requisito de `MVP-DEFINITIVO.md` §12.2 como el punto exacto donde `tenantClient(empresaId)` ya existente se reutiliza sin cambios — el LLM nunca ve `empresaId`.
- **Dónde en el código:** `src/infra/consultas/clasificarIntencion.ts` (llama al AI SDK), `src/domain/consultas/catalogoSemantico.ts` (schemas Zod puros), `src/infra/consultas/construirConsulta.ts` (determinístico, usa `tenantClient()` + las vistas materializadas del Incremento 4), `src/infra/consultas/generarExplicacion.ts` (segunda llamada al AI SDK, solo sobre el resultado numérico ya calculado — nunca la misma llamada que clasifica intención).
- **Testeo:** el catálogo semántico y el constructor de consulta son 100% testeables sin red (dado un objeto de intención ya clasificado, ¿qué SQL/Prisma query determinístico produce?). El clasificador en sí (llamada real a Claude) necesita una prueba de integración con la API real — separarla igual que `test:integration` (necesita red + `ANTHROPIC_API_KEY`, no corre en el lint/test estándar sin red).
- [ ] `ConsultaAnalitica` como log append-only — mismo patrón que `MetricaCuestionario`/`RecomendacionEjecutada` de RNF9 (tabla sin mutación después del insert, con `empresaId`, sumada a `TENANT_SCOPED_MODELS`).
- **Riesgo concreto:** el AI SDK y `@ai-sdk/anthropic` son librerías que iteran rápido (breaking changes entre minors no son raros en el ecosistema Vercel AI SDK) — fijar versión exacta en `package.json` (no `^`) dado que este repo ya tuvo un incidente real de breaking change de infraestructura (Prisma/Windows ARM64) que costó una adenda de ADR completa; no repetir ese patrón de riesgo con una librería igual de joven sin pin de versión.
- **Riesgo concreto #2:** el layout serverless de Vercel tiene timeouts de función (10s en el plan gratuito, hasta 60s+ en planes pagos) — una consulta en lenguaje natural con clasificación + query + explicación son mínimo 2 llamadas a la API de Anthropic en serie; el RNF de "<5 segundos" de `MVP-DEFINITIVO.md` Sección 10 es optimista si cada llamada LLM tarda 1-3s — medir esto temprano (la Sección 6 de `PLAN-DE-TRABAJO.md` ya lo señala como hueco de cobertura sin resolver), no asumir que el streaming del AI SDK lo resuelve solo (el streaming mejora percepción, no el tiempo real hasta tener el dato determinístico completo que exige el contrato de 10 elementos de §12.3).

---

### Incremento 6 — Investigación

- [ ] Sin librería nueva de terceros para k-anonimato/generalización — es lógica de dominio pura (`src/domain/investigacion/anonimizacion.ts`), coherente con que el proyecto no tiene ninguna dependencia de "privacy engineering" instalada y el volumen de datos (mercado inicial: Perú) no justifica una librería pesada tipo ARX solo para esto.
- [ ] Reutilizar el sanitizador de inyección de fórmulas de `domain/csvImport.ts` (Incremento 4) para las exportaciones CSV/JSON de este incremento — no reescribir.
- [ ] `DatasetVersion`/`DatasetContribution` sin FK directa a filas identificables — mismo patrón snapshot-JSON que `ResultadoConexion.criticidadSnapshot` ya usa (`src/infra/ciclos/cerrarCiclo.ts`), y que `PLAN-DE-TRABAJO.md` Sección 4 ya fijó como estándar para `Hallazgo`.
- [ ] Camino de acceso separado del Investigador: reutilizar el patrón `SECURITY DEFINER` ya usado para `Usuario.email` (`login_lookup()`) para exponer solo agregados/vistas aprobadas sin darle a ese rol acceso de lectura directa a tablas operativas.
- **Testeo:** unitario puro para la función de generalización/supresión de celdas pequeñas (dado un conjunto sintético, verificar que ninguna celda por debajo del umbral quede expuesta); integración para el camino de acceso separado (confirmar que el rol de Investigador no puede leer nada fuera de las vistas aprobadas, mismo espíritu que `aislamientoMultitenant.integration.test.ts`).
- **Riesgo concreto:** el umbral de publicación y las reglas de generalización son decisiones legales/de producto disfrazadas de parámetro técnico — si se codifican como constantes mágicas en `domain/` sin la misma disciplina que `engine/constantes.ts` (comentario de origen, quién lo calibra, cuándo se revisa), va a ser difícil auditarlas cuando llegue la revisión legal pendiente (Ley 29733, ya señalada como bloqueante en `PLAN-DE-TRABAJO.md` Sección 4).

---

### Incremento 7 — Market Signals

- [ ] Sin librería nueva — reutiliza vistas materializadas (Incremento 4/6), pg-boss para recómputo dinámico del umbral de 20 organizaciones (job programado, mismo mecanismo que el refresh de vistas), y el patrón `SECURITY DEFINER` de acceso separado (Incremento 6) para el actor nuevo "Comprador de estadísticas".
- [ ] La regla de dominancia + supresión de celdas pequeñas es una extensión directa de la lógica de generalización ya escrita en `domain/investigacion/anonimizacion.ts` (Incremento 6) — no una librería ni un módulo nuevo desde cero.
- **Testeo:** igual criterio que Incremento 6 — unitario para la lógica de supresión/dominancia, integración para el aislamiento del rol de Comprador de estadísticas.
- **Riesgo concreto, no genérico:** este incremento tiene un gate de proceso (evaluación de impacto de privacidad **por segmento**, no una sola vez — `MVP-DEFINITIVO.md` §6.6) que ninguna herramienta automatiza. El riesgo real de stack es que el job de recómputo dinámico del umbral (vía pg-boss) publique un segmento que cruza el umbral de 20 organizaciones automáticamente, sin que el gate de privacidad manual lo haya revisado todavía para ese segmento puntual — el job debe dejar el segmento en estado "candidato a publicar" y nunca marcarlo visible al Comprador de estadísticas sin una confirmación humana explícita registrada aparte (no basta con el umbral numérico como condición suficiente).

---

### Orden recomendado de adopción de herramientas

```
Incremento 2 (en este orden dentro del incremento):
  1. Sentry + pino + activar eslint-plugin-jsx-a11y   — sin dependencias, primero para capturar errores desde el día 1
  2. Tabla de rate limiting Postgres-nativa            — depende de (1) para que sus propios errores ya se capturen
  3. pg-boss (ADR-0004)                                — necesario para el job de purga de huellaOrigen de este mismo incremento
  4. @axe-core/playwright (suite + primer spec)         — en paralelo a la UI del cuestionario, no bloquea nada más
  5. engine/v2/ + Zod para validar input                — en paralelo, sin dependencia de las anteriores

Incremento 3:
  6. @xyflow/react                                      — independiente, no depende de jobs/storage
  7. ConexionCadena (tabla + TENANT_SCOPED_MODELS + RLS) — depende del patrón de transacción atómica ya declarado en Incremento 2/4

Incremento 4:
  8. Cloudflare R2 (@aws-sdk/client-s3 + presigner)      — depende de pg-boss (3) para el parseo asíncrono
  9. PapaParse + sanitizador de domain/                  — depende de (8): el flujo completo es subir a R2 → encolar → parsear server-side
 10. Vistas materializadas                               — depende de pg-boss (3) para el refresh programado

Incremento 5:
 11. Vercel AI SDK + @ai-sdk/anthropic sobre Zod          — depende de (10): la capa determinística consulta las vistas materializadas

Incremento 6:
 12. Anonimización/k-anonimato (domain/, sin librería nueva) — depende del patrón snapshot-JSON y Consentimiento append-only, ambos ya resueltos en Incremento 2

Incremento 7:
 13. Extensión de (12) + recómputo dinámico vía pg-boss   — depende de (10) y (12), más el gate de privacidad como proceso, no como código
```

**Regla general de la secuencia:** pg-boss es el nodo con más dependientes de todo el plan (purga de Incremento 2, importación de Incremento 4, refresh de vistas de Incremento 4/6, recómputo de Incremento 7) — es la pieza que más vale la pena resolver bien (incluyendo la decisión pendiente de worker persistente vs. cron serverless) antes de construir nada encima, aunque `MVP-DEFINITIVO.md` la mencione recién en su sección de arquitectura general sin atarla a un incremento puntual.

## 12. Plan detallado — Seguridad y privacidad

### Contexto verificado en el repo real (antes de planificar)

Inspeccioné `src/infra/auth/rateLimit.ts`, `src/infra/prisma/tenantClient.ts`, `prisma/schema.prisma`, `prisma/rls.sql`, `prisma/auth_functions.sql` y `.env.example`. Hallazgos que fundamentan las tareas de abajo:

- **`rateLimit.ts` protege únicamente el login.** Opera sobre `Usuario.intentosFallidos`/`bloqueadoHasta` vía `tenantClient(empresaId, usuarioId)` — es decir, requiere un `Usuario` y un `empresaId` ya resueltos. `EvaluacionExpres` no tiene tenant ni `Usuario` asociado (es el "caso de tenant nulo" documentado en `prisma/rls.sql`), así que este mecanismo **no aplica ni puede reutilizarse tal cual** para RF15/RF17. Hay que construir uno nuevo, distinto en su clave (huella de origen, no usuario).
- **`RATE_LIMIT_STORE_URL` existe en `.env.example` desde el addendum de ADR-0001** ("Store externo requerido en despliegues serverless") pero un `grep` confirma que **no se referencia en ningún archivo `.ts` del repo** — es una intención documentada, no código. Confirma exactamente el hallazgo de `PLAN-DE-TRABAJO.md`: nada de RF15/RF17 está construido.
- No existe `src/infra/retencion.ts`, ni ninguna ruta bajo `src/app/api/public/evaluations*` — el Incremento 2 no arrancó todavía a nivel de código.
- `TENANT_SCOPED_MODELS` en `tenantClient.ts` = `{Empresa, Usuario, Eslabon, Conexion, CicloPulso}`. Las tablas hijas sin `empresaId` propio (`RespuestaCruda`, `ResultadoConexion`, `ResultadoCiclo`, `MetricaCuestionario`, `RecomendacionEjecutada`) se protegen solo por RLS vía subquery contra su padre — un segundo patrón que hay que replicar conscientemente para cada tabla nueva.
- `prisma/auth_functions.sql` ya tiene el patrón `SECURITY DEFINER` de referencia: `login_lookup()` expone solo columnas puntuales, `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO chainpulse_app` únicamente, y todo lo posterior vuelve a pasar por `tenantClient()`. Es el molde a clonar, no a inventar de nuevo.
- `EvaluacionExpres` ya tiene `consentimientoEnvio`/`consentimientoMejoraAlgoritmo` (dos booleans) y `huellaOrigen`/`huellaOrigenPurgadaEn` en el schema, pero sin ningún job que los use.

---

### Incremento 2 — Evaluación exprés v2

#### Tareas

**Rate limiting real para evaluación pública anónima (RF15/RF17) — el fix concreto**
- [x] Crear tabla nueva `LimiteTasa` — **hecho 2026-09-16** (`prisma/schema.prisma` + `prisma/migrations/20260916140000_limite_tasa/`), con exactamente los campos aquí descritos (`huellaOrigenHash`, `bucket` vía enum `BucketLimiteTasa`, `ventanaInicio`, `contador`), tenant nulo explícito documentado en el propio schema y en `prisma/rls.sql`.
- [x] Implementar el incremento con una sola sentencia atómica — **hecho 2026-09-16**, `registrarIntento()` en `src/infra/rateLimit/limiteTasa.ts` (exactamente el `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING contador` aquí especificado, vía `prisma.$queryRaw`). Con pruebas unitarias verdes para los helpers puros (`src/infra/rateLimit/__tests__/huella.test.ts`); el propio UPSERT quedó validado indirectamente en la corrida de `npm run test:integration` en Windows del 2026-09-16 (24/24 verdes, ver nota de línea de `purgarHuellasOrigen` arriba) — no hay todavía una prueba de integración dedicada a `registrarIntento()` en sí (ninguna ruta pública lo llama aún, eso es scope de RF19-26/motor v2).
- [ ] Aplicar el límite de RF15 (5 inicios/hora) sobre `POST /api/public/evaluations` y el de RF17 (10 intentos de desbloqueo/hora) sobre el endpoint de desbloqueo del detalle — dos buckets independientes, como ya lo exige RF17 textualmente.
- [x] `src/infra/retencion.ts` — **construido 2026-09-16**: `purgarHuellasOrigen()` purga `huellaOrigen`/`huellaOrigenPurgadaEn` de `EvaluacionExpres` a 48h+ y elimina filas de `LimiteTasa` fuera de ventana (2h de margen). Encolado como job pg-boss en `src/infra/jobs/purgaHuellaOrigenJob.ts`, disparado por `src/app/api/internal/jobs/run` (ADR-0004).
- [x] Decidido — **2026-09-16**: se elimina `RATE_LIMIT_STORE_URL` de `.env.example` (enfoque 100% Postgres-nativo, sin store externo). Documentado como comentario en `.env.example` y en la cabecera de `prisma/schema.prisma`/`limiteTasa.ts`, no como ADR separado — no se consideró necesario un documento aparte para esta decisión puntual.
- [ ] Prueba de integración dedicada: 6 inicios de evaluación desde la misma huella en <1h → el 6to se rechaza; distinta huella no se ve afectada (mismo estándar de prueba que RNF1).

**`Consentimiento` (4 finalidades, append-only) — diseño y migración**
- [ ] Modelo nuevo `Consentimiento`: `finalidad` (`DIAGNOSTICO`/`INVESTIGACION`/`ESTADISTICAS_COMERCIALES`/`CONTACTO_COMERCIAL`), `otorgado` (bool), `textoVersion`, `textoSnapshot` (el texto legal completo mostrado en ese momento, no solo un puntero — un cambio futuro del texto no debe reescribir lo que la persona realmente leyó), `fecha`, `jurisdiccion` (Perú, fijo por ahora), `metodoRetiro`, `origenRegimen` (`LEGACY_V1_BOOLEAN` / `V2_CUATRO_FINALIDADES`).
- [ ] **Append-only real**: otorgar es una fila nueva; retirar consentimiento es **otra fila nueva** (`otorgado=false`, `fecha`=retiro), nunca un `UPDATE` sobre la fila original — el historial completo queda íntegro para auditoría.
- [ ] **Migración sin retroactividad falsa de `consentimientoEnvio`/`consentimientoMejoraAlgoritmo`:**
  - `consentimientoEnvio` → una fila histórica `Consentimiento{finalidad: DIAGNOSTICO, origenRegimen: LEGACY_V1_BOOLEAN}` por cada `EvaluacionExpres` existente. Si el texto exacto mostrado en su momento (RF13) no quedó capturado en ningún lado (no lo está — RF13 solo linkeaba a la política de privacidad, no snapshoteaba su contenido), `textoVersion` se marca `"desconocido-pre-v2"`, **nunca se inventa** un `textoSnapshot` retroactivo.
  - `consentimientoMejoraAlgoritmo` **no equivale** semánticamente a la finalidad `INVESTIGACION` de V2 — el boolean viejo autorizaba específicamente "mejorar los algoritmos con datos reales", más angosto que lo que V2 define para `INVESTIGACION` (incluye exportación a investigadores externos, código cualitativo, etc.). La migración debe mapear la fila legacy con un alcance explícitamente restringido (`alcanceLegado: "solo-mejora-de-algoritmo"` o campo equivalente) y **no** tratarla como habilitante para que esos registros entren en un `DatasetVersion` de investigación del Incremento 6 sin re-consentimiento. Esto es la regla dura contra la retroactividad falsa que pide la tarea.
  - Los dos booleans existentes **no se borran** del modelo `EvaluacionExpres` — quedan congelados como snapshot histórico de qué se mostró bajo el régimen viejo (ya lo señala `PLAN-DE-TRABAJO.md`), y el código nuevo deja de escribirlos, escribiendo solo en `Consentimiento` desde el Incremento 2 en adelante.
- [ ] Ninguna casilla premarcada en la UI de las 4 finalidades (ya es principio adoptado); cada finalidad es un consentimiento independiente, aceptar una no implica aceptar otra.

**`Hallazgo`/`DiagnosticFinding` — fijar el patrón snapshot-JSON desde ahora (se hereda en Incremento 6)**
- [ ] `Hallazgo` usa el mismo patrón que `ResultadoConexion.criticidadSnapshot`: un campo `contextoSnapshot: Json` con solo variables no identificables (sector, tamaño, rol, país=Perú) copiadas al momento de creación — **nunca** una FK viva a `Conexion`/`RespuestaCruda`/`Usuario` en la tabla que el camino de Investigador puede tocar.
- [ ] Para el uso operacional (Admin/Responsable viendo su propio hallazgo en contexto), la FK operacional puede existir, pero en una tabla/vista separada que vive exclusivamente en el dominio tenant-scoped con RLS normal — nunca la misma tabla que alimenta después el pipeline de investigación. Definir esta separación de tablas ahora evita re-modelar en el Incremento 6.

**Otras tareas de seguridad de Incremento 2**
- [ ] `CuestionarioVersion`/`PreguntaVersion` como aggregate de versión + filas hijas inmutables (patrón nuevo, no `ruleVersion` de código) — evita que el Curador edite contenido sin desplegar código, pero conserva versionado inmutable (principio 9).
- [ ] Confirmar aggregate root y política RLS de `Respuesta` (por pregunta) para el visitante anónimo sin tenant — extiende el patrón "tenant nulo" ya usado en `EvaluacionExpres`/`rls.sql`.
- [ ] Observabilidad mínima (logging estructurado + Sentry con *scrubbing* de PII: nunca capturar `correo`/`nombreCompleto`/`huellaOrigen` en claro en los logs de error) sobre los Route Handlers nuevos, antes de exponer el motor V2 a tráfico público.
- [ ] Definir el modelo de permisos técnico del actor "Administrador de plataforma" (transversal desde este incremento, nunca definido en detalle — hueco señalado por la auditoría en `PLAN-DE-TRABAJO.md` Sección 6).

**Revisión legal (Ley 29733) — tarea humana, no de IA**
- [ ] **[HUMANO — abogado/a peruano/a especializado en protección de datos, no un agente de IA puede dar validez legal a esto.]** Antes de abrir el Incremento 2 a tráfico público general (no bloquea construir/probar con los dos pilotos, ya controlados por Alex): revisar (a) si ChainPulse requiere **registro de banco de datos personales** ante la Autoridad Nacional de Protección de Datos Personales de Perú dado el volumen y tipo de datos que RF13/RF14 capturan; (b) **validación de transferencia internacional de datos** — Neon y Vercel son infraestructura fuera de Perú, y la Ley 29733 (Art. 15 y reglamento) exige nivel de protección adecuado o consentimiento explícito informado para transferencias internacionales, algo que el texto de consentimiento actual de RF13 no cubre todavía; (c) **suficiencia del texto de consentimiento** de las 4 finalidades (consentimiento libre, previo, informado, expreso e inequívoco — no basta con "no premarcado", el contenido del texto debe ser jurídicamente suficiente). Este ítem es la Decisión pendiente #5/#8 de `MVP-DEFINITIVO.md`: el país ya está confirmado (Perú), pero la revisión en sí sigue sin hacerse.

#### Gates de seguridad antes de avanzar
- Rate limiting real (tabla `LimiteTasa`) + job de purga de `huellaOrigen`: **construido y validado de punta a punta el 2026-09-16** — `tsc`/`eslint`/`test` (66/66)/`test:integration` (24/24) en verde en Windows contra Neon real, `npm run jobs:bootstrap` corrido. Gate cumplido.
- `Consentimiento` append-only funcionando y los dos booleans legacy congelados (no se siguen escribiendo).
- Patrón snapshot-JSON de `Hallazgo` implementado (no FK viva desde el camino de investigación).
- Observabilidad con *scrubbing* de PII activa.
- **Revisión legal Ley 29733 completada [HUMANO]** — condición de entrada obligatoria antes de tráfico público general, no antes de construir/probar con los pilotos.

#### Riesgos si no se cierra este incremento bien
- Sin rate limiting real, la evaluación pública anónima es un vector de scraping/DoS y de generación masiva de leads falsos que contamina el dataset de RNF6.
- Migrar `Consentimiento` de forma retroactiva mal hecha (asumir que el boolean viejo cubre las 4 finalidades nuevas) es un incumplimiento legal directo — exactamente lo que la Ley 29733 sanciona (consentimiento no informado/no específico).
- Si `Hallazgo` no fija el patrón snapshot desde ahora, el Incremento 6 hereda una tabla con FK operacional viva y hay que migrar datos reales bajo presión, con riesgo de exponer identidad operacional durante la migración.

---

### Incremento 3 — Mapa y profundidad

#### Tareas
- [ ] Construir `ConexionCadena` como tabla **nueva** (ya recomendado y a confirmar por Alex en `PLAN-DE-TRABAJO.md`) — no extender `Conexion` (su `@@unique([origenId, destinoId])` con FKs obligatorias a `Eslabon` no admite la extensión literal sin romper RF7/RF16, verificado en el schema real).
- [ ] Denormalizar `empresaId` en `Cadena`/`Nodo`/`ConexionCadena`/`Flujo` e incluir las 4 tablas en `TENANT_SCOPED_MODELS` (`src/infra/prisma/tenantClient.ts`) — sin este paso, estas tablas nuevas quedan protegidas solo por RLS (capa 2) y pierden la capa 1 (inyección de filtro en Prisma) que hoy tienen `Eslabon`/`Conexion`.
- [ ] Escribir las políticas RLS nuevas en `prisma/rls.sql` para las 4 tablas, replicando el patrón de columna directa (`empresaId = current_setting(...)`) para las que la tienen, y el patrón de subconsulta para cualquier tabla hija sin `empresaId` propio (mismo criterio ya usado para `RespuestaCruda`/`ResultadoConexion`).
- [ ] Declarar como estándar oficial el patrón de transacción manual + `set_config` (ya usado en `registrarEmpresaYAdmin()`) para la creación atómica de `Cadena` + `Nodo`(s) + `ConexionCadena`(s) en una sola operación — `tenantClient()` no da atomicidad multi-modelo, confirmado en el código: cada `$allOperations` abre su propia transacción independiente.
- [ ] Auditar expiración real de tokens de invitación de un solo uso (extiende el mecanismo de RF4) para el invitado de `Cadena`/`ConexionCadena` — verificar que un token usado o vencido no permita re-uso ni fuerza bruta de tokens.
- [ ] `Nodo.eslabonRefId` opcional — FK nullable, sin forzar migración ni fusión conceptual (ya recomendado).

#### Gates de seguridad
- Las 4 tablas nuevas están en `TENANT_SCOPED_MODELS` **y** tienen política RLS propia antes de que cualquier endpoint de Incremento 3 quede accesible — doble capa, sin excepción, mismo criterio que RNF1 del Incremento 1.
- Prueba de integración de aislamiento horizontal específica para `Cadena`/`Nodo`/`ConexionCadena`/`Flujo` con datos de dos tenants (extiende la prueba ya existente del Incremento 1, no la reemplaza).
- Confirmación explícita de Alex sobre `ConexionCadena` como tabla nueva antes de tocar el schema.

#### Riesgos
- Si se omite el paso de `TENANT_SCOPED_MODELS`, la app queda con una falsa sensación de seguridad: RLS sigue bloqueando en la base, pero cualquier bug de omisión de `where: {empresaId}` en el código de aplicación no se detecta hasta que RLS lo bloquea en producción, perdiendo la defensa en profundidad.
- Crear `Cadena`+`Nodo`+`ConexionCadena` sin transacción atómica puede dejar objetos huérfanos si falla a mitad de camino (mismo riesgo que ya se evitó con `registrarEmpresaYAdmin()`).

---

### Incremento 4 — Indicadores

#### Tareas
- [ ] Sanitizador de fórmulas CSV como función pura en `domain/` — mitiga inyección de fórmulas tipo Excel (`=CMD(...)`, `=HYPERLINK(...)`) tanto al **importar** (Nivel 3, CSV con mapeo de columnas) como al **exportar** (cualquier reporte descargable). Regla dura ya fijada en MVP-DEFINITIVO Sección 9: nunca persistir un archivo sin mostrar filas detectadas, campos mapeados y autorización explícita — el sanitizador corre antes de esa previsualización, no después.
- [ ] Almacenamiento de objetos privado, cifrado, con URL temporal — Cloudflare R2 (decisión de infraestructura ya confirmada por Alex). Validar: bucket privado por defecto (nunca público), URLs firmadas con expiración corta (minutos, no horas), y que el CSV crudo nunca quede accesible por URL predecible.
- [ ] Validación de entrada y límites de archivo explícitos (tamaño máximo, tipo MIME, número de filas) antes de encolar el job de importación en la cola de jobs Postgres-nativa (decisión de infraestructura ya confirmada).
- [ ] CSRF adicional en los endpoints nuevos de subida (`POST /api/chains/:id/imports`).
- [ ] Confirmar `DefinicionKpi` como catálogo de plataforma sin `empresaId` (contenido compartido) y `ObservacionKpi` como el aggregate tenant-scoped que lo referencia — incluir `ObservacionKpi` en `TENANT_SCOPED_MODELS` + RLS, igual que en Incremento 3.

#### Gates de seguridad
- Sanitizador de fórmulas probado contra un CSV con payloads de inyección conocidos (`=1+1`, `=cmd|...`, etc.) antes de que el flujo de importación quede accesible.
- URLs firmadas de R2 verificadas con expiración real (probar que una URL vencida efectivamente falla).
- `ObservacionKpi` en `TENANT_SCOPED_MODELS` + política RLS antes de exponer el endpoint de indicadores.

#### Riesgos
- Sin sanitización, un CSV de indicadores subido por un usuario malicioso de un tenant podría ejecutar una fórmula peligrosa cuando otro usuario (del mismo tenant, con Excel/Sheets) abra un export generado desde esos datos.
- Storage público o sin expiración de URL expone datos operacionales de indicadores de un tenant a cualquiera con el link.

---

### Incremento 5 — Consultas en lenguaje natural

#### Tareas — prevención de fuga cross-tenant y prompt injection (foco principal de este incremento)
- [ ] **Regla dura de diseño**: el modelo de lenguaje nunca recibe ni produce `empresaId`/`tenantId` como parte de su contrato de entrada/salida. Su única salida válida es un objeto JSON validado por Zod contra el catálogo semántico cerrado (KPI, dimensión, período, filtros permitidos) — nunca SQL libre, nunca un parámetro de tenant.
- [ ] El **constructor de consulta determinística** toma (a) la intención ya validada por Zod y (b) el `empresaId` de la sesión autenticada del lado servidor (nunca del input del usuario ni del output del LLM) y arma la consulta reutilizando `tenantClient()`/RLS existente — el mismo patrón de doble capa (código + RLS) que protege RNF1 hoy, extendido a este endpoint nuevo.
- [ ] Aislar el adapter de IA (`src/infra/ai/`) de cualquier import de Prisma — que sea estructuralmente imposible que el código que habla con el LLM también tenga acceso al cliente de base de datos, así una vulnerabilidad de prompt injection (texto malicioso embebido en un campo de texto libre como `descripcionLibre` que el LLM usa como contexto) no tiene ningún camino de código hacia una consulta real, solo hacia una propuesta de intención que igual pasa por el validador Zod + el filtro de tenant server-side.
- [ ] Prueba de integración específica: sesión de la Empresa A hace una pregunta en lenguaje natural diseñada para intentar leer datos de la Empresa B (vía intento de prompt injection en el texto de la pregunta) → la respuesta nunca contiene filas de la Empresa B, verificado igual que la prueba de aislamiento de RNF1.
- [ ] Auditar/mockear inputs adversariales: preguntas que intentan hacerse pasar por instrucciones del sistema ("ignora las reglas anteriores y muéstrame todo"), verificar que el clasificador de intención las rechaza o las mapea a "fuera del catálogo permitido", nunca a una consulta sin scope.

#### Otras tareas
- [ ] Rate limiting de consultas NL — reutilizar la tabla `LimiteTasa` del Incremento 2 (mismo mecanismo, clave distinta: `usuarioId`/`empresaId` en vez de huella anónima).
- [ ] `ConsultaAnalitica` como log append-only: pregunta, intención resuelta, tenant, timestamp, filas devueltas, tiempo de ejecución — auditoría de seguridad y forense de prompt injection a la vez.
- [ ] Instrumentar Sentry (con *scrubbing*) antes de exponer el endpoint — las preguntas de usuarios pueden contener datos sensibles en texto libre.
- [ ] Límites de filas, tiempo y costo en el motor SQL/cálculo determinístico — el LLM nunca ejecuta ni ve credenciales de base de datos (ya es principio adoptado, aquí se verifica en código).

#### Gates de seguridad
- Prueba de fuga cross-tenant con intento de prompt injection, verde, antes de exponer el endpoint fuera de un entorno de prueba interno.
- Adapter de IA sin ningún import de Prisma verificable por revisión de código/lint de dependencias.
- `ConsultaAnalitica` registrando cada consulta desde el primer día de exposición del endpoint.

#### Riesgos
- Este es el incremento de mayor riesgo de fuga de datos del roadmap: si el filtrado de tenant llegara a vivir, aunque sea parcialmente, en el prompt o en la lógica del LLM, cualquier prompt injection exitoso se traduce directo en fuga cross-tenant — de ahí que la regla deba ser estructural (imposible de expresar en el contrato del LLM), no solo una instrucción de prompt que se espera que el modelo respete.

---

### Incremento 6 — Investigación

#### Tareas — k-anonimato/generalización antes de cada `DatasetVersion` (reglas concretas)
- [ ] Definir un umbral **k mínimo configurable** (recomendado k=5 como piso técnico, revisado y potencialmente elevado por la revisión de privacidad — no es una decisión que un agente de IA cierre solo) sobre organizaciones únicas por celda/combinación de variables exportadas.
- [ ] Generalización jerárquica concreta antes de publicar cada celda:
  - Ubicación: nunca distrito/ciudad — solo macro-región (o el nivel que la revisión de privacidad fije), aunque el alcance geográfico actual sea únicamente Perú.
  - Sector/subsector: si una combinación cae bajo k, generalizar el subsector al sector padre (no suprimir toda la fila de entrada, subir un nivel primero).
  - Tamaño empresarial: solo rangos ya definidos (nunca empleados/facturación puntual).
  - Tecnología declarada (Q5): agrupar categorías de baja frecuencia en "otra" antes de exportar.
- [ ] Si tras generalizar la celda sigue bajo k, **se suprime esa fila del dataset**, nunca se publica igual con nota de "muestra pequeña" — la supresión es la regla, no una excepción documentada.
- [ ] Texto libre (sugerencias, citas anonimizadas) **nunca** pasa por un pipeline 100% automático — revisión humana obligatoria antes de exportar (ya es principio de V2, aquí se implementa como gate real del pipeline, no como nota).
- [ ] Chequeo de k-anonimato como función pura versionada (mismo patrón que el motor de reglas), corrida automáticamente antes de persistir cada `DatasetVersion` — nunca un paso manual que se pueda saltear.
- [ ] Manifiesto de generalizaciones/supresiones aplicadas, adjunto a cada `DatasetVersion` (ya lo pide V2 — diccionario de variables, manifiesto de versiones — aquí se ata específicamente a las decisiones de k-anonimato tomadas, para que sea auditable).
- [ ] **Reconciliación con retiro de consentimiento posterior**: si alguien retira consentimiento de `INVESTIGACION` después de publicado un `DatasetVersion`, ese retiro **no recalcula retroactivamente** el dataset ya publicado (mismo principio de inmutabilidad que `ResultadoConexion`/`ResultadoCiclo` — RNF6) — el retiro solo excluye esa contribución del próximo `DatasetVersion`. Documentar esta regla explícitamente para no generar expectativas falsas de "borrado total retroactivo".

#### Tareas — patrón snapshot-JSON (finalizar lo fijado en Incremento 2)
- [ ] `DatasetVersion`/`DatasetContribution` confirmados sin FK directa a filas identificables — construidos a partir del `contextoSnapshot` de `Hallazgo` (fijado en Incremento 2), nunca leyendo `Conexion`/`Usuario` en vivo desde el camino de Investigador.
- [ ] El job que **construye** cada `DatasetVersion` (que sí necesita leer datos operacionales cross-tenant para agregar) corre con el patrón `SECURITY DEFINER` descrito abajo, no con acceso Prisma normal del código de aplicación.

#### Tareas — reutilización del patrón `SECURITY DEFINER`
- [ ] Clonar el patrón de `login_lookup()` (`prisma/auth_functions.sql`): una función Postgres `SECURITY DEFINER` estrecha y específica para el job que agrega datos cross-tenant hacia `DatasetVersion` — expone solo las columnas agregadas necesarias, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE` solo al rol que ejecuta el job (no a `chainpulse_app` genérico si se puede distinguir un rol más angosto), y el chequeo de k-anonimato corre **dentro** de esa función/job, no en una capa de aplicación que un bug pueda saltear.
- [ ] Mismo patrón para el acceso del Curador metodológico si necesita estadísticas agregadas cross-tenant de una pregunta (ej. "esta pregunta genera 80% de 'No sé' en general") para decidir versionado — función `SECURITY DEFINER` que devuelve solo agregados, nunca filas.
- [ ] Construir el camino de acceso separado (no-tenant) para el rol Investigador: consultas contra `DatasetVersion`/`DatasetContribution` (que no tienen `empresaId`, como `EvaluacionExpres`) vía Prisma directo — sin necesidad de `SECURITY DEFINER` en este punto porque el dato ya está agregado/anonimizado antes de llegar aquí; el `SECURITY DEFINER` protege la **construcción**, no la lectura del resultado ya anónimo.

**Auditoría de acceso a datos de investigación — [HUMANO para diseñar la política, técnico para implementarla]**
- [ ] Bitácora de consultas del Investigador (ya pedido por V2 — filtros, fecha, esquema, versiones de cada exportación) — quién, cuándo, qué filtros, cuántas filas.
- [ ] Definir con Alex (decisión de producto/negocio, no puramente técnica) la política de revisión periódica de esa bitácora.

#### Gates de seguridad
- Chequeo de k-anonimato corriendo automáticamente y probado contra el schema real (simulando una base pequeña donde varias celdas caen bajo k) antes de crear el primer `DatasetVersion` real.
- `SECURITY DEFINER` del job de construcción probado: verificar que un rol sin ese permiso específico no puede ejecutar la función ni leer las tablas fuente directamente.
- Prueba dedicada de que Investigador nunca ve identidad operativa (ya es criterio de aceptación de V2 — aquí se convierte en prueba automatizada, no solo revisión manual).

#### Riesgos
- El riesgo central de este incremento es la reidentificación por combinación de cuasi-identificadores (ataque de intersección) — un dataset "anónimo" con celdas pequeñas es el vector clásico. La regla de supresión (no solo generalización) es la mitigación principal.
- Sin el patrón `SECURITY DEFINER` en el job de construcción, cualquier bug en el código de aplicación del job tiene, por diseño, acceso de lectura cross-tenant sin restricción — exactamente el tipo de superficie que `login_lookup()` deliberadamente acota hoy para el login.

---

### Incremento 7 — Market Signals (aprobado, último incremento del alcance actual)

#### Contexto de riesgo específico
El umbral fijo de "20 organizaciones" (MVP-DEFINITIVO Sección 6.6) es insuficiente por sí solo dado que el mercado peruano es chico y concentrado: en un segmento con pocas organizaciones grandes, alcanzar 20 orgs no impide que una o dos dominen el agregado (permitiendo inferir su dato individual por diferencia), ni que un cambio pequeño en el segmento (una organización que deja de participar) reduzca el conteo real por debajo de 20 sin que nadie lo note si el chequeo es solo al momento de publicar.

#### Tareas — los 4 controles adicionales, cada uno con su implementación concreta
- [ ] **Regla de dominancia**: antes de publicar un segmento, calcular qué porcentaje del agregado corresponde a la organización con mayor peso (ej. la que más participantes/respuestas aporta). Si esa organización supera un umbral (ej. 40% del segmento — valor a confirmar con la revisión de privacidad), el segmento se suprime o se fuerza a un `n` mínimo mayor que 10 hasta diluir la dominancia. Implementar como función pura versionada (mismo patrón que k-anonimato de Incremento 6), corrida junto al chequeo de umbral, no como paso separado opcional.
- [ ] **Agregación por rangos, no valores puntuales**: cualquier cifra publicada en Market Signals se expresa como rango (ej. "60-70% de interés declarado", no "63.4%") — mitiga ataques de diferencia entre dos consultas consecutivas al mismo segmento con distinto filtro que permitirían despejar el valor exacto de una organización.
- [ ] **Supresión de celdas pequeñas con supresión complementaria**: si una celda de una tabla cruzada (ej. sector × horizonte de interés) cae bajo el umbral, no basta con suprimir solo esa celda — hay que suprimir además una segunda celda de la misma fila/columna, para que no se pueda reconstruir la celda suprimida por resta contra el total ya publicado (ataque clásico de "recuperación por complemento" en estadística de agregados).
- [ ] **Recálculo dinámico del umbral**: el umbral de publicación no es un "10" fijo por segmento definido una sola vez — se recalcula cada vez que cambia la composición del segmento (una organización deja de contribuir, retira consentimiento de `ESTADISTICAS_COMERCIALES`, o cambia de tenant). Si tras el recálculo el segmento cae bajo el umbral (o bajo la regla de dominancia), el segmento publicado **se despublica o recalcula de inmediato**, no en el próximo ciclo programado. Implementar como trigger/job disparado por los mismos eventos que afectan la composición (cambio de consentimiento, baja de organización), no solo como job periódico.
- [ ] Camino de acceso separado para el actor Comprador de estadísticas — nunca consulta viva cross-tenant; lee solo tablas de agregados ya pre-computados y con los 4 controles ya aplicados, mismo principio de `SECURITY DEFINER` en la construcción que en Incremento 6 (reutilizar el mismo job/función, extendido con estas 4 reglas).
- [ ] Nunca exponer: respuestas individuales, texto libre sin revisión, nombres, correos, teléfonos, IP, archivos, o combinaciones que identifiquen indirectamente (ya listado en MVP-DEFINITIVO — aquí se verifica con prueba automatizada, no solo declaración).

#### Tareas — evaluación de impacto de privacidad y revisión legal [HUMANO]
- [ ] **[HUMANO]** Evaluación de impacto de privacidad **por segmento, repetida cada vez que se publica o recalcula un segmento** — no una sola vez para todo el producto (ya lo fija MVP-DEFINITIVO Sección 6.6 como gate obligatorio). Dado el recálculo dinámico del umbral de arriba, esta evaluación debe integrarse al mismo flujo, no ser un trámite separado que se hace una vez al lanzar Market Signals.
- [ ] **[HUMANO — mismo abogado/a de la revisión Ley 29733 del Incremento 2]** Revisión legal específica para Market Signals: a diferencia de la evaluación exprés (datos de un solo tenant/persona), aquí se agregan y comercializan datos derivados de múltiples tenants — verificar que las 4 finalidades de `Consentimiento` (en particular `ESTADISTICAS_COMERCIALES`) cubren jurídicamente este uso comercial específico, y que la venta de agregados a un "Comprador de estadísticas" no requiere un registro o autorización adicional ante la autoridad peruana de protección de datos más allá del registro de banco de datos ya cubierto en el Incremento 2.

#### Gates de seguridad
- Los 4 controles (dominancia, rangos, supresión complementaria, recálculo dinámico) implementados y probados contra un segmento simulado con concentración alta (ej. 3 organizaciones que representan el 90% de un segmento de 10) — el segmento debe suprimirse o requerir `n` mayor, no publicarse.
- Evaluación de impacto de privacidad **aprobada para ese segmento específico** antes de cada publicación — no una aprobación genérica reutilizada.
- Revisión legal de Market Signals completada antes de la primera venta/publicación real (no antes de construir/probar internamente).

#### Riesgos
- El riesgo de negocio-reputacional es alto: un mercado concentrado como el peruano hace que "20 organizaciones" sea fácilmente vulnerable a reidentificación por alguien con conocimiento del sector (ej. un competidor que sabe quiénes son los jugadores grandes de un segmento y puede inferir el dato de uno por descarte). Los 4 controles existen específicamente para esto — omitir cualquiera de los 4 no es "menos seguro", es directamente insuficiente para este mercado en particular.

---

### Reconciliación de la política de retención (transversal, no de un solo incremento)

La política de 90 días de `requirements.md` Sección 12 (purga de datos identificables a 90 días si nunca se pide el detalle; huella de origen a 48-72h; agregados conservados indefinidamente) fue diseñada para `EvaluacionExpres` sola. Al extender el alcance hasta Incremento 7, se reconcilia así:

- [ ] El reloj de 90 días aplica **solo a datos identificables** (correo, nombre, teléfono, huella de origen) — nunca a agregados, y nunca a `DatasetVersion`/Market Signals, que por diseño ya nacen anonimizados (k-anonimato + generalización aplicados en su creación, Incremento 6/7) y no cargan ningún dato personal que "purgar" con el tiempo.
- [ ] `Consentimiento` (append-only) **no se borra nunca**, ni siquiera ante un pedido de eliminación de datos de contacto — es el registro legal de qué se autorizó y cuándo. Lo que se purga/pseudonimiza es el dato personal referenciado (correo, nombre), no el registro de consentimiento en sí; documentar esto explícitamente para que un pedido de borrado no se interprete erróneamente como borrado del historial de consentimiento.
- [ ] `RespuestaCruda` con texto libre: extender la recomendación ya señalada en `PLAN-DE-TRABAJO.md` de pseudonimización a 24-36 meses (distinto del plazo de 90 días de `EvaluacionExpres` — dato de cuenta registrada, régimen de RNF6 de persistencia indefinida salvo política distinta).
- [ ] `DatasetVersion`/Market Signals: **exentos del reloj de purga por diseño**, pero sujetos a una **revalidación periódica de k-anonimato** (no solo el chequeo al momento de creación) — si el universo de tenants cambia con el tiempo (empresas que dejan de operar, retiros masivos de consentimiento), un dataset que cumplía k-anonimato al publicarse puede dejar de cumplirlo si se cruza con datos externos más recientes; esto es responsabilidad de la evaluación de impacto de privacidad periódica de Incremento 7, no un job automático adicional.

---

### Orden recomendado de gates de seguridad

1. **[Técnico]** `LimiteTasa` (rate limiting Postgres-nativo) + job de purga de `huellaOrigen` — **construido y validado de punta a punta, Bloque A, 2026-09-16** (`prisma/schema.prisma`, `src/infra/rateLimit/`, `src/infra/retencion.ts`, `src/infra/jobs/`, `src/app/api/internal/jobs/run`). `tsc`/`eslint`/`test` (66/66)/`test:integration` (24/24) en verde en Windows contra Neon real, `npm run jobs:bootstrap` ya corrido. Gate cerrado — Incremento 2 puede seguir con el resto del schema (ver Tarea #68) en cuanto Alex dé el go-ahead.
2. **[Técnico]** `Consentimiento` append-only implementado, booleans legacy congelados, migración sin retroactividad falsa documentada — Incremento 2.
3. **[Técnico]** Patrón snapshot-JSON de `Hallazgo` fijado (separación operacional/investigación) — Incremento 2, antes de cerrar el incremento (se hereda sin rediseño en Incremento 6).
4. **[Técnico]** Observabilidad mínima con *scrubbing* de PII activa — Incremento 2, antes de tráfico público.
5. **[HUMANO]** Revisión legal Ley 29733 (registro de banco de datos, transferencia internacional Neon/Vercel, suficiencia del consentimiento) — gate obligatorio antes de abrir el Incremento 2 a tráfico público general (no bloquea construir/probar con los dos pilotos).
6. **[Técnico]** `ConexionCadena` + denormalización `empresaId` + inclusión en `TENANT_SCOPED_MODELS` + política RLS nueva + prueba de aislamiento dedicada — Incremento 3, antes de exponer cualquier endpoint de mapa.
7. **[Técnico]** Patrón de transacción atómica manual declarado estándar y aplicado — Incremento 3.
8. **[Técnico]** Sanitizador de fórmulas CSV probado + storage R2 con URL firmada de expiración corta verificada — Incremento 4, antes de exponer importación de indicadores.
9. **[Técnico]** Filtro de tenant en la capa determinística de queries (nunca en el prompt) + adapter de IA sin import de Prisma + prueba de fuga cross-tenant con prompt injection verde — Incremento 5, antes de exponer el endpoint de consultas, aunque sea internamente.
10. **[Técnico]** Rate limiting de consultas NL + `ConsultaAnalitica` como log append-only + Sentry activo — Incremento 5.
11. **[Técnico]** Chequeo de k-anonimato/generalización probado contra el schema real (simulando celdas bajo el umbral) — Incremento 6, antes de crear el primer `DatasetVersion`.
12. **[Técnico]** `SECURITY DEFINER` para el job de construcción de `DatasetVersion` (clonado de `login_lookup()`) probado — Incremento 6.
13. **[Técnico + HUMANO]** Bitácora de acceso de Investigador implementada + política de revisión periódica definida con Alex — Incremento 6.
14. **[Técnico]** Los 4 controles de Market Signals (dominancia, rangos, supresión complementaria, recálculo dinámico del umbral) implementados y probados contra un segmento concentrado simulado — Incremento 7, antes de publicar el primer segmento real.
15. **[HUMANO]** Evaluación de impacto de privacidad aprobada **para ese segmento específico** — repetida en cada publicación/recálculo, Incremento 7.
16. **[HUMANO]** Revisión legal específica de Market Signals (comercialización de datos agregados multi-tenant) — antes de la primera venta/publicación real, Incremento 7.

## 13. Plan detallado — DDD y modelo de datos

Fundamentado en `MVP-DEFINITIVO.md` v1.3, `PLAN-DE-TRABAJO.md` v1.0, `requirements.md`, y en la lectura directa de `prisma/schema.prisma`, `src/infra/prisma/tenantClient.ts`, `src/infra/prisma/client.ts`, `prisma/rls.sql`, `src/infra/auth/registro.ts` (`registrarEmpresaYAdmin()`) y `src/engine/constantes.ts` del repo real.

---

### 0. Fundamentos transversales (aplican desde el Incremento 2)

#### 0.1 Patrón `tenantTransaction()` — extensión del patrón manual de `registrarEmpresaYAdmin()`

Hoy hay dos mecanismos distintos y **no componibles**:

- `tenantClient(empresaId)` — abre **una transacción por cada operación** (`$allOperations` → `prisma.$transaction(tx => ...)` por llamada), inyecta el filtro de tenant automáticamente vía `injectTenantFilter()`, pero **no da atomicidad entre dos llamadas** (`tx.cadena.create()` y `tx.nodo.create()` en líneas separadas son dos transacciones distintas).
- `registrarEmpresaYAdmin()` — abre **una sola transacción manual** (`prisma.$transaction(async tx => {...})`), fija `set_config('app.tenant_id', empresaId, true)` una vez, y dentro hace varios `tx.X.create()` **con `empresaId` puesto a mano en cada `data`** — sin la inyección automática de `injectTenantFilter()`, porque ese código nunca pasa por `tenantClient()`.

Para Incremento 3 (crear `Cadena`+`Nodo`(s)+`ConexionCadena` en una operación) e Incremento 4 (persistir un CSV completo) se necesita lo mejor de ambos: una sola transacción **y** la inyección automática de tenant. Propuesta concreta — nuevo módulo `src/infra/prisma/tenantTransaction.ts`:

```ts
// Reexportar injectTenantFilter y TENANT_SCOPED_MODELS desde tenantClient.ts
// (hoy son privados del módulo; exportarlos es el único cambio necesario ahí).
export async function tenantTransaction<T>(
  empresaId: string,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  if (!empresaId) throw new Error("tenantTransaction requiere un empresaId no vacio");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    return fn(buildScopedTx(tx, empresaId)); // Proxy que aplica injectTenantFilter
  });                                        // en cada tx.<modelo>.<operacion>(args)
}
```

`buildScopedTx` es un `Proxy` sobre el `tx` de Prisma que, para cada modelo en `TENANT_SCOPED_MODELS`, envuelve la llamada con `injectTenantFilter(model, operation, args, empresaId)` antes de ejecutarla — el mismo código que ya usa `tenantClient()`, reutilizado en vez de duplicado. Uso en Incremento 3:

```ts
const cadena = await tenantTransaction(empresaId, async (tx) => {
  const cadena = await tx.cadena.create({ data: { nombre, productoServicio, periodoInicio, periodoFin, tipoOperacion } });
  const nodoA = await tx.nodo.create({ data: { cadenaId: cadena.id, nombre: "Compras", tipo: "AREA" } });
  const nodoB = await tx.nodo.create({ data: { cadenaId: cadena.id, nombre: "Producción", tipo: "AREA" } });
  await tx.conexionCadena.create({ data: { cadenaId: cadena.id, origenNodoId: nodoA.id, destinoNodoId: nodoB.id } });
  return cadena;
});
```

**Riesgo real para Incremento 4 (CSV masivo):** una sola transacción Postgres sosteniendo miles de `INSERT` en un worker de cola de jobs corre riesgo de exceder timeouts de transacción/idle-in-transaction en Neon. Recomendación: **no** una transacción gigante para todo el archivo — el job de importación llama a `tenantTransaction()` en **lotes de ~500 filas**, cada lote atómico en sí mismo; si un lote falla, `ImportacionCsv.estado` pasa a `ERROR` y se necesita una transacción compensatoria que borre las `ObservacionKpi` ya insertadas con ese `importId` (no hay ACID de archivo completo, es un trade-off deliberado — documentarlo así, no prometer atomicidad que Neon no puede sostener de forma segura a esa escala).

#### 0.2 `TENANT_SCOPED_MODELS` — regla general para toda tabla nueva

`TENANT_SCOPED_MODELS` hoy es `{Empresa, Usuario, Eslabon, Conexion, CicloPulso}` — únicamente los modelos con columna `empresaId` **propia**. Los hijos sin `empresaId` (`RespuestaCruda`, `ResultadoConexion`, `ResultadoCiclo`, `MetricaCuestionario`, `RecomendacionEjecutada`) **no** están en el Set: se acceden siempre anidados (`include`/`select`) desde una consulta ya escopeada al padre dentro de la misma transacción, y quedan protegidos solo por la política RLS de subconsulta (capa 2) — nunca se consultan como modelo top-level vía `tenantClient()` directo, porque si se hiciera, `$allOperations` los dejaría pasar a `query(args)` sin fijar `app.tenant_id`, y RLS fallaría cerrado (cero filas, no una fuga — pero sí un bug funcional silencioso).

Regla para cada incremento: **toda tabla nueva con `empresaId` propio se agrega a `TENANT_SCOPED_MODELS` en la misma migración que la crea**, nunca después. Las tablas hijas sin `empresaId` propio siguen el patrón `RespuestaCruda`.

**Riesgo transversal encontrado en el repo, no solo hipotético:** `prisma/rls.sql` es SQL a mano, aplicado manualmente contra Neon, y su propio encabezado dice *"No se pudo ejecutar contra una base real desde este entorno... queda escrita y lista pero SIN verificar en vivo"*. Cada tabla tenant nueva de los Incrementos 2-7 necesita su `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` correspondiente, y hoy ese archivo vive desacoplado de las migraciones de Prisma — ya hay un antecedente real de desincronización (RLS "escrito pero no verificado"). Recomendación operativa: para cada tabla tenant nueva, el `CREATE POLICY` se agrega **dentro del mismo archivo `migration.sql`** generado por `prisma migrate dev --create-only` (edición manual, como el propio `rls.sql` ya sugiere como opción), no como un archivo aparte que alguien puede olvidar aplicar.

#### 0.3 Patrón de versionado DB-nativo (aggregate + filas hijas inmutables)

`RULE_VERSION = "engine-v1.0.0"` (`src/engine/constantes.ts`) es una constante de código — funciona para el motor porque cambiar de regla exige un deploy. `CuestionarioVersion`/`PreguntaVersion`/`DefinicionKpi` los edita un Curador metodológico **sin deploy**, así que necesitan tablas reales, nunca strings. Patrón único, reutilizado en Incrementos 2 y 4:

- Un **aggregate root de versión** (`CuestionarioVersion`, `DefinicionKpi`) con `codigo` (identidad lógica estable) + `numero` (entero incremental) + `estado` (`BORRADOR`/`PUBLICADA`/`RETIRADA`) + `@@unique([codigo, numero])`.
- Filas hijas **inmutables una vez publicadas** — nunca se hace `UPDATE` sobre una versión `PUBLICADA`; una corrección crea una fila nueva con `numero + 1`.
- Toda fila que "usó" esa versión (`Respuesta.preguntaVersionId`, `ObservacionKpi.definicionKpiId`) queda con FK `onDelete: Restrict` — una versión con datos reales atados nunca se borra.

---

### Incremento 2 — Evaluación exprés v2

#### Cambios de schema concretos

**Hallazgo de identidad, no solo de datos:** los actores "Curador metodológico" y "Administrador de plataforma" aparecen formalmente desde este incremento (§4 de `MVP-DEFINITIVO.md`), pero `Usuario.empresaId` es `String` **obligatorio, no nullable** — el schema actual no admite un actor sin tenant. Ampliar `Usuario` con un `empresaId` opcional debilitaría la invariante que tanto `tenantClient()` como `rls.sql` asumen ("`empresaId` siempre presente y significativo") — no se toca `Usuario`. Se crea una identidad separada, fuera de RLS, mismo criterio ya usado para `EvaluacionExpres` (tenant nulo) y para `login_lookup()` (SECURITY DEFINER):

```prisma
enum RolPlataforma { CURADOR_METODOLOGICO  ADMINISTRADOR_PLATAFORMA  INVESTIGADOR  COMPRADOR_ESTADISTICAS }

model UsuarioPlataforma {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  mfaSecret    String?
  mfaHabilitado Boolean @default(false)
  rol          RolPlataforma
  createdAt    DateTime @default(now())
  @@map("usuarios_plataforma")
}
```

Nunca entra en `TENANT_SCOPED_MODELS` ni en `rls.sql` — mismo tratamiento que `EvaluacionExpres`. Su acceso a datos cross-tenant (leer `DatasetVersion`, publicar `CuestionarioVersion`, leer agregados de Incremento 7) se hace con funciones `SECURITY DEFINER` acotadas, reutilizando el patrón ya validado de `login_lookup()` — recomendación ya señalada en `PLAN-DE-TRABAJO.md` §5.

**Versionado del cuestionario:**

```prisma
enum EstadoVersionContenido { BORRADOR  PUBLICADA  RETIRADA }
enum DimensionDiagnosticoV2 { ALINEACION  COORDINACION  INTEGRACION  EVIDENCIA  RESILIENCIA }
```

> **Riesgo de nombres, no solo de datos:** `DimensionDiagnosticoV2.INTEGRACION` y el campo ya existente `indiceIntegracion` (float, motor v1, RF16) **no son el mismo concepto** — una es un estado categórico por dimensión del motor V2, la otra es un índice numérico agregado del motor v1. Coexisten en el mismo dominio con nombres casi idénticos; documentarlo explícitamente en el schema (comentario) para que nadie los confunda al leer el código dentro de un año.

```prisma
model CuestionarioVersion {
  id          String   @id @default(cuid())
  codigo      String   // "evaluacion-expres-v2"
  numero      Int
  estado      EstadoVersionContenido @default(BORRADOR)
  publicadaEn DateTime?
  retiradaEn  DateTime?
  curadorId   String?  // UsuarioPlataforma
  notasCambio String?
  preguntas   PreguntaVersion[]
  @@unique([codigo, numero])
  @@map("cuestionario_versiones")
}

model PreguntaVersion {
  id                    String   @id @default(cuid())
  cuestionarioVersionId String
  cuestionarioVersion   CuestionarioVersion @relation(fields: [cuestionarioVersionId], references: [id], onDelete: Restrict)
  codigo                String   // "Q1".."Q7", estable entre versiones (permite series historicas)
  orden                 Int
  texto                 String
  dimension             DimensionDiagnosticoV2
  opciones              Json     // lista fija de opciones (valor, texto, orden) — sin tabla propia:
                                  // contenido de solo lectura, mismo espiritu que los snapshot JSON
  esNoPuntuable         Boolean  @default(false) // subpregunta contextual de Q5 (§7.2)
  respuestas            Respuesta[]
  @@unique([cuestionarioVersionId, codigo])
  @@map("pregunta_versiones")
}
```

**Evaluación anónima V2 — tabla nueva, no se toca `EvaluacionExpres` (motor v1, detrás de su propia bandera, Sección 1 de `MVP-DEFINITIVO.md`):**

```prisma
model EvaluacionExpresV2 {
  id  String @id @default(cuid())
  cuestionarioVersionId String
  cuestionarioVersion   CuestionarioVersion @relation(fields: [cuestionarioVersionId], references: [id], onDelete: Restrict)

  // Contexto previo no puntuable (§7.1)
  pais String @default("PE")
  region String?
  sector String?
  subsector String?
  rangoTamano String?
  rolParticipante String?
  productoServicio String   // "una cadena concreta" — principio 2
  periodoInicio DateTime
  periodoFin    DateTime
  tipoOperacion String

  // Gate macro/detalle — mismo mecanismo que EvaluacionExpres v1 (RF13/RF17,
  // "se conserva sin cambios")
  detalleDesbloqueado   Boolean   @default(false)
  detalleDesbloqueadoEn DateTime?
  correo String?  nombreCompleto String?  empresaNombre String?  telefono String?

  huellaOrigen String
  huellaOrigenPurgadaEn DateTime?

  respuestas   Respuesta[]
  hallazgos    HallazgoExpres[]
  consentimientos ConsentimientoExpres[]

  createdAt DateTime @default(now())
  @@index([huellaOrigen])
  @@index([createdAt])
  @@map("evaluaciones_expres_v2")
}

model Respuesta {
  id  String @id @default(cuid())
  evaluacionExpresV2Id String
  evaluacionExpresV2    EvaluacionExpresV2 @relation(fields: [evaluacionExpresV2Id], references: [id], onDelete: Cascade)
  preguntaVersionId     String
  preguntaVersion       PreguntaVersion @relation(fields: [preguntaVersionId], references: [id], onDelete: Restrict)

  opcionSeleccionada String?
  noSabe             Boolean @default(false)  // principio 6: "No sé" no es cero
  contextoLibre      String?                  // subpregunta no puntuable de Q5

  createdAt DateTime @default(now())
  @@unique([evaluacionExpresV2Id, preguntaVersionId])
  @@map("respuestas")
}
```

**Consentimiento — append-only, dividido en dos tablas (no una tabla polimórfica con FK nullable), siguiendo el mismo criterio arquitectónico que ya separa `EvaluacionExpres*` de `Empresa/Eslabon/Conexion*`:**

```prisma
enum FinalidadConsentimiento { DIAGNOSTICO  INVESTIGACION  ESTADISTICAS_COMERCIALES  CONTACTO_COMERCIAL }
enum MetodoRetiro { NINGUNO  FORMULARIO_PUBLICO  SOLICITUD_SOPORTE }

model ConsentimientoExpres {           // sin tenant, igual que EvaluacionExpresV2
  id  String @id @default(cuid())
  evaluacionExpresV2Id String
  evaluacionExpresV2    EvaluacionExpresV2 @relation(fields: [evaluacionExpresV2Id], references: [id], onDelete: Cascade)
  finalidad    FinalidadConsentimiento
  aceptado     Boolean
  textoVersion String
  jurisdiccion String  @default("PE")
  vigenteDesde DateTime @default(now())
  metodoRetiro MetodoRetiro @default(NINGUNO)
  retiradoEn   DateTime?
  createdAt    DateTime @default(now())
  @@index([evaluacionExpresV2Id, finalidad])
  @@map("consentimientos_expres")
}

model ConsentimientoCuenta {           // empresaId propio → SÍ entra en TENANT_SCOPED_MODELS
  id  String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  usuarioId String
  usuario   Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  finalidad    FinalidadConsentimiento
  aceptado     Boolean
  textoVersion String
  jurisdiccion String  @default("PE")
  vigenteDesde DateTime @default(now())
  metodoRetiro MetodoRetiro @default(NINGUNO)
  retiradoEn   DateTime?
  createdAt    DateTime @default(now())
  @@index([empresaId, usuarioId, finalidad])
  @@map("consentimientos_cuenta")
}
```

**Coexistencia con los booleans de `EvaluacionExpres` (v1) — sin migración retroactiva falsa:** `consentimientoEnvio`/`consentimientoMejoraAlgoritmo` de `EvaluacionExpres` **se congelan tal cual están**, no se tocan. No se genera ningún backfill que "invente" filas de `ConsentimientoExpres` (con `textoVersion`, `jurisdiccion`, `vigenteDesde` reales) para evaluaciones v1 ya creadas — esos metadatos nunca se capturaron en su momento y fabricarlos sería falsificar el histórico. Regla de lectura documentada: cualquier código que necesite "¿esta evaluación consintió X?" debe ramificar por fecha — `EvaluacionExpres` (v1, anterior a este incremento) consulta los dos booleans; `EvaluacionExpresV2` (desde este incremento) consulta `ConsentimientoExpres`. Nunca se mezclan en una sola consulta.

**Hallazgo/`DiagnosticFinding` — snapshot JSON, dividido igual que Consentimiento (anónimo vs. cuenta, la variante de cuenta llega recién en Incremento 3 cuando existe `Cadena`):**

```prisma
enum EstadoEvidencia { DECLARADO  CONFIRMADO_POR_OTROS  VERIFICADO_CON_DATOS }
```

> **Riesgo de nombres real, no cosmético:** el schema ya tiene `EstadoDato` (`DECLARADO/INFERIDO/VERIFICADO`) en `Eslabon.estado`/`Conexion.estado`/`EvaluacionExpresEslabon.estado` — un taxonomía distinta ("cómo se obtuvo el valor de un campo": declarado por el usuario / inferido / verificado, campo de nivel-3-de-visualización aún sin UI). El principio 5 de V2 exige un enum de **tres valores distintos** (`DECLARADO/CONFIRMADO_POR_OTROS/VERIFICADO_CON_DATOS`) que mide otra cosa ("cuánta confianza tiene el dato de una conexión"). Son enums separados a propósito — `EstadoEvidencia` ≠ `EstadoDato` — pese al nombre parecido y al valor `DECLARADO` compartido; no reutilizar uno por el otro.

```prisma
model HallazgoExpres {
  id  String @id @default(cuid())
  evaluacionExpresV2Id String
  evaluacionExpresV2    EvaluacionExpresV2 @relation(fields: [evaluacionExpresV2Id], references: [id], onDelete: Cascade)

  dimension          DimensionDiagnosticoV2
  estadoCategoria    String   // uno de los 5 estados por dimension (catalogo cerrado en src/engine/v2)
  enunciado          String   // "statement"
  evidenceState      EstadoEvidencia
  coberturaConfianza Float    // confidenceCoverage
  evidenciaFaltante  String?  // missingEvidence
  siguienteVerificacion String? // nextCheck
  origenSnapshot     Json     // { preguntaCodigos, respuestaIds } — YA resuelto, nunca se relee la fila viva
  ruleVersion        String   // "v2-preliminary"

  createdAt DateTime @default(now())
  @@index([evaluacionExpresV2Id])
  @@map("hallazgos_expres")
}
```

#### Tareas

- [ ] Exportar `injectTenantFilter` y `TENANT_SCOPED_MODELS` desde `tenantClient.ts`; crear `tenantTransaction.ts` (§0.1).
- [ ] Crear `UsuarioPlataforma` + `RolPlataforma`, fuera de RLS/`TENANT_SCOPED_MODELS`, con su propio flujo de auth (reusar `hashPassword`/`generarSecretoMfa` de `src/infra/auth/`).
- [ ] Migración: enums `EstadoVersionContenido`, `DimensionDiagnosticoV2`, `EstadoEvidencia`, `FinalidadConsentimiento`, `MetodoRetiro` + tablas `CuestionarioVersion`/`PreguntaVersion`.
- [ ] Seed de la primera `CuestionarioVersion` (código `evaluacion-expres-v2`, número 1) con las 7 `PreguntaVersion` de §7.2, vía script administrado por `UsuarioPlataforma`, no por migración de datos (el contenido no es responsabilidad del schema).
- [ ] Migración: `EvaluacionExpresV2`, `Respuesta` (referencia `PreguntaVersion`, `onDelete: Restrict`).
- [ ] Migración: `ConsentimientoExpres`, `ConsentimientoCuenta` (esta última entra a `TENANT_SCOPED_MODELS` ya en este incremento, aunque `Cadena` todavía no exista — el consentimiento de cuenta es transversal desde ya).
- [ ] Migración: `HallazgoExpres`.
- [ ] Escribir políticas RLS de `ConsentimientoCuenta` en el mismo `migration.sql` (única tabla tenant-scoped de este incremento); confirmar que `EvaluacionExpresV2`/`Respuesta`/`ConsentimientoExpres`/`HallazgoExpres` **no** llevan `ENABLE ROW LEVEL SECURITY` (mismo régimen que `EvaluacionExpres`).
- [ ] Motor de diagnóstico V2 en `src/engine/v2/` como funciones puras versionadas (mismo patrón que `src/engine/`), consumiendo `PreguntaVersion.opciones` y produciendo `HallazgoExpres.origenSnapshot`.
- [ ] Construir rate limiting real sobre la tabla `LimiteTasa` (nombre canónico — ver Sección 12; tenant-nula, columnas `huellaOrigenHash`/`bucket`/`ventanaInicio`/`contador`, el campo `bucket` distingue RF15 de RF17 en la misma tabla) + job de purga de `huellaOrigen` a 48-72h, extendido a `EvaluacionExpresV2.huellaOrigen`.

#### Riesgos de migración

- Todas las migraciones de este incremento son `CREATE TABLE`/`CREATE TYPE` puros — **cero `ALTER TABLE` sobre las tablas del Incremento 1** (`empresas/usuarios/eslabones/conexiones/ciclos_pulso/respuestas_crudas/resultados_conexion/resultados_ciclo/evaluaciones_expres*`). El riesgo sobre los dos pilotos ya validados es estructuralmente bajo si se respeta esta disciplina aditiva en cada PR.
- Riesgo real, no hipotético: si alguien "simplifica" y hace que `HallazgoExpres`/`ConsentimientoExpres` reutilicen `EstadoDato` en vez de `EstadoEvidencia` por el parecido de nombres, se estaría mezclando dos taxonomías con semántica distinta sin que Prisma lo detecte (ambos son enums de 3 strings, el compilador no avisa del error conceptual).
- `ConsentimientoCuenta` es la primera tabla tenant-scoped nueva desde el Incremento 1: es el caso de prueba real de la regla del §0.2 (RLS en la misma migración) — si se hace mal aquí, se repite mal en los siguientes 6 incrementos.

---

### Incremento 3 — Mapa y profundidad

#### Diseño de `Cadena` / `Nodo` / `ConexionCadena` (decisión de Alex ya confirmada: tabla nueva, aditiva, sin tocar `conexiones`)

`Conexion` existente está cerrada a ese flujo específico: FK a `Eslabon` únicamente, `@@unique([origenId, destinoId])` (una sola arista por par, un solo `tipoFlujo` implícito, sin soporte de múltiples flujos por conexión), atada conceptualmente al ciclo de pulso de cuenta completa. V2 necesita aristas entre `Nodo` (más amplio que `Eslabon`: organización/área/instalación/proceso/persona decisora/sistema) con **múltiples flujos simultáneos** por conexión — extender `Conexion` literalmente rompería RF7/RF16 del motor v1. Se resuelve con tablas nuevas en un namespace propio:

```prisma
model Cadena {
  id  String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  nombre           String
  productoServicio String   // principio 2: "una cadena concreta"
  periodoInicio    DateTime
  periodoFin       DateTime
  tipoOperacion    String   // manufactura|distribucion|comercio|servicios|otra

  nodos      Nodo[]
  conexiones ConexionCadena[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([empresaId])
  @@map("cadenas")
}

enum TipoNodo { ORGANIZACION  AREA  INSTALACION  PROCESO  PERSONA_DECISORA  SISTEMA }

model Nodo {
  id  String @id @default(cuid())
  empresaId String    // denormalizado, igual criterio que Eslabon/Conexion
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  cadenaId  String
  cadena    Cadena  @relation(fields: [cadenaId], references: [id], onDelete: Cascade)
  nombre    String
  tipo      TipoNodo
  // Recomendado (no obligatorio, PLAN §5): puente sin fusionar los dos modelos.
  eslabonRefId String?
  eslabonRef   Eslabon? @relation(fields: [eslabonRefId], references: [id], onDelete: SetNull)

  conexionesOrigen  ConexionCadena[] @relation("conexion_cadena_origen")
  conexionesDestino ConexionCadena[] @relation("conexion_cadena_destino")
  createdAt DateTime @default(now())
  @@index([empresaId])
  @@index([cadenaId])
  @@map("nodos")
}

enum TipoFlujoV2 { PRODUCTO_SERVICIO  INFORMACION  DINERO  DECISION  DEVOLUCION }

model ConexionCadena {
  id  String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  cadenaId  String
  cadena    Cadena  @relation(fields: [cadenaId], references: [id], onDelete: Cascade)

  origenNodoId  String
  origenNodo    Nodo @relation("conexion_cadena_origen", fields: [origenNodoId], references: [id])
  destinoNodoId String
  destinoNodo   Nodo @relation("conexion_cadena_destino", fields: [destinoNodoId], references: [id])
  flujos        FlujoConexionCadena[]   // multiples flujos por conexion → tabla hija, no un array repetido

  // Datos por conexión (§9.2)
  requerimientoCantidad       Boolean @default(false)
  requerimientoFecha          Boolean @default(false)
  requerimientoEspecificacion Boolean @default(false)
  requerimientoAprobacion     Boolean @default(false)
  requerimientoPago           Boolean @default(false)
  coincidePrioridad Boolean?
  coincideCantidad  Boolean?
  coincideFecha     Boolean?
  oportunidadInformacion DuracionCategorica?   // reutiliza el enum ya existente (Corto/Medio/Largo)
  responsableDecision    String?               // rol/cargo, nunca nombre real de tercero (RF18)
  impactoFalla           NivelImpacto?         // reutiliza el enum ya existente
  tieneAlternativa       Boolean?
  alternativaProbada     Boolean?
  tiempoTolerable        DuracionCategorica?   // reutiliza el enum ya existente
  tiempoRecuperacion     DuracionCategorica?   // reutiliza el enum ya existente
  fuenteDato             String?
  estadoEvidencia        EstadoEvidencia?      // el enum del Incremento 2, NO EstadoDato

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([origenNodoId, destinoNodoId])
  @@index([empresaId])
  @@index([cadenaId])
  @@map("conexiones_cadena")
}

model FlujoConexionCadena {   // hija sin empresaId propio — mismo patrón que RespuestaCruda
  id String @id @default(cuid())
  conexionCadenaId String
  conexionCadena   ConexionCadena @relation(fields: [conexionCadenaId], references: [id], onDelete: Cascade)
  tipo TipoFlujoV2
  @@unique([conexionCadenaId, tipo])
  @@map("flujos_conexion_cadena")
}
```

**Cómo convive con `conexiones`:** ninguna FK cruzada entre `Conexion` y `ConexionCadena`; son grafos independientes sobre universos de nodos distintos (`Eslabon` vs `Nodo`). El único punto de contacto es opcional y no estructural: `Nodo.eslabonRefId`. `Eslabon`/`Conexion`/`CicloPulso`/`RespuestaCruda`/`ResultadoConexion`/`ResultadoCiclo` no reciben ni una sola columna nueva en este incremento.

**`Hallazgo` versión cuenta** (paralela a `HallazgoExpres` del Incremento 2, ahora sí tenant-scoped porque ya existe `Cadena`):

```prisma
model HallazgoCadena {
  id String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  cadenaId  String
  cadena    Cadena @relation(fields: [cadenaId], references: [id], onDelete: Cascade)
  // ... mismos campos que HallazgoExpres (dimension, estadoCategoria, enunciado,
  // evidenceState, coberturaConfianza, evidenciaFaltante, siguienteVerificacion,
  // origenSnapshot, ruleVersion)
  @@index([empresaId])
  @@index([cadenaId])
  @@map("hallazgos_cadena")
}
```

#### Tareas

- [ ] Migración: `TipoNodo`, `TipoFlujoV2` + `Cadena`.
- [ ] Migración: `Nodo` (con `eslabonRefId` opcional).
- [ ] Migración: `ConexionCadena` + `FlujoConexionCadena` — **requiere que `EstadoEvidencia` (Incremento 2) ya exista**; si por algún motivo se reordenara la construcción, esta migración debe crear el enum ella misma.
- [ ] Migración: `HallazgoCadena`.
- [ ] Agregar `Cadena`, `Nodo`, `ConexionCadena`, `HallazgoCadena` a `TENANT_SCOPED_MODELS`; **no** agregar `FlujoConexionCadena` (hija sin `empresaId` propio, patrón `RespuestaCruda`).
- [ ] Políticas RLS de las 4 tablas anteriores en la misma migración; política de subconsulta para `FlujoConexionCadena` vía `ConexionCadena` (mismo patrón que `respuestas_crudas` vía `conexiones`).
- [ ] Implementar la creación atómica `Cadena`+`Nodo`(s)+`ConexionCadena` con `tenantTransaction()` (§0.1).
- [ ] Extender el mecanismo de invitación por token de un solo uso (RF4, ya construido) a `ConexionCadena` — nueva tabla `InvitacionCadena` (tenant-scoped, entra en `TENANT_SCOPED_MODELS`) o campo adicional, a definir en el detalle EARS.
- [ ] Instalar `@xyflow/react` para el mapa visual (ya recomendado en ADR-0002).

#### Riesgos de migración

- Ninguna tabla del Incremento 1 se altera — riesgo sobre los pilotos, bajo.
- Dependencia cruzada real: `ConexionCadena.estadoEvidencia` usa `EstadoEvidencia`, creado en Incremento 2 — si el orden de construcción se invirtiera, este es el primer punto de fallo de migración a vigilar.
- `FlujoConexionCadena` sin `empresaId`: si en algún momento se necesita consultarlo top-level (no anidado desde `ConexionCadena`), hay que denormalizarle `empresaId` — no asumir que la política RLS de subconsulta basta para todos los patrones de acceso futuros (mismo aviso que ya vale para `RespuestaCruda`).

---

### Incremento 4 — Indicadores

#### Cambios de schema concretos

`DefinicionKpi` es catálogo de plataforma (sin `empresaId`, versionado igual que `CuestionarioVersion`); `ObservacionKpi` es el aggregate tenant-scoped que lo referencia — confirmado en `PLAN-DE-TRABAJO.md` §5.

```prisma
model DefinicionKpi {
  id  String @id @default(cuid())
  codigo  String   // "OTIF","FILL_RATE","STOCKOUT",... (los 10 confirmados por Alex)
  numero  Int
  estado  EstadoVersionContenido @default(BORRADOR)
  publicadaEn DateTime?
  curadorId   String?  // UsuarioPlataforma

  nombre  String
  descripcion String
  formula String
  unidad  String
  periodoDefecto  String
  zonaHoraria     String  @default("America/Lima")
  reglasExclusion Json?

  observaciones ObservacionKpi[]
  @@unique([codigo, numero])
  @@map("definicion_kpis")
}

model ObservacionKpi {
  id  String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  cadenaId  String
  cadena    Cadena @relation(fields: [cadenaId], references: [id], onDelete: Cascade)
  definicionKpiId String
  definicionKpi   DefinicionKpi @relation(fields: [definicionKpiId], references: [id], onDelete: Restrict)

  periodoInicio DateTime
  periodoFin    DateTime
  valor         Float?
  numerador     Float?
  denominador   Float?
  fuente        String     // manual|pegado|csv
  estado        EstadoDato @default(DECLARADO)   // aquí sí es EstadoDato, no EstadoEvidencia:
                                                   // es "cómo se cargó el dato", no "cuánta confianza tiene"
  importId      String?    // FK logica a ImportacionCsv si vino de nivel 3

  createdAt DateTime @default(now())
  @@index([empresaId])
  @@index([cadenaId])
  @@map("observaciones_kpi")
}

enum EstadoImportacion { PENDIENTE_REVISION  CONFIRMADA  DESCARTADA  ERROR }

model ImportacionCsv {
  id  String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  cadenaId  String
  cadena    Cadena @relation(fields: [cadenaId], references: [id], onDelete: Cascade)
  definicionKpiId String
  definicionKpi   DefinicionKpi @relation(fields: [definicionKpiId], references: [id], onDelete: Restrict)

  objetoStorageKey String   // clave en R2 — nunca el archivo en la fila
  mapeoColumnas    Json
  filasDetectadas  Int
  filasConError    Int
  erroresMuestra   Json?
  estado           EstadoImportacion @default(PENDIENTE_REVISION)
  confirmadaPorId  String?
  confirmadaEn     DateTime?

  observaciones ObservacionKpi[]
  createdAt DateTime @default(now())
  @@index([empresaId])
  @@map("importaciones_csv")
}
```

#### Tareas

- [ ] Migración: `DefinicionKpi` (independiente, sin FK a nada tenant — puede construirse incluso antes que `Cadena` si se quisiera, aunque no se usa hasta que `Cadena` exista).
- [ ] Seed de los 10 KPIs confirmados por Alex vía `UsuarioPlataforma`/curador, no vía migración de datos.
- [ ] Migración: `ObservacionKpi` — **depende estrictamente de `Cadena` (Incremento 3)**.
- [ ] Migración: `EstadoImportacion` + `ImportacionCsv`.
- [ ] Agregar `ObservacionKpi`, `ImportacionCsv` a `TENANT_SCOPED_MODELS` (no `DefinicionKpi`, catálogo de plataforma).
- [ ] Políticas RLS de ambas en la misma migración.
- [ ] Resolver almacenamiento de objetos (Cloudflare R2, ya confirmado por Alex) con URL temporal para el CSV crudo — nunca persistir el archivo en Postgres.
- [ ] Importación por lotes de `tenantTransaction()` (§0.1), cola de jobs Postgres-nativa (ya confirmada) para orquestar los lotes y actualizar `ImportacionCsv.estado`.
- [ ] Sanitizador de fórmulas peligrosas tipo Excel antes de mapear columnas (regla dura de §9 de `MVP-DEFINITIVO.md`).

#### Riesgos de migración

- **Dependencia estricta con Incremento 3:** `ObservacionKpi.cadenaId` es `NOT NULL` — este incremento no puede cerrarse funcionalmente sin que `Cadena` ya exista y tenga datos reales. Coincide con el orden ya aprobado (3 antes de 4), pero si alguna vez se reordenara, este es el punto de ruptura.
- Riesgo operativo (no de schema): una importación masiva parcialmente aplicada (falla a mitad de los lotes) deja `ObservacionKpi` huérfanas con el mismo `importId` — necesita una rutina de limpieza explícita, no solo `estado = ERROR` en `ImportacionCsv`.
- Ninguna tabla del Incremento 1 ni 2 ni 3 se altera.

---

### Incremento 5 — Consultas en lenguaje natural

#### Cambios de schema concretos

```prisma
model ConsultaAnalitica {
  id  String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  usuarioId String
  usuario   Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  preguntaTexto      String   // tal cual la escribió el usuario
  intentoClasificado String   // intent del catálogo semántico cerrado
  consultaGenerada   Json     // parámetros de la consulta permitida — nunca SQL libre
  resultadoResumen   Json     // el contrato de 10 elementos de §12.3
  ruleVersion        String
  duracionMs         Int?
  huboError          Boolean @default(false)

  createdAt DateTime @default(now())
  @@index([empresaId])
  @@index([usuarioId])
  @@map("consultas_analiticas")
}

model Accion {
  id  String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  cadenaId  String?
  hallazgoCadenaId    String?
  hallazgoCadena      HallazgoCadena? @relation(fields: [hallazgoCadenaId], references: [id], onDelete: SetNull)
  consultaAnaliticaId String?   // si nace de una consulta en vez de un hallazgo directo

  descripcion String
  estado      EstadoAccion @default(SUGERIDA)
  asignadaAId String?

  seguimientos Seguimiento[]
  createdAt DateTime @default(now())
  @@index([empresaId])
  @@map("acciones")
}

enum EstadoAccion { SUGERIDA  EN_PROGRESO  COMPLETADA  DESCARTADA }

model Seguimiento {
  id  String @id @default(cuid())
  accionId String
  accion   Accion @relation(fields: [accionId], references: [id], onDelete: Cascade)
  nota     String
  confirmaResolucion Boolean?   // "confirmación o contradicción posterior" (§14.2)
  creadoPorId String
  createdAt DateTime @default(now())
  @@index([accionId])
  @@map("seguimientos")
}
```

#### Tareas

- [ ] Migración: `ConsultaAnalitica` — independiente a nivel de schema (solo referencia `Empresa`/`Usuario`, ya existentes), pero funcionalmente inútil sin `Cadena`/`ObservacionKpi` (Incrementos 3-4) ya construidos.
- [ ] Migración: `EstadoAccion` + `Accion` + `Seguimiento` — **depende de `HallazgoCadena` (Incremento 3)**.
- [ ] Agregar `ConsultaAnalitica`, `Accion` a `TENANT_SCOPED_MODELS` (`Seguimiento` sin `empresaId` propio, patrón hijo).
- [ ] Políticas RLS de las dos tablas padre; política de subconsulta para `Seguimiento` vía `Accion`.
- [ ] Catálogo semántico cerrado (validado por Zod) que el LLM solo puede elegir, nunca generar SQL libre — el filtro de tenant vive en la capa determinística, nunca en el prompt (mismo criterio ya reflejado en `tenantClient`/RLS).
- [ ] Registrar cada consulta en `ConsultaAnalitica` como log append-only, incluso las que fallan (`huboError`).

#### Riesgos de migración

- `Accion.hallazgoCadenaId` con `onDelete: SetNull` — decisión deliberada: si algún día se purga un `HallazgoCadena` viejo, la `Accion` derivada no debe desaparecer (el seguimiento de una acción tiene valor de negocio propio, más allá del hallazgo que la originó).
- Ninguna tabla de Incrementos 1-4 se altera.

---

### Incremento 6 — Investigación

#### Cambios de schema concretos

```prisma
enum EstadoPreguntaSugerida { RECIBIDA AGRUPADA CANDIDATA EN_PRUEBA APROBADA RECHAZADA ESPECIALIZADA }

model PreguntaSugeridaCuenta {   // tenant-scoped
  id String @id @default(cuid())
  empresaId String
  empresa   Empresa @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  usuarioId String
  textoPregunta String
  razon String   // riesgo|dependencia|coordinacion|desempeño|sector|otra
  rolSugerido String?
  decisionQueAyudaria String?
  estado EstadoPreguntaSugerida @default(RECIBIDA)
  grupoId String?
  createdAt DateTime @default(now())
  @@index([empresaId])
  @@map("preguntas_sugeridas_cuenta")
}

model PreguntaSugeridaExpres {   // sin tenant, igual que EvaluacionExpresV2
  id String @id @default(cuid())
  evaluacionExpresV2Id String
  evaluacionExpresV2    EvaluacionExpresV2 @relation(fields: [evaluacionExpresV2Id], references: [id], onDelete: Cascade)
  textoPregunta String
  razon String
  rolSugerido String?
  decisionQueAyudaria String?
  estado EstadoPreguntaSugerida @default(RECIBIDA)
  grupoId String?
  createdAt DateTime @default(now())
  @@index([evaluacionExpresV2Id])
  @@map("preguntas_sugeridas_expres")
}
```

**`DatasetVersion`/`DatasetContribution` — sin FK a ninguna fila identificable, por diseño (extiende el mismo patrón snapshot-JSON de `ResultadoConexion.criticidadSnapshot` y de `Hallazgo*.origenSnapshot`, llevado a su extremo: aquí ni siquiera hay un puntero al origen):**

```prisma
model DatasetVersion {
  id  String @id @default(cuid())
  codigo  String   // "investigacion-general-v1"
  numero  Int
  esquema Json     // diccionario de variables, versionado junto al dataset (§14.3)
  filtrosBase Json?
  publicadoEn DateTime?
  generadoPorId String   // UsuarioPlataforma (investigador/curador), nunca Usuario de tenant

  contribuciones DatasetContribution[]
  createdAt DateTime @default(now())
  @@unique([codigo, numero])
  @@map("dataset_versiones")
}

model DatasetContribution {
  id  String @id @default(cuid())
  datasetVersionId String
  datasetVersion   DatasetVersion @relation(fields: [datasetVersionId], references: [id], onDelete: Cascade)
  contenido Json           // payload anonimizado completo, conforme al `esquema` del padre —
                            // contexto no identificable, version pregunta/respuesta, tiempos, "no sé",
                            // diferencias de rol, mapa reducido a tipos, KPIs agregados, resultado,
                            // acción, confirmación posterior (§14.2) — TODO copiado como valor, no FK
  codigosCualitativos Json?
  createdAt DateTime @default(now())
  @@index([datasetVersionId])
  @@map("dataset_contribuciones")
}
```

**Por qué evita exponer identidad operacional:** exactamente el mismo motivo que `ResultadoConexion.criticidadSnapshot` no relee `Conexion` en vivo — aquí, además, no hay FK en absoluto hacia `EvaluacionExpresV2`/`Cadena`/`Usuario`/`Respuesta`/`ObservacionKpi`. Un investigador con acceso de lectura a `DatasetContribution` **no puede**, ni por error de código ni por un `include` mal puesto, llegar a una fila operativa — no existe el camino de join. El costo es que generar una `DatasetVersion` es un proceso de escritura explícito (job de anonimización/k-anonimato) que copia valores, nunca un simple `SELECT` con joins.

#### Tareas

- [ ] Migración: `EstadoPreguntaSugerida` + `PreguntaSugeridaCuenta` + `PreguntaSugeridaExpres`.
- [ ] Agregar `PreguntaSugeridaCuenta` a `TENANT_SCOPED_MODELS`; `PreguntaSugeridaExpres` sin RLS, igual que `EvaluacionExpresV2`.
- [ ] Migración: `DatasetVersion` + `DatasetContribution` — **sin RLS, sin `TENANT_SCOPED_MODELS`**, acceso exclusivamente vía `UsuarioPlataforma` + función `SECURITY DEFINER` (camino de acceso separado, no-tenant, para Investigador — recomendación ya confirmada en `PLAN-DE-TRABAJO.md`).
- [ ] Construir job de k-anonimato/generalización que lee de `Respuesta`, `HallazgoCadena`/`HallazgoExpres`, `ObservacionKpi`, `ConsentimientoCuenta`/`ConsentimientoExpres` (filtrando solo `INVESTIGACION` aceptado) y escribe `DatasetContribution` — nunca al revés.
- [ ] Auditoría de acceso a `DatasetVersion`/`DatasetContribution` (quién leyó qué versión, cuándo).

#### Riesgos de migración

- Ninguna tabla anterior se altera.
- Riesgo de diseño, no de SQL: si en algún momento alguien "optimiza" agregando una FK de conveniencia entre `DatasetContribution` y su fila fuente para depurar más fácil, se rompe la garantía central de este incremento — vale la pena dejarlo como comentario explícito en el schema, no solo en este documento.

---

### Incremento 7 — Market Signals (aprobado)

#### Cambios de schema concretos

```prisma
model SegmentoMercado {
  id  String @id @default(cuid())
  codigo      String @unique   // "cd-amazonia-pe"
  descripcion String
  filtros     Json             // país/sector/tamaño/tecnología/periodo que define el segmento
  agregados   SegmentoMercadoAgregado[]
  createdAt DateTime @default(now())
  @@map("segmentos_mercado")
}

model SegmentoMercadoAgregado {
  id String @id @default(cuid())
  segmentoId String
  segmento   SegmentoMercado @relation(fields: [segmentoId], references: [id], onDelete: Cascade)

  periodoInicio DateTime
  periodoFin    DateTime
  participantesUnicos  Int
  organizacionesUnicas Int      // debe superar el umbral configurable antes de publicarse
  interesDeclaradoConteo Int
  necesidadDefinidaConteo Int
  horizonteDistribucion Json
  autorizacionContactoConteo Int
  cotizacionConteo Int
  pilotoConteo Int
  contratacionConteo Int

  umbralAplicado Int          // umbral vigente al momento de publicar (configurable, §15)
  revisionReidentificacionAprobadaEn DateTime?   // gate obligatorio antes de publicar
  publicado   Boolean  @default(false)
  publicadoEn DateTime?

  createdAt DateTime @default(now())
  @@index([segmentoId])
  @@map("segmentos_mercado_agregados")
}
```

Sin `empresaId`, sin FK a ninguna fila identificable — mismo criterio de `DatasetContribution`, llevado un paso más: aquí ni siquiera hay `contenido: Json` con datos de nivel-participante, solo conteos agregados por segmento.

#### Tareas

- [ ] Migración: `SegmentoMercado` + `SegmentoMercadoAgregado` — **depende funcionalmente de `DatasetVersion`/`ConsentimientoCuenta`+`ConsentimientoExpres` (finalidad `CONTACTO_COMERCIAL`/`ESTADISTICAS_COMERCIALES`)** del Incremento 6, aunque a nivel de FK de Prisma no dependa de nada (no hay join).
- [ ] Sin RLS, sin `TENANT_SCOPED_MODELS` — acceso vía `UsuarioPlataforma` con rol `COMPRADOR_ESTADISTICAS`.
- [ ] Implementar regla de dominancia + supresión de celdas pequeñas + recómputo dinámico del umbral (20 organizaciones, configurable) antes de marcar `publicado = true`.
- [ ] Evaluación de impacto de privacidad por segmento como gate obligatorio, registrada en `revisionReidentificacionAprobadaEn` — no es un gate único global, es por cada fila de `SegmentoMercadoAgregado`.

#### Riesgos de migración

- Ninguna tabla anterior se altera.
- Riesgo de negocio más que de schema: publicar un segmento con `organizacionesUnicas` por debajo del umbral por un bug de recómputo — la regla dura ("nunca exponer... combinaciones que identifiquen indirectamente") debe verificarse en el job de publicación, no solo confiarse al dato ya persistido.

---

### Orden global de migraciones recomendado

```
M1  Enums base Incremento 2: EstadoVersionContenido, DimensionDiagnosticoV2,
    EstadoEvidencia, FinalidadConsentimiento, MetodoRetiro, RolPlataforma
    → independiente, sin FK a nada existente.
M2  UsuarioPlataforma
    → depende de M1 (RolPlataforma).
M3  CuestionarioVersion + PreguntaVersion
    → depende de M1.
M4  EvaluacionExpresV2 (FK a CuestionarioVersion) + Respuesta (FK a PreguntaVersion)
    → depende de M3.
M5  ConsentimientoExpres + ConsentimientoCuenta
    → depende de M4 (evaluacionExpresV2Id) y de Empresa/Usuario (ya existen).
    ConsentimientoCuenta es la PRIMERA tabla tenant-scoped nueva → primer
    punto donde se valida la regla "RLS en la misma migración".
M6  HallazgoExpres
    → depende de M4.
─────────────────────────────────────────────────────────────
M7  Cadena
    → depende solo de Empresa (ya existe). Sin dependencia técnica de
    M1-M6, pero sí de secuencia de producto (Incremento 2 cerrado primero).
M8  Nodo (FK opcional a Eslabon, ya existe)
    → depende de M7.
M9  ConexionCadena + FlujoConexionCadena
    → depende de M8 y de M1 (EstadoEvidencia) — dependencia cruzada real
    entre incrementos, no solo de producto.
M10 HallazgoCadena
    → depende de M7 y M1 (DimensionDiagnosticoV2).
M11 InvitacionCadena (o campo equivalente, a definir en EARS)
    → depende de M9.
─────────────────────────────────────────────────────────────
M12 DefinicionKpi
    → independiente (catálogo de plataforma, ninguna FK tenant). Podría
    construirse en paralelo con M7-M11, pero no tiene sentido de producto
    hacerlo antes de que exista Cadena.
M13 ObservacionKpi
    → depende ESTRICTAMENTE de M7 (Cadena) y M12 (DefinicionKpi).
M14 ImportacionCsv
    → depende de M13.
─────────────────────────────────────────────────────────────
M15 ConsultaAnalitica
    → depende solo de Empresa/Usuario (ya existen); útil recién con
    M13/M9 poblados.
M16 Accion + Seguimiento
    → depende de M10 (HallazgoCadena).
─────────────────────────────────────────────────────────────
M17 PreguntaSugeridaCuenta + PreguntaSugeridaExpres
    → depende de M7 y M4 respectivamente.
M18 DatasetVersion + DatasetContribution
    → sin FK a nada (por diseño), pero sin sentido funcional antes de que
    M4-M16 tengan datos reales que anonimizar.
─────────────────────────────────────────────────────────────
M19 SegmentoMercado + SegmentoMercadoAgregado
    → sin FK a nada, depende funcionalmente de M18 (dataset de
    investigación) y de la finalidad CONTACTO_COMERCIAL/ESTADISTICAS_COMERCIALES
    de M5.
```

**Regla de independencia real (no solo de producto):** M1-M6 (Incremento 2), M12 (`DefinicionKpi`), M15 (`ConsultaAnalitica`) y M18-M19 (`DatasetVersion`/`SegmentoMercado`) no tienen FK de Prisma hacia `Cadena`/`Nodo`/`ConexionCadena` — técnicamente podrían migrarse en cualquier momento. Las únicas dependencias **estrictas** a nivel de columna `NOT NULL` + FK son: M9→M8→M7 (mapa), M13→M7+M12 (indicadores por cadena), M10→M7, M16→M10, M14→M13. Todo lo demás es dependencia de secuencia de producto (Alex confirma EARS incremento por incremento), no de integridad referencial — vale la pena que quien ejecute las migraciones sepa distinguir cuál es cuál si alguna vez hay presión para adelantar trabajo de un incremento posterior.

## 14. Plan detallado — Implementación práctica (developer)

Leí `MVP-DEFINITIVO.md` v1.3, `PLAN-DE-TRABAJO.md` (revisión de viabilidad ya cerrada) y `requirements.md`, y después inspeccioné el repo real en `~/mnt/BigDevelopment/Proyectos/ChainPulse` (solo lectura): estructura completa de `src/`, `prisma/schema.prisma` (438 líneas), `prisma/rls.sql`, `prisma/auth_functions.sql`, `package.json`, `eslint.config.mjs`, los dos `vitest.config.ts`, `tenantClient.ts`, `rateLimit.ts`, `registrarEmpresaYAdmin()`, varios Route Handlers (`conexiones/route.ts`, `ciclos/[id]/respuestas/route.ts`), `domain/types.ts`, `engine/index.ts`, `auth.ts`/`middleware.ts`, corrí `tsc --noEmit` (limpio) y `vitest run` (56/56 verdes), y revisé `git log` y el README completo. No modifiqué nada.

Antes del plan, cuatro hallazgos de código real que cambian cómo hay que picar esto (no están en los otros reportes porque requieren leer el repo, no solo los documentos):

1. **El flujo público de evaluación exprés (RF11-RF18) no existe en código, solo en schema.** `grep -rl "EvaluacionExpres" src` solo devuelve `tenantClient.ts` (que la excluye explícitamente del filtro de tenant). No hay ni una sola ruta bajo `src/app/api/public/`, ni una página pública, ni `src/infra/retencion.ts` (referenciado en un comentario del propio schema pero inexistente). El Incremento 2 no es "adaptar lo existente a 7 preguntas": es construir el flujo completo de cero, incluyendo el gate macro/detalle que hoy solo vive como intención en comentarios.
2. **El modelo `EvaluacionExpres` ya en `schema.prisma` está diseñado para el diagnóstico viejo (4 valores: salud/criticidad/dependencia/riesgo promedio + `dimensionMasDebil: DimensionDiagnostico` con esos mismos 4 valores como enum), no para las 5 dimensiones de V2 (Alineación/Coordinación/Integración/Evidencia/Resiliencia, cada una con 5 estados categóricos). Como la tabla nunca recibió una sola fila real (cero código que la escriba), no hay riesgo de migrar datos — pero sí hay que decidir explícitamente si se rediseña este modelo o se crea uno nuevo en paralelo, porque tal como está hoy no representa lo que V2 pide.
3. **RLS (`prisma/rls.sql`, `prisma/auth_functions.sql`) no está versionado como migración de Prisma** — es SQL que se pega a mano en el editor de Neon. `find prisma/migrations` no contiene ningún `CREATE POLICY`. Esto funciona hoy porque hay una sola base y Alex la mantiene a mano, pero es un problema real en cuanto exista una segunda base (CI, staging, una base de sombra nueva): nada garantiza que RLS quede aplicado salvo que alguien se acuerde de correr el archivo.
4. **No hay ningún mecanismo de rate limiting reutilizable para tráfico anónimo.** `rateLimit.ts` está acoplado 1:1 a login con tenant conocido (`tenantClient(empresaId).usuario.update(...)`) — no sirve para un visitante sin tenant. Y `RATE_LIMIT_STORE_URL` está en `.env.example` pero **no se lee en ningún lado de `src`** (`grep` sin resultados): es una variable fantasma, no una decisión ya tomada.

Con eso, el plan por incremento:

---

### Incremento 2 — Evaluación exprés v2

#### Bloque A — Infraestructura transversal que este incremento necesita primero
**Esfuerzo: L.** Justificación: toca base de datos (migraciones nuevas, tabla de rate limit), un servicio nuevo (cola de jobs) y afecta todo lo que se construya después — es la base sobre la que se paran los Incrementos 2-7, no una feature aislada.

- [x] **Hecho (2026-09-16/18).** `pg-boss` instalado y configurado contra Neon -- `src/infra/jobs/pgBoss.ts` (singleton, mismo patrón que `src/infra/prisma/client.ts`) + `scripts/bootstrapPgBoss.ts` (`npm run jobs:bootstrap`, setup del schema `pgboss` con `neondb_owner`, confirmado contra Neon de producción 2026-09-16).
- [x] **Hecho.** `src/infra/retencion.ts` + `src/infra/jobs/purgaHuellaOrigenJob.ts` -- job recurring de pg-boss que purga `huellaOrigen`/`huellaOrigenPurgadaEn` a las 48-72h, con respaldo cada 15 min en GitHub Actions (`jobs-cron.yml`) ademas del Cron nativo diario de Vercel (ver `pendientes-tecnicos-incremento2.md`, Sección 9, Proyecto de Claude).
- [x] **Hecho, tal cual se recomendó.** `LimiteTasa` (Postgres, sin Redis) con `huellaOrigenHash`/`bucket` (`BucketLimiteTasa`: `INICIO_EVALUACION`/`DESBLOQUEO_DETALLE`)/`ventanaInicio`/`contador`, `src/infra/rateLimit/limiteTasa.ts` (`registrarIntento`, `hashHuellaOrigen`), usado en `api/public/evaluations/route.ts` (RF15) y `.../unlock/route.ts` (RF17).
- [x] **Decisión tomada e implementada 2026-09-16.** Se optó por **reemplazar con un modelo nuevo** (`EvaluacionExpresV2` + `Respuesta`/`CuestionarioVersion`/`PreguntaVersion`/`HallazgoExpres`), dejando `EvaluacionExpres` (v1) congelado sin uso -- documentado en `README.md` ("Resto del schema del Incremento 2..., 2026-09-16") y en los comentarios del propio `schema.prisma`. **Corrección 2026-09-24:** esta decisión iba a documentarse como "ADR-0004", pero ese número ya estaba ocupado por la cola de jobs (`docs/ADR/0004-cola-de-jobs.md`, aceptado el mismo día). Escrito como [`docs/ADR/0005-evaluacion-expres-v2.md`](./docs/ADR/0005-evaluacion-expres-v2.md), al mismo nivel que ADR-0001/0002/0003/0004.
- [x] **Hecho (2026-09-16), migración a mano en Windows.** `prisma/migrations/20260916150000_incremento2_evaluacion_expres_v2/` -- `CuestionarioVersion`/`PreguntaVersion`, `EvaluacionExpresV2`/`Respuesta`, `ConsentimientoExpres`/`ConsentimientoCuenta` (append-only, `REVOKE UPDATE/DELETE`), `HallazgoExpres`/`HallazgoExpresTraza` (snapshot-JSON, mismo patrón que `ResultadoConexion.criticidadSnapshot`). Validado en Windows: `prisma:migrate` en sync, `typecheck`/`lint`/`test` (66/66) y `test:integration` (24/24) en verde.

**Riesgos concretos:**
- La tabla de rate limiting anónima es la primera escritura del proyecto sin pasar por `tenantClient()` ni por una transacción con `set_config` — hay que decidir explícitamente su política RLS (¿necesita alguna, si no tiene datos de tenant? probablemente no, pero hay que declararlo en `rls.sql`, no dejarlo implícito) para no romper el patrón "toda tabla nueva se declara explícitamente en o fuera de RLS" que el resto del proyecto sigue.
- `pg-boss` necesita su propio esquema en la misma base (`pgboss` por defecto) — confirmar que el rol `chainpulse_app` tiene los permisos de `CREATE SCHEMA`/tablas que pg-boss necesita, o si hace falta correr su setup con `neondb_owner` igual que las migraciones (mismo patrón ya usado para `prisma migrate` vs. runtime).

#### Bloque B — Motor de diagnóstico V2
**Esfuerzo: M.** Justificación: es lógica pura nueva (mismo patrón ya validado con el motor v1), sin tocar Next/Prisma — rápido de escribir y de testear, pero hay 5 dimensiones × 5 estados cada una más la función `DiagnosticFinding`, así que no es trivial.

- [x] **Hecho.** `src/engine/v2/` (aislado de `src/engine/` v1) con `constantes.ts` (`RULE_VERSION_V2 = "v2-preliminary"` -- nombre final distinto al propuesto acá, mismo propósito) y una función por dimensión (`alineacion.ts`/`coordinacion.ts`/`integracion.ts`/`evidencia.ts`/`resiliencia.ts`), funciones puras sin `@prisma/client`.
- [x] **Hecho** -- tipos V2 nuevos y separados de `DimensionDiagnostico` v1, usados por `src/engine/v2/index.ts` y los tests de dimensión.
- [x] **Hecho** -- `src/engine/v2/index.ts` + `prioridad.ts`, orquesta las 5 dimensiones y aplica la priorización de 6 niveles.
- [x] **Hecho** -- `src/engine/v2/__tests__/` (por dimensión + `prioridad.test.ts` + `index.test.ts`, casos límite incluidos), parte de los 173/173 tests en verde del proyecto.

**Riesgo concreto:** la regla "si falta información suficiente, la salida prioritaria pide evidencia — nunca inventa una causa" es fácil de romper por accidente si la función orquestadora tiene una rama por defecto que cae en una prioridad concreta cuando el dato es `null`/`undefined` en vez de un estado explícito "sin evidencia suficiente". Vale la pena un test específico por cada combinación de "No sé" que deje sin dato una dimensión completa.

#### Bloque C — Rutas API públicas + UX del cuestionario
**Esfuerzo: L.** Justificación: toca los 4 endpoints públicos nuevos, el gate macro/detalle completo (que hoy no existe ni en su versión vieja), la UI de 7 pantallas con guardado automático/accesibilidad, y es la primera vez que el proyecto expone algo a tráfico anónimo real — mucha superficie nueva a la vez.

- [x] **Hecho, con un quinto endpoint agregado sobre lo planeado acá.** Los 4 listados + `POST /api/public/evaluations/:id/unlock` (RF13/RF17, desbloqueo de detalle -- decisión documentada en `pendientes-tecnicos-incremento2.md` Sección 1, Proyecto de Claude) -- mismo estilo que `conexiones/route.ts`.
- [x] **Hecho** -- `LIMITE_INICIO_EVALUACION` (RF15) y `LIMITE_DESBLOQUEO_DETALLE` (RF17), dos buckets independientes de `LimiteTasa`.
- [x] **Hecho y validado por Alex end-to-end en Windows (commit `7d6291d`, "Listo todo bien").** `src/app/evaluacion/**` -- contexto previo minimalista, progreso "n de 7" (Q5+subpregunta agrupadas en un solo paso), guardado optimista en segundo plano (`Promise.allSettled` antes de `/complete`), sessionStorage para no releer preguntas.
- [x] **Hecho** -- `complete` calcula y persiste una sola vez, `result` solo revela campos según `detalleDesbloqueado`, tal como se planeó acá.
- [x] **Hecho** -- consentimientos separados sin premarcar en `ResultadoForm.tsx`, textos importados directo de `src/infra/public/textoConsentimiento.ts` (nunca reescritos en el cliente) para que el snapshot persistido coincida siempre con lo que el visitante leyó.

**Incremento 2 -- cerrado por completo.** Sin pendientes técnicos abiertos (`pendientes-tecnicos-incremento2.md`, Proyecto de Claude, Sección 7). Único hueco real detectado al actualizar este checklist (2026-09-24) resultó ya estar resuelto: `docs/ADR/0004-cola-de-jobs.md` ya existía desde el 2026-09-16 (la nota de arriba estaba desactualizada). La decisión de `EvaluacionExpresV2` quedó documentada aparte como ADR-0005 (ver Bloque A) -- sin pendientes de documentación en este incremento.

**Riesgos concretos:**
- Es la primera vez que el código expone un endpoint sin `auth()` de por medio. Cualquier query que use `prisma` directo (como ya hace hoy `EvaluacionExpres`, fuera de `tenantClient`) tiene que ser revisada a mano — no hay ninguna capa automática que la proteja de una fuga (RLS con tenant nulo depende de políticas específicas para esas tablas, que hay que escribir y probar, no asumir que "ya está" porque el resto del proyecto tiene RLS).
- El `POST answers` guardando en cada pregunta (no solo al final) introduce un nuevo patrón de escritura incremental sobre una fila anónima — hay que decidir si cada respuesta es un `upsert` idempotente (reenvío de la misma pregunta no duplica) o si se acumula server-side; el código actual no tiene ningún precedente de "guardado parcial progresivo" para copiar.
- Nada en el repo hoy maneja CSRF explícito en endpoints públicos sin sesión — Next.js con `same-site` cookies mitiga parte, pero un endpoint anónimo que además es candidato a rate-limit abuse merece una revisión explícita, no asumida.

**Deuda técnica a pagar ANTES de avanzar:** el Bloque A completo (cola de jobs, rate limit real, purga) — construir el Bloque C sin eso significa lanzar tráfico público sin ninguna de las dos protecciones que `requirements.md` ya exige por escrito (RF15/RF17), lo mismo que la revisión de viabilidad ya marcó como bloqueante.

---

### Incremento 3 — Mapa y profundidad

#### Bloque A — Modelo de datos (`Cadena`, `Nodo`, `ConexionCadena`, `Flujo`)
**Esfuerzo: L.** Justificación: toca el modelo de datos central del incremento, tiene que resolver denormalización de `empresaId` en 4 tablas nuevas a la vez, y necesita el patrón de transacción atómica que hoy solo existe en dos lugares del código (`registrarEmpresaYAdmin`, `aceptarInvitacion`).

- [x] `ConexionCadena` construida como tabla nueva y aditiva — **hecho 2026-09-20** (`prisma/migrations/20260920040000_incremento3_mapa_bloque_a/`), `Conexion` (v1) sin tocar.
- [x] `empresaId` propio agregado a `Cadena`/`Nodo`/`ConexionCadena`/`HallazgoCadena` (mismo patrón que `Eslabon`/`Conexion`) e incluidas en `TENANT_SCOPED_MODELS` (`src/infra/prisma/tenantScope.ts`) en la misma migración que las crea, con su política RLS propia — **hecho 2026-09-20**. `FlujoConexionCadena` queda deliberadamente FUERA de `TENANT_SCOPED_MODELS`: es tabla hija sin `empresaId` propio (mismo patrón que `RespuestaCruda`), protegida por la política RLS de subconsulta contra `ConexionCadena` (misma migración).
- [x] `Nodo.eslabonRefId` opcional (FK nullable a `Eslabon`, `onDelete: SetNull`), sin fusión conceptual — **hecho 2026-09-20**.
- [x] Patrón de transacción atómica aplicado a su primer caso de uso real — **hecho 2026-09-20**: `crearCadenaCompleta()` (`src/infra/mapa/crearCadenaCompleta.ts`) usa `tenantTransaction()` (ya formalizado como estándar en el Bloque A del Incremento 2, Sección 18.3.B) para crear `Cadena` + `Nodo`(s) + `ConexionCadena`(s) + `Flujo`(s) en una sola operación — primer uso real del helper fuera de `auth/`, el caso concreto que motivó construirlo.

**Bloque A completado y validado de punta a punta (Mac 2026-09-20, Windows/Neon real 2026-09-20)** — `tsc`/`eslint` limpios sobre los 3 archivos nuevos/tocados (`prisma/schema.prisma`, `src/infra/prisma/tenantScope.ts`, `src/infra/mapa/crearCadenaCompleta.ts`) y sobre las dos pruebas de integración nuevas; `npm run test` sigue en 30/30 archivos, 153/153 tests (sin regresiones, las pruebas nuevas quedan excluidas por nombre `*.integration.test.ts`, mismo criterio que RNF1). `npm run prisma:migrate` aplicó la migración en Windows sin problemas; **`npm run test:integration` confirmado en verde por Alex: 3/3 archivos, 37/37 tests** (incluye las dos pruebas nuevas de abajo más las ya existentes de RF1-RF7).

La primera corrida en Windows encontró (y se corrigió, commit `56cf8dd`) dos bugs reales que solo una base Postgres real podía exponer — ninguno en `crearCadenaCompleta()` ni en el schema, los dos en el código de las pruebas: (1) el `create` manual de `HallazgoCadena` en el fixture de `aislamientoMultitenant.integration.test.ts` no pasaba `empresaId` — a diferencia de `crearCadenaCompleta()` (que usa `tenantTransaction()`, con inyección automática), un `create` sobre el `tx` crudo de `bajoTenant()` no inyecta nada, hay que pasarlo a mano; (2) la prueba de `crearCadenaCompleta()` consultaba `FlujoConexionCadena` vía `tenantClient()`, pero esa tabla a propósito no está en `TENANT_SCOPED_MODELS` (tabla hija sin `empresaId` propio) — `tenantClient()` la deja pasar sin fijar `app.tenant_id`, y RLS bloqueaba todo (falló cerrado, tal como tiene que funcionar). Corregida consultándola bajo un `set_config` manual, mismo patrón que el resto de las tablas hijas sin `empresaId`.

**Nota de limpieza, no bloqueante:** la primera corrida fallida dejó un tenant sintético huérfano en Neon (`"Empresa piloto A (prueba RNF1, borrar si queda huerfana)"`, nombrado a propósito para poder encontrarlo) — aislado por RLS, sin datos reales, se puede borrar cuando haya tiempo.

Pruebas de integración escritas, ya confirmadas en verde contra Neon real:
- `src/infra/mapa/__tests__/crearCadenaCompleta.integration.test.ts` (nuevo): camino feliz (Cadena+Nodos+ConexionCadena+Flujos creados con `empresaId` correcto sin pasarlo a mano, confirmando que `buildScopedTx()` lo inyecta bien — el riesgo concreto de abajo, "error de tipeo en el nombre de un modelo"), atomicidad (una conexión duplicada fuerza `P2002` a mitad de la transacción → se verifica que Cadena/Nodos/ConexionCadena NO quedan huérfanos), y los tres errores de validación de forma (índice inválido, auto-referencia, sin flujos).
- `src/infra/prisma/__tests__/aislamientoMultitenant.integration.test.ts` (extendido, no nuevo): el fixture de cada tenant ahora también crea una Cadena completa vía `crearCadenaCompleta()` (dogfooding) más un `HallazgoCadena`, con nuevos casos en capa 1 (`tenantClient()`) y capa 2 (RLS) para las 4 tablas nuevas — mismo criterio que ya cubre `RespuestaCruda`/`ResultadoConexion`/`ResultadoCiclo`. De paso, el borrado del fixture (`borrarFixtureTenant()`) tuvo que agregar un `deleteMany()` manual de `conexionCadena` antes de borrar la `Empresa`: `conexiones_cadena → nodos` es `ON DELETE RESTRICT`, mismo hallazgo de orden de cascade ya documentado para `RespuestaCruda`/`Usuario` — sin este borrado manual, el `afterAll` de la prueba fallaría.

**Riesgos concretos:**
- `tenantClient()` inyecta el filtro de tenant modelo por modelo (`injectTenantFilter`) asumiendo una sola FK de tenant por tabla (`empresaId` o `id` para `Empresa`). Una operación que cree `Cadena` + `Nodo`s + `ConexionCadena`s en un solo `create` anidado de Prisma (`data: { nodos: { create: [...] } }`) **no** pasa por `injectTenantFilter` en las tablas hijas anidadas — hay que verificar explícitamente que cada tabla hija reciba su `empresaId` propio, porque el extend de Prisma actual no inspecciona escritura anidada, solo el nivel superior de cada operación.
- El propio comentario de `tenantClient.ts` documenta que los tipos de `$allOperations` están tipados `any` "a propósito" a la espera de correr `prisma generate` con red real — cualquier error de tipeo en el nombre de un modelo nuevo (`ConexionCadena` vs. `conexionCadena` en `uncapitalize()`) no lo va a atrapar el compilador, solo un test de integración en Windows. Vale la pena un test de integración específico por cada tabla nueva que confirme que el filtro de tenant se aplica (mismo criterio que ya existe para `RespuestaCruda`/`ResultadoConexion`/`ResultadoCiclo`).

**Ambos riesgos resueltos en la implementación real (2026-09-20):** `crearCadenaCompleta()` nunca usa `create` anidado — cada `Cadena`/`Nodo`/`ConexionCadena` se crea con su propio `tx.X.create()` de nivel superior, exactamente para que cada uno pase individualmente por `injectTenantFilter()` (evita el primer riesgo por diseño, no por casualidad). El segundo riesgo queda cubierto por `crearCadenaCompleta.integration.test.ts`, que verifica explícitamente `empresaId` en las tres tablas — pendiente de correr en Windows para confirmarlo contra Neon real.

#### Bloque B — Mapa visual interactivo
**Esfuerzo: M.** Justificación: es una librería nueva (`@xyflow/react`) con una curva de integración conocida (React Flow es standard, buena documentación), pero el indicador "foto puntual vs. serie temporal" y el layout con 4-5 tipos de nodo (organización/área/instalación/proceso/persona/sistema) es trabajo de UI real, no solo "instalar y listo".

- [x] **Hecho 2026-09-20 (commit `62586c9`):** `POST`/`GET /api/cadenas` (RF27) — crea solo la `Cadena` en sí (nombre/productoServicio/periodo/tipoOperacion), **a propósito sin nodos ni conexiones en el payload**. Corrección respecto a una lectura previa de este mismo plan (se había planteado un formulario con filas dinámicas de Nodos/Conexiones): RF34 (`requirements.md` Sección 14.3) exige explícitamente que los nodos y conexiones se declaren "directamente sobre el propio mapa, sin pasar por una pantalla de formulario separada para cada operación" — así que `crearCadenaCompleta()` (Bloque A) se llama aquí siempre con `nodos: []`/`conexiones: []`; declarar un Nodo o una `ConexionCadena` individual sobre una Cadena ya existente queda para el siguiente paso de este mismo Bloque (edición interactiva sobre el canvas), no para este formulario.
- [x] **Hecho 2026-09-20 (commit `62586c9`):** Instalado `@xyflow/react` (`^12.11.6`, JS puro, sin binarios nativos — instaló sin problemas vía el device bridge de la Mac). Construido `MapaCadenaCanvas.tsx` (`/dashboard/cadenas/[id]`, Server Component padre resuelve `nodos`/`conexiones`/`flujos` ya filtrados por tenant y se los pasa como props, mismo patrón que `ciclos/[id]/responder`) — **de solo lectura por ahora**: nodos coloreados/etiquetados por `TipoNodo` (6 tipos, Tailwind a mano), aristas etiquetadas con la lista de flujos de cada `ConexionCadena`. `/dashboard/cadenas` (lista + formulario de creación) y un card nuevo en el panel principal, mismo patrón visual que eslabones/conexiones/ciclos.
- [x] **Hecho -- este ítem estaba desactualizado, la funcionalidad ya existía.** Creación y edición interactiva de nodos/conexiones directamente sobre el canvas (RF34): botón "Agregar nodo" (`crearNodo()`), arrastrar de un nodo a otro (`onConnect`), editar/borrar una conexión desde el panel (ver más abajo, hecho 2026-09-23). Rutas granulares (`POST /api/cadenas/:id/nodos`, `POST/DELETE/PATCH .../conexiones/:id`) ya construidas. Corregido al revisar este documento el 2026-09-24 (Alex: "actualiza las casillas obsoletas").
- [x] **Hecho 2026-09-24 (commit `0f9af69`):** los 15 campos de RF30-33 (requerimiento recibido, coincidencia con lo pedido, oportunidad de la información, impacto/alternativa/tiempos, estado de evidencia) se exponen ahora en el panel de edición de una conexión del mapa (5 `fieldset` nuevos), guardados en la misma transacción que los flujos (`actualizarFlujosConexionCadenaAtomico`). RF35: como no existe ningún mecanismo de serie temporal para estos campos (una sola fila, un solo `updatedAt`), se agregó un único badge de "Foto puntual" para toda la sección (no uno por campo) con la fecha de `updatedAt`, dejando explícito que es una declaración puntual y sin sugerir monitoreo continuo por omisión. Validado en Mac: typecheck/lint limpios, test 173/173. **Pendiente de validar en Windows:** guardar datos vía el panel contra Neon real, confirmar que el badge y los valores precargan correctamente al reabrir una conexión.
- [x] **Hecho 2026-09-23:** columnas de posición (`posX`/`posY`, nullable) en `Nodo` (migración `20260923050000_nodo_posicion_canvas`) — `MapaCadenaCanvas.tsx` persiste la posición al soltar el arrastre (`onNodeDragStop` → `PATCH /api/cadenas/:id/nodos/:nodoId`, ruta nueva) y cae al layout en grilla anterior cuando `posX`/`posY` son `null` (todo nodo que nunca se arrastró). Validado en Windows contra Neon real (2026-09-23).
- [x] **Hecho 2026-09-23:** conectar nodos por los 4 lados del canvas (arriba/derecha/abajo/izquierda), no solo verticalmente — pedido explícito de Alex tras probar el mapa. `NodoCadenaVisual` (4 `Handle`, `connectionMode="loose"`) + `connectionRadius={40}` para que el arrastre enganche cómodo. El arrastre en sí ya funcionaba, pero la línea se dibujaba siempre arriba y volvía a "arriba" en cada recarga — causa real (confirmada leyendo `@xyflow/system`): un `Edge` sin `sourceHandle`/`targetHandle` explícitos usa el primer `Handle` declarado del nodo. Fix: se capturan y persisten (`origenHandleId`/`destinoHandleId`, `ConexionCadena`, migración `20260923070000_conexion_cadena_handle_lados`, nullable — conexiones previas caen al comportamiento anterior hasta que se recreen). Validado en Windows (2026-09-23): migración aplicada contra Neon real, conectar por cualquiera de los 4 lados dibuja la línea en el lado real, confirmado.
- [x] **Hecho 2026-09-23:** borrar y editar una `ConexionCadena` ya creada desde el canvas — pedido explícito de Alex ("no te permite alterar las líneas"). Click en una arista abre el mismo panel de checkboxes que crear, precargado; "Guardar cambios" hace `PATCH`, "Eliminar conexión" (botón, o Supr/Backspace con el panel abierto) pide confirmación y hace `DELETE` — ruta nueva `/api/cadenas/:id/conexiones/:conexionId` (`DELETE`+`PATCH`). Validado en Windows (2026-09-23).
- [x] **Hecho 2026-09-23:** A2 de la revisión externa — Alex reprodujo en vivo "Transaction API error: Unable to start a transaction in the given time" en `dashboard/page.tsx`. Causa real: Neon duerme la base tras inactividad y la primera conexión tras despertar puede tardar más que el default de Prisma para arrancar una transacción (`maxWait` 2000ms/`timeout` 5000ms) — las pruebas de integración ya venían trabajando este mismo problema con un `TX_OPTIONS` propio, pero el código de producción nunca lo recibió. `tenantClient()` (envuelve CADA operación en su propia transacción, la ruta más usada de toda la app) y `tenantTransaction()` (ningún llamador pasaba `options`) ahora usan `TX_OPTIONS_NEON = {maxWait: 15000, timeout: 20000}` por default (`tenantScope.ts`). No requiere migración. Pendiente de validar en Windows (que el error no vuelva a aparecer navegando normalmente).

**Riesgo ya resuelto por el propio schema, no hacía falta resolverlo en el componente:** el riesgo original de "aristas paralelas entre el mismo par de nodos" no aplica — `ConexionCadena` tiene `@@unique([origenNodoId, destinoNodoId])`, así que solo puede existir **una** conexión (con sus múltiples flujos adentro) por par dirigido de nodos. El componente no necesita ningún patrón de renderizado para aristas paralelas.

#### Bloque C — Participación multi-rol e invitaciones a conexión/cadena
**Esfuerzo: M.** Justificación: extiende un mecanismo ya construido (invitación con JWT stateless de RF4), pero el cálculo de 4 estados de comparación (`acuerdo`/`acuerdo parcial`/`diferencia`/`sin respuesta suficiente`) es lógica de negocio nueva.

**Riesgo del stateless ya resuelto (2026-09-24):** Alex decidió explícitamente mantener el mecanismo sin cuenta ni tabla de invitaciones — el invitado responde por link, identificado solo por el email del token, sin crear `Usuario` (ver AskUserQuestion de esa fecha). La necesidad de "listar invitaciones pendientes/aceptadas" que este riesgo anticipaba no aplica: la comparación de RF38 se calcula sobre las filas de `RespuestaCadena` ya guardadas, nunca sobre una lista de invitaciones enviadas.

- [x] **Paso 1 — hecho 2026-09-24 (commit `46600fa`):** `src/infra/auth/invitacion.ts` gana `crearTokenInvitacionCadena`/`verificarTokenInvitacionCadena` (audience de JWT propia, distinta de la invitación de eslabón de RF4). Modelo nuevo `RespuestaCadena` (`prisma/schema.prisma` + migración a mano `20260924000000_respuesta_cadena`, RLS+GRANT en la misma migración) con 3 enums propios (`PromesaPrincipalCadena`/`ConocimientoEntradaSalida`/`FuenteDatosCadena`, vocabulario inspirado en Q1/Q3/Q5 del cuestionario V2 pero SIN ninguna relación con el sistema versionado de `PreguntaVersion`/RF19-26) más los enums/FKs ya existentes que reutiliza (`DuracionCategorica`, `Nodo` para "nodo crítico", los booleans de alternativa). `POST /api/cadenas/:id/invitar` (nuevo, `requireSession()`) genera el token y manda el correo (`enviarInvitacionCadena` en `resend.ts`). Botón "Invitar" (toda la cadena) y "Invitar a esta conexión" (dentro del panel de edición) en `MapaCadenaCanvas.tsx`. Validado en Mac: typecheck/lint/test limpios (153/153). **Pendiente de validar en Windows:** `npm run prisma:migrate` contra Neon real + confirmar que el botón "Invitar" manda el correo.
- [x] **Paso 2 — hecho 2026-09-24:** página pública `src/app/invitacion-cadena/responder/page.tsx` (Server Component, verifica el token, resuelve cadena/empresa/conexión/lista de nodos vía `tenantClient()`, "cinturón y tirantes" igual que la ruta que emite el token) + `ResponderCadenaForm.tsx` (client, una sola pantalla, 2 preguntas para alcance "cadena completa" o 4 para "conexión puntual", cada select puede quedar en "Prefiero no responder" -> null, mismo criterio de minimalismo que `ConexionForm.tsx`). `POST /api/invitacion-cadena/responder` (nuevo, público, sin `requireSession()`) valida con Zod, deriva el alcance del propio token (nunca del body, para que RF37 no pueda burlarse mandando campos de más), y hace el find-then-create-or-update manual a mano sobre `RespuestaCadena` (no `upsert()` de Prisma, ver comentario del modelo en `schema.prisma`). Reabrir el mismo link precarga la respuesta ya guardada y la actualiza en vez de duplicarla. Validado en Mac: typecheck/lint/test limpios (153/153, sin regresiones). **Nota sobre RNF15 -- resuelta:** RNF15 decía literalmente que el token "debe expirar y dejar de ser válido tras su uso" (lectura de uso único), en tensión con permitir reabrir el mismo link para corregir una respuesta (decisión de Alex del 2026-09-24). Confirmado con Alex (2026-09-24, "sí debe expirar por temas de seguridad" referido al plazo fijo) que la garantía real es la expiración de 7 días + verificación de firma en cada apertura, no el primer uso -- `requirements.md` (doc del Proyecto de Claude, no la copia del repo) ya quedó reescrito con esta aclaración; no hizo falta tocar código.

**Fix post-Mac (commit `684929b`, 2026-09-24):** el primer `npm run typecheck` en Windows (con el cliente Prisma completo, `prisma generate` sin bloqueo de red) encontró un error real que Mac no detectó: al `create()` de `RespuestaCadena` le faltaba `empresaId` explícito -- en runtime no rompía nada (`injectTenantFilter()` lo inyecta igual), pero el tipo generado lo exige como campo no opcional. Mismo patrón ya usado en `cadenas/[id]/nodos/route.ts` y `conexiones/route.ts`; se aplicó el mismo fix. **Confirmado en Windows (2026-09-24):** típecheck/lint/test limpios (153/153) contra el cliente Prisma real.

**Validado a mano en el navegador contra Neon real (Alex, 2026-09-24):** respuestas de "cadena completa" y "conexión puntual" guardan y precargan correctamente al reabrir el link.

**Bug encontrado durante esa prueba y corregido (commit `6ffd225`):** en el panel "Invitar a esta conexión", cualquier Backspace/Supr tipeado en el campo de email disparaba el `window.confirm()` de "eliminar conexión" en vez de borrar el carácter -- el listener global de teclado para borrar la conexión seleccionada no distinguía si el foco estaba en un input de texto. Corregido para que ese atajo solo actúe con el foco en el lienzo, no en un campo editable.

**Paso 2 -- cerrado.**
- [x] **Paso 3 — hecho 2026-09-24 (commit `1d9c20b`):** `src/engine/cadena/compararCadena.ts` (motor puro, módulo hermano de `engine/v2/` en vez de dentro de él -- concepto distinto: comparación multi-participante, no diagnóstico de un solo respondente) compara las respuestas de una `Cadena`/`ConexionCadena` en las 6 dimensiones de RF38 y devuelve uno de los 4 estados. **Nota para Alex -- criterio de diseño, no validado con datos reales:** RF38/RF39 definen los 4 estados pero no un algoritmo exacto para "acuerdo parcial" vs "diferencia"; usé una interpretación razonable (dimensiones categóricas sin punto medio -- prioridad, nodo crítico, fuente de datos -- van directo a "diferencia"; las 2 dimensiones ordinales -- conocimiento de entradas/salidas, momento de información -- son "parcial" si las respuestas están en posiciones adyacentes y "diferencia" si están en los extremos; alternativa disponible trata el desacuerdo sobre si existe como lo central y si fue probada como un matiz menor). Documentado en detalle en el propio archivo -- avisame si preferís otro criterio, es un ajuste local sin tocar el resto. `src/infra/cadena/persistirHallazgosCadena.ts` persiste solo las dimensiones en "diferencia" como fila de `HallazgoCadena` (lectura literal de RF39: "cuando resulta en diferencia... registrarla como hallazgo") y borra la fila si una respuesta corregida deja de ser diferencia. `POST /api/invitacion-cadena/responder` recalcula el alcance tocado después de guardar. El dashboard de la cadena muestra la lista de diferencias detectadas, sin atribuir culpa (RF39). Nueva migración `20260924010000_hallazgos_cadena_unique` (dos índices únicos parciales, mismo patrón que `respuestas_cadena`) -- **requiere `npm run prisma:migrate` en Windows** antes de probar contra Neon real. Validado en Mac: typecheck/lint limpios, test 173/173 (20 nuevos para el motor).

**Validado end-to-end contra Neon real (Alex, 2026-09-24):** invitó a dos personas a la misma conexión, una respondió "corto" y otra "largo" en la dimensión ordinal de momento de información -> el hallazgo de diferencia apareció correctamente en el panel "Diferencias de percepción detectadas" del dashboard de la cadena. Confirma en vivo el criterio de diseño documentado arriba (distancia entre posiciones ordinales, sin acuerdo parcial cuando la distancia es mayor a 1). **Paso 3 -- cerrado.**

**Incremento 3 -- cerrado por completo.** Bloque A, B y C sin ítems pendientes. Único punto abierto: validar en Windows contra Neon real el guardado/precarga de los datos RF30-33 y el badge RF35 (ver ítem de arriba) -- mismo patrón que otras piezas de este incremento que ya se dieron por "hechas en Mac, pendiente de confirmar en Windows".

---

### Incremento 4 — Indicadores

#### Bloque A — Catálogo de KPIs (`DefinicionKpi`/`ObservacionKpi`)
**Esfuerzo: S.** Justificación: los 10 KPIs ya están definidos con fórmula/campos exactos en MVP-DEFINITIVO — es transcripción a schema + función de cálculo por KPI, sin ambigüedad de diseño.

- [x] **Hecho 2026-09-24 (commit `e44d8ed`):** `DefinicionKpi` (catálogo de plataforma sin `empresaId`, mismo patrón versionado que `CuestionarioVersion` -- codigo+numero+estado, índice único parcial `uq_definicion_kpi_publicada`) + `ObservacionKpi` (tenant-scoped, referencia `Cadena`+`DefinicionKpi`, agregada a `TENANT_SCOPED_MODELS`+RLS). Migración escrita a mano (`prisma/migrations/20260924020000_incremento4_kpis_bloque_a/`). Seed de los 10 KPIs (`prisma/seedDefinicionesKpi.ts`, `npm run seed:definiciones-kpi`), mismo patrón bootstrap sin curador que `seedCuestionarioV2.ts`. **Aplicado y validado en Windows contra Neon real el 2026-09-24:** `prisma migrate dev` aplicó la migración original limpio, pero `prisma migrate diff` reveló dos diferencias reales entre el SQL escrito a mano y `schema.prisma` -- la FK de `curadorId` sin `ON DELETE SET NULL ON UPDATE CASCADE` (el default de Prisma para una relación opcional) y un índice único con nombre truncado distinto al que genera Prisma. Corregido con una migración nueva y separada (`prisma/migrations/20260924030000_incremento4_kpis_bloque_a_fix/`, commit `35e6c49`) generada literalmente a partir de la salida de `migrate diff` -- nunca se edita una migración ya aplicada. Tras aplicarla, `npm run seed:definiciones-kpi` publicó los 10 `DefinicionKpi` sin errores, y `typecheck`/`lint`/`test` (239/239) quedaron en verde contra el cliente de Prisma real (no el stub `any` del Mac). **Pendiente, no bloqueante:** no existe todavía ninguna prueba de integración que ejercite la política RLS de `observaciones_kpi` contra Neon real (mismo patrón que `aislamientoMultitenant.integration.test.ts` para las demás tablas tenant-scoped) -- tiene sentido escribirla cuando Bloque B empiece a insertar filas reales, no antes.
- [x] **Hecho 2026-09-24 (commit `e44d8ed`):** 10 funciones puras de cálculo (OTIF, Fill Rate, Stockout, Cobertura, Lead time, Variabilidad de lead time, OTIF proveedor, Tiempo de detección/decisión/recuperación) en `src/engine/kpis/`, factorizadas sobre 3 agregadores genéricos compartidos (`calcularRatio`/`calcularPromedio`/`calcularDesviacionEstandar` en `compartido.ts`) -- mismo criterio de pureza y "helper compartido" que `engine/v2/dimensionSimple.ts`. Validado en Mac: typecheck/lint limpios, test 216/216 (43 nuevos). **Nota para Alex (SUPERADA -- ver revisión 2026-09-24 más abajo):** diseño original, no validado con datos reales: Stockout interpretaba "base definida" como el total de observaciones evaluadas (no días-SKU); Cobertura agregaba varias filas como promedio ponderado (suma inventario / suma consumo), no promedio simple por SKU. Ambos criterios fueron revisados por Alex y reemplazados -- ver el bullet siguiente. Bloque A **no** incluye ingreso de datos ni UI -- eso es Bloque B (XL), sin construir todavía; estas funciones son las que Bloque B llamará una vez exista el flujo de ingreso.
- [x] **Revisión cerrada 2026-09-24 (commit `27bc9fa`):** Alex revisó en dos rondas las definiciones de Stockout y Cobertura del bullet anterior ("las dos decisiones necesitan quedar explícitas antes de aprobarlas") y entregó las reglas literales que reemplazan el diseño original. **Stockout** ("Porcentaje de observaciones sin stock"): observación = SKU+ubicación+fecha de corte; duplicados idénticos se colapsan, duplicados en conflicto se excluyen y se señalan para resolver a mano (nunca se elige un ganador en silencio); stock faltante/no numérico se excluye y se informa, nunca se convierte en 0; sin observaciones válidas → "Sin datos suficientes"; la limitación de peso por frecuencia de observación ahora está documentada en `DefinicionKpi.descripcion`, no solo en el código. **Cobertura**: cálculo SIEMPRE por SKU+ubicación -- se eliminó por completo el agregado opcional (Σinventario/Σconsumo) de la primera ronda, ya que "la agregación de cobertura entre SKU queda fuera de esta implementación hasta acordar su metodología"; nuevos estados por fila: `DATOS_INCOMPLETOS`, `VALOR_NEGATIVO` (señalado, nunca convertido silenciosamente), `UNIDADES_INCOMPATIBLES` (requiere `unidadInventario`/`unidadConsumoDiario` declaradas y coincidentes), `DUPLICADO` (mismo criterio de colapso/conflicto que Stockout); consumo cero → "Sin consumo de referencia"; inventario cero con consumo positivo → 0 días (resultado válido). Ambas definiciones quedaron versionadas en el catálogo funcional (`prisma/seedDefinicionesKpi.ts`: `nombre`/`descripcion`/`formula` con el texto literal de Alex + nuevo campo `reglasExclusion` JSON documentando observación única, duplicados, datos faltantes, valores negativos y unidades incompatibles), no solo en código. Tests nuevos para el ejemplo literal de Alex, duplicados (colapso/conflicto), datos incompletos, denominador vacío, consumo cero, valores negativos y unidades incompatibles. Validado en Mac: typecheck/lint limpios (solo los 5 falsos positivos conocidos de `Prisma.InputJsonValue` por el cliente stub), test 231/231 (15 nuevos). Ambas reglas siguen siendo "propuestas para el MVP, no resultados validados con datos reales" (Alex, 2026-09-24) -- la validación contra datos reales queda pendiente para cuando exista Bloque B.
- [x] **Precisiones adicionales cerradas 2026-09-24 (commit `1f4ecda`, tercera ronda):** Alex agregó precisiones sobre la fecha de corte y los valores crudos, más la corrección de encabezado a "Implementemos estas reglas para evitar interpretaciones ambiguas". **Fecha de corte por zona horaria:** Stockout y Cobertura calculaban el día calendario en UTC; ahora usan un helper compartido (`diaEnZona`, `Intl.DateTimeFormat`) que recibe una zona horaria IANA explícita como parámetro obligatorio -- "usar una fecha diaria según la zona horaria definida para la cadena". **Nota abierta para Alex:** el schema hoy no tiene un campo de zona horaria en `Cadena` (solo existe `DefinicionKpi.zonaHoraria`, un default sugerido por KPI, no por cadena) -- de dónde sale el valor real que Bloque B le pasará a estas funciones sigue siendo una decisión de schema pendiente. **Bug corregido en Cobertura:** la clave de duplicados solo usaba SKU+ubicación, sin la fecha -- dos observaciones del mismo SKU+ubicación en fechas distintas se trataban incorrectamente como posible duplicado/conflicto; ahora la clave es SKU+ubicación+fecha de corte, igual que Stockout. **Stockout con valor crudo:** `FilaStockout.conStock` (booleano pre-derivado) se reemplazó por `stockDisponible: number | null` (valor crudo con signo) -- un saldo negativo cuenta como observación sin stock (igual que antes) y además se señala aparte como anomalía para revisión, sin excluirse. Catálogo funcional (`reglasExclusion`) actualizado con estas precisiones. Validado en Mac: typecheck/lint limpios, test 239/239 (8 nuevos).

#### Bloque B — Ingreso progresivo + almacenamiento
**Esfuerzo: XL.** Justificación: es la pieza más grande del incremento — toca storage externo (R2, servicio nuevo nunca usado en el proyecto), un sanitizador de seguridad real (inyección de fórmulas CSV), la cola de jobs para el procesamiento asíncrono, y una UI de 3 niveles (manual/pegado/CSV) con previsualización obligatoria antes de persistir.

- [ ] Cliente R2 (S3-compatible) en `src/infra/storage/` — primer código del proyecto que habla con un servicio externo de objetos; no hay ningún patrón previo que copiar (Resend es el único servicio externo hoy, y es fire-and-forget, no bidireccional con URLs firmadas).
- [ ] URL temporal de subida/descarga firmada.
- [x] **Hecho 2026-09-24 (adelantado, no depende de R2):** función pura de sanitización de inyección de fórmulas CSV -- `src/domain/sanitizacionCsv.ts` (`esFormulaPeligrosa`/`sanitizarCeldaTexto`/`sanitizarFilaCsv`). Detecta `=`, `+`, `-`, `@` al inicio de celda (los 4 marcados en este documento -- OWASP también marca tab/retorno de carro, no incluidos por no ser parte de la especificación original) y neutraliza prefijando con apóstrofo en vez de borrar el carácter, para no corromper un valor legítimo como "-5" si algún día llega ahí por error de mapeo. Aplica solo a campos de texto libre (SKU, ubicación, pedido, etc.) -- nunca a campos numéricos/fecha, donde un "-" inicial es un signo legítimo que se parsea antes de llegar acá. Todavía no integrado a ningún flujo real (no hay `PapaParse` instalado ni importador -- eso sigue esperando R2 y el resto del bloque). Validado en Mac: typecheck/lint limpios, test 249/249 (10 nuevos).
- [ ] Flujo: subir a R2 → job de pg-boss parsea y mapea columnas → UI de previsualización (filas detectadas, campos mapeados, errores) → confirmación explícita del usuario → recién ahí persistencia — la regla dura de MVP-DEFINITIVO ("nunca persistir sin mostrar y autorizar") aplica letra por letra.

**Riesgos concretos:**
- **Revisado 2026-09-24 (adelantado, no depende de R2) -- resuelto para 9 de los 10 KPIs, hueco real encontrado para Cobertura.** `ObservacionKpi` ya tiene `@@unique([cadenaId, definicionKpiId, periodoInicio, periodoFin, fuente])`. Para OTIF, Fill Rate, Stockout, Lead Time, Variabilidad Lead Time, OTIF Proveedor y los 3 KPIs de Tiempo (los 9 que devuelven `ResultadoCalculoKpi` -- un solo `valor`/`numerador`/`denominador` agregado para todo el período), esa restricción YA alcanza como clave de idempotencia: el importador hace un upsert sobre esa tupla, sin necesitar ninguna clave adicional por fila de CSV -- reintentar una importación fallida simplemente reescribe la misma fila agregada, no la duplica. La nota original de este documento (clave "fecha+SKU+ubicación" por fila) asumía que cada fila cruda del CSV se persistía como su propia `ObservacionKpi` -- no es así: `ObservacionKpi` guarda el resultado agregado de una corrida de cálculo, no el detalle crudo. **Hueco real para Cobertura:** `calcularCobertura` devuelve `porSku: CoberturaPorSku[]` -- un resultado POR SKU+ubicación+fecha de corte, sin ningún agregado único ("la agregación de cobertura entre SKU queda fuera de esta implementación hasta acordar su metodología", Alex 2026-09-24) -- y `ObservacionKpi` no tiene ningún campo `sku`/`ubicación` para guardar eso: tal como está el schema hoy, el resultado de Cobertura literalmente no tiene dónde persistirse. Esto es anterior a la sanitización/dedup de este bloque -- es una decisión de schema pendiente, no de importador, y hay que resolverla antes de poder definir la clave de idempotencia de Cobertura. Opciones para Alex: (a) una tabla nueva tipo `ObservacionCobertura` con su propia clave única (cadenaId+definicionKpiId+sku+ubicación+fecha de corte+fuente), separada de `ObservacionKpi`; o (b) relajar `ObservacionKpi` agregando `sku`/`ubicación` opcionales y ajustando su restricción única para incluirlos cuando estén presentes. Sin definir esto, Cobertura no puede tener importador propio aunque el resto del bloque (R2, sanitizador, cola) ya esté listo.
- **Resuelto 2026-09-24 (adelantado, no depende de R2).** `src/domain/limitesImportacionCsv.ts`: 5 MB / 10.000 filas por importación, con el razonamiento completo documentado en el propio archivo -- el job real (`src/app/api/internal/jobs/run`) tiene `maxDuration = 60` (Vercel Hobby), y la importación procesa en lotes de ~500 filas por `tenantTransaction()`; a ~1.5s por lote, el techo teórico de una sola invocación de punta a punta (descarga R2 + parseo + lotes) ronda las 15.000 filas -- el límite elegido queda deliberadamente por debajo de ese techo, con margen. Decisión de diseño explícita: un archivo que supere el límite se RECHAZA en la previsualización, antes de encolar nada, en vez de construir seguimiento de progreso multi-invocación (un estado intermedio tipo "procesando parcial" que `EstadoImportacion` no tiene hoy) -- así el caso feliz siempre termina en un solo ciclo del job. Números de partida razonados, no medidos contra Neon real todavía -- revisables en un solo lugar si el uso real los muestra mal calibrados. Validado en Mac: typecheck/lint limpios, test 258/258 (5 nuevos).

**Deuda técnica a pagar ANTES de avanzar:** el Bloque A del Incremento 2 (cola de jobs) es prerrequisito directo — sin pg-boss ya funcionando en producción real (no solo instalado), este bloque no tiene dónde correr el procesamiento asíncrono.

**PROPUESTA 2026-09-24 — persistencia de Cobertura + modelo de idempotencia/corrección (revisión pendiente de Alex, NINGÚN cambio aplicado -- sin migración, sin código de importador).** Responde a dos cosas: (1) dónde persiste el resultado de `calcularCobertura` (hueco de schema encontrado más arriba) y (2) la corrección de Alex a la nota de idempotencia original -- "no demos por resuelto el problema... únicamente con un `upsert`", distinguiendo unicidad de idempotencia real.

*Tres claves distintas, no una sola:*

1. **Clave de observación de negocio** -- identifica QUÉ se está midiendo, sin importar cuántas veces se cargó: para Cobertura, `cadenaId + sku + ubicación + fechaCorte + fuente`. Para los otros 9 KPIs, la que ya existe en `ObservacionKpi`: `cadenaId + definicionKpiId + periodoInicio + periodoFin + fuente`.
2. **Clave de intento de importación** -- identifica QUÉ CARGA la produjo, no qué mide: `importId` (FK lógica a `ImportacionCsv`, ya diseñada en la Sección 18.3.A pero sin construir) + `numeroFila` (la fila dentro de ese archivo). Null para manual/pegado. Esta es la clave que hace un reintento seguro: reintentar el mismo `importId` reinserta las mismas filas con el mismo `numeroFila`, nunca filas nuevas.
3. **Huella de contenido** (`contenidoHash`) -- un hash estable (SHA-256 sobre un JSON con claves ordenadas, para que el hash no dependa del orden de propiedades) de los campos de negocio + la versión de fórmula (`ruleVersion`) vigentes al calcular. Sirve para distinguir, ante la MISMA clave de observación: ¿esta carga trae el mismo dato que ya existe (reintento seguro, no-op) o uno distinto (corrección real, o conflicto)?

*Corrección de la nota original del documento:* la restricción única que ya tiene `ObservacionKpi` (para los 9 KPIs) resuelve la clave de intento para manual/pegado (reingresar el mismo período por error no duplica), pero el propio comentario de cabecera de `ObservacionKpi` en `schema.prisma` ya dejaba dicho que CSV necesita su propia clave (`importId+numeroFila`, todavía sin agregar) -- mi resumen anterior a Alex no mencionó esa distinción con suficiente claridad. Además, tal como está hoy, reingresar el mismo período+fuente para esos 9 KPIs hace un upsert que SOBREESCRIBE en silencio, sin historial -- exactamente lo que la revisión de Alex objeta en general. Cambiar ESO requeriría tocar una tabla ya migrada (`d78c880`/`35e6c49` en adelante); lo dejo como pregunta abierta para Alex al final, no lo resuelvo acá.

*Esquema propuesto (Prisma, sin aplicar):*

```prisma
enum EstadoObservacionCobertura {
  CALCULADA
  SIN_CONSUMO_REFERENCIA
  DATOS_INCOMPLETOS
  VALOR_NEGATIVO
  UNIDADES_INCOMPATIBLES
  // DUPLICADO no aplica aca: calcularCobertura() ya excluye los
  // duplicados en conflicto ANTES de llegar a persistencia -- esta tabla
  // solo guarda resultados que superaron esa etapa en memoria.
}

model ObservacionCobertura {
  id              String        @id @default(cuid())
  empresaId       String
  empresa         Empresa       @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  cadenaId        String
  cadena          Cadena        @relation(fields: [cadenaId], references: [id], onDelete: Cascade)
  // Siempre el id de la DefinicionKpi "COBERTURA" -- FK a la version
  // vigente del catalogo funcional, no un enum/string KPI redundante
  // (mismo criterio que ObservacionKpi -- no hace falta un campo KPI
  // aparte cuando definicionKpiId ya lo identifica).
  definicionKpiId String
  definicionKpi   DefinicionKpi @relation(fields: [definicionKpiId], references: [id], onDelete: Restrict)

  // -- Clave de observacion de negocio --
  sku       String // normalizado: trim + colapsar espacios internos + mayusculas -- NUNCA se tocan ceros iniciales ni otros caracteres (ver nota de normalizacion abajo)
  ubicacion String // idem
  fechaCorte             DateTime @db.Date // fecha de NEGOCIO (solo dia, no DateTime con hora) -- evita que una medianoche UTC se lea como el dia anterior en la UI
  zonaHorariaReferencia  String   // la zona horaria IANA usada por diaEnZona() para calcular fechaCorte -- se guarda para poder auditar/recalcular, nunca se asume despues

  inventarioDisponible  Float?
  unidadInventario      String
  consumoDiarioEsperado Float?
  unidadConsumoDiario   String
  // Regla de Alex (ronda 3): el consumo esperado debe recibirse como
  // dato, con fuente y periodo de referencia declarados -- nunca
  // inferido en silencio.
  fuenteConsumo                  String
  periodoReferenciaConsumoInicio DateTime?
  periodoReferenciaConsumoFin    DateTime?

  coberturaDias Float?
  estado        EstadoObservacionCobertura
  ruleVersion   String // RULE_VERSION_KPIS al momento del calculo -- nunca se reescribe con una version distinta (ver "version de formula" abajo)

  fuente String // "manual" | "pegado" | "csv" -- canal de ingreso, mismo criterio que ObservacionKpi.fuente. NO es el identificador estable de origen que pediste -- ver nota abajo.

  // -- Clave de intento de importacion --
  importId   String? // FK logica a ImportacionCsv -- el id (cuid) de esa fila ES el identificador estable de origen para CSV, nunca el nombre del archivo (que puede repetirse entre subidas distintas). Null para manual/pegado.
  numeroFila Int?    // fila dentro de ese importId. Null para manual/pegado.

  // -- Huella de contenido --
  contenidoHash String // sha256 de {sku, ubicacion, fechaCorte, inventarioDisponible, unidadInventario, consumoDiarioEsperado, unidadConsumoDiario, fuenteConsumo, periodoReferenciaConsumo*, ruleVersion} con claves ordenadas

  // -- Correccion / vigencia --
  vigente          Boolean   @default(true) // false si una carga posterior la reemplazo o la retiro explicitamente
  reemplazadaPorId String?   // FK logica a la fila que la reemplazo (correccion con reemplazo) -- null si sigue vigente, o si fue retirada SIN reemplazo (ver caso 4 abajo)
  reemplazadaEn    DateTime?

  createdAt DateTime @default(now())

  // Evita duplicar EXACTAMENTE el mismo intento -- no resuelve por si
  // sola "mismo contenido -> no-op" vs. "distinto contenido -> conflicto"
  // ni el modelo de correccion; esa logica vive en el importador,
  // comparando contra la fila vigente de la misma clave de negocio. Ver
  // los 4 casos con ejemplos mas abajo.
  @@unique([cadenaId, sku, ubicacion, fechaCorte, fuente, importId, numeroFila], map: "uq_observacion_cobertura_intento")
  @@index([empresaId])
  @@index([cadenaId])
  @@index([definicionKpiId])
  // Consulta real: "dame la cobertura vigente de este SKU/ubicacion/fecha".
  @@index([cadenaId, sku, ubicacion, fechaCorte, fuente, vigente])
  @@map("observaciones_cobertura")
}
```

RLS: mismo patrón que `observaciones_kpi` (`empresaId` propio, comparación directa contra `app.tenant_id`), agregada a `TENANT_SCOPED_MODELS`. `GRANT SELECT, INSERT, UPDATE, DELETE ... TO chainpulse_app` en la misma migración.

*Nota de normalización (SKU/ubicación):* propongo trim + colapsar espacios internos + mayúsculas, preservando todo lo demás sin tocar (ceros iniciales, guiones, cualquier carácter). Ejemplo: `"  sku-007 "` → `"SKU-007"`; `"sku-007"` y `"SKU-007"` cargados por separado se tratan como la MISMA observación. Esto es una recomendación, no un hecho: si el catálogo real de algún cliente distingue mayúsculas/minúsculas como códigos distintos, esta normalización sería incorrecta -- lo dejo como pregunta abierta.

*Los 4 casos de reintento/corrección, con ejemplos concretos (cadena "C1", SKU "A", ubicación "Lima", fecha "2026-09-20"):*

1. **Mismo intento, mismo contenido (reintento seguro).** Se reintenta `importId=IMP1, numeroFila=5` tras un timeout de red, con exactamente el mismo CSV. `contenidoHash` coincide con la fila ya persistida para esa clave de intento → no se inserta nada nuevo, se devuelve la fila existente. El `@@unique` de arriba ya lo impide a nivel de base (INSERT ... ON CONFLICT DO NOTHING, después SELECT).
2. **Mismo intento, contenido distinto (anomalía, no una corrección).** `importId=IMP1, numeroFila=5` se reintenta pero con un valor distinto de `inventarioDisponible` -- esto no debería pasar nunca en un reintento real (el archivo no cambia entre reintentos), así que se trata como error/anomalía a investigar, nunca se sobrescribe en silencio. El job de importación lo reporta como fallo, no como éxito parcial.
3. **Intento nuevo, misma clave de negocio, contenido distinto (corrección explícita).** Una nueva carga `importId=IMP2` trae `SKU A, Lima, 2026-09-20` con un inventario corregido. La fila anterior (de `IMP1`) se marca `vigente=false, reemplazadaPorId=<id de la fila nueva>, reemplazadaEn=now()`; se inserta la fila nueva con `vigente=true`. Nunca un UPDATE en el lugar -- el historial completo queda consultable (mismo criterio "nunca se elige un ganador en silencio" que ya usan Stockout/Cobertura en memoria, aplicado ahora a la persistencia).
4. **Corrección con MENOS SKU que la carga anterior.** `IMP1` cargó A, B y C para `2026-09-20`; la corrección `IMP2` solo trae A y B (C se dejó de reportar, a propósito o por error). Sin un paso explícito, C quedaría `vigente=true` de `IMP1` para siempre, aunque ya no la reporte nadie -- exactamente el riesgo que señalaste. Propuesta: al confirmar una corrección, el usuario declara explícitamente el alcance que está corrigiendo (cadena + rango de `fechaCorte` + fuente -- nunca inferido en silencio del contenido del archivo, para no retirar SKU de fechas que el archivo ni tocaba); cualquier fila `vigente=true` dentro de ese alcance que NO esté en la nueva carga se marca `vigente=false, reemplazadaEn=now(), reemplazadaPorId=null` (retirada sin reemplazo, un caso distinto de "reemplazada por una fila nueva"). Esto es una decisión de producto, no solo de schema -- cómo declara el usuario "estoy corrigiendo este alcance" es parte del diseño de la UI de previsualización de Bloque B, todavía sin construir.

*Versión de fórmula:* una fila ya persistida nunca cambia su `ruleVersion` (mismo principio ya documentado en `RULE_VERSION_KPIS`, `engine/kpis/constantes.ts`). Si `RULE_VERSION_KPIS` sube, una corrección posterior calcula con la versión nueva, pero eso por sí solo no dispara un reproceso retroactivo de las filas vigentes calculadas con la fórmula vieja -- ¿hace falta ese reproceso explícito cuando cambia la fórmula, o las filas vigentes se quedan con la versión con la que se calcularon hasta que alguien las recargue a mano? Lo dejo como pregunta abierta -- nadie lo había planteado hasta esta revisión.

*Concurrencia y fallos parciales (para las pruebas cuando se construya el importador):* dos workers de `pg-boss` procesando el mismo `importId` en simultáneo (reintento automático + manual superpuestos) deben poder correr el mismo lote sin duplicar -- el `@@unique` de intento hace que el segundo INSERT choque y el importador lo trate como no-op, no como error. Un lote que falla a mitad de camino dentro de una `tenantTransaction()` (~500 filas, ver el riesgo ya documentado más arriba en este mismo bloque) dejaría insertadas las filas de lotes anteriores del mismo `importId` -- con la clave de intento (`importId+numeroFila`) ya construida, un reintento del job completo puede SALTAR las filas ya insertadas (no reprocesarlas) en vez de tener que revertir todo el archivo, que es lo que de verdad resuelve "reintentar un job fallido no debe duplicar". Casos a testear cuando exista el importador: (a) reintento exacto del mismo intento -- no-op; (b) dos intentos distintos con contenido distinto en la misma clave de negocio -- corrección con historial; (c) job interrumpido a mitad de los lotes, reintento completo -- las filas de los lotes ya aplicados no se duplican; (d) corrección con menos SKU que la carga anterior -- las filas ausentes quedan `vigente=false` explícitamente, nunca vigentes por omisión.

*Preguntas abiertas para Alex antes de migrar cualquier cosa de esto:*
- ¿La normalización de SKU/ubicación propuesta (mayúsculas, trim) es correcta para los datos reales, o algún cliente distingue casos?
- ¿Cómo declara el usuario el "alcance" de una corrección en la UI (ítem 4 arriba) -- selecciona un rango de fechas explícito, o se infiere del archivo? Recomiendo explícito.
- ¿Aplica el mismo modelo de corrección-con-historial (en vez del upsert silencioso actual) a los otros 9 KPIs, o se acepta el comportamiento actual de `ObservacionKpi` (upsert sin historial) para esos por ser un solo valor agregado por período, reservando el historial más caro solo para Cobertura? Esto no requiere tocar la migración ya aplicada si la respuesta es "se acepta como está".
- ¿Hace falta reproceso retroactivo cuando sube `RULE_VERSION_KPIS`, o las filas vigentes se quedan con la versión con la que se calcularon hasta que alguien las recargue?

Nada de esto se aplicó -- ni migración, ni código de importador, ni cambios a `ObservacionKpi`. Los 253 tests reportados en el commit anterior son evidencia del sanitizador y del motor de cálculo, no de este diseño ni de ningún importador (que todavía no existe).

---

### Incremento 5 — Consultas en lenguaje natural

#### Bloque A — Capa de analítica + catálogo semántico
**Esfuerzo: L.** Justificación: es diseño de un sistema nuevo de punta a punta (vistas derivadas + catálogo cerrado validado por Zod) sin ningún precedente en el repo — todo lo existente hoy consulta directamente las tablas OLTP vía Prisma.

- [ ] Vistas/tablas resumen sobre el mismo Neon (ya recomendado como suficiente, sin warehouse aparte).
- [ ] Catálogo semántico de KPIs/dimensiones como esquema Zod cerrado — el LLM **elige** de este catálogo, nunca genera SQL libre. Esto es el control de seguridad central del incremento: vale la pena escribirlo y testear su cobertura de "qué pasa si el modelo pide algo fuera del catálogo" antes de conectar cualquier proveedor de IA.

#### Bloque B — Pipeline de consulta (clasificador → constructor → ejecución → explicación)
**Esfuerzo: XL.** Justificación: son 8 piezas de arquitectura (clasificador de intención, catálogo, constructor de consulta permitida, control de tenant/permisos, motor determinístico, generador de explicación, auditoría, límites) que tienen que encadenarse correctamente y todas fallar cerrado — la superficie de riesgo de aislamiento multi-tenant más grande de todo el roadmap.

- [ ] Elegir proveedor LLM (Claude API recomendado) y aislarlo en un adapter (`src/infra/ia/`) que nunca reciba credenciales de base de datos — coherente con el principio 10 ("la IA explica, el motor calcula").
- [ ] El filtro de tenant se aplica en la capa determinística (el constructor de consulta), **nunca** como instrucción en el prompt — el prompt no es un lugar donde el aislamiento multi-tenant pueda vivir de forma confiable.
- [ ] `ConsultaAnalitica` como log append-only con auditoría completa.
- [ ] Contrato de respuesta con los 10 elementos obligatorios (§12.3) como un tipo TypeScript/Zod único, para que ninguna respuesta salga incompleta por accidente.

**Riesgos concretos — este es el incremento con el riesgo de aislamiento multi-tenant más alto de todo el roadmap:**
- Ningún patrón existente del proyecto cubre "una consulta generada dinámicamente a partir de lenguaje natural, con filtro de tenant inyectado en un paso intermedio". `tenantClient()` filtra por modelo Prisma completo, no por consulta construida dinámicamente contra una vista de analítica — hay que decidir si el constructor de consulta usa Prisma (y entonces `tenantClient()` sigue aplicando) o SQL parametrizado directo contra las vistas (y entonces hay que replicar el filtro de tenant a mano, con el riesgo real de que un caso nuevo lo omita).
- Prueba obligatoria, no opcional: intento explícito de "escape" — una pregunta en lenguaje natural que intente referirse a datos de otro tenant o pida una columna fuera del catálogo — antes de dar el incremento por cerrado, siguiendo el mismo estándar que ya se usó para RNF1 (10 pruebas de aislamiento contra Neon real).
- Instrumentar Sentry (o equivalente) **antes** de exponer el endpoint — es el primer endpoint del proyecto con un componente no determinístico (el LLM), y sin observabilidad real, un fallo silencioso del clasificador de intención no se va a detectar hasta que un usuario se queje.

---

### Incremento 6 — Investigación

#### Bloque A — Camino de acceso separado para Investigador + k-anonimato
**Esfuerzo: XL.** Justificación: es un modelo de permisos completamente nuevo (no tenant-scoped, cross-tenant por diseño) que tiene que convivir con RLS sin romperlo, más lógica de generalización/anonimización que no tiene ningún precedente matemático en el código actual.

- [ ] Camino de acceso separado (no pasa por `tenantClient()`, que es intrínsecamente por-tenant) — candidato a reutilizar el patrón `SECURITY DEFINER` ya usado en `login_lookup()` (PLAN-DE-TRABAJO §5), acotado a lo que Investigador puede ver.
- [ ] k-anonimato/generalización antes de cada `DatasetVersion` — función pura testeable (umbral mínimo de fila, supresión de celdas pequeñas).
- [ ] Confirmar que `DatasetVersion`/`DatasetContribution` no tienen FK directa a filas identificables — mismo patrón snapshot-JSON que `Hallazgo` (ya resuelto en el Incremento 2, se reutiliza aquí).

**Riesgo concreto:** `SECURITY DEFINER` es la única puerta cross-tenant que el proyecto ya usa (para resolver login sin tenant conocido), y hoy expone un conjunto de columnas fijo y pequeño (`login_lookup`). Una función `SECURITY DEFINER` para Investigador que agregue/filtre datos de **todos** los tenants es un objeto de mucho más riesgo si tiene un bug: cualquier columna de más que se filtre ahí es una fuga cross-tenant real, no un caso hipotético. Vale la pena que esta función específica tenga su propia revisión de seguridad dedicada antes de mergear, no solo el mismo nivel de revisión que el resto del código.

#### Bloque B — Preguntas sugeridas, espacio del investigador, exportación
**Esfuerzo: L.** Justificación: bastante UI y CRUD (6 estados de sugerencia, filtros múltiples, exportación CSV/JSON con diccionario de variables) pero sin la complejidad de seguridad del Bloque A.

- [ ] `PreguntaSugerida` con sus 6 estados (`RECIBIDA → AGRUPADA → CANDIDATA → EN_PRUEBA → APROBADA | RECHAZADA | ESPECIALIZADA`).
- [ ] Pantalla del investigador: filtros, comparaciones, codificación cualitativa con sugerencias de IA (reutiliza el adapter de IA del Incremento 5 — no crear un segundo cliente LLM).
- [ ] Exportación con manifiesto de versiones/transformaciones + bitácora de consultas.

---

### Incremento 7 — Market Signals

#### Bloque A — Gate de privacidad + regla de publicación
**Esfuerzo: L.** Justificación: la lógica en sí (dominancia, agregación por rango, supresión de celdas pequeñas, umbral de 20 organizaciones) es acotada, pero el gate de privacidad por segmento (recómputo dinámico, no una sola vez) es un proceso que hay que operacionalizar, no solo codificar una función.

- [ ] Camino de acceso separado para Comprador de estadísticas (mismo patrón de acceso cross-tenant acotado que Investigador, Incremento 6 — reutilizar, no reinventar).
- [ ] Regla de dominancia + agregación + supresión + recómputo dinámico del umbral de 20 organizaciones — función pura testeable con casos límite (exactamente 20, 19, un segmento que cae por debajo después de publicado).
- [ ] Evaluación de impacto de privacidad **por segmento**, no una sola vez para todo el producto — esto implica que el sistema necesita registrar cuándo se evaluó cada segmento y bloquear la publicación de uno nuevo hasta que pase su propia evaluación, no solo una casilla global.

**Riesgo concreto:** el umbral de 20 organizaciones necesita recomputarse dinámicamente porque un segmento puede caer por debajo del umbral si una organización se da de baja o retira su consentimiento — si el sistema solo evalúa el umbral al momento de publicar y no lo revisa periódicamente, un segmento publicado puede quedar por debajo del mínimo sin que nadie lo note. Vale la pena un job periódico (pg-boss otra vez) que re-verifique segmentos publicados, no solo una verificación en el momento de publicar.

**Deuda a pagar antes de avanzar:** este incremento depende de que el Incremento 6 (consentimiento append-only, snapshot-JSON, k-anonimato) esté sólido — Market Signals es, en la práctica, un consumidor más exigente del mismo pipeline de anonimización que Investigación ya construyó. Construirlo antes de que el Incremento 6 esté maduro significa duplicar la lógica de privacidad en dos lugares.

---

### Gaps de entorno de desarrollo y testing

Este es, desde la perspectiva de quien va a picar el código día a día, el hallazgo más importante de toda la revisión: **hoy no hay ningún entorno automatizado que valide un cambio antes de que llegue a Neon real.** Todo el ciclo de "es correcto" depende de que una persona corra comandos a mano en Windows.

- [ ] **No existe CI.** `find .github -type f` no devuelve nada. Cada commit se sube sin que nada corra `lint`/`typecheck`/`test` automáticamente — hoy esa disciplina depende enteramente de que quien commitea se acuerde de correrlo a mano (y el README documenta que eso ya pasó: una migración quedó sin subir a git por sesiones — commit `13018c9`, "commitea la migración RNF9 pendiente (nunca se había subido a git)"). Con 6 incrementos más por delante, esto escala mal. Mínimo viable: un workflow de GitHub Actions que corra `npm run lint && npm run typecheck && npm run test` (los tests unitarios, sin red — ya corren limpios en 1.5s) en cada push/PR. No requiere resolver el problema de Prisma/Windows para dar este primer paso.
- [ ] **Los tests de integración (RNF1, flujos de mutación) solo corren a mano en Windows contra Neon real** — nunca en CI, nunca automatizados. Esto significa que el aislamiento multi-tenant, la garantía más crítica del producto, se valida manualmente y de forma no repetible en cada cambio. Para escalar con confianza a medida que crecen los Incrementos 3-7 (que agregan tablas nuevas tenant-scoped todo el tiempo), conviene una base de Neon dedicada a CI (branch de Neon, que soporta branching de bases baratas) con las migraciones + `rls.sql` aplicados automáticamente, y correr `test:integration` ahí en cada PR — no solo antes de un release.
- [ ] **`prisma generate`/`migrate` solo corren en Windows** por el bloqueo de red a `binaries.prisma.sh` desde las sesiones de Mac/Claude. Esto ya se resolvió como flujo de trabajo (Windows para eso, Mac para el resto), pero es un cuello de botella real: cada cambio de schema necesita una sesión humana en Windows antes de poder seguir. Vale la pena evaluar si se puede: (a) vendorizar/cachear los binarios de Prisma una vez y reutilizarlos, o (b) migrar el `schema-engine` a un contenedor Docker con salida de red permitida, para no depender de una máquina física específica cada vez que se toca `schema.prisma` — esto se vuelve más urgente con cada incremento nuevo, porque todos (2 a 7) tocan el schema.
- [ ] **RLS no está en las migraciones versionadas** (hallazgo 3 de la introducción) — cualquier base nueva (la de CI recomendada arriba, un staging futuro) necesita que alguien recuerde correr `rls.sql`/`auth_functions.sql` a mano. Conviene convertir esos dos archivos en una migración de Prisma más (`prisma migrate dev --create-only` y pegar el contenido dentro, tal como el propio comentario de `rls.sql` ya sugiere como opción) para que viajen con el resto del historial de schema y se apliquen automáticamente con `prisma migrate deploy`.
- [ ] **Cero cobertura de tests medida.** No hay `--coverage` configurado en ningún script de `package.json`, ni `@vitest/coverage-v8` en las devDependencies. 56 tests unitarios + 24 de integración es una base sólida para lo construido (Incremento 1), pero sin un número de cobertura no hay forma objetiva de saber si los Incrementos 2-7 mantienen el mismo estándar a medida que se agregan funciones nuevas al motor v2, al pipeline de consultas, etc. Agregar `vitest --coverage` con un umbral mínimo (aunque sea informativo al principio, no bloqueante) antes de escalar el ritmo de construcción.
- [ ] **Sin accesibilidad automatizada.** PLAN-DE-TRABAJO ya lo señala como no bloqueante (`eslint-plugin-jsx-a11y` + `@axe-core/playwright`), pero conviene incorporarlo antes del Incremento 2 (primer flujo público de cara a usuarios anónimos reales, con requisito explícito de WCAG 2.2 AA), no después — es mucho más barato de integrar desde el principio de un flujo nuevo que retrofit sobre 7 pantallas ya construidas.
- [ ] **Sin entorno de staging separado de producción.** Todo el desarrollo valida contra la misma base Neon ("Neon real") que, a partir del Incremento 2, empieza a recibir tráfico público anónimo real. Antes de abrir cualquier endpoint público a tráfico externo (no solo los pilotos controlados), conviene un branch de Neon dedicado a staging con los mismos datos de prueba, para no validar features nuevas contra la misma base que ya tiene visitantes reales.
- [ ] **Sin observabilidad de errores en producción todavía** (Sentry u otro) — ya señalado en PLAN-DE-TRABAJO como bloqueante antes del Incremento 2; desde la óptica de desarrollo, además de la razón de seguridad ya dada, es la única forma práctica de detectar una regresión real en producción sin depender de que un usuario reporte el bug.

---

### Orden recomendado de ejecución (developer)

El orden de incrementos del roadmap (2→3→4→5→6→7) es correcto a nivel de negocio/alcance y no hay razón para cambiarlo a ese nivel. Pero **dentro** de esa secuencia, el orden de tareas concreto que minimiza retrabajo, dado lo que ya existe en el repo, es este:

1. **Antes de tocar el schema de Incremento 2: cerrar CI mínimo (lint+typecheck+test unitarios).** Es una tarde de trabajo, no bloquea nada, y a partir de acá cada incremento nuevo se valida solo con cada push en vez de depender de acordarse de correrlo a mano. Hacerlo ahora es barato; hacerlo después de 6 incrementos más de código es una migración de hábito mucho más cara.
2. **Cola de jobs (pg-boss) + patrón de rate limiting Postgres-nativo, antes que el motor v2 o las rutas públicas.** Es infraestructura pura, sin ambigüedad de diseño (Alex ya la confirmó), y todo lo demás del Incremento 2 (purga de huella, rate limit real) depende de que exista primero. Construir las rutas públicas antes que esto significa construirlas dos veces (una sin protección, otra con).
3. **Decidir y ejecutar el rediseño de `EvaluacionExpres`** (hallazgo 2) antes de escribir el motor v2 — si el motor v2 se escribe primero contra un modelo de datos que después hay que rehacer, el trabajo de mapear `DiagnosticFinding` al schema se hace dos veces.
4. **Motor v2 (`src/engine/v2/`) antes que las rutas API públicas.** Es lógica pura, rápida de testear de forma aislada (sin servidor, sin base de datos) — construirla primero y con tests sólidos evita descubrir errores de cálculo mientras se está debuggeando además la integración con rate limiting/consentimientos/gate macro-detalle al mismo tiempo.
5. **Rutas públicas + UI del Incremento 2, con el rate limiting y la cola de jobs ya funcionando de punta a punta (no solo instalados).** Recién acá conviene validar contra Neon real en Windows, con el mismo estándar de "probado de punta a punta" que ya se usó para el Incremento 1.
6. **Extraer el helper de transacción atómica (`ejecutarEnTransaccionDeTenant`) antes de empezar el Incremento 3**, no durante — el Incremento 3 es el primero que necesita crear varias entidades relacionadas en una sola operación (`Cadena`+`Nodo`s+`ConexionCadena`s), y hoy ese patrón está duplicado de forma ad hoc en dos archivos sin una función compartida. Formalizarlo antes evita una tercera copia con una variación sutil.
7. **Dentro del Incremento 3: modelo de datos y el patrón de denormalización de `empresaId`/RLS primero, mapa visual (React Flow) después.** El mapa es la parte más visible pero la de menor riesgo técnico; el modelo de datos es donde se puede introducir un agujero de aislamiento multi-tenant si se apura.
8. **Capa de analítica del Incremento 5 (vistas derivadas) conviene adelantarla en paralelo al Incremento 4**, no estrictamente después: los KPIs del Incremento 4 (`ObservacionKpi`) son exactamente el tipo de dato que la capa de analítica del Incremento 5 necesita consultar. Diseñar ambas sin coordinación corre el riesgo de que las vistas de analítica del Incremento 5 tengan que rehacerse cuando lleguen los KPIs reales del Incremento 4.
9. **Dentro del Incremento 5: el catálogo semántico cerrado (Zod) y el control de tenant en la capa determinística se escriben y testean ANTES de conectar cualquier proveedor LLM real**, no en paralelo. Es mucho más fácil verificar que el catálogo rechaza correctamente algo fuera de su alcance con datos de prueba fijos que debuggear ese mismo control con la variabilidad de una respuesta real de modelo de lenguaje de por medio.
10. **El patrón `SECURITY DEFINER` cross-tenant para Investigador (Incremento 6) se revisa como su propia unidad de seguridad, con tests de aislamiento dedicados, antes de construir el espacio del investigador (Bloque B) encima.** Construir la UI de investigación sobre un camino de acceso que todavía no probó que no filtra columnas de más es invertir esfuerzo sobre una base insegura.
11. **Market Signals (Incremento 7) reutiliza el pipeline de anonimización del Incremento 6 en vez de construir uno paralelo** — si al llegar ahí el pipeline de k-anonimato de Investigación no generaliza bien a "agregados por segmento de mercado" en vez de "datasets para investigador", vale la pena invertir ahí (generalizar el pipeline existente) antes de escribir una segunda implementación de la misma idea de privacidad.

## 15. Nuevas decisiones tecnicas surgidas en las Rondas 2 y 3 (a confirmar por Alex)

Los 5 planes detallados de las Secciones 10-14 profundizaron las 3 decisiones ya confirmadas (Sección 3) y encontraron preguntas mas finas que no estaban resueltas. Ninguna cambia el alcance aprobado; son todas decisiones de "como construirlo".

- [x] **ADR-0004 — dónde vive el worker de la cola de jobs (`pg-boss`) — resuelto el 2026-09-16, dentro de la restricción de presupuesto $0/mes (ver H14 abajo).** Se mantiene **Opción A — Vercel Cron**, pero **en el plan Hobby** (cadencia diaria, no cada 1 minuto) en vez de pasar a Vercel Pro ahora. Esto funciona sin degradar nada del Incremento 2: el único job real de esa etapa es la purga de `huellaOrigen` a 48-72h, que tolera perfectamente una cadencia diaria (la ventana de tolerancia es de horas, no de minutos). El rate limiting de RF15/RF17 **no** pasa por la cola — es una escritura síncrona (`UPSERT` atómico) en la propia ruta pública, así que no depende de la cadencia del Cron. Se revisa este ADR y se sube a Vercel Pro cuando: (a) un job futuro necesite latencia menor a un día (candidato: recómputo de Market Signals en el Incremento 7, o el import de CSV del Incremento 4 si se decide asíncrono), o (b) el volumen de tráfico lo justifique económicamente — evaluación mes a mes, según confirmó Alex.
  - [x] Confirmado: Opción A (Vercel Cron), plan Hobby por ahora, cadencia diaria.
  - [x] Confirmado: **no** pasar a Vercel Pro todavía — se difiere hasta que el presupuesto o la latencia lo exijan.
- [x] **Rate limiting de la evaluación pública anónima (RF15/RF17): tabla Postgres propia — confirmado.** `LimiteTasa` (huellaOrigenHash, bucket, ventanaInicio, contador), sin proveedor nuevo. Sin costo adicional de infraestructura — encaja en el presupuesto $0/mes.
- [ ] **Rediseño de `EvaluacionExpres`:** el modelo ya en el schema fue pensado para el diagnóstico viejo (4 valores) y no representa las 5 dimensiones de V2. Como no tiene ninguna fila real todavía, el plan de Developer (Sección 14) recomienda **rediseñarlo in place** en vez de crear un modelo paralelo — evita mantener dos tablas con el mismo propósito. El plan de DDD (Sección 13) llega al mismo resultado por otro camino, usando el nombre `EvaluacionExpresV2` como tabla nueva; ambos planes coinciden en el fondo (separar el motor v2 del v1 sin tocar datos), difieren solo en si la tabla se llama distinto o se reescribe — se resuelve como parte del detalle EARS del Incremento 2, no bloquea nada mas.
- [x] **Plan de Neon (autosuspend/SLA) — resuelto el 2026-09-16, misma lógica que ADR-0004.** Se queda en el plan actual (Launch, sin SLA contractual) mientras el tráfico sea de pilotos — coherente con el presupuesto $0/mes. El autosuspend agresivo sí conviene extenderlo (no tiene costo adicional relevante, solo configuración) para evitar el cold-start ya observado en los tests de integración; pasar a un plan con SLA (Scale) queda condicionado a cuándo el Incremento 2 reciba tráfico público real, mismo criterio de revisión mes a mes.
- [ ] **Cifrado de Cloudflare R2:** confirmar si el cifrado por defecto de R2 (a nivel de infraestructura) satisface el requisito de "cifrado" de `MVP-DEFINITIVO.md` Sección 8, o si se espera cifrado adicional a nivel de aplicación antes de subir un archivo (trabajo extra real, no cosmético). *(No bloquea el Incremento 2 — R2 recién se usa desde el Incremento 4.)*
- [x] **[Ronda 3 — H5] Mecanismo de autenticación de `UsuarioPlataforma` — confirmado por Alex el 2026-09-16: correo + contraseña + autenticador (TOTP), el mismo mecanismo ya aprobado y construido para `Usuario`/`ADMINISTRADOR` (Argon2id + MFA, ADR-0003).** No puede ser una reutilización literal de la sesión NextAuth existente porque `src/infra/auth/next-auth.d.ts` exige `empresaId: string` obligatorio y `UsuarioPlataforma` no tiene tenant — el diseño técnico concreto (segundo provider/config de NextAuth vs. sesión separada) queda para la ronda de cierre de brechas (ver Sección 18).
- [x] **[Ronda 3 — H14] Presupuesto de infraestructura — confirmado por Alex el 2026-09-16: arrancar en $0/mes y evaluar mes a mes** a medida que el tráfico real lo justifique. Esto fija, en cascada: Vercel Hobby (no Pro) por ahora, Neon Launch (no Scale) por ahora, Cron diario (no cada minuto) por ahora — ver ADR-0004 y Plan de Neon arriba, ambos ya resueltos bajo esta misma restricción.
- [x] **[Ronda 3 — H16] Umbral de k-anonimato / supresión de celdas pequeñas — confirmado por Alex el 2026-09-16: 20 organizaciones**, mismo número para Investigación (Incremento 6) y Market Signals (Incremento 7). Ya propagado a `MVP-DEFINITIVO.md` Sección 6.6 y a todas las menciones en este documento. Sigue pendiente la revisión legal Ley 29733 (Sección 4) para validar el número desde el punto de vista normativo, no solo técnico — el umbral numérico es la posición de producto de Alex, no un cierre legal.

**Estado al 2026-09-16: de las 8 decisiones de esta sección, 6 ya están confirmadas** (ADR-0004, rate limiting, plan de Neon, H5, H14, H16) **y quedan 2 abiertas, ninguna bloqueante** (rediseño de `EvaluacionExpres`, que se resuelve dentro del propio detalle EARS del Incremento 2; cifrado de R2, que recién aplica desde el Incremento 4). Con esto, la Sección 15 deja de ser un obstáculo para arrancar el detalle EARS del Incremento 2.

## 16. Próximo paso concreto (vigente)

1. **Rondas 3 y 4 completadas.** Ronda 3 (Calidad 1, Calidad 2, Finanzas, Auditoría): hallazgos consolidados en la Sección 17, hallazgo crítico H1 corregido. Ronda 4 (cierre de brechas): con las 3 decisiones que Alex confirmó el 2026-09-16 (auth de `UsuarioPlataforma`, presupuesto $0/mes, k-anonimato = 20 organizaciones) como fijas, se resolvieron con diseños concretos casi todos los ítems que quedaban abiertos en las Secciones 4, 15 y 17 — ver Sección 18. Los cambios de tooling seguros (CI, pre-commit hook, `docs/PATRONES.md`, cobertura de tests) ya se aplicaron directamente al repositorio.
2. **Único punto genuinamente pendiente y fuera del alcance de cualquier agente:** la revisión legal formal de Ley 29733 (checklist de 4 bloques ya preparado en la Sección 18.2.D) — no bloquea empezar a construir los pilotos ya controlados, sí bloquea abrir el Incremento 2 a tráfico público general.
3. **Con esto, la preparación previa a construir queda cerrada.** El siguiente paso natural es redactar el detalle EARS del Incremento 2 (`requirements.md` Sección 4bis) y recién ahí tocar el schema de Prisma — se espera la confirmación explícita de Alex para arrancar ese paso, mismo criterio de "nada se construye sin visto bueno" que rigió toda esta etapa de planificación.

## 17. Ronda 3 de revisión — Calidad, Finanzas y Auditoría (hallazgos consolidados)

**Alcance de esta ronda:** a pedido de Alex, tres agentes revisaron en paralelo el documento completo (Secciones 0-16, incluyendo los 5 planes detallados de la Ronda 2) desde tres ángulos — **Calidad 1** (QA/testing), **Calidad 2** (calidad de código/ingeniería) y **Finanzas** (costos de infraestructura y operación, con precios de septiembre 2026 vía búsqueda web) — y un cuarto agente, **Auditoría**, leyó los tres reportes completos, verificó sus afirmaciones contra el documento real y contra el repositorio (`grep`, listado de archivos), deduplicó hallazgos y produjo el veredicto y la tabla consolidada de abajo.

### 17.1 Veredicto global

**Viable con condiciones — aprobado con correcciones documentales obligatorias antes de redactar el detalle EARS del Incremento 2.** Ningún hallazgo de la Ronda 3 contradice ninguna de las decisiones ya confirmadas por Alex (Sección 3) ni el alcance de `MVP-DEFINITIVO.md`. La corrección obligatoria (H1) ya se aplicó directamente en el documento (Secciones 10-14); el resto de los hallazgos técnicos (H2-H4) se agregaron a la Sección 4 y las decisiones para Alex (H5, H14, H16) a la Sección 15.

### 17.2 Tabla consolidada de hallazgos (H1-H16)

| # | Hallazgo | Severidad | Secciones afectadas | Origen | Ruteo |
|---|---|---|---|---|---|
| H1 | `LimiteTasa` con 4 nombres distintos entre secciones (`LimiteTasa`/`LimiteTasaEvaluacion`/`LimiteTasaContador`) y una versión sin columna `bucket` (RF15 vs. RF17 indistinguibles) | CRÍTICO | 10, 11, 12, 13, 14 | Auditoría (verificado con `grep` contra el repo real: la tabla no existe aún en código → corrección sin costo) | [Técnico] — **ya corregido en este documento** |
| H2 | No existe CI (`.github/` vacío) — cada commit depende de disciplina manual; ya causó un incidente real (commit `13018c9`) | ALTO | 14, Gaps de entorno | Calidad 2, Calidad 1 | [Técnico] — **resuelto, Sección 18.4.A, ya aplicado al repo** |
| H3 | Sin guarda de compilación contra mezclar `tenantClient()` y el futuro `tenantTransaction()` en el mismo flujo | ALTO | 10, 13, 14 | Calidad 2 | [Técnico] — **resuelto, Sección 18.3.B** |
| H4 | `ObservacionKpi`: la Sección 10 exige idempotencia pero el schema real (Sección 13) solo define `@@index`, no `@@unique` | ALTO | 10, 13 | Calidad 1, Auditoría | [Técnico] — **resuelto, Sección 18.3.F** |
| H5 | `UsuarioPlataforma` no tiene mecanismo de autenticación definido — no puede usar NextAuth existente (`empresaId` obligatorio en los tipos de sesión) | ALTO | 13, 14 | Calidad 2, Auditoría | [Alex+Técnico] — **confirmado por Alex (correo+contraseña+autenticador) y diseño técnico cerrado, Sección 18.1.A / 18.2.F** |
| H6 | Estado de publicación de Market Signals modelado de forma distinta entre Arquitectura (enum tri-estado con despublicación) y DDD (`publicado: Boolean`) | MEDIO | 10, 13 | Calidad 2 | **Resuelto, Sección 18.3.C** — gana el enum tri-estado |
| H7 | 7 enums `Estado*` sin convención de nombres compartida | MEDIO | 13 | Calidad 2 | **Resuelto, Sección 18.3.D**, incorporado a `docs/PATRONES.md` (Sección 18.4.C) |
| H8 | `Hallazgo*`/`Consentimiento*` divididos en pares anónimo/tenant-scoped sin tipos de dominio ni funciones constructoras compartidas | MEDIO | 13, 14 | Calidad 2 | **Resuelto, Sección 18.3.E** — tipos Zod + builders compartidos especificados |
| H9 | Granularidad de migraciones despareja (6 migraciones para el Incremento 2 vs. 1 para el Incremento 7), relevante porque cada migración necesita una sesión de Windows | BAJO | 13, 14 | Calidad 1 | **Resuelto, Sección 18.4.E** — criterio fijado (1 migración = 1 Bloque de trabajo) |
| H10 | Falta un pre-commit hook — el commit `13018c9` (real, confirmado en `git log`) es evidencia de que uno lo habría evitado | MEDIO | 14, Gaps de entorno | Calidad 1, Calidad 2 | **Resuelto, Sección 18.4.B, ya aplicado al repo (Husky)** |
| H11 | Sin documento único de patrones transversales (`docs/PATRONES.md`) para las convenciones que hoy solo existen implícitas en el código | MEDIO | 13, 14 | Calidad 1, Calidad 2, Auditoría | **Resuelto, Sección 18.4.C, ya aplicado al repo** |
| H12 | Tests de integración (aislamiento multi-tenant, el más crítico) solo corren a mano en Windows contra Neon real, nunca en CI | ALTO | 14, Gaps de entorno | Calidad 1 | Parcialmente resuelto — CI mínimo ya corre `test` (unitario) en cada push (H2); el branch de Neon dedicado a CI para `test:integration` queda pendiente, no bloqueante |
| H13 | Cero cobertura de tests medida (`--coverage` no configurado) | BAJO | 14, Gaps de entorno | Calidad 1 | **Resuelto, Sección 18.4.D, ya aplicado al repo** (`test:coverage`, sin umbral bloqueante) |
| H14 | Presupuesto de infraestructura: pilotos $0/mes; Incremento 2 público $40-61/mes; Incremento 5 con IA ~$170-200/mes (dominado por costo de API de Claude) | INFORMATIVO | 3, 15 | Finanzas | [Alex] — **confirmado: arrancar en $0/mes, evaluar mes a mes** |
| H15 | El costo de Claude API en el Incremento 5 depende de 2 llamadas LLM seriadas por consulta NL — posible optimización futura (1 llamada, o caché de prompts) si el volumen crece | BAJO | 14 (Bloque de consultas NL) | Finanzas | No bloqueante — revisar al llegar al Incremento 5 |
| H16 | Umbral de k-anonimato/supresión de celdas pequeñas (Investigación y Market Signals) es una decisión legal/de producto, no técnica, y ningún agente debe fijarlo | ALTO | 6, 15 | Auditoría | [Alex] — **confirmado: 20 organizaciones**, pendiente de validación legal (Sección 18.2.D) |

### 17.3 Estimación de costos (Finanzas, precios de septiembre 2026)

- **Vercel Pro:** $20/mes (requerido por ADR-0004 para Cron de 1 minuto y `maxDuration` extendido).
- **Neon:** plan Launch $0.106/CU-hora (sin SLA contractual) vs. plan Scale $0.222/CU-hora (con SLA) — la elección queda pendiente en la Sección 15 junto con la decisión de autosuspend.
- **Cloudflare R2:** $0.015/GB-mes + costos por operación, sin costo de salida de datos (egress gratuito).
- **Claude API:** Haiku 4.5 $1/$5 por millón de tokens entrada/salida; Sonnet 5 $2/$10 por millón de tokens entrada/salida.
- **Sentry (Team):** $26/mes.
- **Escenario A — solo pilotos actuales:** ≈ $0/mes (dentro de capas gratuitas).
- **Escenario B — Incremento 2 en tráfico público moderado:** ≈ $40-61/mes (≈ $480-732/año).
- **Escenario C — Incremento 5 con IA activa, ~9.000 consultas en lenguaje natural/mes:** ≈ $170-200/mes (≈ $2.040-2.400/año), dominado por ≈ $81-98/mes de costo de API de Claude (2 llamadas LLM seriadas por consulta — catálogo semántico + generación de respuesta).

### 17.4 Verificación cruzada (Auditoría)

La Auditoría confirmó, contra el documento real y el repositorio, los hallazgos con mayor impacto antes de incluirlos en la tabla: comparó lado a lado las Secciones 10/11/12/13/14 para H1 y corrió `grep -rn "LimiteTasa" . --include="*.ts" --include="*.prisma"` contra el repo, que devolvió cero resultados (confirma que la tabla no existe en código, haciendo la corrección segura); confirmó con `find .github -type f` que no hay CI (H2); confirmó con `git log` que el commit `13018c9` citado como evidencia de H10 existe realmente. Ningún hallazgo de esta ronda quedó sin verificar contra una fuente primaria (documento o repositorio).

## 18. Ronda 4 — Cierre de brechas (resoluciones concretas antes de empezar)

A pedido de Alex ("cerremos las brechas, errores y vacíos, y demos solución a todo antes de empezar"), se lanzó una **Ronda 4**: 4 agentes (arquitectura, seguridad, DDD, developer/tooling) recibieron la lista completa de ítems abiertos en las Secciones 4, 5, 6, 15 y 17, más las 3 decisiones que Alex acababa de confirmar (autenticación de `UsuarioPlataforma` = correo+contraseña+autenticador; presupuesto $0/mes, evaluar mes a mes; umbral de k-anonimato = 20 organizaciones), con instrucción explícita de producir **resoluciones concretas, no más hallazgos**. Cada uno inspeccionó el repo real antes de escribir. Los resultados están organizados por dimensión abajo (18.1-18.4) y ya están reflejados como checkboxes `[x]` en las Secciones 4 y 17 de este documento, con referencia de vuelta a la subsección correspondiente.

**Lo que esta ronda deja genuinamente resuelto (diseño listo para implementar en el detalle EARS del Incremento 2):** autenticación de `UsuarioPlataforma`, observabilidad mínima, regla de denormalización de `empresaId`, restricción de idempotencia de `ObservacionKpi`, ADR-0004 con presupuesto $0/mes, diseño de `Consentimiento`/`Respuesta`/`Hallazgo`, patrón `tenantTransaction()`, resolución del estado de publicación de Market Signals, convención de nombres de enums, tipos de dominio compartidos.

**Lo que ya se aplicó directamente al repositorio** (tooling, no schema ni producto — dentro del criterio de "no construir alcance nuevo sin visto bueno", porque no toca `prisma/schema.prisma` ni ninguna funcionalidad): `.github/workflows/ci.yml`, `.husky/pre-commit`, `docs/PATRONES.md`, y los cambios de `package.json`/`vitest.config.ts` para cobertura de tests. Ver Sección 18.4 para el detalle de cada uno.

**Lo que sigue sin poder cerrarse sin una persona externa** (marcado [HUMANO] en la Sección 4): la revisión legal formal de Ley 29733 — esta ronda dejó un checklist concreto de 4 bloques listo para llevarle a un abogado (Sección 18.2.D), pero la validación en sí no la puede hacer ningún agente.

### 18.1 Arquitectura — resoluciones concretas (ADR-0004, observabilidad, denormalización, ObservacionKpi, cadencia de Cron)

*Producido por el agente de arquitectura de la Ronda 4 de cierre de brechas, con inspección directa del repo real.*

#### A. Autenticación de `UsuarioPlataforma`

**Decisión: sesión completamente separada, con JWT propio firmado con `jose` (ya es dependencia del proyecto). No usar un segundo `NextAuth()`/provider en paralelo.**

##### Por qué no un segundo provider de NextAuth

La opción obvia — agregar un segundo `Credentials` provider al mismo `auth.ts` o montar una segunda instancia `NextAuth()` — no resuelve el problema real. `src/infra/auth/next-auth.d.ts` amplía las interfaces `Session`/`User`/`JWT` de los módulos `next-auth`, `@auth/core/types`, `next-auth/jwt`, `@auth/core/jwt` mediante *declaration merging* de TypeScript. Esa ampliación es **global al proyecto**, no por instancia: aunque se creen dos `NextAuth()` distintos, ambos comparten el mismo tipo `Session` compilado. Hacer `empresaId` opcional (`string | null`) para acomodar a `UsuarioPlataforma` obliga a tocar cada uno de los sitios que hoy asumen `session.user.empresaId` no-nulo (todo `tenantClient(session.user.empresaId)` en rutas de dashboard) — el peor de los dos mundos: contamina código que hoy funciona, y el compilador no puede impedir que una sesión de `UsuarioPlataforma` "preste" un `empresaId` inexistente.

##### Diseño concreto (archivos, sin código todavía)

**Nuevo, aislado de todo lo existente:**
- `prisma/schema.prisma` — `model UsuarioPlataforma` (sin `empresaId`; `email @unique`, `passwordHash`, `mfaSecret`, `mfaHabilitado`, `rol RolUsuarioPlataforma`, `intentosFallidos`, `bloqueadoHasta`) + `enum RolUsuarioPlataforma { CURADOR_METODOLOGICO ADMINISTRADOR_PLATAFORMA }` (agregar `INVESTIGADOR_COMPRADOR` cuando llegue el Incremento 6). **No entra en `TENANT_SCOPED_MODELS`** — mismo caso que `EvaluacionExpres`, consultado con `prisma` directo.
- `src/infra/auth-plataforma/session.ts` — `crearSesionPlataforma()` (firma un JWT con `jose`'s `SignJWT`, payload `{ sub, rol }`, TTL corto ~8h) y `leerSesionPlataforma(req)` (`jwtVerify`), cookie propia `chainpulse.plataforma-session` (nombre distinto de `authjs.session-token`, para que ambas sesiones coexistan sin colisión de cookie). Firma con un secreto **nuevo y distinto**, `PLATAFORMA_SESSION_SECRET` — nunca reutilizar `NEXTAUTH_SECRET`, así un JWT de una sesión nunca es válido como la otra aunque se filtre.
- `src/infra/auth-plataforma/loginLookup.ts` — `prisma.usuarioPlataforma.findUnique({ where: { email } })` directo; no necesita la función `SECURITY DEFINER login_lookup()` que sí usa `Usuario` (esa existe para resolver el tenant sin conocerlo de antemano — `UsuarioPlataforma` no tiene tenant que resolver).
- `src/infra/auth-plataforma/rateLimit.ts` — mismo patrón que `src/infra/auth/rateLimit.ts` pero contra `prisma.usuarioPlataforma` (no `tenantClient`).
- `src/app/api/auth-plataforma/login/route.ts` + `.../logout/route.ts` — Route Handlers Node runtime, reutilizan **sin modificar** `verifyPassword()`/`hashPassword()` (`src/infra/auth/password.ts`) y `verificarCodigoMfa()`/`generarSecretoMfa()` (`src/infra/auth/mfa.ts`): ambos son funciones puras que no dependen de `Usuario` ni de `empresaId`, se reutilizan tal cual.
- `src/app/plataforma/login/page.tsx`, `src/app/plataforma/activar-mfa/page.tsx` — mirror de `src/app/login` y `src/app/activar-mfa`.

**Modificado (cambio mínimo, localizado):**
- `src/middleware.ts` — hoy es `export default auth((req) => {...})`, un único wrapper de NextAuth. Pasa a ser una función propia que despacha por prefijo de ruta: si `pathname` empieza con `/plataforma`, llama a `leerSesionPlataforma(req)` (verificación JWT con `jose`, Edge-safe — es la misma librería que NextAuth usa internamente para esto, ya es dependencia del proyecto); si no, conserva exactamente la lógica actual (`auth()` de `authConfig`) sin tocarla. `matcher` gana `"/plataforma/:path*"`.
- `.env.example` — agregar `PLATAFORMA_SESSION_SECRET`.

**Explícitamente sin tocar:** `src/infra/auth/next-auth.d.ts`, `src/auth.ts`, `src/auth.config.ts`, `TENANT_SCOPED_MODELS`. El radio de impacto sobre código de `Usuario` que hoy funciona es cero.

Cada `route.ts` bajo `/api/plataforma/**` valida la sesión otra vez del lado del servidor con un helper `requireSesionPlataforma(req, rolesPermitidos)` — mismo criterio de "cinturón y tirantes" que ya documenta el comentario de `middleware.ts` para el resto del sistema.

#### B. Observabilidad mínima (Sentry) — especificación lista para implementar

- **Paquete:** `@sentry/nextjs` únicamente. **No** instalar `@sentry/profiling-node`.
- **Plan de Sentry: Developer (gratuito), no Team ($26/mes)** — coherente con el presupuesto $0/mes confirmado por Alex. El plan gratuito alcanza para pilotos y el arranque del Incremento 2. Revaluar el salto a Team junto con el resto de esa decisión, no antes.
- **Archivos:** `sentry.server.config.ts`, `sentry.client.config.ts`, **`sentry.edge.config.ts`** (faltante en el plan anterior y necesario porque `src/middleware.ts` corre en Edge runtime y, con el diseño del punto A, gana lógica nueva que puede fallar), `instrumentation.ts`, `next.config.ts` envuelto con `withSentryConfig(nextConfig)`.
- **Variables de entorno:** `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (mapeado de `VERCEL_ENV`), `SENTRY_TRACES_SAMPLE_RATE=0` (apagado al inicio). `SENTRY_AUTH_TOKEN` se difiere hasta que exista CI (ya resuelto, Sección 18.4).
- **Scrubbing explícito (no depender del scrubbing genérico por nombre de campo de Sentry):** `sendDefaultPii: false` + `beforeSend`/`beforeSendTransaction` que remueve por nombre real de campo: `correo`, `telefono`, `nombreCompleto`, `empresaNombre`, `huellaOrigen`/`huellaOrigenHash`, `descripcionLibre` (y, cuando exista, `email` de `UsuarioPlataforma`).
- **Dónde se integra primero:** rutas nuevas del Incremento 2 (`src/app/api/public/evaluations/**`), `src/app/api/auth-plataforma/**` y `src/middleware.ts` — las rutas del Incremento 1 se migran después, en un commit separado.
- **Prueba:** `src/infra/__tests__/sentryScrub.test.ts` — evento sintético con los campos sensibles, verifica que `beforeSend` los remueve.
- **Riesgo de red:** verificar `sentry.io`/`*.ingest.sentry.io` contra el allowlist antes de instalar; si está bloqueado, instalar/validar desde Windows.

#### C. Regla de denormalización de `empresaId` (para `docs/PATRONES.md`)

> **Toda tabla nueva que tenga una relación (directa o indirecta, vía FK encadenada) con `Empresa` debe denormalizar su propio campo `empresaId` (nunca delegar el aislamiento a un `JOIN` hacia la tabla padre) y debe agregarse a `TENANT_SCOPED_MODELS` (`src/infra/prisma/tenantClient.ts`) en el mismo commit que introduce su migración — sin excepción, salvo que el modelo sea, por diseño, catálogo de plataforma sin tenant (p. ej. `DefinicionKpi`) o un aggregate explícitamente tenant-nulo ya documentado (p. ej. `EvaluacionExpres`/`EvaluacionExpresV2`, `LimiteTasa`, `UsuarioPlataforma`), en cuyo caso el modelo debe llevar un comentario explícito en `schema.prisma` explicando por qué queda fuera.**

Aplicación inmediata pendiente (a resolver junto con sus propias migraciones): `ConexionCadena`, `ObservacionKpi`/`ImportacionCsv` (Incremento 4) deben sumar `empresaId` propio y entrar al `Set`.

#### D. `ObservacionKpi` — restricción `@@unique` de idempotencia (H4)

```prisma
numeroFila Int?   // índice de la fila dentro del CSV, asignado una sola vez durante
                   // el parseo/mapeo (antes de encolar el job), nunca recalculado en
                   // cada intento — es la mitad de la clave de idempotencia (H4).
```
```prisma
@@unique([importId, numeroFila])
```

Se prefiere un índice ordinal estable a un "hash de fila" porque un hash de contenido es frágil ante re-parseos con formato distinto y colisiona legítimamente si dos filas tienen los mismos valores para el mismo período; `NULL` de `importId` nunca colisiona entre filas manuales/pegadas, que no pasan por reintentos de `pg-boss`. El job usa `INSERT ... ON CONFLICT (importId, numeroFila) DO NOTHING`. *(Nota de consolidación: el agente de DDD, Sección 18.3.F, llegó de forma independiente a una segunda restricción complementaria — `@@unique([cadenaId, definicionKpiId, periodoInicio, periodoFin, fuente])` para cargas manuales/pegadas — las dos no son excluyentes, cubren escenarios de duplicado distintos; el modelo final del Incremento 4 lleva ambas.)*

#### E. ADR-0004 con cadencia diaria en Vercel Hobby ($0/mes) — riesgo real, no genérico

**Riesgo bajo/aceptable — purga de `huellaOrigen`.** Con cron diario en vez de horario, el peor caso empuja la purga hasta ~96h en vez de 72h — excede nominalmente el rango documentado pero sigue muy por debajo del límite duro de 90 días. Aceptable para la etapa $0, con una corrección de redacción en `requirements.md`/plan: "purgado dentro de las ~24h siguientes a cumplir 48-72h (peor caso ~96h) mientras el proyecto esté en Vercel Hobby".

**Riesgo real y concreto — el resto de la cola de `pg-boss` queda huérfana.** Si `/api/internal/jobs/run` solo se invoca por el Cron diario, todos los demás jobs futuros (import CSV del Incremento 4, recómputo de Market Signals del Incremento 7) quedan atados a esa misma cadencia — un usuario que sube un CSV vería "procesando" hasta 24 horas.

**Mitigación concreta, sin costo adicional:** cada punto del código que hace `boss.send()` hace además, en el mismo request, una llamada HTTP *fire-and-forget* a `/api/internal/jobs/run` inmediatamente después de encolar — procesamiento en segundos en el caso normal. El Cron diario pasa a ser una red de seguridad (jobs huérfanos), no el disparador esperado. El mecanismo de *checkpoint* del Incremento 4 (reencolarse ante CSVs grandes) debe disparar también su propia llamada fire-and-forget al reencolarse.

**Conclusión:** la cadencia diaria es viable en Hobby solo con el patrón "disparo al encolar" — sin esa pieza, bloquea funcionalmente el Incremento 4 tal como está descrito.


---

### 18.2 Seguridad y privacidad — resoluciones concretas (Consentimiento, Respuesta, Hallazgo, checklist legal, R2, auth de plataforma)

*Producido por el agente de seguridad de la Ronda 4 de cierre de brechas, con inspección directa del repo real (`prisma/schema.prisma`, `prisma/rls.sql`, `prisma/auth_functions.sql`, `src/infra/prisma/tenantClient.ts`, `src/infra/auth/*`).*

#### A. `Consentimiento` — modelo final y congelamiento de los booleanos legacy

**Decisión: dos tablas, no una polimórfica** — mismo criterio que ya separa `EvaluacionExpres*` (tenant nulo) de `Empresa/Usuario` (tenant-scoped):

```prisma
enum FinalidadConsentimiento { DIAGNOSTICO  INVESTIGACION  ESTADISTICAS_COMERCIALES  CONTACTO_COMERCIAL }
enum MetodoRetiro { NINGUNO  FORMULARIO_PUBLICO  SOLICITUD_SOPORTE }

model ConsentimientoExpres {           // sin tenant, mismo régimen que EvaluacionExpresV2 — NO lleva RLS
  id                    String   @id @default(cuid())
  evaluacionExpresV2Id  String
  evaluacionExpresV2    EvaluacionExpresV2 @relation(fields: [evaluacionExpresV2Id], references: [id], onDelete: Cascade)
  finalidad             FinalidadConsentimiento
  aceptado              Boolean
  textoVersion          String
  textoSnapshot         String            // texto legal completo mostrado, no un puntero
  jurisdiccion          String   @default("PE")
  vigenteDesde          DateTime @default(now())
  metodoRetiro          MetodoRetiro @default(NINGUNO)
  retiradoEn            DateTime?
  createdAt             DateTime @default(now())
  @@index([evaluacionExpresV2Id, finalidad])
  @@map("consentimientos_expres")
}

model ConsentimientoCuenta {           // empresaId propio → SÍ entra en TENANT_SCOPED_MODELS + rls.sql
  id            String   @id @default(cuid())
  empresaId     String
  empresa       Empresa  @relation(fields: [empresaId], references: [id], onDelete: Cascade)
  usuarioId     String
  usuario       Usuario  @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  finalidad     FinalidadConsentimiento
  aceptado      Boolean
  textoVersion  String
  textoSnapshot String
  jurisdiccion  String   @default("PE")
  vigenteDesde  DateTime @default(now())
  metodoRetiro  MetodoRetiro @default(NINGUNO)
  retiradoEn    DateTime?
  createdAt     DateTime @default(now())
  @@index([empresaId, usuarioId, finalidad])
  @@map("consentimientos_cuenta")
}
```

**Append-only real — garantía SQL, no solo disciplina de código.** Igual que `login_lookup()` en `prisma/auth_functions.sql` acota lo que `chainpulse_app` puede hacer:

```sql
REVOKE UPDATE, DELETE ON "consentimientos_expres", "consentimientos_cuenta" FROM chainpulse_app;
GRANT INSERT, SELECT ON "consentimientos_expres", "consentimientos_cuenta" TO chainpulse_app;
```

Retirar consentimiento es literalmente `INSERT` de una fila nueva con `aceptado=false, retiradoEn=now()` — el registro histórico queda intacto por diseño de permisos, no por convención.

**Congelamiento exacto de `consentimientoEnvio`/`consentimientoMejoraAlgoritmo` (`EvaluacionExpres`):** los dos campos no se tocan en el schema, solo ganan un comentario `//` de "congelado, no escribir desde Incremento 2 en adelante". **No hay backfill** — `textoVersion`/`textoSnapshot`/`jurisdiccion` de ese momento nunca se capturaron y fabricarlos falsificaría el histórico legal. `EvaluacionExpres` (v1) se consulta por los dos booleans; `EvaluacionExpresV2` se consulta por `ConsentimientoExpres` — nunca en la misma query. Si algún día se necesita un reporte agregado que cruce v1 y v2, se construye explícitamente como unión con columna `origenRegimen`, nunca tratando el boolean viejo como si fuera la finalidad `INVESTIGACION` (el boolean autoriza algo más angosto que lo que V2 define).

#### B. Aggregate root y política RLS de `Respuesta`

**Aggregate root: `EvaluacionExpresV2`. `Respuesta` es entidad hija, no su propio aggregate** — se accede siempre por `evaluacionExpresV2Id` (nunca se lista `Respuesta` de forma independiente, eso permitiría reconstruir el patrón de respuestas de cualquier evaluación anónima sin pasar por el gate de detalle). `@@unique([evaluacionExpresV2Id, preguntaVersionId])` es la invariante de dominio suficiente.

**RLS: ninguna — mismo régimen de tenant nulo que `EvaluacionExpres`.** Verificado contra `prisma/rls.sql`: esas tablas no tienen `ENABLE ROW LEVEL SECURITY` ni política propia. Acción concreta: agregar al final de `prisma/rls.sql`, en el mismo bloque de comentario ya existente, la lista explícita de tablas nuevas del Incremento 2 que comparten el régimen de tenant nulo:

```sql
-- Incremento 2 (Evaluación exprés V2): mismo régimen de tenant nulo que
-- EvaluacionExpres arriba. NUNCA agregar empresaId ni política RLS a:
--   "evaluaciones_expres_v2", "respuestas", "hallazgos_expres",
--   "consentimientos_expres" — se protegen por RF15/RF17 (rate limiting)
--   y por no compartir tabla con datos de cuentas registradas (RNF7).
-- ConsentimientoCuenta SÍ es tenant-scoped y SÍ lleva política propia.
```

Protección real sin RLS: (1) cascada `onDelete: Cascade` desde `EvaluacionExpresV2` — no hay `Respuesta` huérfana consultable, (2) `LimiteTasa` en el endpoint de inicio/desbloqueo, (3) disciplina de nunca exponer un endpoint `GET /api/public/respuestas/:id` — todo acceso pasa por `evaluacionExpresV2Id` en el path.

#### C. Patrón snapshot-JSON de `Hallazgo` — corrección sobre el borrador existente

**Gap real encontrado:** el `HallazgoExpres.origenSnapshot` drafteado en la Sección 13 (`{ preguntaCodigos, respuestaIds }`) **incluye `respuestaIds`** — no es un snapshot seguro, sigue siendo un puntero funcional hacia `Respuesta`/`EvaluacionExpresV2` (que puede llevar correo/nombre si `detalleDesbloqueado=true`). Si Incremento 6 lee este campo para construir `DatasetVersion`, un JOIN "solo para depurar" desde `respuestaIds` reintroduce la fuga que la Sección 4 quiere evitar.

**Resolución: separar en dos tablas — una que Investigación lee, otra que nunca toca.**

```prisma
model HallazgoExpres {
  id  String @id @default(cuid())
  evaluacionExpresV2Id String
  evaluacionExpresV2    EvaluacionExpresV2 @relation(fields: [evaluacionExpresV2Id], references: [id], onDelete: Cascade)

  dimension              DimensionDiagnosticoV2
  estadoCategoria        String
  enunciado              String
  evidenceState          EstadoEvidencia
  coberturaConfianza     Float
  evidenciaFaltante      String?
  siguienteVerificacion  String?
  ruleVersion            String

  // Único campo que Incremento 6 lee para construir DatasetVersion.
  // SOLO variables no identificables — preguntaCodigos son códigos de
  // contenido ("Q1".."Q7"), no IDs de fila.
  contextoSnapshot Json  // { dimension, sector, subsector, rangoTamano,
                         //   rolParticipante, pais, preguntaCodigos, ruleVersion }

  createdAt DateTime @default(now())
  @@index([evaluacionExpresV2Id])
  @@map("hallazgos_expres")
}

// Tabla separada — 1:1, PK propia — para trazabilidad operacional (el
// visitante viendo su propio resultado detallado). Incremento 6 NUNCA
// hace JOIN contra esta tabla.
model HallazgoExpresTraza {
  id                String         @id @default(cuid())
  hallazgoExpresId  String         @unique
  hallazgoExpres    HallazgoExpres @relation(fields: [hallazgoExpresId], references: [id], onDelete: Cascade)
  respuestaIds      String[]
  createdAt         DateTime       @default(now())
  @@map("hallazgos_expres_traza")
}
```

Con tabla separada, la función `SECURITY DEFINER` del job de Incremento 6 (mismo patrón que `login_lookup()`) directamente no tiene ningún `JOIN`/`GRANT` hacia `hallazgos_expres_traza` — la separación es estructural (dos tablas, dos permisos), no solo una lista de columnas. Esto se hereda sin rediseño en Incremento 6.

#### D. Checklist de revisión legal (Ley 29733) — [HUMANO], para Alex/abogado

**1. Registro de banco de datos personales** (Autoridad Nacional de Protección de Datos, Perú): ¿el volumen/tipo de datos de RF13/RF14 obliga a registrar? ¿uno solo o separado (flujo anónimo vs. cuentas)? Plazo estimado, para planificar antes del Incremento 2 con tráfico público general (no bloquea los pilotos ya controlados).

**2. Transferencia internacional de datos** (Neon + Vercel, fuera de Perú): confirmar región física real de producción. Ley 29733 Art. 15 exige nivel de protección adecuado en destino o consentimiento explícito e informado de la transferencia — el texto de consentimiento actual de RF13 no cubre esto todavía. Si no hay nivel adecuado declarado, redactar la cláusula de transferencia internacional (afecta las 4 finalidades).

**3. Suficiencia jurídica de los 4 textos de consentimiento** (`DIAGNOSTICO`, `INVESTIGACION`, `ESTADISTICAS_COMERCIALES`, `CONTACTO_COMERCIAL`): libre, previo, informado, expreso e inequívoco — "checkbox no premarcado" es necesario, no suficiente. Confirmar que `ConsentimientoExpres.textoSnapshot` es el mecanismo correcto para demostrar qué leyó cada persona.

**4. Umbral de k-anonimato = 20 organizaciones** (decisión de Alex, ya fija — validar, no re-decidir): ¿20 es estadística/jurídicamente suficiente en los sectores más chicos donde ChainPulse probablemente opere primero, dado que el mercado peruano es chico/concentrado? ¿el umbral de dominancia de Market Signals (40% recomendado) también necesita revisión legal?

**Adicionales:** confirmar que retener el registro de `Consentimiento` tras un retiro (append-only, nunca se borra — es el "recibo" legal) no entra en conflicto con el derecho de cancelación/oposición — aclarar con el abogado para no generar expectativa de "borrado total" que el producto no ofrece. Confirmar si comercializar agregados a un "Comprador de estadísticas" requiere autorización/registro adicional.

#### E. Cifrado de Cloudflare R2 — recomendación

**Sí, cifrado adicional a nivel de aplicación, antes de subir el archivo.** El cifrado en reposo de R2 (automático) satisface el checkbox literal de `MVP-DEFINITIVO.md` Sección 8 pero solo cubre robo físico de disco — no cubre un bucket mal configurado, un token de API con permisos amplios filtrado, o una URL firmada mal manejada. Recomendación concreta, sin proveedor nuevo (coherente con presupuesto $0):

- **Mecanismo:** envelope encryption con AES-256-GCM usando el módulo `crypto` nativo de Node — cero dependencias nuevas.
- **Clave maestra:** `R2_ENCRYPTION_KEY` (env var), mismo procedimiento de generación/rotación que `NEXTAUTH_SECRET`.
- **Flujo:** DEK aleatoria por archivo, cifra el contenido, la propia DEK se cifra con `R2_ENCRYPTION_KEY`; `(iv, authTag, dekCifrada)` se guarda como metadata en Postgres (no como metadata de R2). El objeto que llega a R2 es siempre ciphertext.
- **Descarga recomendada:** un endpoint propio que descifra server-side y transmite el CSV en claro solo al usuario ya autorizado del tenant dueño (evita complicar el sanitizador de fórmulas CSV, que corre server-side).
- **Limitación documentada:** clave maestra sin versionado — rotar `R2_ENCRYPTION_KEY` requiere un job de re-cifrado, documentado en `SEGURIDAD-credenciales.md`.

#### F. Autenticación de `UsuarioPlataforma` — riesgo y aislamiento

**Riesgo real:** no es "más superficie de ataque" en abstracto — es superficie *más sensible*, porque todo rol de plataforma tiene alcance cross-tenant por definición (un `Usuario` comprometido expone un tenant; un `UsuarioPlataforma` comprometido expone potencialmente todos).

**Reusar sin cambios** (funciones puras, ya desacopladas de `NextAuth`/`empresaId`): `src/infra/auth/password.ts` (Argon2id), `src/infra/auth/mfa.ts` (TOTP).

**No reusar tal cual — necesitan implementación propia:**
- `login_lookup()` está tipado contra `usuarios`. Se clona el **patrón**, no el código: `login_lookup_plataforma(email)` `SECURITY DEFINER`, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE` solo a `chainpulse_app`.
- `src/infra/auth/rateLimit.ts` depende de `tenantClient(empresaId, ...)` — no aplica. Módulo nuevo, o reutilizar `LimiteTasa` con un `bucket` nuevo (`LOGIN_PLATAFORMA`).
- `UsuarioPlataforma` necesita `intentosFallidos`/`bloqueadoHasta` propios (espejando `Usuario`) — gap del borrador de schema.
- **No ampliar `next-auth.d.ts` a `empresaId?: string`** — el propio cambio de tipo sería la vulnerabilidad (basta que un desarrollador olvide un chequeo null en un endpoint tenant-scoped). Aislamiento estructural: sesión separada, cookie con nombre distinto, `jose` en vez de NextAuth, guard propio que nunca comparte código de resolución de sesión con el de `Usuario`.
- **MFA obligatorio desde el día uno para los 4 roles de plataforma**, no solo `ADMINISTRADOR_PLATAFORMA` — incluso `CURADOR_METODOLOGICO` tiene impacto amplio (puede publicar una `PreguntaVersion` maliciosa que afecta el motor de scoring de toda la plataforma).


---

### 18.3 DDD y modelo de datos — resoluciones concretas (versionado, tenantTransaction, Market Signals, enums, tipos compartidos, ObservacionKpi)

*Producido por el agente de DDD de la Ronda 4 de cierre de brechas, con inspección directa del repo real (`prisma/schema.prisma`, `src/infra/prisma/tenantClient.ts`, `src/infra/auth/registro.ts`, `src/engine/constantes.ts`).*

#### A. Versionado nativo en BD — patrón único (aggregate + hijas inmutables)

Aplica a `CuestionarioVersion`/`PreguntaVersion` (Incremento 2) y `DefinicionKpi` (Incremento 4):

1. **Aggregate root**: `codigo` (identidad lógica estable) + `numero` (`Int`, incrementa por `codigo`) + `estado` (`EstadoVersionContenido`: `BORRADOR`/`PUBLICADA`/`RETIRADA`) + `publicadaEn`/`retiradaEn` + `curadorId` (FK a `UsuarioPlataforma.id`) + `@@unique([codigo, numero])`.
2. **Filas hijas**: FK al padre, `codigo` propio estable + `@@unique([aggregateId, codigo])`, nunca `updatedAt`.
3. **Inmutabilidad — dos capas:**
   - **Aplicación:** un único módulo de escritura por aggregate (`src/domain/versionado/publicarCuestionario.ts`, `.../publicarKpi.ts`) es el único punto que transiciona `BORRADOR → PUBLICADA`; cualquier "corrección" sobre `PUBLICADA`/`RETIRADA` se rechaza ahí, creando `numero + 1` en su lugar.
   - **BD (barata, agregar ya):** índice único parcial en el mismo `migration.sql`:
     ```sql
     CREATE UNIQUE INDEX uq_cuestionario_version_publicada
       ON cuestionario_versiones (codigo) WHERE estado = 'PUBLICADA';
     CREATE UNIQUE INDEX uq_definicion_kpi_publicada
       ON definicion_kpis (codigo) WHERE estado = 'PUBLICADA';
     ```
   - Un trigger `BEFORE UPDATE` que bloquee cualquier `UPDATE` sobre fila `PUBLICADA` queda diferido — se agrega solo si hay un incidente real.
4. **Consumo**: toda fila que "usó" una versión referencia la fila hija con `onDelete: Restrict` — `Respuesta.preguntaVersionId`, `ObservacionKpi.definicionKpiId`.

`DefinicionKpi` aplica el mismo patrón sin filas hijas.

#### B. `tenantTransaction()` — estándar oficial

**Cambio previo en `src/infra/prisma/tenantClient.ts`:** exportar `TENANT_SCOPED_MODELS`, `injectTenantFilter`, `uncapitalize` (hoy privados). Nada más se toca.

**Firma concreta — `src/infra/prisma/tenantTransaction.ts` (nuevo módulo):**

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { TENANT_SCOPED_MODELS, injectTenantFilter } from "./tenantClient";

type ScopedTx = any;

function buildScopedTx(tx: any, empresaId: string): ScopedTx {
  return new Proxy(tx, {
    get(target, modelProp: string) {
      const delegate = target[modelProp];
      if (typeof delegate !== "object" || delegate === null) return delegate;
      const model = modelProp.charAt(0).toUpperCase() + modelProp.slice(1);
      if (!TENANT_SCOPED_MODELS.has(model)) return delegate;
      return new Proxy(delegate, {
        get(mTarget, operation: string) {
          const fn = mTarget[operation];
          if (typeof fn !== "function") return fn;
          return (args: Record<string, unknown>) =>
            fn.call(mTarget, injectTenantFilter(model, operation, args, empresaId));
        },
      });
    },
  });
}

export async function tenantTransaction<T>(
  empresaId: string,
  fn: (tx: ScopedTx) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  if (!empresaId) throw new Error("tenantTransaction requiere un empresaId no vacio");
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    return fn(buildScopedTx(tx, empresaId));
  }, options);
}
```

**Regla de "cuándo usar cada uno" (para `docs/PATRONES.md`):**

| Situación | Usar |
|---|---|
| Lectura, o escritura a un solo modelo tenant-scoped | `tenantClient(empresaId)` |
| Operación que escribe en 2+ modelos que deben confirmarse o fallar juntos | `tenantTransaction(empresaId, fn)` |
| Dentro del callback de `tenantTransaction()` | Usar solo el `tx` recibido — nunca instanciar `tenantClient()` adentro |
| CSV masivo (Incremento 4) | `tenantTransaction()` por lote de ~500 filas, nunca el archivo completo |

**Guarda concreta (H3), realista sin CI de tipos aún:** patrón de nombre obligatorio (`xxxAtomico`/`crearXxxCompleto`) para funciones que usan `tenantTransaction()`, de forma que un `grep -rn "tenantClient(" src/ | grep -v tenantClient.ts` (agregable al workflow de CI como paso de lint no bloqueante) pueda señalar cualquier función con más de una llamada a `tenantClient(` como candidata a revisión.

#### C. H6 — Resolución definitiva: publicación de Market Signals

**Gana el enum tri-estado (Arquitectura), no el `Boolean`.** El propio requisito del Incremento 7 exige que el job de recómputo pueda despublicar un segmento automáticamente — un `Boolean publicado` no distingue "nunca se publicó" de "se publicó y se retiró por caer bajo el umbral".

```prisma
enum EstadoPublicacionSegmento { PENDIENTE_REVISION  PUBLICADO  DESPUBLICADO }

model SegmentoMercadoAgregado {
  id String @id @default(cuid())
  segmentoId String
  segmento   SegmentoMercado @relation(fields: [segmentoId], references: [id], onDelete: Cascade)
  periodoInicio DateTime
  periodoFin    DateTime
  participantesUnicos  Int
  organizacionesUnicas Int
  interesDeclaradoConteo Int
  necesidadDefinidaConteo Int
  horizonteDistribucion Json
  autorizacionContactoConteo Int
  cotizacionConteo Int
  pilotoConteo Int
  contratacionConteo Int
  umbralAplicado Int   // 20 organizaciones — decisión fija de Alex
  estado EstadoPublicacionSegmento @default(PENDIENTE_REVISION)
  revisionReidentificacionAprobadaEn DateTime?   // gate humano: PENDIENTE_REVISION -> PUBLICADO
  publicadoEn    DateTime?
  despublicadoEn DateTime?
  despublicadoMotivo String?   // "recomputo_bajo_umbral" | "retiro_consentimiento" | "revision_manual"
  createdAt DateTime @default(now())
  @@index([segmentoId])
  @@index([estado])
  @@map("segmentos_mercado_agregados")
}
```

Transiciones únicas en un solo módulo de escritura: `PENDIENTE_REVISION → PUBLICADO` (requiere `revisionReidentificacionAprobadaEn` no nulo y `organizacionesUnicas >= umbralAplicado`), `PUBLICADO → DESPUBLICADO` (automático, job de recómputo). Nunca `DESPUBLICADO → PUBLICADO` directo — una republicación crea una fila nueva.

#### D. H7 — Convención de nombres para los 7 enums `Estado*`

**Regla:** `Estado<Dimensión>` — el nombre después de `Estado` identifica la pregunta que ese enum responde, nunca el modelo que lo contiene. Un enum se reutiliza entre modelos solo si responde exactamente la misma pregunta; si la pregunta cambia (aunque el modelo o un valor se repita), es un enum nuevo.

| Enum | Pregunta que responde | Modelos/campos |
|---|---|---|
| `EstadoDato` | ¿Cómo se obtuvo el valor de este campo? | `Eslabon.estado`, `Conexion.estado`, `ObservacionKpi.estado` |
| `EstadoEvidencia` | ¿Cuánta confianza tiene este hallazgo? | `ConexionCadena.estadoEvidencia`, `HallazgoExpres`/`HallazgoCadena.evidenceState` |
| `EstadoCiclo` | ¿Está este ciclo abierto o cerrado? | `CicloPulso.estado` |
| `EstadoVersionContenido` | ¿En qué punto de su ciclo editorial está esta versión? | `CuestionarioVersion.estado`, `DefinicionKpi.estado` |
| `EstadoImportacion` | ¿En qué punto de su pipeline está este archivo? | `ImportacionCsv.estado` |
| `EstadoAccion` | ¿En qué punto de su ciclo de vida operativo está esta acción? | `Accion.estado` |
| `EstadoPreguntaSugerida` | ¿En qué punto de su triage está esta sugerencia? | `PreguntaSugeridaCuenta/Expres.estado` |
| `EstadoPublicacionSegmento` *(nuevo, C)* | ¿Está este segmento publicado? | `SegmentoMercadoAgregado.estado` |

Regla de PR: antes de crear un enum `Estado*` nuevo, buscar primero en esta tabla si ya existe uno que responda la misma pregunta.

#### E. H8 — Tipos de dominio compartidos para `Hallazgo*`/`Consentimiento*`

`src/domain/hallazgo/tipos.ts` + `builders.ts`, `src/domain/consentimiento/tipos.ts` + `builders.ts`: un `HallazgoBaseSchema`/`ConsentimientoBaseSchema` (Zod) único, con dos funciones constructoras finas por par (`crearHallazgoExpres`/`crearHallazgoCadena`, `crearConsentimientoExpres`/`crearConsentimientoCuenta`) que arman el `Prisma.*CreateInput` de cada tabla a partir del mismo tipo validado. Toda validación y regla de negocio compartida vive una sola vez en el schema Zod; ningún código de aplicación construye el `CreateInput` a mano fuera de estos builders.

#### F. H4 — `ObservacionKpi`: restricción de idempotencia

Dos restricciones, cubren dos escenarios de duplicado distintos:

```prisma
model ObservacionKpi {
  // ...campos existentes...
  importId       String?
  importFilaHash String?   // sha256 de la fila normalizada — solo cuando fuente = "csv"

  // Escenario 1: carga manual/pegada — una sola observación viva por KPI+período+fuente.
  @@unique([cadenaId, definicionKpiId, periodoInicio, periodoFin, fuente], name: "uq_observacion_kpi_periodo")
  // Escenario 2: reintento de job de importación CSV — misma fila del mismo importId
  // nunca se inserta dos veces. NULLs no colisionan en Postgres, no interfiere con filas manuales.
  @@unique([importId, importFilaHash], name: "uq_observacion_kpi_import_fila")
}
```

`INSERT ... ON CONFLICT (importId, importFilaHash) DO NOTHING` hace el reintento de un lote fallido seguro sin transacción compensatoria de borrado.


---

### 18.4 Developer/tooling — cierre de brechas de CI (H2, H9, H10, H11, H13) y ajuste de ADR-0004 por presupuesto $0

*Producido por el agente de developer/tooling de la Ronda 4 de cierre de brechas. Verificado corriendo `npm run lint`, `npm run typecheck` y `npm run test` sin `DATABASE_URL` en el entorno real del repo — los 56 tests unitarios pasan igual (`vitest.config.ts` ya excluye `*.integration.test.ts`). Estos archivos ya fueron aplicados al repositorio (ver commit correspondiente).*

#### A. `.github/workflows/ci.yml` — aplicado al repo

Workflow mínimo: `lint && typecheck && test` en cada push/PR a `main`. Fijado a Node 22 (no hay `.nvmrc` ni `engines` en `package.json`; coincide con la versión real de la Mac de desarrollo, `v22.23.2`, compatible con el requisito de Next 15.5, `^18.18 || ^19.8 || >=20`). `npm ci` dispara el postinstall de `@prisma/client` (`prisma generate`) automáticamente — los runners de GitHub Actions tienen salida a internet normal, a diferencia del proxy del entorno de este agente, así que esto no necesita ningún workaround ahí. Se dejó `npm run build` fuera del alcance mínimo (necesitaría secrets de producción que hoy no existen en GitHub) — paso natural siguiente, no parte de este cierre.

#### B. Pre-commit hook (H10) — Husky, aplicado al repo

**Husky en vez de un script en `.git/hooks/`**, porque `.git/hooks/` no se versiona con git — el incidente real que motiva H10 (commit `13018c9`) ocurrió justamente porque el proyecto ya se trabaja desde múltiples entornos (Mac + Windows); un hook no versionado tendría el mismo modo de falla que causó el incidente original, aplicado al hook en vez de a la migración. `package.json` gana `"prepare": "husky"` + `husky` como devDependency; `.husky/pre-commit` corre `npm run lint && npm run typecheck` (deliberadamente sin `test` en el hook, para no meter fricción en commits chicos — la red de seguridad completa corre en cada push vía el workflow de A).

#### C. `docs/PATRONES.md` (H11) — aplicado al repo

Documento nuevo con 7 secciones basadas en código real del proyecto: (1) snapshot-JSON de resultados inmutables (`ResultadoConexion.criticidadSnapshot` como ejemplo canónico, con la regla de aplicarlo a `Hallazgo`/`DatasetVersion`), (2) transacción de tenant conocido con `set_config` manual (`registrarEmpresaYAdmin`, `aceptarInvitacion`, `resultados.ts` como ejemplos reales), (3) tenant verdaderamente nulo sin `set_config`/RLS (`EvaluacionExpres`), (4) tabla de "`tenantClient()` vs. transacción manual — cuándo usar cada uno", incluyendo el riesgo ya documentado de que un `create` anidado de Prisma no pasa por `injectTenantFilter` en las tablas hijas, (5) convención de que toda tabla nueva se declara explícitamente en `rls.sql` — con RLS o con un comentario de exclusión explícita, nunca en silencio, (6) convención de nombres para enums `Estado*` (ver Sección 18.3.D), (7) el gap abierto de `Hallazgo*`/`Consentimiento*` (ver Sección 18.3.E, ya con solución diseñada aunque el código todavía no existe).

#### D. Cobertura de tests (H13) — aplicado al repo

`package.json` gana el script `test:coverage` (`vitest run --coverage`) y la devDependency `@vitest/coverage-v8` (fijada a `^3.0.0` para calzar con la versión de `vitest` ya instalada). `vitest.config.ts` gana un bloque `coverage` (`provider: "v8"`, reporters `text`+`html`, mismo alcance de include/exclude que `test`) **sin `thresholds`** — informativo, sin umbral bloqueante, tal como pedía el propio hallazgo H13. No se agregó a `ci.yml` (fuera del alcance mínimo de A) — paso natural siguiente.

#### E. Granularidad de migraciones de Prisma (H9)

**El costo real a minimizar es cuántas sesiones de Windows hacen falta, no cuántas migraciones existen.** Criterio:

> **Una migración de Prisma = un Bloque de trabajo (A/B/C) de un Incremento, tal como ya los separa la Sección 14 — nunca una tabla suelta, nunca un Incremento completo.**

Con dos excepciones: (1) **split hacia abajo** cuando el Bloque contiene una decisión todavía sin confirmar por Alex (ejemplo real: la parte de `EvaluacionExpres` del Bloque A del Incremento 2 espera a la sesión de Windows siguiente si su rediseño no está cerrado — nunca bloquear una migración lista detrás de una decisión pendiente); (2) **merge hacia arriba** cuando las tablas se crean atómicamente en la misma transacción (ejemplo: `Cadena`+`Nodo`+`ConexionCadena`+`Flujo` del Incremento 3 — si el código las trata como unidad atómica, el schema las trata como unidad de migración).

#### F. Impacto de la cadencia diaria de Cron (Hobby, $0/mes) sobre el orden recomendado de ejecución

**El orden de los 11 pasos no cambia** — la cola de jobs sigue siendo el paso 2, antes del motor v2 o las rutas públicas, por la misma razón de siempre (infraestructura sin ambigüedad de diseño de la que todo lo demás depende).

**Ajuste interno al paso 2 (y a ADR-0004):** con Vercel Hobby confirmado por el presupuesto $0/mes, el Cron nativo queda en cadencia diaria — suficiente para la purga de `huellaOrigen` (ventana de 48-72h con margen de sobra), pero insuficiente por sí solo para el ping anti-autosuspend de Neon (recomendado cada 4-5 min) y para cualquier job con expectativa de turnaround corto (CSV del Incremento 4). **Resolución sin gastar presupuesto:** un segundo workflow de GitHub Actions con `on: schedule` (cron cada 10-15 min, $0, usa la misma infraestructura de CI ya agregada en A) que haga un `curl` autenticado contra `/api/internal/jobs/run`, dejando el Cron nativo de Vercel Hobby como respaldo redundante, no como único disparador. Esto resuelve tanto la purga como el ping anti-cold-start sin subir a Vercel Pro — se re-evalúa mes a mes, según ya confirmó Alex, cuando el volumen real de un job exija más que eso.



---

## 19. Ronda 5 — Auditoría del código real (2026-09-16, post Bloque A + schema completo del Incremento 2)

A diferencia de las Rondas 1-4 (revisión de planes y documentos), esta ronda revisó el **código fuente real** ya construido: Incremento 1 completo en producción (`https://chain-pulse-steel.vercel.app`) y el Bloque A + schema completo del Incremento 2 (validados de punta a punta en Windows, ver README). Cinco agentes en paralelo — Arquitectura, Seguridad y privacidad, Modelo de datos/DDD, Calidad/QA, Calidad de código — leyeron `src/`, `prisma/` y la configuración del proyecto; un sexto rol (Auditoría) consolidó, cruzó y depuró duplicados entre los cinco informes. A diferencia de las rondas anteriores, ningún hallazgo aquí es sobre el plan: todos apuntan a líneas de código o de schema concretas, ya escritas.

### 19.1 Veredicto global

**Nada bloquea el commit de documentación que se acaba de subir a GitHub** (solo toca `README.md`, sin cambios de código ni de schema). Pero la ronda encontró **un hallazgo CRÍTICO real en producción** (fuerza bruta de MFA) y **cinco hallazgos ALTOS**, dos de ellos en el schema del Incremento 2 recién escrito — ninguno bloquea lo ya desplegado (Incremento 1 sigue funcionando como está documentado), pero el CRÍTICO amerita una corrección pronta y los ALTOS del Incremento 2 conviene resolverlos antes de construir código de aplicación sobre ese schema, no después.

### 19.2 Tabla consolidada de hallazgos

| # | Hallazgo | Severidad | Área | Toca código ya en producción |
|---|---|---|---|---|
| R5-1 | El código MFA (`src/auth.ts`, `src/app/api/mfa/activar/route.ts`) no tiene rate limiting propio: `registrarIntentoFallido()` solo se dispara si la *contraseña* es incorrecta, nunca si el TOTP falla. Con la contraseña ya filtrada/reusada, un atacante puede fuerza-bruta el código de 6 dígitos sin límite — anula el propósito de MFA en el escenario exacto que MFA debería cubrir. | **CRÍTICO** | Seguridad | **Sí — Incremento 1, en producción real** |
| R5-2 | Timing attack de enumeración de cuentas: en `src/auth.ts` (login) y `src/app/api/recuperar-contrasena/route.ts`, la rama "email no existe" responde casi de inmediato mientras la rama "email existe" corre Argon2id o llama a Resend antes de responder — mide el tiempo de respuesta y se sabe si un email está registrado, contradiciendo el diseño de "sin enumeración" ya documentado en el propio código. | ALTO | Seguridad | Sí — Incremento 1 |
| R5-3 | `HallazgoExpres.evaluacionExpresV2Id` es una FK real en cascada hacia `EvaluacionExpresV2` (que guarda correo/nombre/teléfono tras `detalleDesbloqueado=true`), contradiciendo el propio comentario del modelo ("nunca un id de fila... aquí"). Cualquier `SELECT` con JOIN reidentifica el hallazgo — el aislamiento operacional/investigación que el patrón snapshot-JSON promete no existe a nivel de schema. | ALTO | Modelo de datos | No — schema nuevo, sin código de aplicación todavía |
| R5-4 | La retención de `huellaOrigen` (purgada a 48-72h) documentada en el comentario de `EvaluacionExpresV2` (`schema.prisma`) nunca se implementó en `src/infra/retencion.ts`: `purgarHuellasOrigen()` solo toca `evaluacionExpres` (v1), nunca `evaluacionExpresV2`. La huella de origen de V2 queda sin purgar indefinidamente si no se corrige antes de abrir tráfico público. | ALTO | Modelo de datos / Seguridad | No — falta código, no está desplegado |
| R5-5 | El índice único parcial de `CuestionarioVersion` (`WHERE estado='PUBLICADA'`, backstop real de "una sola versión vigente") no es representable en `schema.prisma` (Prisma no soporta índices parciales en el DSL sin preview feature declarada). La próxima corrida de `prisma migrate dev` con red real puede proponer un `DROP INDEX` silencioso del backstop sin que nadie lo note. | ALTO | Modelo de datos | No, pero es un riesgo latente para la *próxima* migración con red real |
| R5-6 | `injectTenantFilter()` (`tenantClient.ts`) no inyecta `empresaId` en la rama `create` anidada de un `upsert` (solo cubre `create`/`createMany` explícitos) — no explotado hoy (ningún `upsert` sobre un modelo tenant-scoped todavía), pero es la pieza compartida de aislamiento multi-tenant (RNF1 capa 1) y no tiene ningún test propio pese a ser pura. | ALTO | QA / Seguridad | Latente — infraestructura ya en producción, gap sin explotar |
| R5-7 | `abrirCiclo()` es un check-then-act (`findFirst` + `create` sin transacción) sin índice único parcial en `CicloPulso` que impida dos ciclos `ABIERTO` simultáneos para la misma empresa. Solo probado secuencialmente, nunca con dos llamadas concurrentes reales. Dos administradores (o un doble clic) casi simultáneos pueden abrir dos ciclos a la vez. | ALTO | QA | Sí — Incremento 1 |
| R5-8 | `fetch()` sin `try/catch` en 7 componentes cliente (`NuevoEslabonForm`, `ConexionForm`, `ResponderCuestionarioForm`, `InvitarResponsableForm`, `AbrirCicloBoton`, `CerrarCicloBoton`, `MarcarEjecutadaBoton`): si el `fetch` falla o el servidor responde con HTML no estructurado, `await respuesta.json()` lanza sin capturarse y el botón queda en "Guardando..." indefinidamente, sin mensaje de error ni forma de reintentar. | ALTO | Calidad de código | Sí — Incremento 1 |
| R5-9 | `/api/mfa/activar/route.ts` verifica `session?.user?.email` en vez de `session?.user?.empresaId` como el resto de las rutas, y no envuelve `tenantClient(...)` en `try/catch` — si `empresaId` llegara vacío, la ruta rompe el contrato JSON `{ok:false,...}` que respeta el resto de la API. Mismo archivo que R5-1 (fuerza bruta de TOTP) y R5-9 (contrato roto) — vale resolverlos juntos. | MEDIO | Seguridad / Calidad de código | Sí — Incremento 1 |
| R5-10 | Sin `ADR-0004` en `docs/ADR/` pese a que 6 archivos de código y ambos documentos de plan lo citan como la decisión que sostiene el diseño de la cola de jobs — o nunca se escribió como archivo propio, o se perdió. | MEDIO | Arquitectura | Sí (referencia documental, no de comportamiento) |
| R5-11 | `tenantTransaction()` (`tenantTransaction.ts`) está implementada y documentada como el patrón oficial, pero tiene **cero usos** — el patrón manual que reemplaza (`set_config` a mano dentro de `$transaction`) sigue duplicado en 8 sitios (`registro.ts`, `aceptarInvitacion.ts`, `cerrarCiclo.ts`, `registrarRespuestas.ts`, `resultados.ts`, `metricasAgregadas.ts`, `recomendacionEjecutada.ts`). | MEDIO | Calidad de código | Sí — Incremento 1 |
| R5-12 | Duplicación de verificación de sesión/rol en las 14 rutas API sin helper compartido (`requireSession()`/`requireAdmin()`) — ya causó la inconsistencia de R5-9. | MEDIO | Calidad de código | Sí — Incremento 1 |
| R5-13 | `registrarIntentoFallido()` (`src/infra/auth/rateLimit.ts`) es un patrón leer-incrementar-escribir no atómico (a diferencia de `limiteTasa.ts`, que sí usa `UPSERT` atómico): bajo login fallido concurrente puede "perderse" un intento y retrasar el bloqueo por fuerza bruta. | MEDIO | Seguridad / QA | Sí — Incremento 1 |
| R5-14 | Sin `maxDuration` en `src/app/api/internal/jobs/run/route.ts` ni `functions` en `vercel.json` — en Vercel Hobby (default 10s) un cold-start de Neon coincidiendo con la corrida del cron puede cortar la purga a mitad de camino, dejando jobs "fetched" sin `complete()`/`fail()` hasta su visibility timeout. | MEDIO | Arquitectura | Sí — Incremento 1/Bloque A |
| R5-15 | `pgBoss.ts`/`purgaHuellaOrigenJob.ts` sin ningún test (ni unitario con un `PgBoss` falso, ni de integración), pese a tener lógica real de manejo de errores por job y deduplicación (`singletonSeconds`). Es el código que el cron real de producción ejecuta cada 15 minutos. | MEDIO | QA | Sí — Bloque A |
| R5-16 | `REVOKE`/`GRANT` de la migración del Incremento 2 asume que `chainpulse_app` ya tiene privilegios base sobre las tablas nuevas, pero ningún archivo versionado (`rls.sql` ni ninguna migración) otorga ese acceso — el mecanismo real depende de un paso manual fuera de control de versiones. | MEDIO | Modelo de datos | No — schema nuevo |
| R5-17 | Contradicción comentario/código en `CuestionarioVersion.curadorId`: el comentario dice "sin relación FK a propósito" pero la línea siguiente define una relación real con FK real en la migración. | MEDIO | Modelo de datos | No — schema nuevo |
| R5-18 | `ConsentimientoExpres`/`ConsentimientoCuenta` (append-only) no tienen ningún constraint que determine cuál fila es la "vigente" por finalidad — el retiro depende enteramente de que el código de lectura futuro implemente bien la lógica de "última fila gana". | MEDIO | Modelo de datos / Seguridad | No — schema nuevo |
| R5-19 | Ventana fija (no deslizante) en `LimiteTasa`: permite hasta el doble del límite nominal en una ráfaga a caballo entre dos horas. Ya señalado en un comentario del propio código, se confirma como riesgo real dado que el Bloque A recibirá tráfico anónimo. | MEDIO | Seguridad | Sí — Bloque A |
| R5-20 | Sin test de casos borde vacíos en el motor (`calcularEslabonesMasDebiles([])`, `calcularSalud([])` sin ninguna respuesta) — probablemente correcto, pero sin ninguna aserción que lo confirme, y es el estado inicial real de una empresa nueva. | MEDIO | QA | Sí — Incremento 1 |
| R5-21 | Naming inconsistente: `HallazgoExpres.evidenceState` es el único campo en inglés de todo el bloque nuevo (debería ser `estadoEvidencia`, coherente con el enum `EstadoEvidencia`). | BAJO | Modelo de datos | No — schema nuevo |
| R5-22 | `console.error(err)` disperso sin logging estructurado en 10 archivos, sin `requestId` ni nivel de severidad — dificulta correlacionar un incidente real en producción. Ya señalado como pendiente transversal en la Sección 15/18.4 antes del Incremento 2 público. | BAJO | QA | Sí — Incremento 1 |
| R5-23 | Duck-typing de error `P2002` duplicado literal en 3 archivos (`conexiones/route.ts`, `registro.ts`, `aceptarInvitacion.ts`) — candidato a extraer `esViolacionUnica(err)`. | BAJO | Calidad de código | Sí — Incremento 1 |
| R5-24 | `POST /api/eslabones` sin `try/catch`, a diferencia del resto de rutas mutantes — un error transitorio de conexión a Neon se propagaría como 500 HTML no estructurado (dispara además R5-8 del lado cliente). | BAJO | Calidad de código | Sí — Incremento 1 |
| R5-25 | Sin índice propio en `curadorId` (`CuestionarioVersion`) ni en `preguntaVersionId` aislado (`Respuesta`) — continuidad de un patrón ya laxo en el Incremento 1 (`Conexion.origenId`/`destinoId`), no una regresión nueva. | BAJO | Modelo de datos | No — schema nuevo |
| R5-26 | Sin `regions` explícito en `vercel.json` — vale confirmar una vez que la región del deployment de Vercel coincide con la de Neon (São Paulo), dado que el patrón de `tenantClient()` ya multiplica los round-trips por request (ver R5-arquitectura informativo). | INFORMATIVO | Arquitectura | Sí |

### 19.3 Qué corregir antes de seguir, y qué puede esperar

**Antes de construir cualquier ruta/UI sobre el resto del Incremento 2 (bloquea el próximo paso, no lo ya desplegado):**
- R5-3 (FK de `HallazgoExpres` rompe el aislamiento operacional/investigación) y R5-4 (retención de `huellaOrigen` no extendida a V2) — ambos son defectos de diseño en el schema recién escrito; corregirlos ahora es una migración más (todavía no hay filas reales ni código que dependa de la forma actual), corregirlos después de construir el motor v2 encima es mucho más caro.
- R5-5 (índice parcial no representable en Prisma) — no requiere cambiar el diseño, solo dejar documentado el riesgo y un chequeo manual antes de la próxima migración con red real, para no perder el backstop sin darse cuenta.

**Corrección recomendada pronto, en paralelo (no bloquea nada, pero toca producción real):**
- R5-1 (fuerza bruta de MFA) — es el único CRÍTICO de la ronda y ya está en producción. No bloquea el Incremento 2 (son módulos distintos) pero es la corrección de mayor impacto de toda la lista.
- R5-2, R5-7, R5-8, R5-9, R5-13 (los ALTOS/MEDIOS restantes que tocan código ya desplegado) quedan a criterio de Alex sobre cuándo priorizarlos frente a seguir construyendo.

**Puede esperar sin riesgo real (deuda técnica documentada, no urgente):** R5-6, R5-10 a R5-26.

*Nota: esta ronda no encontró ningún hallazgo que invalide una decisión ya confirmada por Alex ni que contradiga el alcance de `MVP-DEFINITIVO.md` — todos son defectos de implementación o diseño de detalle, no de producto o arquitectura general.*


---

## 20. Ronda 5 — correcciones aplicadas (2026-09-16)

Los 26 hallazgos de la Sección 19 (5 agentes de revisión + Auditoría, código real ya en producción) se corrigieron en su totalidad, no solo el CRÍTICO y los ALTOS — a pedido explícito de Alex ("vamos con todas las correcciones en total"). Cada corrección queda marcada en el código con un comentario `R5-N` que referencia este documento, para que quien lo encuentre después sepa por qué está ahí sin tener que reconstruir el contexto.

| # | Hallazgo | Corrección aplicada | Dónde |
|---|---|---|---|
| R5-1 | MFA sin rate limiting propio (fuerza bruta de TOTP) | Un TOTP incorrecto ahora cuenta como intento fallido igual que una contraseña incorrecta — mismo contador/bloqueo de `registrarIntentoFallido()` | `src/auth.ts`, `src/app/api/mfa/activar/route.ts` |
| R5-2 | Timing attack de enumeración de cuentas | `conPisoDeTiempo()` — normaliza a un piso mínimo el tiempo de respuesta de login y recuperación de contraseña, exista o no la cuenta | `src/infra/timing.ts` (nuevo), `src/auth.ts`, `src/app/api/recuperar-contrasena/route.ts` |
| R5-3 | FK de `HallazgoExpres` rompe el aislamiento operacional/investigación prometido | FK confirmado como necesario (RF22); el gate real se documenta a nivel de permisos de Postgres (sin `GRANT SELECT` sobre `evaluaciones_expres_v2` para el rol de Investigación), no en el schema — tarea agregada al backlog de Incremento 6 (Sección 12) | `prisma/schema.prisma` (modelo `HallazgoExpres`), Sección 12 |
| R5-4 | Retención de `huellaOrigen` de `EvaluacionExpresV2` documentada pero no implementada | `purgarHuellasOrigen()` ahora purga `EvaluacionExpres` (v1) y `EvaluacionExpresV2` con el mismo criterio de 48h, en paralelo | `src/infra/retencion.ts`, `src/infra/__tests__/retencion.test.ts` |
| R5-5 | Índice único parcial de `CuestionarioVersion` no representable en el DSL de Prisma | Comentario de advertencia explícito junto al modelo (mismo patrón que R5-7) para que una futura `prisma migrate dev` con red real no lo interprete como drift | `prisma/schema.prisma` (modelo `CuestionarioVersion`) |
| R5-6 | `injectTenantFilter()` no cubría la rama `create` de un `upsert` | Rama `upsert` agregada (inyecta el tenant en `where` y en `create`); lógica pura extraída a un módulo sin dependencia de Prisma y cubierta con 7 pruebas unitarias | `src/infra/prisma/tenantScope.ts` (nuevo), `tenantScope.test.ts` (nuevo) |
| R5-7 | `abrirCiclo()` sin protección real contra dos ciclos `ABIERTO` concurrentes | Índice único parcial (`WHERE estado='ABIERTO'`) a nivel de base + captura de la violación de unicidad como `YaHayCicloAbiertoError()` | `prisma/migrations/20260916160000_ciclo_abierto_unico/`, `src/infra/ciclos/abrirCiclo.ts` |
| R5-8 | `fetch()` sin `try/catch` en 7 componentes cliente | Helper centralizado `fetchJsonSeguro()` adoptado en los 7 componentes — nunca deja un botón en "Guardando..." indefinido ante un error de red o una respuesta no-JSON | `src/infra/http/fetchJsonSeguro.ts` (nuevo) + 7 componentes bajo `src/app/dashboard/**` |
| R5-9 | `/api/mfa/activar` verificaba `session.user.email` en vez de `empresaId`, sin `try/catch` | Helper `requireEmpresaId()`/`requireSesion()` centralizado, adoptado también para prevenir la inconsistencia de R5-12 | `src/infra/auth/session.ts` (nuevo), `src/app/api/mfa/activar/route.ts` |
| R5-10 | Sin ADR-0004 propio pese a estar citado por 6 archivos de código | Documento escrito, formalizando la decisión ya tomada e implementada (Opción A, Vercel Cron + `boss.fetch()` por lotes, plan Hobby + respaldo de GitHub Actions) | `docs/ADR/0004-cola-de-jobs.md` (nuevo) |
| R5-11 | `tenantTransaction()` (patrón oficial) con cero usos reales | Adoptado en los 7 sitios que todavía repetían `set_config` manual dentro de `$transaction` | `registro.ts`, `aceptarInvitacion.ts`, `cerrarCiclo.ts`, `registrarRespuestas.ts`, `resultados.ts`, `metricasAgregadas.ts`, `recomendacionEjecutada.ts` |
| R5-12 | Verificación de sesión/rol duplicada en 14 rutas, sin helper compartido | Mismo helper de R5-9 (`requireSesion()`/`requireEmpresaId()`) centraliza el chequeo | `src/infra/auth/session.ts` |
| R5-13 | `registrarIntentoFallido()` no atómico (leer-incrementar-escribir) | Reescrito como `UPDATE` atómico (`intentosFallidos + 1` en una sola sentencia SQL) dentro de `tenantTransaction()` | `src/infra/auth/rateLimit.ts` |
| R5-14 | Sin `maxDuration` en la ruta de jobs; timeout por defecto de Vercel (10s) insuficiente | `export const maxDuration = 60` agregado | `src/app/api/internal/jobs/run/route.ts` |
| R5-15 | `pgBoss.ts`/`purgaHuellaOrigenJob.ts` sin ningún test | 6 pruebas unitarias con un `PgBoss` falso (encolado, procesamiento por lotes, fallo de un job sin bloquear el resto) | `src/infra/jobs/__tests__/purgaHuellaOrigenJob.test.ts` (nuevo) |
| R5-16 | `GRANT`/`REVOKE` del Incremento 2 asumía privilegios base no versionados | Migración explícita que otorga `SELECT/INSERT/UPDATE/DELETE` a `chainpulse_app` sobre las 7 tablas nuevas | `prisma/migrations/20260916170000_grants_incremento2/` (nuevo) |
| R5-17 | Comentario de `curadorId` contradecía el código (decía "sin FK" con una FK real debajo) | Comentario corregido, documentando el nullable y el `onDelete` por defecto | `prisma/schema.prisma` (modelo `CuestionarioVersion`) |
| R5-18 | Sin índice que resuelva "consentimiento vigente más reciente" sin un sort aparte | `createdAt` agregado al final de los dos índices compuestos de consentimiento | `prisma/schema.prisma`, `prisma/migrations/20260916190000_indices_r5_18_25/` (nuevo) |
| R5-19 | Ventana fija (no deslizante) de `LimiteTasa` permitía hasta el doble del límite en una ráfaga a caballo entre horas | Buckets de 15 min + suma de los últimos 4 como ventana deslizante aproximada (documentado como aproximación intencional, no matemáticamente exacta) | `src/infra/rateLimit/huella.ts`, `limiteTasa.ts` |
| R5-20 | Motor sin test de casos borde vacíos (`calcularSalud([])`, `calcularEslabonesMasDebiles([])`) | Un test por función cubriendo el array vacío | `src/engine/__tests__/salud.test.ts`, `eslabonMasDebil.test.ts` |
| R5-21 | `HallazgoExpres.evidenceState` — único campo en inglés del bloque nuevo | Renombrado a `estadoEvidencia` | `prisma/schema.prisma`, `prisma/migrations/20260916180000_rename_evidence_state/` (nuevo) |
| R5-22 | `console.error(err)` disperso sin logging estructurado | Helper `logError(contexto, err)` (JSON estructurado) adoptado en todos los call-sites restantes | `src/infra/log.ts` (nuevo) |
| R5-23 | Duck-typing de error `P2002` duplicado literal en 3 archivos | Helpers compartidos `esViolacionUnica()`/`codigoErrorPrisma()` | `src/infra/prisma/errores.ts` (nuevo) |
| R5-24 | `POST /api/eslabones` sin `try/catch`, a diferencia del resto de rutas mutantes | `try/catch` agregado, mismo contrato de error que el resto de la API | `src/app/api/eslabones/route.ts` |
| R5-25 | Sin índice propio en `curadorId` ni en `preguntaVersionId` aislado | Dos índices agregados | `prisma/schema.prisma`, `prisma/migrations/20260916190000_indices_r5_18_25/` |
| R5-26 | Sin `regions` explícito en `vercel.json` | `"regions": ["gru1"]` (São Paulo, misma región que Neon) agregado | `vercel.json` |

**Validación aplicada en este entorno (sin red completa — ver README, "Bloqueo de entorno"):** `typecheck`, `lint` y `test` (87/87) en verde. **Pendiente de validar por Alex** con red real: `npm run prisma:migrate` (4 migraciones nuevas: `20260916160000_ciclo_abierto_unico`, `20260916170000_grants_incremento2`, `20260916180000_rename_evidence_state`, `20260916190000_indices_r5_18_25`) y `test:integration`, mismo criterio que todas las rondas anteriores.

*Nota de proceso: al aplicar esta ronda se encontró y corrigió, además, un `import` faltante introducido durante la propia corrección de R5-13 (`tenantClient` sin importar en `src/infra/auth/rateLimit.ts`, detectado por `tsc --noEmit`) y se extrajo la lógica pura de `tenantClient.ts` a `tenantScope.ts` para que la prueba unitaria de R5-6 no dependiera de tener `prisma generate` corrido contra red real — ambos son ajustes de esta misma ronda, no hallazgos nuevos de una ronda futura.*
