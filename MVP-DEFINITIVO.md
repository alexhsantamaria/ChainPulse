# ChainPulse — MVP Definitivo

Fecha: 2026-09-15
Estado: **Hoja de ruta aprobada por Alex (Incrementos 2-6), contenido completo de V2 incorporado a pedido explícito de Alex el 2026-09-15.** Cada pieza de construcción listada abajo queda marcada `[ ]` — sin construir, pendiente de confirmación puntual — hasta que se marque `[x]` al validarla, mismo criterio ya usado en todo el proyecto (nada se construye sin visto bueno explícito).
Versión: 1.2

## 0. Qué es este documento y qué no es

Este es el documento único que define, de aquí en adelante, **qué es el MVP de ChainPulse**: qué ya existe y no se toca, qué se construye a continuación y en qué orden, y **el contenido completo** de la especificación V2 (`CHAINPULSE_ESPECIFICACION_FUNCIONAL_TECNICA_V2.md`, subida por Alex el 2026-09-15), incorporado íntegro a pedido explícito de Alex — no solo un resumen. Es la fuente única de verdad para "qué construir": cuando haya una diferencia de alcance entre este documento y `requirements.md` o los ADR, gana este documento.

**No reemplaza el detalle técnico ya escrito.** `requirements.md` conserva el detalle EARS completo de RF1-RF18/RNF1-RNF9 del Incremento 1 ya cerrado, y los ADR conservan el razonamiento de cada decisión de arquitectura. Cuando se construya cada incremento nuevo (2 en adelante), su detalle EARS se redacta en su momento como actualización de `requirements.md` — este documento fija **qué** se construye y **en qué orden**, con el inventario completo de V2 ya volcado aquí para que nada se pierda ni se tenga que releer el documento original.

**Cómo usar el checklist de esta versión.** Cada punto de construcción real (una pantalla, una regla, una entidad, un endpoint) aparece como una casilla `- [ ]`. Ninguna casilla se marca `[x]` por escribirla aquí — se marca cuando esa pieza puntual está construida y validada, exactamente igual que se hizo con cada RF del Incremento 1. Que algo esté en este documento significa "está aprobado en la hoja de ruta y descrito con detalle", no "ya está construido".

**Estructura de marcas:** **Hecho** (verificable en los documentos existentes o en V2), **Recomendación/Supuesto propuesto** (mi lectura, que Alex puede corregir) o **Decisión pendiente de Alex** (algo que ningún análisis técnico resuelve solo).

## 1. Línea base ya construida — no se toca

**Hecho.** El Incremento 1 (ADR-0002) está completo y validado de punta a punta en Windows contra Neon real: registro de cuenta y MFA (RF1), invitación de responsables (RF4), declarar eslabones/conexiones (RF2/RF3), ciclo de pulso completo abrir→responder→cerrar (RF5-RF7), recomendación priorizada (RF8), panel completo con tendencia (RF9), cobertura de respuesta (RF10), aislamiento multi-tenant probado con datos reales de dos tenants (RNF1), instrumentación mínima (RNF9), recuperación de contraseña, y una suite ampliada de pruebas de mutación (56 unitarias + 24 de integración, todas verdes). El motor v1 (`src/engine/`) calcula salud, criticidad, riesgo, el conjunto no dominado de eslabones más débiles (frontera de Pareto) y el índice de integración de la cadena — con `ruleVersion` único e inmutable por resultado.

**Recomendación.** Nada de esto se reabre, se renombra ni se migra por causa del documento V2 — es trabajo validado con datos reales. El V2 mismo lo anticipa en su Sección 8.4: pide que el motor actual quede disponible (aunque sea detrás de una bandera), no que se borre.

## 2. Principios obligatorios de V2 (Sección 3 del documento original) — adoptados íntegros

V2 define 10 principios obligatorios para todo lo que se construya de aquí en adelante (no solo para la evaluación exprés). Se adoptan los 10, sin excepción, como reglas transversales de diseño para los Incrementos 2-6:

