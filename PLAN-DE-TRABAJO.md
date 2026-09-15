# ChainPulse — Plan de Trabajo hasta Completar el Proyecto

Fecha: 2026-09-15
Estado: **Revisión de viabilidad completada (arquitectura, herramientas, seguridad, DDD) + auditoría final.** Veredicto global: **Viable con condiciones.** Ninguna condición exige cambiar el alcance ya aprobado en `MVP-DEFINITIVO.md` v1.3 — todas son decisiones de "cómo construir", no de "qué construir". Este documento fija el plan de tareas concreto, ordenado, hasta terminar el proyecto (Incrementos 2 a 7). Cada tarea es una casilla `- [ ]` que se marca `[x]` solo cuando está resuelta y validada, mismo mecanismo que `MVP-DEFINITIVO.md`.
Versión: 1.0

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

## 3. Decisión de infraestructura que Alex debe confirmar (única, no bloquea nada más)

Los reportes de Arquitectura y de Herramientas recomendaron dos mecanismos distintos de cola de jobs sin saberlo (Arquitectura: cola nativa en Postgres tipo `pg-boss`/`graphile-worker`; Herramientas: Inngest). La auditoría resolvió la contradicción recomendando **empezar con cola nativa en Postgres**, coherente con que el proyecto ya evitó añadir Redis para el rate limiting existente, y reevaluar Inngest solo si más adelante aparecen flujos multi-paso con reintentos complejos que la opción Postgres no cubra bien.

- [ ] **Confirmar:** cola de jobs sobre Postgres/Neon (`pg-boss` o `graphile-worker`), no Inngest, como mecanismo inicial. *(Si Alex prefiere Inngest directamente, se documenta como ADR-0004 con esa opción en su lugar — es intercambiable sin afectar el resto del plan.)*
- [ ] **Confirmar:** almacenamiento de objetos privado — Cloudflare R2 (recomendado, portable, sin lock-in) vs. Vercel Blob (más simple si el host final es Vercel). Depende de confirmar el proveedor de hosting definitivo, nunca fijado explícitamente en los ADR existentes.

## 4. Bloqueantes antes de tocar el schema de Prisma o escribir el detalle EARS del Incremento 2

Cada ítem es una casilla que se marca `[x]` cuando está resuelto (documentado como decisión o implementado, según corresponda) y validado.

- [ ] **Corregir el checkbox de rate limiting en `MVP-DEFINITIVO.md` Sección 9** (de `[x]` a `[ ]`) y construir el rate limiting real para la evaluación pública anónima (store externo, no memoria de proceso) + el job de purga de `huellaOrigen` a 48-72h.
- [ ] **ADR-0004 — infraestructura transversal:** cola de jobs + almacenamiento de objetos (ver Sección 3 de este plan).
- [ ] **Observabilidad mínima** (logging estructurado + tracking de errores, p. ej. Sentry con scrubbing de PII) sobre los Route Handlers existentes, antes de exponer el motor V2 a tráfico público en el Incremento 2.
- [ ] **Resolver con Alex la contradicción de `MVP-DEFINITIVO.md`** entre la Sección 6.2 ("`Conexión` extiende la ya construida") y la Sección 7 ("todo es aditivo y aislado"). El schema real (`Conexion.origenId/destinoId` con FK únicas obligatorias) no admite una extensión literal sin romper RF7/RF16. La recomendación técnica es una tabla nueva `ConexionCadena` (aditiva, sin tocar `conexiones`).
  - [ ] Confirmación de Alex: ✅ construir `ConexionCadena` como tabla nueva (recomendado) / ❌ prefiero otra solución.
- [ ] **Diseñar `Consentimiento`** (4 finalidades: `DIAGNOSTICO`, `INVESTIGACION`, `ESTADISTICAS_COMERCIALES`, `CONTACTO_COMERCIAL`) como registro append-only/histórico (texto, versión, fecha, jurisdicción, método de retiro) + estrategia de congelamiento de los booleanos `consentimientoEnvio`/`consentimientoMejoraAlgoritmo` que ya existen en `EvaluacionExpres` (no se migran retroactivamente, quedan como snapshot histórico).
- [ ] **Diseñar versionado nativo en base de datos** para `CuestionarioVersion`/`PreguntaVersion` y, más adelante, `DefinicionKpi` — el patrón actual (`ruleVersion` como constante de código) sirve para el motor, no para contenido que un Curador metodológico edita sin desplegar código. Necesita su propio patrón: aggregate de versión + filas hijas inmutables.
- [ ] **Confirmar aggregate root y política RLS de `Respuesta`** para el visitante anónimo sin tenant, extendiendo el patrón tenant-nulo ya usado en `EvaluacionExpres`.
- [ ] **Fijar el patrón snapshot-JSON para `Hallazgo`** (mismo patrón que `ResultadoConexion.criticidadSnapshot`) — nunca FK directa a la fila operativa, para que investigación (Incremento 6) nunca vea identidad operativa reutilizando la misma tabla.
- [ ] **Revisión legal formal (Ley 29733, Perú)** — registro de banco de datos personales, validación de transferencia internacional (Neon/Vercel son infraestructura fuera de Perú), suficiencia de los textos de consentimiento — antes de abrir el Incremento 2 a tráfico público general. *(Esta es la Decisión pendiente #5/#8 de `MVP-DEFINITIVO.md`, ya con país confirmado — Perú — pero la revisión legal en sí sigue sin hacerse.)*
- [ ] **Fijar regla de denormalización de `empresaId`** + inclusión en `TENANT_SCOPED_MODELS` (`src/infra/prisma/tenantClient.ts`) para toda tabla nueva tenant-scoped, para no perder la garantía de doble capa de aislamiento que hoy tienen `Eslabon`/`Conexion`.
- [ ] **Declarar como estándar oficial** el patrón de transacción manual + `set_config` (ya usado en `registrarEmpresaYAdmin()`) para escrituras atómicas multi-entidad, ya que `tenantClient()` no da atomicidad entre modelos — lo necesitan el Incremento 3 (crear `Cadena` + `Nodo` + `Conexión` juntos) y el Incremento 4 (persistir un CSV completo).

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
- [ ] Implementar regla de dominancia + agregación por rango + supresión de celdas pequeñas + recómputo dinámico del umbral de 10 organizaciones.
- [ ] Evaluación de impacto de privacidad por segmento (gate obligatorio antes de publicar cada segmento, no una sola vez).
- [ ] Construir y validar.

## 8. Gobernanza de este documento

Este plan no cambia el alcance de `MVP-DEFINITIVO.md` — fija cómo y en qué orden se construye lo ya aprobado. Cambios de alcance siguen requiriendo aprobación explícita de Alex en `MVP-DEFINITIVO.md`. Este documento se actualiza a medida que se resuelven bloqueantes y se cierran incrementos, con el mismo mecanismo de checklist.

## 9. Próximo paso concreto

Con este plan, el siguiente paso es que Alex confirme la Sección 3 (cola de jobs y storage) y la contradicción de `Conexión` (Sección 4). En cuanto lleguen esas confirmaciones, se redacta el detalle EARS del Incremento 2 como actualización de `requirements.md` Sección 4bis, y recién ahí se toca el schema de Prisma.
