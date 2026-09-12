# ChainPulse — especificación integral end-to-end

**Versión:** 0.1 (documento de diseño, no especificación validada)  
**Fecha:** 2026-09-12  
**Estado:** propuesta para validar con usuarios, especialistas SCM y equipo técnico

## 1. Resumen ejecutivo

ChainPulse es una aplicación web que ayuda a una organización a **conocer cómo funciona realmente su cadena de suministro, localizar descoordinaciones y dependencias críticas, elegir una mejora concreta y comprobar si funcionó**. Su puerta de entrada es una evaluación breve, sin registro obligatorio ni carga de archivos. El producto evoluciona desde una primera fotografía basada en respuestas hacia un mapa de nodos y flujos, evidencia operativa y seguimiento de cambios.

La metáfora del producto es un **electrocardiograma de la cadena**: el mapa indica dónde están los nodos y conexiones; los latidos representan el comportamiento de los flujos de producto/servicio, información, dinero, decisiones y capacidad. Un cuestionario único no produce un electrocardiograma temporal: muestra una primera fotografía. Los cambios en el tiempo requieren mediciones repetidas o datos operativos conectados.

**Problema central:** las áreas pueden tener herramientas, indicadores y reuniones, pero carecer de una visión compartida de qué flujo está descoordinado, qué dependencia amenaza la promesa al cliente y qué acción debe emprenderse primero.

**Promesa del MVP:** «Descubre dónde pierde ritmo tu cadena y cuál es el primer paso verificable para estabilizarla».

## 2. Principios y límites

1. **Valor antes de registro.** El visitante obtiene un resultado inicial antes de crear cuenta.
2. **Entrada ligera.** Respuestas para marcar; escritura y archivos opcionales.
3. **Explicabilidad.** Toda conclusión muestra las respuestas o evidencias que la sustentan, versión de reglas y limitaciones.
4. **Una acción inicial.** La pantalla principal no se convierte en un plan genérico de 30/60/90 días.
5. **Progresión de evidencia.** Percepción individual → consenso de varias áreas → evidencia documental/CSV → datos conectados.
6. **Neutralidad tecnológica.** Excel, SAP, otros ERP o procesos manuales son contexto; la sola presencia de un sistema no equivale a integración.
7. **No inventar causalidad.** Una asociación entre respuestas y síntomas genera una hipótesis, no una causa demostrada.
8. **Aplicación multiindustria.** El modelo es configurable para manufactura, comercio, servicios, salud, alimentos, plataformas y otros; no fuerza nodos físicos donde no existen.
9. **Privacidad por defecto.** Captura lo mínimo, permite anonimato inicial y evita nombres de proveedores/clientes hasta que sean necesarios.

### Fuera del MVP

Monitorización en tiempo real, digital twin, predicción de disrupciones, integraciones SAP nativas, evaluación financiera auditada, comparación pública entre empresas, recomendaciones generadas libremente por IA y descubrimiento automático completo de la red de proveedores.

## 3. Usuarios y trabajos por hacer

| Usuario | Necesidad | Resultado esperado |
|---|---|---|
| Dueño o gerente de pyme | Entender dónde se atasca la operación sin consultoría costosa | Diagnóstico breve y acción concreta |
| Líder de Supply Chain/Operaciones | Unificar señales de varias áreas | Mapa, dependencias y prioridades justificadas |
| Ventas, Compras, Finanzas y Tecnología | Hacer visibles desacuerdos y traspasos fallidos | Comparación de percepciones y acuerdos verificables |
| Consultor/facilitador | Estructurar una conversación basada en evidencia | Informe trazable, no una puntuación opaca |

El primer usuario puede ser una persona; la unidad de análisis posterior es una **organización + cadena o flujo de valor + periodo de evaluación**. Una empresa con varias unidades puede mantener mapas separados.

## 4. Modelo conceptual

### 4.1 Elementos del mapa

