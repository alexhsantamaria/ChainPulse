# Incremento 5 — Consultas deterministicas mediante catalogo cerrado
## Tabla de trazabilidad I5-01..29 (Fase A)

Fuentes usadas: `MVP-DEFINITIVO.md` Seccion 6.4 (texto literal de los 29
requisitos), matriz v6 (`_documentos-locales/auditorias/matriz-individual-209-casillas-2026-10-15-v6.md`,
estado NI para las 29 filas), `Programa ChainPulse 53+ v3` (Punto 2: auditoria
fila por fila, categorias, archivos esperados, dependencias, riesgo) y las
decisiones de producto ya aprobadas por Alex en esta autorizacion (Seccion 4):
I5-08 (el usuario elige, no un modelo) e I5-12 (plantillas deterministicas con
interpolacion). Estas dos decisiones YA RESUELVEN la "candidatura a revision"
que Programa 53+ v3 dejaba abierta para I5-08/I5-12 — se registran aqui como
RESUELTO, no como ambiguedad pendiente.

Arquitectura real reutilizada (ver Seccion 6 de esta tabla): `tenantClient()`
(`src/infra/prisma/tenantClient.ts`), `requireSession()` (`src/infra/auth/session.ts`),
patron `declarar.ts` (puro) / `persistir.ts` (Prisma) ya usado por OTIF,
`ResultadoCalculoKpi`/`calcularRatio` (`src/engine/kpis/*`), `ordenarPorPrioridad`
(`src/engine/v2/prioridad.ts`), `leerCuerpoJsonLimitado`, `TENANT_SCOPED_MODELS`.

Convencion de columnas: **Estado v6** = NI para las 29 (confirmado por lectura
directa de la matriz v6, lineas 197-240). **Componente** = modulo nuevo o
existente que implementa la pieza. **Criterio INV** = que evidencia hace que
la pieza cuente como implementada y verificada bajo el Producto 1 (catalogo
de seleccion directa, el UNICO autorizado en esta ronda). **Criterio IV**
= que validacion funcional independiente adicional (de Alex, sobre un flujo
real desplegado) haria falta para subir de INV a IV — ninguna casilla de esta
tabla se marca IV por este trabajo; se deja constancia de que haria falta
para que, en una ronda posterior, Alex pueda decidir si la otorga.

---

### Grupo 1 — Ejemplos de consulta (MVP-DEFINITIVO §12.1, I5-01..06)

| ID | Requisito literal | Estado v6 | Componente | Dependencia | Prueba | Criterio INV | Criterio IV | Riesgo | Decision pendiente |
|---|---|---|---|---|---|---|---|---|---|
| I5-01 | "¿Por qué cayó mi OTIF?" | NI | `src/engine/queries/otifCaida.ts` + entrada de catalogo | I4-01 (motor OTIF, ya en produccion) | Fixture con caida de OTIF conocida → variacion y factor reproducen exacto | Catalogo + motor + plantilla construidos y probados; API/UI funcional | Alex valida manualmente contra un caso real desplegado | Bajo — reutiliza motor OTIF ya piloteado | Ninguna |
| I5-02 | "¿Qué proveedor concentra más retrasos?" | NI | `src/engine/queries/otifProveedorRanking.ts` sobre `otifProveedor.ts` | I4-07 (motor existe, sin persistencia real — puede caer en "sin datos") | Fixture con 3 proveedores alias, tasas distintas → top-1 correcto | Idem I5-01; "sin datos" es una respuesta valida, no una falla | Alex valida con datos reales de produccion | Bajo-medio — utilidad depende de que I4-07 tenga datos cargados | Ninguna — "sin datos" es el comportamiento correcto hoy |
| I5-03 | "¿Dónde se encuentra la dependencia más crítica?" | NI | `src/engine/queries/dependenciaCritica.ts` (nuevo, recorrido de grafo) | I3-11/I3-12 (`impactoFalla`/`tieneAlternativa` en `ConexionCadena`, ya en schema) | Fixture de grafo con punto unico de falla conocido → identificado correctamente | Algoritmo determinista sin IA, probado contra fixture | Alex valida con mapa real de una cadena | Medio — algoritmo nuevo, depende de calidad de datos de Mapa | Ninguna |
| I5-04 | "¿Qué información falta para calcular Fill Rate?" | NI | `src/engine/queries/faltantesKpi.ts` (nuevo, parametrizado por KPI) | Definicion de "campos requeridos por KPI" (config nueva) | Fixture con Fill Rate parcialmente cargado → lista de faltantes exacta | No depende de que Fill Rate este completo; solo informa que falta | Alex valida con datos reales incompletos | Bajo | Ninguna |
| I5-05 | "¿Qué acción debería evaluar primero?" | NI | Wrapper de catalogo sobre `ordenarPorPrioridad()` (`src/engine/v2/prioridad.ts`) | I2-28 (orden de 6 niveles, HOY **IND**, no verificado linea por linea en esta ronda) | Fixture con hallazgos en varios niveles → devuelve el de mayor prioridad segun el orden ya documentado | Integracion nueva sin huecos; riesgo esta en I2-28, no en esta pieza | Alex confirma/verifica I2-28 linea por linea en ronda separada | Medio — depende de una pieza no verificada de otro incremento | **Pendiente, fuera de esta ronda**: verificar I2-28 linea por linea (no autorizado aqui) |
| I5-06 | "¿Qué cambió desde el último pulso?" | NI | `src/engine/queries/cambiosPulso.ts` (nuevo, diff entre ciclos) | S10-12 (inmutabilidad de `ResultadoConexion`/`ResultadoCiclo`, ya `[x]`) | Fixture con 2 ciclos → diferencias exactas; fixture con 1 ciclo → I5-25 | Pieza nueva sin IA, reutiliza inmutabilidad ya garantizada | Alex valida con 2+ ciclos reales | Bajo-medio — esfuerzo de construccion moderado | Ninguna |