1. **Valor antes del registro** — ya cumplido hoy (RF12 no exige cuenta para el resultado preliminar). Se extiende a todo lo nuevo: ninguna pantalla nueva exige registro antes de mostrar algo de valor.
2. **Una cadena concreta** — toda evaluación se refiere a un producto, servicio o familia concretos y a un periodo (30 días por defecto), nunca a "la empresa en general". Nuevo respecto al modelo actual: `Cadena` necesita estos dos campos (producto/servicio, periodo) desde el Incremento 3.
3. **Sin falsa precisión** — ya adoptado (Sección 4, punto 2 más abajo): no se presenta un índice universal de "salud" como medida científica validada en la experiencia pública.
4. **Trazabilidad** — todo hallazgo (`Hallazgo`, Incremento 5 en adelante) referencia qué preguntas, qué datos y qué versión de regla lo originaron. Se aplica a `DiagnosticFinding` desde el Incremento 2.
5. **Tres estados de evidencia** — `DECLARADO` / `CONFIRMADO_POR_OTROS` / `VERIFICADO_CON_DATOS`, ya adoptado (Sección 4, punto 1).
6. **"No sé" no es cero** — ya es una regla del Incremento 1 (RF6 de `requirements.md`, Likert + "No sé"/"No aplica") y se mantiene igual para las 7 preguntas nuevas del Incremento 2.
7. **Tecnología no equivale a integración** — SAP/ERP/Excel/WMS/TMS/APS son contexto declarado (subpregunta no puntuable de Q5, Incremento 2), no una fuente de puntaje ni una señal de madurez por sí sola.
8. **Consentimientos independientes** — 4 finalidades separadas (`DIAGNOSTICO`, `INVESTIGACION`, `ESTADISTICAS_COMERCIALES`, `CONTACTO_COMERCIAL`), ya adoptado (Sección 4, punto 3), con el detalle completo en la Sección 8 de este documento.
9. **Versionado inmutable** — preguntas, opciones, fórmulas y reglas conservan su versión histórica; ningún cambio de regla altera un resultado ya cerrado (mismo principio que ya rige `ruleVersion` en el motor v1, extendido a `CuestionarioVersion`/`PreguntaVersion`/`DefinicionKpi`).
10. **La IA explica, el motor calcula** — ningún KPI ni hallazgo crítico se calcula con texto generativo; una capa de IA opcional puede interpretar/explicar datos ya calculados por el motor determinístico (aplica directamente al Incremento 5, Consultas).

## 3. Alcance explícito de V2 — incluido y excluido (Sección 4 del documento original)

**Hecho — Incluido en V2** (mapeado a incrementos en la Sección 6 de este documento): evaluación pública de 7 preguntas, resultado preliminar explicable, cuenta empresarial opcional, cadenas/nodos/conexiones/flujos, invitación a participantes, contraste de respuestas por rol o nodo, ingreso manual de indicadores, pegado de tabla y CSV opcional, catálogo inicial de KPIs, consultas en lenguaje natural sobre datos autorizados, recomendaciones basadas en reglas, seguimiento de acciones, sugerencias de nuevas preguntas, consentimientos versionados, base analítica separada, exportación anónima para investigación, estadísticas comerciales agregadas con umbral de publicación.

**Hecho — Explícitamente fuera del MVP, según el propio V2** (se adopta tal cual, no es una decisión mía): conexión directa con SAP/WMS/TMS/ERP; benchmarking público con muestra insuficiente; marketplace de leads sin autorización expresa; modelos predictivos entrenados con datos de clientes; puntuación universal validada; diagnóstico causal automático; recomendaciones que modifiquen directamente sistemas operativos del cliente. Ninguno de estos se construye en ningún incremento de este documento.

## 4. Actores (Sección 5 del documento original)

**Hecho.** V2 define 8 actores. Se listan todos, con el incremento donde cada uno se vuelve relevante por primera vez:

| Actor | Permisos principales | Aparece desde |
|---|---|---|
| Visitante | Completar evaluación preliminar sin cuenta | Incremento 2 (ya existe como "Visitante anónimo" en `requirements.md`) |
| Usuario de empresa | Crear cadenas, aportar respuestas, consultar datos autorizados | Incremento 3 |
| Administrador de empresa | Gestionar participantes, nodos, indicadores, permisos del tenant | Ya existe (Incremento 1) |
| Participante invitado | Responder solo sobre su cadena/conexión asignada | Incremento 3 (extiende al "Responsable de área" ya existente) |
| Investigador | Consultar conjuntos anonimizados autorizados, nunca datos privados identificables | Incremento 6 |
| Curador metodológico | Versionar preguntas/reglas/biblioteca; aprobar o rechazar candidatas | Incremento 2 (versionado) y 6 (preguntas sugeridas) |
| Administrador de plataforma | Operación técnica, auditoría y cumplimiento, sin acceso empresarial innecesario | Transversal, formalizar desde Incremento 2 |
| Comprador de estadísticas | Acceder solo a agregados que superen reglas de privacidad y calidad | Incremento 7 (Market Signals — **excluido de este alcance**, ver Sección 6.6) |

## 5. Terminología — se mantiene la ya construida

**Hecho.** ADR-0002 ya resolvió este mismo problema una vez (`SupplyNode`/`SupplyEdge` de `chainpulse_end_to_end.md` no se convirtieron en entidades nuevas). El V2 introduce vocabulario distinto otra vez: `Cadena`/`Nodo`/`Conexión`/`Flujo` en vez de `Empresa`/`Eslabón`/`Conexión`.

**Recomendación.** `Empresa`, `Eslabón` y `Conexión` siguen siendo las entidades de dominio y de base de datos ya construidas — renombrarlas no cambia comportamiento, solo cuesta migrar. Los términos nuevos de V2 (`Cadena` como alcance producto/periodo, `Nodo`, `Flujo`) se incorporan como entidades **adicionales** desde el Incremento 3 (Sección 7), no como reemplazo: una `Cadena` es el alcance de una evaluación (producto/servicio + periodo) que puede vivir dentro de una `Empresa`; `Nodo` es el término de V2 para lo que hoy es `Eslabón` en el flujo de cuenta completa, pero en el flujo nuevo de V2 un `Nodo` puede ser también una persona decisora o un sistema, no solo un área — por eso no se fusionan automáticamente, se detalla en la Sección 7.