- **Nodo:** entidad o función que transforma, almacena, transporta, decide, financia o habilita valor. Tipos: proveedor, compras, planificación, producción/prestación, almacén, transporte, canal, cliente, finanzas, sistema, socio externo u otro.
- **Conexión dirigida:** dependencia entre dos nodos. Registra origen, destino, tipo de flujo, frecuencia, importancia, alternativa, responsable y fuente de información.
- **Flujo:** producto/servicio, información, dinero, decisiones, capacidad y flujo inverso/devoluciones. Aprendizaje es una capacidad transversal que modifica los demás flujos.
- **Promesa al cliente:** lo que la cadena debe cumplir (disponibilidad, plazo, calidad, experiencia, costo u otra condición). Es la referencia para valorar criticidad.
- **Latido:** observación de estabilidad/coordinación de un flujo en un momento o periodo.
- **Evento:** retraso, variación, interrupción o decisión relevante.
- **Dependencia:** necesidad de que un nodo o conexión funcione para que otro entregue valor.
- **Control/alternativa:** inventario, proveedor alterno, capacidad de respaldo, procedimiento manual, sustituto o tiempo de recuperación.

### 4.2 Términos que no deben confundirse

| Término | Pregunta que responde | Ejemplo |
|---|---|---|
| Salud | ¿Qué tan estable y coordinado funciona hoy? | Demanda cambia sin comunicarse |
| Criticidad | ¿Qué daño causaría la interrupción? | Un componente único detiene entregas |
| Dependencia | ¿De qué nodo o conexión necesita otro para operar? | Compras depende de previsión de Ventas |
| Riesgo | ¿Qué amenaza existe y qué exposición/respuesta tiene? | Proveedor único con entrega variable |
| Confianza | ¿Qué sustento tiene el diagnóstico? | Una persona responde sin datos |

Un nodo con baja salud no es necesariamente el más crítico. Un nodo sano puede ser crítico si no tiene sustituto. No se debe llamar «corazón» al flujo con mejor puntuación: el corazón se identifica por la promesa al cliente y el impacto de su interrupción.

## 5. Recorrido end-to-end del usuario

### Etapa A — llegada y activación

1. El visitante llega a una página que pregunta: **«¿Conoces de verdad el estado de tu cadena de suministro?»**
2. Ve una muestra del resultado: mapa, latido vulnerable, explicación y primer paso.
3. Selecciona **«Medir mi cadena»**. No se exige correo, tarjeta, integración ni archivo.
4. Se explica que el resultado inicial es orientativo y mejora cuando participa más de un área o se añade evidencia.

### Etapa B — contexto mínimo

5. Marca modelo de negocio o plantilla: fabrica, comercializa, presta servicios, plataforma, operación mixta u otro.
6. Elige la promesa principal al cliente: disponibilidad, rapidez, calidad, personalización, precio u otra.
7. Selecciona herramientas usadas: Excel, SAP, otro ERP, WMS/TMS, software propio, mensajería, papel u otras. Se pueden marcar varias.
8. Marca nodos presentes en su cadena. La plantilla propone un mapa inicial, editable y con opción «no aplica/no lo sé».

### Etapa C — evaluación rápida

9. Responde afirmaciones sobre objetivo común, calidad y oportunidad de información, claridad de responsables, detección temprana, coordinación con socios, decisiones en reuniones, visibilidad de capacidad/caja y aprendizaje.
10. Respuestas cerradas con anclajes conductuales: **nunca / rara vez / a veces / casi siempre / siempre / no lo sé / no aplica**. «No lo sé» se registra como ausencia de visibilidad; «no aplica» excluye la pregunta pertinente. Ninguna equivale automáticamente a cero.
11. El sistema puede añadir como máximo pocas preguntas adaptativas cuando una respuesta cambia de forma importante la recomendación. La pregunta abierta «¿qué problema resolverías hoy?» es opcional.

**Objetivo de experiencia:** entregar valor lo antes posible. La duración de un minuto es una hipótesis de producto por validar; se medirá con usuarios y no se prometerá como hecho hasta comprobarla.

### Etapa D — cálculo y primera respuesta

12. El motor valida las respuestas, aplica reglas versionadas y produce: salud por dimensión, señales de descoordinación, limitaciones y nivel de confianza.
13. El resultado responde en lenguaje llano: **qué está pasando, dónde, por qué se sospecha, qué falta saber y qué hacer primero**.
14. Si la información no permite identificar un nodo crítico, el sistema dice «criticidad aún no determinada» y pide el dato mínimo que permitiría evaluarla.
15. El visitante puede corregir respuestas antes de guardar.

### Etapa E — mapa tipo electrocardiograma