### Grupo 2 — Arquitectura de consulta (MVP-DEFINITIVO §12.2, I5-07..14)

| ID | Requisito literal | Estado v6 | Componente | Dependencia | Prueba | Criterio INV | Criterio IV | Riesgo | Decision pendiente |
|---|---|---|---|---|---|---|---|---|---|
| I5-07 | Clasificador de intención sobre la pregunta en lenguaje natural | NI | Ninguno — el Producto 1 (catalogo) no lo requiere | Decision de producto (Seccion 4 de esta autorizacion: NO implementar) | No aplica | **No alcanza INV bajo este producto, por diseño** — permanece NI, tal como exige la autorizacion | Solo si Alex aprueba el Producto 2/3 (texto libre) en una ronda futura | No aplica bajo el Producto 1 | Ninguna — resuelta explicitamente por Alex: permanece NI |
| I5-08 | Catálogo semántico permitido de KPIs y dimensiones (el modelo de lenguaje solo elige de este catálogo, nunca genera SQL libre) | NI | `catalogoPreguntas.ts` (IDs estables → ejecutores permitidos en codigo) | Ninguna | Prueba de esquema: cada entrada mapea a un ejecutor permitido, ninguna permite SQL libre | **RESUELTO por Alex (Seccion 4 de esta autorizacion)**: el usuario elige directamente, no un modelo — esto satisface la garantia de seguridad subyacente de forma mas fuerte que la lectura literal. Cuenta como INV sin reserva adicional | No aplica — ya resuelto, no es una IV adicional | Bajo | Ninguna — ya resuelta |
| I5-09 | Constructor de consulta permitida | NI | `construirConsultaPermitida.ts` | I5-08 (catalogo debe existir primero) | Para cada una de las 6 preguntas, la consulta construida coincide con la esperada | Pieza nueva autocontenida, probada | Alex valida con las 6 preguntas reales | Bajo | Ninguna |
| I5-10 | Control de tenant, permisos y periodo antes de ejecutar | NI | Wrapper sobre `tenantClient()`/`requireSession()` ya existentes | Ninguna no resuelta | Intento de consulta cruzada de tenant falla (mismo patron que 10/10 de RNF1) | Reutilizacion pura de infraestructura ya probada en produccion | Alex valida con cuentas reales de 2+ tenants | Bajo (el mas bajo del paquete) | Ninguna |
| I5-11 | Motor SQL/cálculo determinístico (no generativo) para el resultado numérico | NI | `ejecutarConsultaPermitida.ts` (dispatcher/orquestador) | I5-09 + motores de KPI subyacentes (algunos en P, ej. Fill Rate I4-02) | Para cada entrada, el numero devuelto coincide con el calculo directo del motor sobre el mismo fixture | Orquestacion nueva sin IA; si el motor subyacente esta incompleto, cae en I5-25 (correcto, no defecto) | Alex valida con datos reales de produccion | Medio — depende de motores de KPI no controlados por este paquete | Ninguna |
| I5-12 | Generador de explicación sobre el resultado ya calculado | NI | `plantillasExplicacion.ts` (plantilla fija + interpolacion) | Ninguna | Para cada entrada + fixture, el texto renderizado coincide exactamente (prueba de snapshot) | **RESUELTO por Alex (Seccion 4)**: plantillas deterministicas e interpolacion de resultados calculados — nunca texto generativo libre. Cuenta como INV sin reserva adicional | No aplica — ya resuelto | Bajo (ya no es medio-alto interpretativo, la decision de producto lo cierra) | Ninguna — ya resuelta |
| I5-13 | Registro auditable de cada consulta | NI | Modelo Prisma `ConsultaLog` (migracion nueva) + `registrarConsulta.ts` | Migracion de esquema (autorizada, Seccion 8 — sin ejecutar) | Ejecutar 1 consulta → exactamente 1 fila de log; alterar/borrar un log falla (append-only) | Pieza nueva, patron append-only ya usado (`ConsentimientoCuenta`) | Alex valida el registro en produccion tras ejecutar la migracion | Bajo | Ninguna |
| I5-14 | Límites de filas, tiempo, costo y acceso — el modelo de lenguaje nunca recibe credenciales | NI | `limites.ts` compartido (constantes `MAX_*`) | Ninguna no resuelta | Consulta que excede limite de filas/tiempo es rechazada/truncada con error explicito | Reutiliza constantes `MAX_*` ya usadas en OTIF/Fill Rate/Cobertura; clausula de credenciales se satisface de forma vacia (no hay modelo de lenguaje) | No aplica — satisfaccion trivial bajo este producto, sin lectura alternativa posible | Bajo | Ninguna |

