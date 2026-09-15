# ChainPulse — MVP Definitivo

Fecha: 2026-09-15
Estado: **Propuesto para aprobación de Alex** — no reemplaza nada hasta que Alex lo confirme.
Versión: 1.0

## 0. Qué es este documento y qué no es

Este es el documento único que define, de aquí en adelante, **qué es el MVP de ChainPulse**: qué ya existe y no se toca, qué se construye a continuación y en qué orden, qué se adopta de la nueva especificación V2 (`CHAINPULSE_ESPECIFICACION_FUNCIONAL_TECNICA_V2.md`, subida por Alex el 2026-09-15) y qué queda pospuesto. Es la fuente única de verdad para "qué construir" — cuando haya una diferencia de alcance entre este documento y `requirements.md` o los ADR, gana este documento, porque es la versión reconciliada y más reciente.

**No reemplaza el detalle técnico ya escrito.** `requirements.md` conserva el detalle EARS completo de RF1-RF18/RNF1-RNF9 (criterios de aceptación, valores de calibración) y los ADR conservan el razonamiento de cada decisión de arquitectura — ambos se citan aquí, no se copian. Este documento tampoco es un ADR de una sola decisión: es la consolidación de todas las decisiones de alcance vigentes, incluida la reconciliación con V2.

**"Definitivo" no significa "congelado para siempre".** Por la arquitectura modular ya adoptada (ADR-0001: dominio separado de infraestructura, motor como función pura versionada), este documento puede mejorarse sección por sección sin rehacer el producto — pero cada cambio de alcance real necesita el mismo tipo de aprobación explícita de Alex que ya se aplicó a `requirements.md` y a los ADR (ver Sección 8, Gobernanza). No es un documento que se edita libremente en cada sesión.

**Estructura de esta sección en adelante:** cada punto de reconciliación se marca como **Hecho** (lo que dicen los documentos existentes o el V2, verificable), **Supuesto propuesto** (mi lectura o recomendación, que Alex debe confirmar o corregir) o **Decisión pendiente de Alex** (algo que ningún análisis técnico puede resolver por sí solo).

## 1. Línea base ya construida — no se toca

**Hecho.** El Incremento 1 (ADR-0002) está completo y validado de punta a punta en Windows contra Neon real: registro de cuenta y MFA (RF1), invitación de responsables (RF4), declarar eslabones/conexiones (RF2/RF3), ciclo de pulso completo abrir→responder→cerrar (RF5-RF7), recomendación priorizada (RF8), panel completo con tendencia (RF9), cobertura de respuesta (RF10), aislamiento multi-tenant probado con datos reales de dos tenants (RNF1), instrumentación mínima (RNF9), recuperación de contraseña, y una suite ampliada de pruebas de mutación (56 unitarias + 24 de integración, todas verdes). El motor v1 (`src/engine/`) calcula salud, criticidad, riesgo, el conjunto no dominado de eslabones más débiles (frontera de Pareto) y el índice de integración de la cadena — con `ruleVersion` único e inmutable por resultado.

**Recomendación.** Nada de esto se reabre, se renombra ni se migra por causa del documento V2. Es trabajo validado con datos reales, no un prototipo descartable — cualquier ganancia de "prolijidad terminológica" no compensa el costo de retrabajo ni el riesgo de reintroducir bugs ya cerrados (p. ej. el de RLS o el de `ruleVersion` en las tendencias). El V2 mismo lo anticipa en su Sección 8.4: pide que el motor actual quede disponible (aunque sea detrás de una bandera), no que se borre.

## 2. Qué falta construir y que V2 puede reformular sin costo: la evaluación exprés (RF11-RF18)

**Hecho clave, y es la pieza central de esta reconciliación.** La evaluación exprés pública sin registro (RF11-RF18 de `requirements.md`, Sección 4bis) es la **única** parte funcional grande del Incremento 1 que todavía no se construyó — el propio README la deja anotada como "rama de trabajo aparte, de menor prioridad". Esto significa que no hay nada validado en producción que romper ahí.