16. La vista muestra nodos y conexiones, con capas conmutables: producto/servicio, información, dinero y decisiones.
17. El color indica una **señal** (estable, atención, interrupción observada, sin datos); el grosor indica importancia declarada, no riesgo calculado. La leyenda siempre está visible y es accesible sin depender solo del color.
18. Al seleccionar un nodo o conexión se abre una ficha: función, flujos, dependencias, alternativas, señales, responsable, hallazgos y evidencia.
19. El usuario confirma conexiones y contesta para las más importantes: «¿Qué pasa por aquí?», «¿Qué ocurre si se detiene?», «¿Existe alternativa?», «¿Cuánto tiempo puede resistir la operación?». Esto refina criticidad y riesgo.
20. El mapa deja distinguir **declarado**, **inferido** y **verificado**; no presenta una inferencia como hecho.

### Etapa F — una mejora y cierre del ciclo

21. ChainPulse propone una acción prioritaria, con explicación, responsable sugerido, esfuerzo aproximado, dependencia previa, señal de éxito y guardrails (servicio, costo, caja, calidad y riesgo).
22. La persona acepta, cambia o descarta la acción; registra motivo. Puede asignar responsable y fecha de revisión, pero no se obliga a un plan 30/60/90.
23. Cuando vuelve, registra si la acción ocurrió y qué señal cambió. El sistema compara mediciones equivalentes, muestra incertidumbre y recomienda **continuar, ajustar o abandonar**.
24. El historial preserva mapa, reglas, evidencia y decisiones de cada evaluación; nunca reescribe un resultado antiguo silenciosamente.

### Etapa G — profundización opcional

25. El usuario puede invitar a otra área, cargar CSV sencillos o añadir datos manuales. Esos pasos aumentan la confianza y permiten análisis más específicos.
26. La biblioteca contextual muestra herramientas, métodos, tipos de reunión y servicios pertinentes a la debilidad detectada. Debe explicar cuándo usarlos y cuándo no; cualquier proveedor comercial se identifica como tal.
27. Un reporte exportable resume diagnóstico, mapa, hallazgos, evidencia, acción y seguimiento. Exportar puede requerir cuenta, pero ver el primer resultado no.

## 6. Diseño de preguntas y evidencia

Las preguntas deben describir conductas observables, no impresiones vagas. Ejemplo: «Cuando cambia la demanda, ¿Compras y Operaciones reciben la misma versión antes de decidir?» es más útil que «¿La comunicación es buena?».

Cada pregunta define `id`, texto, dimensión, modelos aplicables, opciones, peso **provisional**, regla de exclusión, evidencia esperada y versión. La respuesta guarda también `respondent_role`, fecha y fuente. La escala no es una certificación de madurez.

**Escalera de evidencia:**

| Nivel | Fuente | Qué permite afirmar |
|---|---|---|
| E0 | Una persona, sin documento | Hipótesis inicial de percepción |
| E1 | Varias áreas independientes | Acuerdo/desacuerdo entre funciones |
| E2 | Evidencia manual o CSV comprobable | Contraste puntual con operación |
| E3 | Datos conectados y comparables en el tiempo | Seguimiento más robusto |

El nivel no sustituye comprobaciones de calidad. Tres personas de la misma área no equivalen a tres perspectivas independientes. Archivos incompletos o sesgados tampoco aumentan automáticamente la confianza.

## 7. Reglas del motor diagnóstico

### 7.1 Pipeline

`validar entrada → normalizar respuestas → determinar aplicabilidad → calcular dimensiones → detectar contradicciones → analizar grafo → generar hallazgos → priorizar acciones → calcular confianza → construir explicación → guardar resultado inmutable`

El motor es una función determinística y sin efectos secundarios. Misma entrada y misma versión de reglas producen la misma salida. La IA, si se usa, puede ayudar a redactar o resumir, pero **no modifica puntuaciones, criticidad, prioridades ni confianza** sin pasar por reglas aprobadas.

### 7.2 Salud

Dimensiones iniciales: coordinación de información, decisiones y objetivos, continuidad de producto/servicio, integración de procesos/herramientas, visibilidad de capacidad y caja, coordinación externa y aprendizaje. Solo se calcula una dimensión con suficiente cobertura de preguntas aplicables; de otro modo se marca «sin información suficiente».

Una puntuación visual 0–100, pesos y umbrales serían **estimaciones de diseño**, no magnitudes científicas. Antes del lanzamiento deben calibrarse con casos reales. El resultado principal debe mostrar también evidencias y patrones, no solo un número.

### 7.3 Criticidad y dependencias

