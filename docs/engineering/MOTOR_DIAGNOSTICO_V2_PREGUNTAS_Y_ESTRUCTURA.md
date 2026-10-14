# ChainPulse — Evaluación Exprés v2
## Preguntas del cuestionario y estructura de respuesta del Motor de Diagnóstico

Estado: **diseño implementado para el alcance actual del Motor de Diagnóstico v2 y verificado contra el código el 2026-10-14.** Las reglas del motor, el cuestionario y sus pruebas coinciden sustancialmente con este documento. Permanecen fuera de esta verificación la aplicación de la regla de minimización en la interfaz y la garantía de inmutabilidad en la capa de persistencia; además, en el flujo actual el motor produce `DECLARADO`, mientras los otros valores de `EvidenceState` quedan preparados para incrementos posteriores. Las diferencias puntuales encontradas están documentadas en la Sección 8 — el resto de este documento se conserva tal como se escribió originalmente, como registro histórico del diseño.

---

## 1. ¿El marco aplica para Supply Chain Management (SCM)?

Análisis, separando lo que corresponde a conceptos de SCM ya establecidos en la literatura/práctica de lo que es una síntesis propia del diseño de este cuestionario.

| Dimensión | Concepto de SCM al que corresponde | Estado |
|---|---|---|
| Alineación | Consenso interfuncional sobre prioridad de servicio (S&OP / Integrated Business Planning: ventas, compras, operaciones y logística respondiendo lo mismo ante la misma pregunta) | Concepto establecido |
| Coordinación | Latencia entre información y decisión — raíz directa del efecto látigo (bullwhip effect, Forrester 1961; Lee, Padmanabhan y Whang 1997) | Concepto establecido |
| Integración | Fuente única de datos vs. conciliación manual entre sistemas — madurez de integración ERP/WMS/TMS, un problema de silos muy documentado en SCM | Concepto establecido |
| Evidencia | Indicador con respaldo de datos vs. estimación vs. ausencia de medición — madurez de gestión por indicadores (métricas tipo SCOR: medido, estimado, no medido) | Concepto establecido |
| Resiliencia | Punto único de falla, alternativa probada vs. no probada — gestión de riesgo de cadena de suministro y continuidad operativa, tema central en SCM desde las disrupciones globales de 2020-2021 | Concepto establecido |

**Lo que sí es una síntesis propia (no proviene de un modelo publicado con nombre):**

- Que estas 5 dimensiones específicas, con estos 5 estados categóricos cada una, se agrupen exactamente así (en vez de, por ejemplo, usar el modelo SCOR completo de 5 procesos, o un modelo de madurez por niveles tipo Gartner) es una decisión de diseño de producto, no la implementación de un estándar académico.
- Que Q1 (Promesa), Q2 (Objetivo común) y Q3 (Interdependencia) se agrupen todas bajo Alineación es una síntesis razonada a partir de la redacción de las propias preguntas, no algo que un marco externo prescriba.
- La regla de "gatillo" de Q1 (forzar el peor estado de Alineación si la promesa no está definida) es lógica añadida por coherencia con el principio propio de ChainPulse "sin falsa precisión" — no es un requisito de ningún marco de SCM.

**Recomendación:** el marco es defendible y coherente con temas de diagnóstico de SCM reconocidos — cada dimensión individualmente traza a una línea de literatura o práctica establecida. Vale la pena documentar explícitamente, en el material metodológico de cara al cliente, que es una síntesis propia de ChainPulse inspirada en estos conceptos, y no una certificación o adaptación literal de un estándar (SCOR, APICS/ASCM, etc.) — así se evita cualquier alegación de uso indebido de una marca o metodología de terceros.

---

## 2. Contexto previo, no puntuable (§7.1)

No se usan para calcular ninguna dimensión. Se guardan como datos de la evaluación:

- País y región
- Sector y subsector
- Rango de tamaño empresarial
- Rol del participante
- Producto, servicio o familia analizada (define el alcance de la `Cadena`)
- Periodo (por defecto, últimos 30 días)
- Tipo de operación: manufactura, distribución, comercio, servicios u otra
- Regla de minimización: nunca nombres reales de proveedores/clientes (usar alias tipo "Proveedor A")

---

## 3. Las 7 preguntas y sus opciones

### Q1 — Promesa
*¿Cuál es el resultado más importante que esta cadena debe entregar al cliente?*

1. Disponibilidad
2. Rapidez
3. Cumplimiento de fecha y cantidad
4. Calidad y consistencia
5. Precio o eficiencia
6. Personalización
7. Continuidad ante interrupciones
8. No está claramente definido

**Dimensión: Alineación (gatillo).** Las opciones 1-7 son categorías del tipo de promesa, sin carga positiva/negativa entre sí. La opción 8 ("no está claramente definido") es la única que señala un problema, y fuerza el estado de Alineación al más cauto ("no comprobable") sin importar lo que respondan Q2 y Q3.

### Q2 — Objetivo común
*Si preguntáramos hoy a ventas, compras, operaciones y logística cuál es esa prioridad, ¿qué ocurriría?*