## 6. Hoja de ruta con inventario completo de V2 y checklist de confirmación

Cada incremento de abajo incorpora **todo** el contenido correspondiente de V2 (no un resumen). Ningún ítem se construye por estar aquí — cada casilla se marca `[x]` solo cuando Alex confirma esa pieza puntual como construida y validada.

### 6.1 Incremento 2 — Evaluación exprés v2 (V2 "Incremento 1 — Primer plano V2", §7-8)

Redefine RF11-RF18 de `requirements.md`. Reemplaza el cuestionario Likert condensado original por las 7 preguntas de V2, y el cálculo agregado de salud/criticidad/riesgo por el motor categórico — solo para esta puerta pública (Sección 1 de este documento: el flujo de cuenta completa no cambia).

**Contexto previo, no puntuable (§7.1):**
- [ ] País y región
- [ ] Sector y subsector
- [ ] Rango de tamaño empresarial
- [ ] Rol del participante
- [ ] Producto, servicio o familia analizada (define el alcance de la `Cadena`, principio 2 de la Sección 2)
- [ ] Periodo (por defecto últimos 30 días)
- [ ] Tipo de operación: manufactura, distribución, comercio, servicios u otra
- [ ] Regla de minimización: nunca pedir nombres reales de proveedores/clientes, usar alias tipo "Proveedor A" (extiende RF18 ya existente)

**Las 7 preguntas (§7.2), cada una con sus opciones ya definidas en V2, versionadas como `CuestionarioVersion`/`PreguntaVersion`:**
- [ ] Q1 — Promesa (8 opciones: disponibilidad, rapidez, cumplimiento de fecha y cantidad, calidad y consistencia, precio o eficiencia, personalización, continuidad ante interrupciones, no está claramente definido)
- [ ] Q2 — Objetivo común (5 opciones, de "misma respuesta y deciden de acuerdo" a "no puedo responder por las otras áreas")
- [ ] Q3 — Interdependencia (5 opciones)
- [ ] Q4 — Información y decisión (5 opciones)
- [ ] Q5 — Integración operativa (5 opciones) + subpregunta contextual no puntuable de fuente principal (SAP/ERP, Excel, WMS/TMS/APS, correo/mensajería, varios sistemas, sin fuente definida)
- [ ] Q6 — Evidencia de cumplimiento (5 opciones)
- [ ] Q7 — Respuesta ante falla (5 opciones)

**UX del cuestionario (§7.3):**
- [ ] Una pregunta por pantalla
- [ ] Una selección por toque
- [ ] Avance automático opcional
- [ ] Botón Atrás
- [ ] Indicador de progreso "n de 7"
- [ ] Guardado automático
- [ ] Accesibilidad de teclado y lector de pantalla
- [ ] Tiempo objetivo inicial 60-90 segundos (a validar con uso real, no un límite duro como RNF2)
- [ ] No pedir correo para ver el primer resultado (ya garantizado por el gate de RF12/RF13 existente)
- [ ] Mostrar claramente que es una percepción individual, no un dato verificado

**Motor de diagnóstico V2 (§8):**
- [ ] Salida por 5 dimensiones separadas, sin sumar en un porcentaje único: Alineación, Coordinación, Integración, Evidencia, Resiliencia — cada una con sus 5 estados categóricos posibles (tabla completa en §8.1 del V2, citada en Sección 7 de este documento — modelo de datos)
- [ ] Contrato `DiagnosticFinding` (dimension, status, statement, sourceQuestionIds, evidenceState, confidenceCoverage, missingEvidence, nextCheck, ruleVersion) — implementado como función pura versionada, mismo patrón que el motor v1
- [ ] Priorización inicial en este orden: (1) posible afectación directa a la promesa, (2) punto único de falla sin alternativa, (3) decisión inexistente o tardía, (4) información inconsistente, (5) ausencia de evidencia, (6) oportunidad de mejora no crítica
- [ ] Si falta información suficiente, la salida prioritaria pide evidencia — nunca inventa una causa
- [ ] `diagnosticRuleVersion = "v2-preliminary"` desde el primer resultado; motor v1 (`salud`/`criticidad`/`riesgo`/`eslabón más débil`/`índice de integración`) queda intacto detrás de su propio flujo (Sección 1), nunca mezclado con este

**Criterios de aceptación de V2 para este incremento (§21, "Evaluación"):**
- [ ] Visitante completa las 7 preguntas sin cuenta
- [ ] "No lo sé" no se convierte en cero
- [ ] Resultado muestra las 5 dimensiones separadas
- [ ] Todo hallazgo referencia las preguntas de origen y el `ruleVersion`
- [ ] No aparece ningún índice universal como hecho validado