Para cada nodo/conexión se evalúan al menos: impacto de interrupción sobre la promesa al cliente, alcance aguas abajo, posibilidad de sustitución, tiempo tolerable sin el nodo y tiempo estimado de recuperación. Cuando faltan datos, se muestra una categoría provisional con confianza baja o «desconocido».

El grafo permite recorrer dependencias aguas arriba y aguas abajo, detectar puntos únicos de falla y simular de forma cualitativa «si este nodo se detiene, ¿qué conexiones quedan afectadas?». El MVP **no** predice probabilidades ni pérdidas monetarias sin datos suficientes.

### 7.4 Riesgo

La exposición combina amenaza/variabilidad observada, impacto, controles y capacidad de recuperación; no se confunde con criticidad. Para un proveedor único, por ejemplo, la plataforma puede mostrar «alta exposición potencial» aunque la probabilidad de falla sea desconocida. Si se conocen tiempo hasta interrupción (`TTS`) y tiempo de recuperación (`TTR`), se comparan con unidades y supuestos explícitos.

### 7.5 Hallazgos y acción

Cada hallazgo contiene `evidence_refs`, explicación, flujos/nodos afectados, hipótesis alternativa, grado de confianza y dato que podría refutarlo. Las acciones se seleccionan desde un catálogo versionado con condiciones de aplicabilidad, contraindicaciones, esfuerzo, impacto esperado **estimado**, dependencias, responsable sugerido, indicador temprano e indicador de resultado. La prioridad se calcula con una fórmula simple y visible, por ejemplo ICE, ajustada por guardrails; nunca se presenta como beneficio garantizado.

**Ejemplo:** información distinta entre Ventas y Compras + cambios urgentes reportados → hipótesis de descoordinación de demanda → acción «acordar una versión común y revisar excepciones» → señal «menos cambios urgentes y decisiones sin responsable». La causa permanece por confirmar.

### 7.6 Confianza y contradicciones

La confianza considera cobertura, independencia de informantes, actualidad/calidad de evidencia y consistencia. Una respuesta «no lo sé», un mapa sin conexiones, datos antiguos o respuestas incompatibles deben disminuir precisión o elevar una alerta, no transformarse automáticamente en mal desempeño. El reporte distingue «dato», «inferencia» y «supuesto».

## 8. Contratos de datos sugeridos

```ts
type EvidenceStatus = "declared" | "inferred" | "verified";
type FlowType = "value" | "information" | "money" | "decisions" | "capacity" | "reverse";

interface SupplyNode {
  id: string;
  type: string;
  label: string;                // puede ser alias anónimo
  ownerRole?: string;
  status: EvidenceStatus;
}

interface SupplyEdge {
  id: string;
  sourceId: string;
  targetId: string;
  flows: FlowType[];
  alternativeAvailable?: boolean;
  interruptionImpact?: "low" | "medium" | "high" | "unknown";
  timeToRecoverHours?: number;
  status: EvidenceStatus;
}

interface AssessmentInput {
  id: string;
  businessModel: string;
  customerPromise: string[];
  tools: string[];
  answers: Array<{ questionId: string; value: 1 | 2 | 3 | 4 | 5 | "unknown" | "na" }>;
  nodes: SupplyNode[];
  edges: SupplyEdge[];
  mainConcern?: string;
}

interface DiagnosticResult {
  assessmentId: string;
  ruleVersion: string;
  calculatedAt: string;
  dimensions: Array<{ id: string; score?: number; coverage: number }>;
  heart?: { flow: FlowType; rationale: string; confidence: string };
  weakestPulse?: { flow: FlowType; rationale: string };
  criticalNodes: Array<{ nodeId: string; rationale: string; evidenceRefs: string[] }>;
  findings: Array<{ id: string; hypothesis: string; evidenceRefs: string[] }>;
  recommendedAction?: { actionId: string; rationale: string; successSignal: string };
  confidence: { level: "low" | "medium" | "high"; limitations: string[] };
}
```

En implementación, los contratos necesitan validación de esquema, límites de longitud, manejo de valores desconocidos, IDs opacos y migración de versiones. `heart` puede quedar sin determinar; jamás se rellena por la puntuación más alta.

## 9. Arquitectura técnica recomendada

**Enfoque inicial:** monolito modular, no microservicios. Separar dominio y reglas de la interfaz facilita pruebas y evolución.

