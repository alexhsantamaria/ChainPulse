# ADR-0001 — Arquitectura y stack inicial de ChainPulse

Fecha: 2026-09-12
Estado: Aceptado — confirmado por Alex el 2026-09-12 (stack, mitigaciones y ruta de crecimiento). Actualizado en la quinta ronda de revisión (ver `requirements.md`, Sección 12) con la decisión final de `ruleVersion` único, el gate macro/detalle como capa de presentación y la nota de rate limiting; ver "Decisiones de la quinta ronda" al final de este documento.

## Contexto

ChainPulse es un MVP de un producto SaaS multi-tenant: empresas registran áreas/procesos y sus conexiones, responsables de área completan cuestionarios periódicos, y el sistema calcula puntajes de coordinación, identifica el eslabón más débil y genera recomendaciones, todo expuesto en un dashboard web (ver `requirements.md`). Necesitamos un stack que permita construir e iterar rápido con un único desarrollador (Alex + Claude), reutilizando patrones ya probados en `Apuntes`, sin comprometer la capacidad de escalar si el MVP valida la hipótesis.

## Opciones consideradas

**Opción A — Next.js + TypeScript + PostgreSQL (Prisma) + Tailwind, monolito full-stack.** Es el patrón con más evidencia directa en el máster: `mbs-finanzas.zip` (Módulo 06) es un proyecto Next.js 16 + Prisma + Tailwind 4 completo con modelo de datos financiero y migraciones ya funcionando, y `ai-course-Big-School-2.zip` (Módulo 08) aporta un ejemplo maduro de Clean Architecture + TDD sobre un stack de frontend similar. Un solo lenguaje (TypeScript) de extremo a extremo, deploy sencillo (Vercel/Railway, visto en el Módulo 10), y Prisma facilita un modelo multi-tenant simple (columna `tenant_id` en cada tabla, con middleware que la inyecta automáticamente en cada consulta).

**Opción B — Backend Express/Node independiente + Frontend React/Vite.** Visto en `clean-orders-ts` (Módulo 04) para el backend y en el frontend del Módulo 08 para el cliente. Separa responsabilidades con más claridad de cara a escalar a múltiples consumidores de la API (app móvil futura, integraciones), pero añade una segunda base de código y un segundo despliegue a mantener desde el día uno — coste que no se justifica todavía sin usuarios reales.

**Opción C — Backend Python (FastAPI) + frontend separado.** Coherente con el ecosistema de IA del máster (Módulos 02, 09, 10) si en el futuro las recomendaciones pasan de reglas a un modelo entrenado. Para el MVP no hay ningún componente de IA/ML en el alcance (RF7 usa reglas predefinidas, ver `requirements.md` Sección 7), así que esta ventaja no aplica todavía; añade además el coste de mantener dos lenguajes distintos sin necesidad actual.

| Opción | Valor | Costo/plazo | Riesgo | Dependencia | Mantenimiento |
|---|---|---|---|---|---|
| A — Next.js monolito | Alto: reutiliza patrones ya probados y documentados | Bajo: un solo lenguaje, un solo despliegue | Medio: aislamiento de tenant por fila exige disciplina (ver Consecuencias) | Baja | Baja para un desarrollador solo |
| B — Backend + frontend separados | Medio: mejor para escalar a varios consumidores | Medio-alto: dos bases de código desde el inicio | Bajo arquitectónicamente, alto de foco/tiempo | Media | Alta para un desarrollador solo |
| C — FastAPI + frontend | Medio: útil si se planea IA/ML pronto | Alto: dos lenguajes, sin ventaja usada en el MVP | Bajo | Media | Alta para un desarrollador solo |

## Decisión

Se adopta la **Opción A**: Next.js + TypeScript + PostgreSQL vía Prisma, con una capa de dominio explícita separada de la capa de infraestructura (Prisma, rutas de Next.js), siguiendo el mismo principio de Clean Architecture ligera aplicado en `clean-orders-ts` y `mbs-finanzas` — sin llevarlo al extremo de puertos/adaptadores completos que esos proyectos usan para backends más grandes, porque sería sobre-ingeniería para el tamaño de este MVP.