### Grupo 3 — Contrato de respuesta (MVP-DEFINITIVO §12.3, I5-15..25)

| ID | Requisito literal | Estado v6 | Componente | Dependencia | Prueba | Criterio INV | Criterio IV | Riesgo | Decision pendiente |
|---|---|---|---|---|---|---|---|---|---|
| I5-15 | Respuesta directa | NI | Campo `respuestaDirecta` en el ensamblador (`ejecutarConsultaPermitida.ts`) | Ninguna | La respuesta contiene el campo con el valor correcto | Campo poblado y probado | Alex valida con dato real | Bajo | Ninguna |
| I5-16 | Periodo y filtros aplicados | NI | Campos `periodo`/`filtros`, eco estructural | Ninguna | Coincide con los parametros de entrada | Campo poblado y probado | Alex valida con dato real | Bajo | Ninguna |
| I5-17 | Fuente de datos | NI | Campo `fuente`, metadato expuesto por cada motor/ejecutor | Metadata de fuente consistente por motor | El campo nombra correctamente el dataset usado | Campo poblado y probado | Alex valida con dato real | Bajo-medio — requiere metadata de fuente consistente | Ninguna |
| I5-18 | Fórmula o regla aplicada | NI | Campo `formula`, cadena estatica por entrada | Ninguna | Coincide con la cadena esperada por entrada | Campo poblado y probado | Alex valida con dato real | Bajo | Ninguna |
| I5-19 | Numerador/denominador cuando corresponda | NI | Campo `numerador`/`denominador`, reutiliza el del motor de KPI | Completitud del motor subyacente (igual que I5-11) | Coincide con el calculo directo del motor | Campo poblado y probado | Alex valida con dato real | Bajo | Ninguna |
| I5-20 | Calidad, faltantes y cobertura | NI | Campo `calidad`, reutiliza salida de `faltantesKpi.ts` (I5-04) | I5-04 | El campo lista los faltantes esperados segun fixture | Campo poblado y probado | Alex valida con dato real | Bajo-medio | Ninguna |
| I5-21 | Interpretación, separada explícitamente del hecho | NI | Campos `hecho`/`interpretacion` distintos, plantilla fija (biblioteca compartida con I5-12) | Biblioteca de plantillas I5-12 | Ambos campos poblados y estructuralmente distintos (snapshot) | Separacion estructural verificable — no depende de la calidad/generatividad del texto (I5-12 ya resuelto) | Alex valida con dato real | Bajo | Ninguna |
| I5-22 | Siguiente acción sugerida | NI | Campo `accion`, mapeo tipo de hallazgo → texto (vocabulario de `prioridad.ts`/I2-28) | I2-28 (misma advertencia que I5-05 — HOY IND) | Fixture de hallazgo mapea a la accion esperada | Mecanismo nuevo completo, probado | Alex confirma/verifica I2-28 en ronda separada | Medio (mismo motivo que I5-05) | **Pendiente, fuera de esta ronda**: verificar I2-28 (no autorizado aqui) |
| I5-23 | Forma de comprobarla | NI | Campo `comoComprobar`, plantilla fija por entrada | Ninguna | El campo coincide con la plantilla esperada | Campo poblado y probado | Alex valida con dato real | Bajo | Ninguna |
| I5-24 | Versión de cálculo (`ruleVersion`) | NI | Campo `ruleVersion`, reutiliza patron ya probado (S10-11, ya `[x]`) | Ninguna | La respuesta incluye el `ruleVersion` correcto por funcion de catalogo | Campo poblado y probado | Alex valida con dato real | Muy bajo | Ninguna |
| I5-25 | Caso sin datos suficientes: "No puedo responder todavía" + qué falta + cómo ingresarlo, nunca inventa un número | NI | Guardia en `ejecutarConsultaPermitida.ts`, reutiliza lista de I5-04 | I5-04 | Fixture con datos insuficientes → respuesta honesta con faltantes correctos; **prueba negativa obligatoria**: nunca un campo numerico de resultado cuando los datos son insuficientes | Regla deterministica pura, sin IA — prioridad de pruebas maxima del paquete | Alex valida con datos reales insuficientes | Bajo en construccion, alto en consecuencia si la prueba es insuficiente | Ninguna — tratar como prioridad de pruebas (ya reflejado en Fase E/G) |