```text
chainpulse/
  apps/
    web/                    # experiencia pública, mapa, resultado, seguimiento
    api/                    # endpoints, autenticación, permisos, persistencia
  packages/
    domain/                 # entidades y contratos
    diagnostic-engine/      # función pura de diagnóstico
    graph-analysis/         # dependencias, alcance, punto único de falla
    rule-config/            # preguntas, umbrales, hallazgos y acciones versionados
    evidence/               # validación de entradas, CSV opcional
    shared/                 # esquemas y utilidades
  database/migrations/
  tests/{unit,integration,e2e,fixtures}/
  docs/{decisions,api,rules}/
```

**Persistencia mínima:** organizaciones, usuarios/membresías, cadenas/mapas, nodos, conexiones, evaluaciones, respuestas, versiones de reglas, resultados inmutables, hallazgos, acciones, evidencias y consentimientos. El modo anónimo usa sesión temporal y política de retención corta; el usuario decide si convierte su evaluación en cuenta.

**API indicativa:** `POST /assessments`, `PUT /assessments/{id}/answers`, `PUT /maps/{id}`, `POST /assessments/{id}/diagnose`, `GET /diagnostics/{id}`, `POST /actions`, `POST /evidence`, `GET /resources`. Deben definirse autorización por organización, idempotencia y límites de tamaño antes de producción.

**Mapa:** grafo dirigido con capas por flujo, edición de nodos/conexiones y panel de detalles. Se debe poder navegar con teclado y consultar una lista tabular equivalente. Para el MVP, la visualización no necesita simulación física ni animaciones continuas; animar «latidos» sin datos temporales sería engañoso.

**Seguridad:** HTTPS, cifrado en reposo donde proceda, aislamiento por organización, roles, logs de acceso, borrado/exportación, límites a archivos, análisis de malware, no incluir datos sensibles en telemetría ni en prompts de IA. La normativa de privacidad aplicable depende de los países de operación y requiere revisión jurídica local.

## 10. Biblioteca de mejora

Cada recurso debe tener `problema`, `cuándo usar`, `prerrequisitos`, `pasos mínimos`, `señal de éxito`, `contraindicaciones`, `fuente`, `fecha de revisión` y `tipo` (herramienta, método, técnica, formato de reunión, servicio). Ejemplos de entradas: reunión de excepciones, mapa de flujo de valor, revisión de proveedor único, matriz de decisiones, análisis de OTIF, ABC-XYZ o prueba de proveedor alterno. Las recomendaciones deben ser compatibles con el nivel de madurez y recursos de la empresa.

El directorio de proveedores de servicios es una fase posterior y exige reglas de transparencia sobre patrocinios y conflictos de interés. No se venderá una recomendación como diagnóstico neutral.

## 11. MVP y secuencia de construcción

| Incremento | Entregable comprobable | No incluye |
|---|---|---|
| 0. Validación | Prototipo y entrevistas; preguntas comprensibles; tiempo real de uso | Código de producción |
| 1. Primer pulso | Evaluación sin registro, motor v1, resultado explicable, acción, limitaciones | Mapa exhaustivo |
| 2. Mapa | Plantillas, nodos/conexiones editables, capas de flujo, dependencias críticas provisionales | Riesgo probabilístico |
| 3. Cerrar ciclo | Guardar cuenta, responsable, señal, nueva medición, comparación e historial | Automatización continua |
| 4. Evidencia | Invitación interáreas, contradicciones, CSV opcional, reporte | Conectores ERP completos |
| 5. Escala | Integraciones selectivas, analítica temporal, biblioteca ampliada | Decisiones autónomas sin supervisión |

La construcción no debe depender de un plazo fijo arbitrario. Cada incremento pasa pruebas de utilidad, seguridad y calidad de diagnóstico antes de ampliar funciones.

## 12. Criterios de aceptación del MVP

- Una persona puede completar y ver el primer resultado sin cuenta ni archivo.
- «No lo sé» y «no aplica» no generan puntuación cero ni falsas alertas de desempeño.
- El sistema puede declarar «información insuficiente» y explicar qué falta.
- Cada hallazgo señala las respuestas/evidencias usadas, versión de reglas y al menos una limitación cuando corresponda.
- Una recomendación tiene responsable sugerido, señal verificable y guardrails; no promete impacto garantizado.
- El motor produce el mismo resultado con la misma entrada y versión; cambios de reglas no alteran evaluaciones históricas.
- El mapa admite nodos y conexiones pertinentes al negocio y distingue estado declarado/inferido/verificado.
- El usuario puede corregir o eliminar su información; los datos de una organización no son accesibles para otra.
- La interfaz funciona en móvil, con teclado y sin depender exclusivamente del color.
- Se prueban escenarios de datos incompletos, respuestas contradictorias, proveedor único, cadena de servicios sin inventario y múltiples herramientas no integradas.