1. Darían la misma respuesta y deciden de acuerdo con ella
2. Conocen la prioridad, pero no siempre la aplican
3. Darían respuestas diferentes
4. No existe una prioridad compartida
5. No puedo responder por las otras áreas

**Dimensión: Alineación (principal).** Determina el `status` en el caso normal (sin gatillo de Q1 activo) — sus 5 opciones mapean 1:1 a los 5 estados de Alineación.

### Q3 — Interdependencia
*¿Cada área sabe qué necesita recibir, qué debe entregar y a quién afecta cuando incumple?*

1. Sí, está definido y se utiliza
2. Está claro para algunas áreas
3. Depende de la experiencia de ciertas personas
4. No está claro
5. No lo sé

**Dimensión: Alineación (corroboración).** No mueve el `status` por sí sola; si contradice a Q2, se registra en `missingEvidence` en vez de ignorarse.

### Q4 — Información y decisión
*Cuando cambia un pedido, la demanda o la capacidad, ¿la información llega a quien debe decidir antes de que sea tarde?*

1. Casi siempre llega a tiempo y se decide
2. Llega a tiempo, pero no siempre se decide
3. Suele llegar tarde
4. Cada área actúa por separado
5. No lo sé

**Dimensión: Coordinación (única fuente).**

### Q5 — Integración operativa
*¿Compras, ventas, operaciones y logística trabajan con la misma información sobre cantidades, fechas y prioridades?*

1. Sí, utilizan una fuente compartida y confiable
2. Usan varias herramientas, pero normalmente coinciden
3. Deben conciliar datos manualmente
4. Frecuentemente trabajan con información diferente
5. No lo sé

Subpregunta contextual, **no puntuable**: fuente principal (`SAP/ERP`, `Excel`, `WMS/TMS/APS`, `correo/mensajería`, `varios sistemas`, `sin fuente definida`) — nunca se usa como señal de madurez por sí sola (principio 7 de V2).

**Dimensión: Integración (única fuente).**

### Q6 — Evidencia de cumplimiento
*Durante los últimos 30 días, ¿puedes comprobar con datos si se cumplió lo prometido al cliente en fecha y cantidad?*

1. Sí, existe indicador y registro de respaldo
2. Existe indicador, pero los datos están incompletos
3. Solo existe una estimación
4. No se mide
5. No lo sé

**Dimensión: Evidencia (única fuente).**

### Q7 — Respuesta ante falla
*Si mañana falla el proveedor, proceso o transporte más crítico, ¿qué tan preparada está la cadena?*

1. Existe alternativa probada y responsable definido
2. Existe alternativa, pero no ha sido probada
3. Depende de algunas personas para resolverlo
4. No existe alternativa definida
5. No sabemos cuál es el punto crítico

**Dimensión: Resiliencia (única fuente).**

---

## 4. Mapeo pregunta → dimensión (resumen)

| Pregunta | Dimensión | Rol |
|---|---|---|
| Q1 — Promesa | Alineación | Gatillo (fuerza peor estado si opción 8) |
| Q2 — Objetivo común | Alineación | Determina el `status` |
| Q3 — Interdependencia | Alineación | Corrobora, alimenta `missingEvidence` |
| Q4 — Información y decisión | Coordinación | Única fuente |
| Q5 — Integración operativa (+ subpregunta no puntuable) | Integración | Única fuente |
| Q6 — Evidencia de cumplimiento | Evidencia | Única fuente |
| Q7 — Respuesta ante falla | Resiliencia | Única fuente |

---

## 5. Estructura de la respuesta del motor (`DiagnosticFinding`)

```ts
type EvidenceState =
  | "DECLARADO"
  | "CONFIRMADO_POR_OTROS"
  | "VERIFICADO_CON_DATOS";

interface DiagnosticFinding {
  dimension: string;          // Alineación | Coordinación | Integración | Evidencia | Resiliencia
  status: string;              // uno de los 5 estados categóricos de esa dimensión
  statement: string;           // enunciado explicando el hallazgo
  sourceQuestionIds: string[]; // ["Q1","Q2","Q3"] para Alineación, un solo id para las demás
  evidenceState: EvidenceState;
  confidenceCoverage: number;  // ver fórmula abajo
  missingEvidence: string[];   // vacíos o contradicciones detectadas
  nextCheck: string;           // qué evidencia pedir a continuación
  ruleVersion: string;         // "v2-preliminary"
}
```

Salida esperada por evaluación: **5 `DiagnosticFinding`, uno por dimensión**, nunca sumados en un porcentaje único (principio "sin falsa precisión").

### Fórmula de `confidenceCoverage`

```
confidenceCoverage = (preguntas fuente respondidas de forma sustantiva) / (preguntas fuente totales de esa dimensión)
```

"Sustantiva" = la respuesta señala positiva o negativamente el estado evaluado (dice que sí ocurre, o que no ocurre). "No lo sé" (o "no está claramente definido" en el caso de Q1) no es sustantiva — se pega al mismo lado de la escala que el peor estado y reduce la cobertura, sin tratarse como cero (principio "no sé no es cero": sigue mapeando a su propio estado categórico, p. ej. "desconocida").