**Estructura de RF11-RF18 ya aprobada, se conserva sin cambios** (gate de dos niveles macro/detalle, 4 datos de contacto con teléfono opcional, dos consentimientos → ahora 4 finalidades, ver Sección 8; límites de tasa RF15/RF17; minimización de datos de terceros RF18).

### 6.2 Incremento 3 — Mapa y profundidad (V2 "Incremento 2 — Cuenta y mapa", §9-10)

**Objetos del mapa (§9.1):**
- [ ] `Cadena` — alcance de un producto/servicio y periodo (entidad nueva, Sección 7)
- [ ] `Nodo` — organización, área, instalación, proceso, persona decisora o sistema (más amplio que `Eslabón` actual — ver Sección 5, terminología)
- [ ] `Conexión` — relación dirigida entre origen y destino (extiende la `Conexion` ya construida con los campos de abajo)
- [ ] `Flujo` — producto/servicio, información, dinero, decisión o devolución (una conexión soporta múltiples flujos)

**Datos por conexión (§9.2), todos nuevos respecto al modelo actual:**
- [ ] Origen y destino
- [ ] Tipos de flujo (múltiples por conexión)
- [ ] Requerimiento recibido: cantidad, fecha, especificación, aprobación o pago
- [ ] Coincidencia de prioridad, cantidad y fecha
- [ ] Oportunidad de la información
- [ ] Responsable de decisión
- [ ] Impacto de falla
- [ ] Alternativa y estado de prueba
- [ ] Tiempo tolerable y tiempo de recuperación
- [ ] Fuente y estado de evidencia (`DECLARADO`/`CONFIRMADO_POR_OTROS`/`VERIFICADO_CON_DATOS`)

**Visualización (§9.3):** metáfora de electrocardiograma — debe indicar siempre si el dato es una foto puntual o una serie temporal, sin sugerir monitoreo continuo cuando no existe.
- [ ] Mapa visual interactivo (React Flow, ya recomendado en ADR-0002) sobre estos objetos
- [ ] Indicador explícito de "foto puntual" vs. "serie temporal" en cada dato mostrado

**Participación multi-rol (§10):**
- [ ] Invitación por enlace con token de un solo propósito (extiende el mecanismo ya construido de RF4)
- [ ] El invitado recibe solo las preguntas necesarias para su cadena o conexión
- [ ] Comparaciones: prioridad elegida, conocimiento de entradas/salidas, momento de información, fuente de datos, nodo crítico, alternativa disponible
- [ ] Resultado de comparación en 4 estados: `acuerdo`, `acuerdo parcial`, `diferencia`, `sin respuesta suficiente`
- [ ] Una diferencia se trata como hallazgo, nunca como culpa ni determinación automática de quién tiene razón

**Criterios de aceptación de V2 (§21, "Mapa"):**
- [ ] Usuario crea, edita y conecta nodos
- [ ] Una conexión soporta múltiples flujos
- [ ] Se identifica procedencia y estado de evidencia
- [ ] No se requieren nombres reales de terceros

### 6.3 Incremento 4 — Indicadores (V2 "Incremento 3 — Indicadores", §11)

**Nota sobre la Decisión pendiente #6 de la Sección 13 de este documento:** V2 ya trae un catálogo inicial completo de 10 KPIs, no solo OTIF/Fill Rate. Como Alex pidió incorporar todo el contenido de V2, la recomendación pasa a ser adoptar los 10 tal como están definidos — queda igual como confirmación pendiente de Alex, pero ya no como una pregunta abierta sin propuesta.

**Catálogo inicial completo (§11.1):**
- [ ] OTIF — pedidos completos y a tiempo / pedidos evaluados (campos: pedido, fecha prometida, fecha real, cantidad pedida y entregada)
- [ ] Fill Rate — unidades servidas / unidades solicitadas (campos: SKU, pedido, solicitado, servido)
- [ ] Stockout — eventos o periodos sin stock / base definida (campos: SKU, ubicación, fecha, stock/disponibilidad)
- [ ] Cobertura — inventario disponible / consumo diario esperado (campos: SKU, inventario, demanda/consumo, periodo)
- [ ] Lead time — fecha fin − fecha inicio (campos: proceso, inicio, fin)
- [ ] Variabilidad de lead time — dispersión sobre lead times comparables
- [ ] OTIF proveedor — recepciones completas y a tiempo / recepciones (campos: proveedor alias, promesa, recepción, cantidades)
- [ ] Tiempo de detección — detección − ocurrencia (campos: incidente, fecha/hora de ambos eventos)
- [ ] Tiempo de decisión — decisión − detección
- [ ] Tiempo de recuperación — recuperación − interrupción

Cada `DefinicionKpi` guarda denominador, unidad, periodo, zona horaria, reglas de exclusión y versión (principio 9, Sección 2).