### Grupo 4 — Criterios de aceptación (MVP-DEFINITIVO §21 "Consultas", I5-26..29)

| ID | Requisito literal | Estado v6 | Componente | Dependencia | Prueba | Criterio INV | Criterio IV | Riesgo | Decision pendiente |
|---|---|---|---|---|---|---|---|---|---|
| I5-26 | Una pregunta permitida genera un cálculo reproducible | NI | No es una pieza — prueba de aceptacion independiente (Fase G) | I5-09, I5-11, I5-24 construidos primero | Ejecutar la misma consulta 2 veces, mismo `ruleVersion` → comparacion byte a byte, para las 6 preguntas | **Solo tras pasar la prueba de aceptacion independiente** — nunca por el solo hecho de que el codigo exista (exigencia explicita de Alex, Seccion 9) | No aplica — es en si misma la prueba de determinismo | Bajo si el resto del paquete es deterministico como se diseño | Ninguna |
| I5-27 | Una pregunta sin datos responde qué campos faltan | NI | Prueba de aceptacion independiente (Fase G), ligada a I5-25 | I5-25 | Para cada entrada, fixture con datos insuficientes → lista de faltantes correcta | Solo tras pasar la prueba de aceptacion independiente | No aplica | Bajo | Ninguna |
| I5-28 | Ningún usuario consulta datos de otro tenant | NI | Prueba de aceptacion independiente (Fase G), extiende bateria RNF1 | I5-10 | Extender la bateria de aislamiento ya existente (10/10) al nuevo endpoint de consultas | Solo tras pasar la extension de prueba — mayor confianza previa por reutilizar infraestructura ya probada | No aplica | Bajo | Ninguna |
| I5-29 | La explicación distingue hecho, interpretación y recomendación | NI | Prueba de aceptacion independiente (Fase G), ligada a I5-15/21/22 | I5-15, I5-21, I5-22 | Para cada respuesta, verificar que los 3 campos existen, son distintos y no duplican contenido | Solo tras pasar la prueba de aceptacion independiente | No aplica | Bajo | Ninguna |

---

## Resumen de contradicciones/decisiones documentadas (Seccion 3 de la autorizacion: "no reinterpretar silenciosamente")