**Recomendación (la decisión central de este documento).** La evaluación exprés es exactamente la puerta de entrada pública que el documento V2 quiere rediseñar (7 preguntas, motor categórico, `diagnosticRuleVersion = "v2-preliminary"`, lenguaje declarado/confirmado/verificado en vez de un número de salud). En vez de construir primero la versión Likert originalmente especificada en RF11-RF18 y rehacerla después, **se construye directamente con el modelo V2**: las 7 preguntas (Q1-Q7) sustituyen al cuestionario condensado, el motor categórico de 5 dimensiones sustituye al cálculo agregado de salud/criticidad/riesgo/dependencia solo para esta puerta de entrada, y el resultado se etiqueta `v2-preliminary` desde el día uno. La estructura ya aprobada de RF11-RF18 (gate de dos niveles macro/detalle, los cuatro datos de contacto con teléfono opcional, dos consentimientos separados, límites de tasa de RF15/RF17, minimización de datos de terceros de RF18) se conserva tal cual — es infraestructura de producto, no depende de qué preguntas se hagan ni de qué motor calcule el resultado.

Esto cumple al mismo tiempo lo que pide la Sección 8.4 del V2 (el motor v1 no se presenta como validado en la experiencia pública nueva) y evita el desperdicio de construir dos veces la misma pantalla.

**Lo que esto implica para el flujo de cuenta completa (RF1-RF10, ya construido):** sigue usando el cuestionario Likert y el motor v1 exactamente como está. El V2 no obliga a cambiarlo — su Sección 8.4 habla de la "experiencia pública", que es precisamente la evaluación exprés, no el ciclo de pulso de una cuenta registrada con responsables reales.

## 3. Terminología — se mantiene la ya construida

**Hecho.** ADR-0002 ya resolvió este mismo problema una vez (`SupplyNode`/`SupplyEdge` del documento `chainpulse_end_to_end.md` no se convirtieron en entidades nuevas). El V2 introduce un vocabulario distinto otra vez: `Cadena`/`Nodo`/`Conexión`/`Flujo` en vez de `Empresa`/`Eslabón`/`Conexión`.

**Recomendación.** Mismo criterio que ADR-0002: `Empresa`, `Eslabón` y `Conexión` siguen siendo las entidades de dominio y de base de datos — todo el código, el schema de Prisma y las políticas RLS ya construidas usan estos nombres, y renombrarlos no cambia ningún comportamiento, solo el costo de migrar. `Cadena`/`Nodo`/`Flujo` quedan como lenguaje narrativo permitido en el copy de cara al usuario de la nueva evaluación exprés v2 (si Alex prefiere ese vocabulario en pantalla), sin tocar el modelo de datos.

## 4. Qué se adopta del V2 sin costo, ya

**Hecho/Recomendación combinados — bajo costo, se incorporan directamente:**

1. **Estados de evidencia declarado/confirmado/verificado**, ya insinuados en ADR-0002 (punto 4: declarado/inferido/verificado), se formalizan con el `EvidenceState` del V2 (`DECLARADO` / `CONFIRMADO_POR_OTROS` / `VERIFICADO_CON_DATOS`) para el nuevo resultado de la evaluación exprés v2.
2. **No mostrar un "% de salud" único como si fuera una medida validada** en la experiencia pública nueva (V2 §8.4 y Sección 23, punto 2) — el resultado macro de la evaluación exprés v2 usa el lenguaje categórico de hallazgos por dimensión, no un porcentaje. (El índice de integración de RF16, que sí muestra un número, sigue existiendo tal cual pero **solo** en el flujo de cuenta registrada, donde ya se explica como "hipótesis de calibración, no una magnitud científica exacta" — no se lleva ese número a la puerta pública nueva.)
3. **Consentimiento por finalidad**, extendiendo el gate de dos consentimientos ya aprobado en RF13 (enviar resultado / mejorar el algoritmo) a las cuatro finalidades que nombra el V2 (`DIAGNOSTICO`, `INVESTIGACION`, `ESTADISTICAS_COMERCIALES`, `CONTACTO_COMERCIAL`) — aditivo sobre el mecanismo que ya existe, sin rediseñarlo.
4. **Minimización de datos de terceros** (alias sugerido, advertencia junto a texto libre) — ya es RF18, no cambia.