**Ingreso progresivo (§11.2):**
- [ ] Nivel 1 — valor manual con fuente y periodo
- [ ] Nivel 2 — pegado de tabla
- [ ] Nivel 3 — CSV con mapeo de columnas y previsualización
- [ ] Nivel 4 — conectores (pospuesto, ya excluido en Sección 3: sin conexión directa a SAP/WMS/TMS/ERP en el MVP)
- [ ] Regla dura: nunca persistir un archivo sin mostrar filas detectadas, campos mapeados, errores y autorización explícita del usuario

**Criterios de aceptación de V2 (§21, "Indicadores"):**
- [ ] Se calcula OTIF con fórmula, periodo, numerador y denominador visibles
- [ ] Datos incompletos producen advertencia y cobertura
- [ ] Importación permite previsualizar antes de persistir
- [ ] El mismo conjunto y versión produce el mismo resultado (determinismo, igual que el motor v1)

### 6.4 Incremento 5 — Consultas en lenguaje natural (V2 "Incremento 4 — Consultas", §12)

**Ejemplos de consulta (§12.1):**
- [ ] "¿Por qué cayó mi OTIF?"
- [ ] "¿Qué proveedor concentra más retrasos?"
- [ ] "¿Dónde se encuentra la dependencia más crítica?"
- [ ] "¿Qué información falta para calcular Fill Rate?"
- [ ] "¿Qué acción debería evaluar primero?"
- [ ] "¿Qué cambió desde el último pulso?"

**Arquitectura de consulta (§12.2) — respeta el principio 10 de la Sección 2 (la IA explica, el motor calcula):**
- [ ] Clasificador de intención sobre la pregunta en lenguaje natural
- [ ] Catálogo semántico permitido de KPIs y dimensiones (el modelo de lenguaje solo elige de este catálogo, nunca genera SQL libre)
- [ ] Constructor de consulta permitida
- [ ] Control de tenant, permisos y periodo antes de ejecutar
- [ ] Motor SQL/cálculo determinístico (no generativo) para el resultado numérico
- [ ] Generador de explicación sobre el resultado ya calculado
- [ ] Registro auditable de cada consulta
- [ ] Límites de filas, tiempo, costo y acceso — el modelo de lenguaje nunca recibe credenciales

**Contrato de respuesta, 10 elementos obligatorios (§12.3):**
- [ ] Respuesta directa
- [ ] Periodo y filtros aplicados
- [ ] Fuente de datos
- [ ] Fórmula o regla aplicada
- [ ] Numerador/denominador cuando corresponda
- [ ] Calidad, faltantes y cobertura
- [ ] Interpretación, separada explícitamente del hecho
- [ ] Siguiente acción sugerida
- [ ] Forma de comprobarla
- [ ] Versión de cálculo (`ruleVersion`)
- [ ] Caso sin datos suficientes: responde "No puedo responder todavía" + qué campos faltan + cómo ingresarlos, nunca inventa un número

**Criterios de aceptación de V2 (§21, "Consultas"):**
- [ ] Una pregunta permitida genera un cálculo reproducible
- [ ] Una pregunta sin datos responde qué campos faltan
- [ ] Ningún usuario consulta datos de otro tenant
- [ ] La explicación distingue hecho, interpretación y recomendación

### 6.5 Incremento 6 — Investigación (V2 "Incremento 5 — Investigación", §13-14)

**Preguntas sugeridas y aprendizaje (§13):**
- [ ] Pantalla posterior al resultado: "¿Hay algo importante sobre tu cadena que ChainPulse no preguntó?"
- [ ] Campos: pregunta sugerida, razón (riesgo/dependencia/coordinación/desempeño/sector/otra), rol que debería responder, decisión que ayudaría a tomar (opcional)
- [ ] Estados: `RECIBIDA → AGRUPADA → CANDIDATA → EN_PRUEBA → APROBADA | RECHAZADA | ESPECIALIZADA`
- [ ] Regla dura: una sugerencia nunca cambia el cuestionario automáticamente; toda publicación crea nueva versión y conserva resultados anteriores

**Finalidades de consentimiento, 4 separadas (§14.1) — ya adoptadas en Sección 2, principio 8 de este documento:**
- [ ] `DIAGNOSTICO` — necesario para prestar el servicio solicitado
- [ ] `INVESTIGACION` — uso anonimizado para estudios
- [ ] `ESTADISTICAS_COMERCIALES` — inclusión en productos agregados de pago
- [ ] `CONTACTO_COMERCIAL` — autorización para contacto o transferencia de lead
- [ ] Ninguna casilla opcional premarcada; cada aceptación conserva texto, versión, fecha, jurisdicción y método de retiro

**Datos investigables (§14.2):**
- [ ] Contexto no identificable
- [ ] Versión de pregunta y respuesta
- [ ] Tiempos y abandono
- [ ] "No lo sé" y cambios de respuesta
- [ ] Diferencias entre roles
- [ ] Mapas reducidos a tipos de nodos y conexiones (nunca nombres reales)
- [ ] KPIs agregados y calidad
- [ ] Resultado generado
- [ ] Acción elegida
- [ ] Confirmación o contradicción posterior
- [ ] Pregunta sugerida y códigos cualitativos