## 13. Métricas para saber si aporta valor

**Embudo:** inicio → finalización → lectura del resultado → interacción con mapa → elección de acción → regreso con señal → mejora observada. Medir tiempo mediano y percentiles de finalización, abandono por pregunta, comprensión del diagnóstico y porcentaje que puede explicar su primera acción.

**Métrica de utilidad principal propuesta:** proporción de organizaciones que, tras un primer diagnóstico, ejecutan una acción y registran una señal comparable. Visitas o puntuaciones generadas son métricas de alcance, no prueba de mejora.

**Calidad:** concordancia entre hallazgos y revisión de especialistas, tasa de falsos positivos, cobertura de reglas, frecuencia de «información insuficiente» y correcciones por los usuarios. Segmentar por sector, tamaño y modelo de negocio para detectar sesgos.

## 14. Riesgos del producto y mitigación

| Riesgo | Mitigación |
|---|---|
| Diagnóstico superficial presentado como certeza | Nivel de evidencia, limitaciones y lenguaje de hipótesis |
| El usuario responde lo socialmente deseable | Preguntas conductuales y contraste interáreas/evidencia |
| Mapa complejo que frena la entrada | Plantilla inicial y profundización progresiva |
| Confundir criticidad con mal desempeño | Dimensiones separadas y reglas de presentación |
| Recomendación genérica o inaplicable | Condiciones, contraindicaciones y validación por segmento |
| Sensibilidad de datos de proveedores/clientes | Alias, minimización, permisos, retención y borrado |
| Monetización que sesga recomendaciones | Separar diagnóstico de contenido patrocinado |
| Costos de operación altos para producto gratuito | Motor determinístico liviano, límites razonables, procesamiento diferido de archivos |

## 15. Modelo gratuito y evolución comercial

**Gratis:** primer pulso, mapa básico, explicación, una acción y una nueva medición limitada o historial básico. El valor esencial no debe esconderse tras registro o pago.

**Pago futuro, sujeto a validación:** varios mapas/unidades, colaboración interáreas, histórico amplio, evidencias y conectores, alertas, escenarios, reportes avanzados, gobierno de acciones y controles corporativos. No monetizar datos individuales ni vender datos identificables a terceros. Una mayor audiencia por sí sola no prueba disposición a pagar: hay que validar quién compra, por qué y qué resultado obtiene.

## 16. Decisiones pendientes antes de desarrollar

1. Segmento inicial para validar (por ejemplo, pymes comerciales o manufactureras); la promesa multiindustria se mantiene, pero la primera calibración necesita foco.
2. Conjunto definitivo de preguntas rápidas y anclajes observables.
3. Definición de la promesa al cliente y del «corazón» para distintos modelos.
4. Criterio mínimo para llamar crítico a un nodo o conexión.
5. Reglas, pesos y umbrales v1; revisión experta y pruebas con casos reales.
6. Política de sesión anónima, conservación y conversión a cuenta.
7. Tecnología concreta de frontend, API, base de datos y motor gráfico según equipo existente.
8. Alcance de la exportación, invitaciones y CSV en la primera versión.
9. Requisitos legales, privacidad y hospedaje según país de lanzamiento.

## 17. Próximo experimento recomendado

Probar un prototipo navegable con empresas de al menos dos modelos de negocio. Solicitarles que completen la evaluación sin ayuda, dibujen/corrijan su mapa y expliquen con sus propias palabras: **qué está fallando, qué nodo importa más, qué harán primero y qué medirán después**. Comparar la salida con una revisión SCM independiente. Si el producto genera una puntuación pero no una decisión comprensible y verificable, todavía no cumple su promesa.

---

**Nota de rigor:** las escalas, pesos, tiempos de uso, reglas de prioridad y umbrales descritos son propuestas de diseño. No hay datos de clientes ni validación empírica en este documento; por tanto, no se presentan como resultados comprobados.