1. **I5-08/I5-12** — Programa ChainPulse 53+ v3 las marcaba como "candidatas a confirmacion" por una lectura no literal del texto (el usuario elige en vez de un modelo; una plantilla con interpolacion en vez de generacion libre). La Seccion 4 de esta misma autorizacion de Alex **ya las resuelve explicitamente** en el mismo sentido que v3 proponia. Se registran aqui como RESUELTAS, no como ambiguedad abierta — no hay contradiccion real, solo una confirmacion que ya llego por otro documento.
2. **I5-05/I5-22** — ambas dependen de I2-28 (orden de 6 niveles de `prioridad.ts`), que Programa 53+ v3 marca como **CONFIRMADA** en su Punto 4 (verificacion de lectura ejecutada 2026-10-15: `src/engine/v2/prioridad.ts` implementa literalmente las 6 reglas documentadas). Dado que I2-28 ya tiene evidencia directa de codigo (no es una pieza faltante), I5-05/I5-22 se construyen reutilizando `ordenarPorPrioridad()` tal cual existe, sin reabrir la verificacion de I2-28 — esta tabla deja constancia de la dependencia, pero no la trata como bloqueo dado que ya esta confirmada.
3. **I5-07** — el texto literal describe una pieza que el Producto 1 (unico autorizado) elimina por diseño, no por incompletitud. Permanece NI, tal como exige la Seccion 1 de esta autorizacion y tal como ya resuelve Programa 53+ v3 (Punto 2).
4. **I5-26..29** — se construyen como pruebas de aceptacion independientes (Fase G), nunca contadas como INV solo porque el codigo de la pieza tecnica correspondiente exista — exigencia explicita de la Seccion 9 de esta autorizacion.

Ninguna de las 29 filas fue reinterpretada mas alla de lo que la propia
autorizacion de Alex (Secciones 1 y 4) ya decidio explicitamente.

---

## Arquitectura minima (Seccion 6 de la autorizacion)

Todo nuevo, bajo `src/engine/queries/` (motores puros, sin Prisma — mismo
principio ADR-0002 que el resto de `src/engine/`) y `src/infra/queries/`
(orquestacion con Prisma, tenant, auditoria — mismo patron `declarar.ts`/
`persistir.ts` ya usado por OTIF):

- **Catalogo tipado** (`src/infra/queries/catalogo.ts`): union discriminada
  `CatalogoConsultaId` (6 literales), cada entrada con ID estable, titulo,
  descripcion, dependencias de datos, parametros permitidos, periodo,
  permisos, ejecutor determinista, plantilla de respuesta, comportamiento
  sin datos, limites, version de regla — nunca strings abiertos.
- **Constructor de consulta permitida** (`src/infra/queries/construirConsultaPermitida.ts`):
  dado un `CatalogoConsultaId` + parametros ya validados, construye el
  input exacto que el ejecutor correspondiente necesita.
- **Dispatcher exhaustivo** (`src/infra/queries/ejecutarConsultaPermitida.ts`):
  `switch` exhaustivo (nunca `default`) sobre `CatalogoConsultaId`, cada rama
  llama a UN ejecutor. El compilador garantiza exhaustividad vía
  `nuncaOcurre()` — si se agrega un 7mo ID al catalogo sin su rama, el build
  falla, no un fallback silencioso.
- **Ejecutores deterministicos** (uno por pregunta, en `src/engine/queries/`):
  funciones puras que reciben datos ya cargados por la capa de infra (nunca
  Prisma directo), devuelven un `ResultadoConsulta` o señalan "sin datos".
- **Contratos de entrada/salida** (`src/domain/queries/tipos.ts`): el
  contrato de 10 elementos obligatorios del §12.3 como una interfaz unica
  `RespuestaConsulta`.
- **Control de tenant/permisos/periodo**: wrapper sobre `requireSession()` +
  `tenantClient(empresaId)` ya existentes — nunca `empresaId` del cliente.
- **Plantillas deterministicas** (`src/infra/queries/plantillasExplicacion.ts`):
  interpolacion de parametros sobre strings fijas, nunca generacion libre.
- **Registro auditable**: modelo Prisma `ConsultaLog` (migracion nueva,
  sin ejecutar) + `src/infra/queries/registrarConsulta.ts`.
- **Limites** (`src/domain/limitesConsultas.ts`): constantes `MAX_*`
  (filas, periodo, tiempo) siguiendo el patron de `limitesDeclaracionOtif.ts`.
- **API**: `src/app/api/consultas/catalogo/route.ts` (GET, lista el
  catalogo) y `src/app/api/consultas/ejecutar/route.ts` (POST, ejecuta una
  consulta permitida) — mismo patron `requireSession` + `leerCuerpoJsonLimitado`
  que las rutas de OTIF.
- **UI**: `src/app/dashboard/consultas/` — catalogo visible + panel de
  respuesta (Fase F).

Explicitamente evitado (Seccion 6 de la autorizacion): ninguna plataforma
generica de IA, ningun motor DSL, ningun string abierto donde una union
discriminada baste.