**Espacio del investigador (§14.3):**
- [ ] Filtros por país, sector, tamaño, rol, tecnología y periodo
- [ ] Conteos de participantes y organizaciones únicas
- [ ] Comparaciones entre grupos
- [ ] Codificación cualitativa humana con sugerencias de IA (la IA sugiere, un humano decide — principio 10)
- [ ] Notas, casos negativos y citas anonimizadas
- [ ] Exportación CSV/JSON
- [ ] Diccionario de variables
- [ ] Manifiesto de versiones y transformaciones
- [ ] Bitácora de consultas
- [ ] Regla dura: no inferir causalidad a partir de asociaciones transversales

**Criterios de aceptación de V2 (§21, "Investigación y comercialización" — la parte de investigación):**
- [ ] Usuario puede aceptar o rechazar cada finalidad por separado
- [ ] Investigación no ve identidad operativa
- [ ] Toda exportación registra filtros, fecha, esquema y versiones

### 6.6 Incremento 7 — Market Signals (V2 "Incremento 6 — Market Signals", §15) — **EXCLUIDO de este alcance, documentado completo para cuando Alex lo apruebe por separado**

Alex confirmó explícitamente construir "hasta el módulo de investigación" — este incremento **no se construye** sin una aprobación nueva y separada, coherente con la Sección 23 del V2 (punto 7) y con el mensaje de Alex del 2026-09-15. Se documenta íntegro aquí, a pedido de Alex de no dejar nada afuera del documento, precisamente para que quede listo y no haya que releer V2 el día que se apruebe.

**Objetivo (§15):** producto candidato "ChainPulse Market Signals" — ejemplo dado en V2: interés en centros de distribución en la Amazonía peruana.

**Datos a separar:**
- [ ] Participantes únicos
- [ ] Organizaciones únicas
- [ ] Interés declarado
- [ ] Necesidad definida
- [ ] Horizonte
- [ ] Autorización de contacto
- [ ] Cotización
- [ ] Piloto
- [ ] Contratación

**Regla de publicación inicial:**
- [ ] Mínimo 10 organizaciones independientes por segmento publicado, y revisión de reidentificación aprobada (el `10` es un umbral de producto candidato, no garantía legal — debe ser configurable y revisado por privacidad)
- [ ] Nunca exponer: respuestas individuales, texto libre sin revisión, nombres, correos, teléfonos, IP, archivos, o combinaciones que identifiquen indirectamente

**Actor nuevo:** Comprador de estadísticas (Sección 4 de este documento) — accede solo a agregados que superen las reglas de privacidad y calidad de arriba.

## 7. Modelo de datos completo (Sección 16 del documento original)

**Recomendación**, migración aditiva — no se borra ni reinterpreta nada existente, tal como pide el propio V2:

| Entidad nueva | Incremento que la introduce | Relación principal |
|---|---|---|
| `Cadena` (separada de `Empresa`) | 3 | Pertenece a una `Empresa`; agrupa `Nodo`/`Conexion`/`Evaluacion` |
| `Nodo` | 3 | Pertenece a una `Cadena` |
| `CuestionarioVersion` / `PreguntaVersion` | 2 | Versiona las 7 preguntas, igual que `ruleVersion` versiona el motor |
| `Respuesta` (por pregunta) | 2 | Una fila por pregunta respondida, no por conexión — distinto de `RespuestaCruda` ya existente |
| `Hallazgo` | 2 (evaluación exprés) y 6 (investigación) | Una fila por `DiagnosticFinding`: dimensión, estado, `evidenceState`, cobertura, evidencia faltante |
| `DefinicionKpi` / `ObservacionKpi` | 4 | Catálogo de KPIs y sus observaciones cargadas |
| `Accion` / `Seguimiento` | 5 (consultas → acción) y 6 (seguimiento) | Acción recomendada y su verificación posterior |
| `PreguntaSugerida` | 6 | Sugerencias de usuarios, con sus 6 estados (§13) |
| `Consentimiento` (por finalidad + versión) | 2 (ya aprobado, Sección 2) | Las 4 finalidades de la Sección 6.5 |
| `DatasetVersion` / `DatasetContribution` | 6 | Conjuntos anonimizados versionados para investigación |
| `ConsultaAnalitica` (con auditoría) | 5 | Registro de cada consulta en lenguaje natural ejecutada |

Nada de esto toca `Eslabon`, `Conexion`, `CicloPulso`, `RespuestaCruda`, `ResultadoConexion` ni `ResultadoCiclo` del flujo de cuenta completa ya construido — son tablas nuevas, aisladas.

## 8. Arquitectura técnica recomendada por V2 (Sección 17 del documento original)