## 5. Qué se pospone explícitamente, sin ambigüedad

**Recomendación**, siguiendo el mismo criterio de ADR-0002 (documentar como visión, construir cuando haya una razón real de negocio, no antes):

- **KPIs / Indicadores** (Sección de V2 sobre OTIF, Fill Rate y otros) — fase posterior; cuáles KPIs entran primero es una decisión de negocio de Alex (Sección 7 de este documento).
- **Consultas en lenguaje natural** sobre catálogo semántico permitido — fase posterior, depende de tener datos reales acumulados.
- **Pipeline de investigación / anonimización** — fase posterior; depende de volumen real de datos y de una revisión legal previa (ya exigida hoy para abrir la evaluación exprés a tráfico público general, ADR-0002).
- **"ChainPulse Market Signals"** (producto comercial de estadísticas) — explícitamente fuera del MVP; el propio V2 lo reconoce como punto pendiente de confirmar en su Sección 23, punto 7.
- **Entidades de datos que solo sirven a estas fases** (`DefinicionKpi`, `ObservacionKpi`, `Accion`, `Seguimiento`, `PreguntaSugerida`, `DatasetVersion`, `DatasetContribution`, `ConsultaAnalitica`) — no se agregan al schema todavía. Se agregan cuando se construya la fase que las necesita, siguiendo el mismo criterio ya usado con los campos `tipoFlujo`/`estado` de RF (agregarlos recién cuando hay una función real que los use, no antes "por si acaso" salvo que el costo de migrar después sea alto — no es el caso aquí).

## 6. Modelo de datos — extensión mínima para la evaluación exprés v2

**Recomendación**, migración aditiva (no se borra ni reinterpreta nada existente, tal como pide el propio V2 en su Sección 16):

- `EvaluacionExpres` (ya prevista en ADR-0001) pasa a registrar `diagnosticRuleVersion = "v2-preliminary"` en vez del motor v1.
- Nuevas: `CuestionarioVersion` / `PreguntaVersion` (para versionar las 7 preguntas igual que el motor tiene `ruleVersion`), `Respuesta` por pregunta (no por conexión, ya que el modelo V2 pregunta a nivel de cadena, no de conexión individual), `Hallazgo` (una fila por `DiagnosticFinding`: dimensión, estado, `evidenceState`, cobertura de confianza, evidencia faltante), `Consentimiento` con finalidad + versión (Sección 4, punto 3).
- Nada de esto toca `Eslabon`, `Conexion`, `CicloPulso`, `RespuestaCruda`, `ResultadoConexion` ni `ResultadoCiclo` — son tablas nuevas, aisladas, igual que `EvaluacionExpres` ya lo está hoy.

## 7. Decisiones que solo Alex puede tomar (Sección 23 del V2)

El propio documento V2 lista 8 "decisiones que el propietario debe confirmar" en su Sección 23. Ya quedaron resueltas por la reconciliación de arriba, o tienen una recomendación de bajo riesgo (marcadas ✅); dos genuinamente no se pueden asumir (marcadas ⚠️ — necesito tu respuesta directa, no una suposición mía):