Entidades de dominio (actualizadas tras las sucesivas rondas de decisiones de `requirements.md`, Secciones 8-12): `Empresa` (tenant), `Eslabón` (sustituye a "Área" — nodo de la cadena de suministro, con un campo que permita en el futuro distinguir un eslabón interno de un proveedor externo, sin migrar el modelo, y campos nullable/por defecto de `tipoFlujo` y `estado` declarado/inferido/verificado desde ya, para no migrar histórico cuando el nivel 3 de visualización los necesite), `Conexión` (incluye `gradoDependencia` y, desde la segunda ronda, los cuatro datos estáticos de criticidad de RF3 — impacto, alternativa, tiempo tolerable, tiempo de recuperación — con metadatos de cuándo se confirmó/actualizó cada uno), `CicloPulso`, **`RespuestaCruda`** como entidad separada de `PuntajeAgregado` — se persisten ambas, nunca solo el agregado, por RNF6 — y `EvaluacionExpres` (con `detalleDesbloqueado` y `detalleDesbloqueadoEn` para el gate de RF13/RF17, ver "Decisiones de la quinta ronda" abajo). Cada `PuntajeAgregado`/resultado de ciclo lleva un único `ruleVersion` por resultado (no fragmentado por dimensión) y es inmutable: si el administrador edita los datos de criticidad de una `Conexión` después de que un ciclo ya cerró, el resultado ya calculado no se recalcula por referencia viva — queda como snapshot al momento del cierre.

## Consecuencias

**Positivas:** reutilizamos patrones con evidencia real de funcionar en el material ya revisado, un solo lenguaje reduce la carga cognitiva de trabajar solos, y el despliegue es sencillo y barato para un MVP sin usuarios de pago todavía.

**Negativas / riesgos, con mitigación:** el aislamiento de tenant a nivel de fila (no de base de datos separada) exige que absolutamente ninguna consulta olvide filtrar por `tenant_id` — se mitiga con un middleware de Prisma que inyecta ese filtro automáticamente en cada acceso, más una prueba de integración dedicada exclusivamente a probar el aislamiento (RNF1 de `requirements.md`), que el Agente de Pruebas debe tratar como crítica y no opcional.

**Reversibilidad:** alta. Es una decisión típica de MVP — si el producto gana tracción real y el volumen de datos o los requisitos de aislamiento lo justifican, se puede migrar a bases de datos separadas por tenant o a un backend independiente sin rehacer la capa de dominio, que queda desacoplada de Prisma y de Next.js desde el diseño inicial.

## Mitigación de riesgo de aislamiento multi-tenant

El riesgo señalado arriba (una consulta que "olvide" filtrar por `tenant_id`) se reduce apilando tres capas independientes, sin abandonar el modelo de fila compartida:

1. **Middleware de Prisma** — inyecta el filtro de tenant automáticamente en cada consulta (ya descrito arriba).
2. **Row-Level Security (RLS) de PostgreSQL como segunda capa independiente.** Aunque el código de la aplicación se equivoque, la base de datos misma rechaza devolver filas fuera del tenant activo en la sesión — protección "cinturón y tirantes" estándar para este patrón, barata de configurar ahora y mucho más cara de retrofitear después con datos de producción ya cargados.
3. **Prueba de integración dedicada a fuga entre tenants**, tratada como crítica por el Agente de Pruebas (no opcional). Antes de dar el MVP por validado, se ejecuta con datos reales de las dos empresas piloto de Alex cargadas simultáneamente — la prueba de fuego real, no solo un test automatizado aislado.

## Ruta de crecimiento escalonada

El crecimiento no exige rediseñar la arquitectura de una vez: cada etapa extiende a la anterior, porque el dominio (Eslabón, Conexión, CicloPulso) ya está desacoplado de la infraestructura (Prisma, Next.js) desde esta decisión.

| Etapa | Contexto | Arquitectura de datos | Qué cambia |
|---|---|---|---|
| Ahora — pilotos | 2 empresas | Una base de datos, tabla compartida con `tenant_id` + RLS | Nada que preparar de más |
| Tracción inicial | Decenas de empresas | La misma arquitectura, con índices compuestos liderados por `tenant_id` | Ningún rediseño — Postgres lo maneja cómodo hasta miles de tenants bien indexado |
| Crecimiento serio | Cientos de empresas, o un cliente que exige por contrato aislamiento dedicado | Modelo híbrido: la mayoría en esquema compartido, clientes grandes/sensibles en base de datos propia | Los modelos de dominio no cambian, solo cómo se reparten físicamente los datos (mismo patrón que el caso VoiceFlow del Módulo 10: varios motores de datos coexistiendo según el cliente) |
| Escala alta | Un componente concreto (p. ej. el cálculo de puntajes) necesita escalar aparte, o el equipo crece | Se extrae ese componente a un servicio independiente; el resto sigue como monolito | Migración incremental, el mismo ejercicio ya resuelto en `monolith-to-distributed.zip` del Módulo 04 |