**Hecho — ya coincide con lo construido, sin cambios de stack:** Next.js + TypeScript, Route Handlers/servicios TypeScript, PostgreSQL gestionado (Neon), Prisma con driver adapter (`@prisma/adapter-pg`, ya en uso desde ADR-0003), Auth.js según ADR-0003, `tenantClient` + RLS, motor como funciones puras versionadas sin dependencias de Next/Prisma (mismo patrón que `src/engine/`). Piezas nuevas que sí faltan:

- [ ] Almacenamiento de objetos privado, cifrado, con URL temporal (para CSV de indicadores, Incremento 4)
- [ ] Cola de trabajos (jobs) para importación, anonimización, seguimiento y agregados (Incrementos 4 y 6)
- [ ] Capa de analítica: vistas/tablas derivadas separadas de OLTP (Incremento 5 en adelante)
- [ ] Capa de IA opcional de interpretación, solo sobre datos ya autorizados y calculados (Incremento 5, respeta principio 10)
- [ ] Observabilidad: errores, latencia, auditoría y calidad, sin capturar contenido sensible innecesario (transversal)

## 9. Seguridad y privacidad de V2 (Sección 18 del documento original)

**Hecho/Recomendación** — varios ya cumplidos por ADR-0001/0003, el resto nuevo:

- [x] RLS obligatorio para toda tabla con tenant — ya cumplido (ADR-0001)
- [x] Pruebas automáticas de aislamiento horizontal — ya cumplido (RNF1, 10/10 pruebas)
- [x] MFA para administradores — ya cumplido (ADR-0003)
- [x] Cifrado en tránsito y en reposo, secretos fuera del repositorio — ya cumplido
- [x] Rate limiting para acceso anónimo — ya cumplido (RF15/RF17)
- [ ] Rate limiting específico para consultas en lenguaje natural (Incremento 5, nuevo)
- [ ] Protección CSRF, validación de entrada y límites de archivo explícitos para las subidas nuevas (CSV de indicadores)
- [ ] Escaneo de archivos y rechazo de fórmulas peligrosas al exportar/importar CSV (mitiga inyección de fórmulas tipo Excel)
- [ ] Auditoría de acceso a datos de investigación (Incremento 6)
- [ ] Retención definida por tipo de dato — **requiere revisar la retención ya definida hoy para la evaluación exprés actual** (`requirements.md` Sección 12) antes de extenderla a los datos nuevos de V2, tal como el propio V2 lo pide explícitamente en su Sección 18
- [ ] Eliminación o retiro de consentimiento sin borrar irreversiblemente agregados ya anónimos, según política revisada
- [ ] Evaluación de impacto de privacidad antes de comercializar estadísticas (gate previo al Incremento 7, cuando se apruebe)
- [ ] Revisión legal por jurisdicción antes de producción — **esta es la Decisión pendiente #5 de la Sección 13 de este documento**, países iniciales

## 10. Requisitos no funcionales de V2 (Sección 19 del documento original)

Complementan, no reemplazan, RNF1-RNF9 ya construidos:

- [ ] Diseño móvil desde 320px
- [ ] WCAG 2.2 AA como objetivo (RNF de accesibilidad ya existía desde el nivel 1 de visualización, Sección 10 de `requirements.md` — se sube el estándar de AA "informal" a 2.2 AA explícito)
- [ ] Resultado inicial en menos de 2 segundos tras completar las 7 preguntas
- [ ] Consultas simples en menos de 5 segundos en condiciones normales (Incremento 5)
- [ ] Importación idempotente (CSV, Incremento 4)
- [ ] Toda operación sensible auditable
- [ ] Disponibilidad objetivo inicial 99% en horario de uso (mismo valor que RNF4 ya existente)
- [ ] Respaldo y prueba de restauración
- [ ] Fechas en UTC, presentación en zona local
- [ ] Internacionalización preparada (no implementada, solo preparada — coherente con el alcance genérico por país ya definido en `requirements.md` Sección 8)
- [x] Pruebas determinísticas por `ruleVersion` — ya es el patrón del motor v1, se extiende a `diagnosticRuleVersion`/`CuestionarioVersion`
- [x] Ningún cambio de regla altera resultados cerrados — ya es un principio ya aplicado (RNF6, inmutabilidad de `ResultadoConexion`/`ResultadoCiclo`)

## 11. Endpoints lógicos mínimos (Sección 20 del documento original)

Se listan tal cual V2 los define, agrupados por incremento — el detalle de rutas REST/Next.js concretas se define al construir cada uno:

**Incremento 2 (evaluación pública):**
- [ ] `POST /api/public/evaluations`
- [ ] `POST /api/public/evaluations/:id/answers`
- [ ] `POST /api/public/evaluations/:id/complete`
- [ ] `GET /api/public/evaluations/:id/result`

**Incremento 3 (cadenas):**
- [ ] `POST /api/chains`
- [ ] `POST /api/chains/:id/nodes`
- [ ] `POST /api/chains/:id/connections`
- [ ] `POST /api/chains/:id/invitations`
- [ ] `GET /api/chains/:id/comparison`