1. ✅ Mantener las 7 preguntas como versión candidata inicial — Sección 2 de este documento.
2. ✅ Quitar el "% de salud" universal de la experiencia pública hasta validarlo — Sección 4, punto 2.
3. ✅ Permitir resultado preliminar sin email — ya es así en RF12, se mantiene igual en v2.
4. ✅ El mapa (cuando se construya) requiere cuenta registrada para guardarse de forma persistente — coherente con la Sección 10 de `requirements.md` (nivel 2 de visualización es para cuenta registrada o evaluación exprés detallada). Guardado temporal de sesión sin cuenta (para no perder el avance mientras el visitante decide) es una mejora de UX razonable, no bloqueante, se evalúa al construir el mapa.
5. ⚠️ **Países iniciales y revisión legal aplicable.** No hay ningún dato en el proyecto sobre a qué país(es) apunta el lanzamiento más allá de las dos pilotos de Alex en Perú. Necesito que me digas los países iniciales para poder acotar qué revisión legal aplica (esto ya estaba pendiente desde ADR-0002 como gate antes de tráfico público general, y el V2 lo vuelve a marcar).
6. ⚠️ **Qué KPIs, además de OTIF y Fill Rate, entran en el primer lanzamiento de esa fase.** Es una decisión de producto/negocio (qué mide realmente valor para el segmento de calibración, pyme comercial retail/distribución) que no puede inferirse del documento técnico.
7. ✅ Market Signals queda confirmado como fase posterior, no requisito de lanzamiento — Sección 5.
8. ✅ Política de retención real — ya existe una definida para la evaluación exprés actual (`requirements.md` Sección 12, punto 4: 90 días para identificadores de sesión sin desbloqueo, indefinido para agregados). Se propone extender el mismo criterio a los datos nuevos de la evaluación exprés v2, salvo que prefieras uno distinto.

## 8. Hoja de ruta reconciliada (reemplaza la tabla de incrementos de ADR-0002 de aquí en adelante)

**Recomendación** — se recorre el orden original de ADR-0002 dándole prioridad a la evaluación exprés (la puerta de entrada pública, sin dato validado que proteger) antes que al mapa visual:

| Incremento | Contenido | Depende de |
|---|---|---|
| **1 — Primer pulso** (cerrado) | RF1-RF10, RNF1, RNF9, recuperación de contraseña, motor v1. Ya construido y validado. | — |
| **2 — Evaluación exprés v2** (redefine el RF11-RF18 original) | 7 preguntas (Q1-Q7), motor categórico de 5 dimensiones, gate macro/detalle ya especificado, consentimiento por 4 finalidades, `diagnosticRuleVersion = "v2-preliminary"` | Este documento aprobado + decisiones ⚠️ de la Sección 7 |
| **3 — Mapa y profundidad** | Mapa visual interactivo (React Flow) sobre Eslabón/Conexión ya construidos, nivel 2 de visualización de `requirements.md` Sección 10 | Incremento 1 (ya cumplido) |
| **4 — Indicadores** | KPIs más allá de OTIF/Fill Rate (Sección 7, punto 6) | Decisión ⚠️ de Alex |
| **5 — Consultas en lenguaje natural** | Sobre catálogo semántico permitido | Volumen real de datos de los incrementos anteriores |
| **6 — Investigación / anonimización** | Pipeline de anonimización, revisión legal previa | Decisión ⚠️ de países/legal (Sección 7, punto 5) |
| **7 — Market Signals** | Producto comercial de estadísticas agregadas (mínimo 10 organizaciones por segmento publicado) | Volumen real, fuera del MVP |

Ningún incremento arranca sin el visto bueno explícito de Alex, mismo criterio ya establecido para el Incremento 2 original.

## 9. Gobernanza de este documento

Este documento se trata con el mismo criterio que los ADR: cambios de alcance real requieren aprobación explícita de Alex, documentada como una nueva sección o un addendum fechado — nunca una reescritura silenciosa de una sección ya aprobada. `requirements.md` sigue siendo la fuente del detalle EARS/criterios de aceptación del Incremento 1 ya cerrado; cuando se construya el Incremento 2 (evaluación exprés v2), sus RF/RNF de detalle se redactan como una actualización de `requirements.md` Sección 4bis, citada desde aquí — este documento fija el alcance y el orden, no repite el detalle técnico que ya tiene un lugar natural.