Denominadores por dimensión: Alineación = 3 (Q1, Q2, Q3); Coordinación, Integración, Evidencia, Resiliencia = 1 cada una. En incrementos futuros con múltiples evaluadores por cadena, el denominador crecerá con las preguntas de corroboración entre roles/nodos.

---

## 6. Orden de prioridad de los hallazgos (§8.3, ya normativo)

1. Posible afectación directa a la promesa (Q1)
2. Punto único de falla sin alternativa
3. Decisión inexistente o tardía
4. Información inconsistente
5. Ausencia de evidencia
6. Oportunidad de mejora no crítica

Si falta información suficiente, la salida prioritaria pide evidencia — nunca inventa una causa.

---

## 7. Qué falta confirmar antes de escribir código

*(Texto original, conservado como registro. Ambos puntos quedaron resueltos — ver Sección 8.)*

- ¿La regla de "gatillo" de Q1 queda tal como se describe (fuerza el peor estado), o Q1 debe pesar como una corroboración más, sin ese trato especial? **Resuelto: se implementó el gatillo tal como se describe aquí** (`src/engine/v2/alineacion.ts`, función `esQ1Gatillo`). El comentario de ese archivo atribuye esta decisión a una confirmación con Alex el 2026-09-18; no se encontró una decisión primaria versionada (ADR, README, MVP-DEFINITIVO o PLAN-DE-TRABAJO) que confirme esa fecha de forma independiente del comentario de código.
- Validación del criterio de "sustantiva" para `confidenceCoverage`. **Resuelto: implementado exactamente como se describe en la Sección 5** (`src/engine/v2/alineacion.ts` y `src/engine/v2/dimensionSimple.ts`).

El siguiente paso ya se dio: `src/engine/v2/` (funciones puras versionadas, con tests, sin tocar rutas ni UI) ya existe.

---

## 8. Estado de implementación verificado (añadido 2026-10-14, solo lectura)

Verificación de solo lectura contra `src/engine/v2/` y sus tests, `src/domain/types.ts`,
`prisma/seedCuestionarioV2.ts` y `prisma/schema.prisma`. Matriz completa disponible por separado
(`matriz-motor-v2-vs-implementacion.md`); resumen aquí:

**Nota sobre las categorías:** IMPLEMENTADO, PARCIAL, NO_IMPLEMENTADO, SUSTITUIDO e INDETERMINADO no son mutuamente excluyentes entre capas — describen capas distintas de la misma afirmación. Por ejemplo, `EvidenceState` está IMPLEMENTADO como tipo pero su uso real es PARCIAL (solo `DECLARADO` por ahora); la garantía de inmutabilidad de `ruleVersion` es IMPLEMENTADA en el motor pero INDETERMINADA en la capa de persistencia, no revisada aquí. Cada viñeta abajo puede mezclar más de una categoría según la capa a la que se refiere.

- **Las 7 preguntas y todas sus opciones** (Sección 3): implementadas palabra por palabra, mismo orden,
  en `prisma/seedCuestionarioV2.ts`. Sin diferencias.
- **Subpregunta de Q5** ("fuente principal", no puntuable): implementada, pero como una `PreguntaVersion`
  separada (`codigo: "Q5-fuente"`) en vez de un campo anidado dentro de Q5 — diferencia estructural, sin
  efecto funcional (el motor la ignora igual).
- **Contexto previo no puntuable** (Sección 2): los 9 campos tienen su columna equivalente en
  `EvaluacionExpresV2` (`prisma/schema.prisma`). La "regla de minimización de nombres reales" no se pudo
  verificar desde el motor ni el schema — depende de la UI del formulario, fuera de lo revisado aquí.
- **Gatillo de Q1, rol de Q2/Q3, `missingEvidence`, `confidenceCoverage` y sus denominadores**: implementados
  exactamente como se describen en las Secciones 3 y 5. Única nota: el umbral numérico de "contradicción
  fuerte" entre Q2 y Q3 (2 posiciones) es una calibración del código que este documento no especifica —
  no es una diferencia de fondo, es una decisión que faltaba fijar y ya se fijó.
- **`EvidenceState`**: el tipo existe exactamente con los 3 valores descritos, pero hoy el motor solo emite
  `"DECLARADO"` — los otros dos valores están definidos para un incremento futuro (autorreporte de un único
  respondente, Incremento 2), no se usan todavía.
- **`ruleVersion`**: el motor emite `"v2-preliminary"` tal como se describe. La garantía de "nunca se
  reescribe un hallazgo ya persistido con otra versión" es responsabilidad de la capa de persistencia, no
  revisada en esta verificación.
- **5 `DiagnosticFinding` por evaluación, orden de prioridad (§8.3, 6 reglas)**: implementados exactamente
  como se describen, mismo orden de las 6 reglas.
- **Los dos puntos de "Qué falta confirmar" (Sección 7)**: ambos resueltos — ver arriba.

No se encontró ninguna regla del documento que el código contradiga. La única inexactitud es el propio
encabezado de estado original ("ningún campo construido todavía"), ya corregido arriba.