**Triggers explícitos para pasar de etapa** (no se decide por corazonada): un cliente exige contractualmente base de datos dedicada; se supera un volumen de tenants o de datos que empiece a degradar el rendimiento medido (no proyectado); o aparece un incidente real de latencia por contención de un tenant grande afectando a los demás. Ninguno de estos disparadores está activo hoy con 2 empresas piloto — no se invierte en la etapa siguiente hasta que uno de ellos ocurra de verdad.

## Adenda — acceso público sin registro (evaluación exprés)

A pedido de Alex, ChainPulse debe permitir desde el lanzamiento que cualquier empresa visitante mida su salud de cadena de suministro sin crear una cuenta (ver `requirements.md`, RF11-RF18 y actor "Visitante anónimo"). Esto añade una ruta pública no autenticada al mismo monolito Next.js, sin cambiar la decisión de stack:

- La evaluación exprés se modela con una entidad propia (`EvaluacionExpres`), separada de `Empresa`/`Eslabón`/`Conexión` del flujo registrado, y sin `tenant_id` (o con uno nulo tratado como caso explícito en las políticas de RLS, para no romper el aislamiento del resto de los datos).
- Se protege con una limitación de tasa (rate limiting) simple a nivel de aplicación o del proveedor de hosting — suficiente para un MVP público, sin infraestructura adicional. Si el despliegue es serverless (Vercel), este límite no puede vivir en memoria de proceso: necesita un store externo compartido entre invocaciones (p. ej. Redis/Upstash) desde el Incremento 1, porque RF15 y RF17 (Sección 4bis de `requirements.md`) son dos límites independientes sobre el mismo flujo.
- Los datos de evaluación exprés (una sola persona respondiendo por intuición) se guardan separados y claramente distinguibles de los datos de un ciclo de pulso real (varias personas, recurrente) — tienen confiabilidad distinta y no deben mezclarse al recalcular o mejorar el algoritmo (RNF6, RNF7 en `requirements.md`).
- Si el visitante decide "convertir" su evaluación en una cuenta completa, esa es una migración explícita de datos (copiar/enlazar la evaluación a un nuevo tenant), no una promoción automática silenciosa.
- El gate macro/detalle (RF12/RF13) es una capa de presentación, no de cómputo: el resultado completo se calcula y persiste una sola vez al mostrar el resultado macro, y desbloquear el detalle solo revela campos del mismo registro (`detalleDesbloqueado`, `detalleDesbloqueadoEn`) — nunca hay un segundo cálculo que pueda divergir del primero si mientras tanto cambió el `ruleVersion`.

## Decisiones de la quinta ronda (2026-09-12, ver `requirements.md` Sección 12)

Tras el análisis final de los 7 roles antes de Fase 4, quedaron cerradas tres dudas de arquitectura que este ADR había dejado abiertas: (1) `ruleVersion` es un único valor por resultado de ciclo/evaluación, no fragmentado por dimensión — ya incorporado arriba en "Entidades de dominio"; (2) el gate macro/detalle de la evaluación exprés es de presentación, no de cómputo — incorporado en la adenda de arriba; (3) los campos `tipoFlujo` y `estado` (declarado/inferido/verificado) se agregan al esquema de `Eslabón`/`Conexión` desde el Incremento 1, nullable y sin UI, para no migrar datos históricos cuando el nivel 3 de visualización los necesite — incorporado arriba. Ninguna de las tres cambia la decisión de stack ni el modelo de aislamiento multi-tenant ya aceptados; son precisiones del modelo de dominio antes de escribir el primer `schema.prisma`.

## Estado de aprobación

Aceptado por Alex el 2026-09-12: la decisión de stack (Opción A), las mitigaciones de aislamiento multi-tenant, la ruta de crecimiento escalonada y la adenda de evaluación exprés quedan confirmadas para empezar a construir (Fase 4 del prompt maestro), con las tres precisiones de la quinta ronda ya incorporadas.