**Incremento 4 (indicadores):**
- [ ] `GET /api/kpis/definitions`
- [ ] `POST /api/chains/:id/kpi-observations`
- [ ] `POST /api/chains/:id/imports`

**Incremento 5 (consultas):**
- [ ] `POST /api/chains/:id/queries`

**Incremento 6 (investigación):**
- [ ] `POST /api/question-suggestions`
- [ ] `POST /api/consents`
- [ ] `POST /api/follow-ups`
- [ ] `GET /api/research/datasets/:version`
- [ ] `POST /api/research/exports`

**Incremento 7 (Market Signals — excluido, ver Sección 6.6):**
- [ ] `GET /api/market-signals`

Los endpoints de investigación y mercado requieren permisos separados y solo consultan vistas aprobadas (principio de seguridad ya listado en la Sección 9).

## 12. Definición de terminado del MVP completo (Sección 24 del documento original)

**Hecho — criterio final de V2, adoptado íntegro** (notando que la validación científica y la demostración de impacto operacional son hitos posteriores, no parte de "terminado"):

- [ ] Una persona puede evaluar una cadena concreta
- [ ] Puede comprender qué se declaró y qué falta comprobar
- [ ] Puede crear un mapa de nodos y flujos
- [ ] Puede invitar a otro participante y observar diferencias
- [ ] Puede ingresar datos básicos y calcular al menos OTIF/Fill Rate
- [ ] Puede formular una consulta y recibir una respuesta trazable
- [ ] Puede convertir el hallazgo en acción y seguimiento
- [ ] Puede decidir separadamente si contribuye a investigación o estadísticas agregadas

## 13. Decisiones que solo Alex puede tomar (Sección 23 del V2)

1. ✅ Mantener las 7 preguntas como versión candidata inicial — Sección 6.1.
2. ✅ Quitar el "% de salud" universal de la experiencia pública hasta validarlo — Sección 2, principio 3.
3. ✅ Permitir resultado preliminar sin email — ya es así en RF12, se mantiene igual en v2.
4. ✅ El mapa requiere cuenta registrada para guardarse de forma persistente — coherente con `requirements.md` Sección 10.
5. ⚠️ **Países iniciales y revisión legal aplicable.** Sigue sin dato más allá de las dos pilotos en Perú — necesito tu respuesta directa.
6. **Qué KPIs, además de OTIF y Fill Rate, entran en el primer lanzamiento** — con el contenido completo de V2 incorporado (Sección 6.3), la propuesta ahora es adoptar los 10 KPIs del catálogo inicial de V2 tal cual, no elegir un subconjunto. Confirmame si estás de acuerdo o preferís acotar la lista.
7. ✅ Market Signals queda confirmado como fase posterior, no requisito de lanzamiento — Sección 6.6.
8. **Política de retención real** — el V2 (Sección 9 de este documento, ítem de retención) pide explícitamente revisar la retención ya definida (`requirements.md` Sección 12: 90 días para identificadores sin desbloqueo, indefinido para agregados) antes de extenderla a todos los datos nuevos — sigue como confirmación pendiente, no asumida.

## 14. Gobernanza de este documento

Cambios de alcance real requieren aprobación explícita de Alex, documentada como una nueva sección o un addendum fechado. `requirements.md` sigue siendo la fuente del detalle EARS/criterios de aceptación del Incremento 1 ya cerrado; cuando se construya cada incremento nuevo, su detalle EARS se redacta como actualización de `requirements.md`, citada desde aquí.

## 15. Addendum — aprobación de la hoja de ruta (2026-09-15)

Alex confirmó: "vamos a hacer todo lo del MVP V2 que envié hoy hasta el módulo de investigación" — la hoja de ruta queda aprobada para los **Incrementos 2 a 6**. El **Incremento 7 (Market Signals) sigue explícitamente fuera de este alcance** — no se construye salvo una aprobación nueva y separada.

Esta aprobación fija el orden y el contenido de cada incremento — no resuelve las decisiones ⚠️ de la Sección 13 (países/revisión legal, ítem 5). El Incremento 2 no depende de ninguna decisión pendiente y puede empezar a detallarse ya.

## 16. Addendum — incorporación del contenido completo de V2 (2026-09-15, segunda instrucción)

Alex pidió explícitamente: "vamos a agregar todo lo que se envió en V2... es importante agregar todo", con un mecanismo para confirmar la creación de cada pieza. Esta versión (1.2) reemplaza los resúmenes de la versión 1.1 por el contenido íntegro de las 24 secciones de V2, organizado por incremento, con un checklist `- [ ]` por cada elemento de construcción real (pregunta, campo, endpoint, regla, entidad). Ninguna casilla se marca sola: se marca cuando esa pieza puntual está construida y validada, igual que cada RF del Incremento 1 se fue marcando validado en el README a medida que se probaba en Windows.

Próximo paso concreto: redactar el detalle EARS del Incremento 2 (evaluación exprés v2) como actualización de `requirements.md` Sección 4bis, antes de tocar el schema de Prisma o escribir código.
