# Patrones transversales — ChainPulse

Este documento existe porque varias convenciones del proyecto hoy solo
viven implicitas en el codigo (hallazgo H11, Ronda 3 de revision de
`PLAN-DE-TRABAJO.md`). No es un documento de arquitectura de alto nivel
(eso vive en `docs/ADR/`) — es la referencia concreta de "asi se hace
esto" para quien pica codigo nuevo.

## 1. Snapshot-JSON de resultados inmutables

**Donde vive hoy:** `ResultadoConexion.criticidadSnapshot` (columna `Json`
en `prisma/schema.prisma`, escrita en `src/infra/ciclos/cerrarCiclo.ts`,
leida en `src/infra/ciclos/resultados.ts`).

**Problema que resuelve:** un `ResultadoConexion`/`ResultadoCiclo` es la
foto de un ciclo ya cerrado. Si las reglas del motor de diagnostico
cambian mas adelante (esperado, no hipotetico — ver el comentario de
`resultados.ts` sobre `ruleVersion`), un ciclo historico no debe
recalcularse con las reglas nuevas: eso mostraria un salto de salud que
nunca ocurrio realmente. La solucion es persistir el objeto de dominio
completo (`DatosCriticidad`) como `Json` en el momento exacto en que se
calculo, en vez de agregar una columna por cada campo que el motor podria
necesitar despues.

**Ejemplo real (`cerrarCiclo.ts`):**

```ts
await tx.resultadoConexion.create({
  data: {
    cicloPulsoId,
    conexionId: conexion.id,
    salud: resultadoSalud.salud,
    criticidadSnapshot: conexion.datosCriticidad, // objeto completo, no campos sueltos
    gradoDependenciaSnapshot: conexion.datosCriticidad.gradoDependencia,
    riesgo,
    ruleVersion: RULE_VERSION,
  },
});
```

**Regla para modelos nuevos:** cualquier tabla que persista el resultado
de un calculo cuya logica pueda recalibrarse en el futuro (candidatas ya
identificadas: `Hallazgo`/`HallazgoExpres` del Incremento 2,
`DatasetVersion`/`DatasetContribution` del Incremento 6) sigue este mismo
patron:

1. Columna `Json` con el objeto de dominio completo en el momento del calculo, no columnas sueltas por campo.
2. Columna `ruleVersion: String` al lado, para decidir en lectura si dos resultados son comparables (ver el filtro de `ruleVersion` en `resultados.ts`).
3. Un tipo TypeScript explicito en `src/domain/types.ts` para la forma del JSON — nunca `Record<string, unknown>` suelto en el codigo que lo lee.

## 2. Transaccion de tenant conocido con `set_config` manual

**Donde vive hoy:** `src/infra/auth/registro.ts` (`registrarEmpresaYAdmin`),
`src/infra/auth/aceptarInvitacion.ts` (`crearUsuarioResponsable`),
`src/infra/ciclos/resultados.ts` (`obtenerResultadosCiclo`).

**Cuando aplica:** el `empresaId` ya se conoce antes de tocar la base (se
genero localmente con `randomUUID()`, o vino de un token firmado), pero la
operacion no puede pasar por `tenantClient()` — ver la Seccion 4 de este
documento.

**El patron, siempre igual:**

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
  // ... el resto de las operaciones de esta transaccion, todas dentro de tx ...
});
```

`set_config('app.tenant_id', ..., true)` con `true` como tercer argumento
fija la variable solo para la transaccion actual (`is_local = true`) —
nunca para la conexion completa. Esto es obligatorio: sin el `true`, un
connection pool (Neon usa PgBouncer) podria reutilizar la misma conexion
fisica para otro tenant despues, filtrando el `app.tenant_id` de una
request a la siguiente. Las politicas de `prisma/rls.sql` leen esta misma
variable con `current_setting('app.tenant_id', true)`.

**Esto NO reemplaza a `tenantClient()` por comodidad.** Si una funcion
nueva solo necesita leer/escribir un modelo de `TENANT_SCOPED_MODELS` con
una operacion simple, usa `tenantClient()`, no esto — ver la tabla de la
Seccion 4.

## 3. Tenant verdaderamente nulo (sin `set_config`, sin RLS)

**Donde vive hoy:** `EvaluacionExpres` y sus tablas hijas.

Patron distinto al de la Seccion 2: aca no hay `empresaId` en absoluto
(adenda de ADR-0001), el codigo consulta con `prisma` directo, **sin
transaccion de `set_config`**, y `prisma/rls.sql` termina con un
comentario explicito que excluye estas tablas de cualquier politica.

La proteccion aca no es RLS ni `set_config` — es (a) rate limiting por
`huellaOrigen` (RF15/RF17, tabla `LimiteTasa`) y (b) que estas tablas
nunca comparten fila ni FK con datos de una cuenta registrada. Cualquier
tabla nueva "anonima por diseno" sigue este patron, no el de la Seccion 2.

## 4. `tenantClient()` vs. transaccion manual (`tenantTransaction()`) — cuando usar cada uno

| Situacion | Usar |
|---|---|
| Una sola operacion CRUD sobre un modelo de `TENANT_SCOPED_MODELS` (`Empresa`, `Usuario`, `Eslabon`, `Conexion`, `CicloPulso`) | `tenantClient(empresaId)` — inyecta el filtro automaticamente, es el camino por defecto |
| Crear varias filas relacionadas que deben ser atomicas (todo o nada) — ej. `Empresa` + `Usuario` administrador, o (futuro) `Cadena`+`Nodo`+`ConexionCadena` | `tenantTransaction(empresaId, fn)` (ver PLAN-DE-TRABAJO.md Seccion 18.3.B) o transaccion manual + `set_config` — `tenantClient()` envuelve cada operacion en su propia transaccion independiente, dos `create` seguidos por `tenantClient()` NO son atomicos entre si |
| Leer/escribir un modelo que no tiene `empresaId` propio y no esta en `TENANT_SCOPED_MODELS` (`ResultadoConexion`, `ResultadoCiclo`, `RespuestaCruda`, `MetricaCuestionario`, `RecomendacionEjecutada`) | Transaccion manual + `set_config`, filtrando explicitamente por el padre tenant-scoped |
| El `empresaId` no se conoce de antemano (ej. login) | Patron `SECURITY DEFINER` (`login_lookup()`) |
| Tenant verdaderamente nulo (`EvaluacionExpres`) | Ninguno — `prisma` directo, ver Seccion 3 |

**Riesgo documentado a no repetir:** un `create` anidado de Prisma
(`data: { nodos: { create: [...] } }`) **no** pasa por `injectTenantFilter`
de `tenantClient()` en las tablas hijas — cualquier funcion que cree
entidades relacionadas con un `create` anidado necesita `empresaId`
explicito en cada nivel, verificado a mano, no asumido.

## 5. Convencion: toda tabla nueva se declara en `rls.sql`, explicitamente

`prisma/rls.sql` no es opcional — es un archivo que **toda tabla nueva**
tiene que tocar, en uno de tres sentidos:

- **Tenant-scoped, con `empresaId` propio:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation_<tabla> ... USING ("empresaId" = current_setting('app.tenant_id', true))`.
- **Tenant-scoped, sin `empresaId` propio (tabla hija):** mismo `ENABLE ROW LEVEL SECURITY`, pero la politica filtra por subconsulta contra el padre.
- **Explicitamente sin RLS (tenant nulo, Seccion 3):** no se agrega politica, pero se documenta con un comentario explicito — nunca se deja una tabla nueva fuera de `rls.sql` sin ese comentario.

Este paso es independiente de agregar el modelo a `TENANT_SCOPED_MODELS`
en `src/infra/prisma/tenantClient.ts` — la lista de verificacion al
agregar una tabla tenant-scoped nueva es siempre: (1) columna `empresaId`,
(2) entrada en `TENANT_SCOPED_MODELS`, (3) politica en `rls.sql` (o el
comentario de exclusion explicita).

## 6. Convencion de nombres para enums `Estado*`

`Estado<Dimension>` — el nombre despues de `Estado` identifica la
pregunta que ese enum responde, nunca el modelo que lo contiene. Un enum
se reutiliza entre modelos solo si responde exactamente la misma
pregunta; si la pregunta cambia (aunque el modelo o un valor se repita),
es un enum nuevo. Ver PLAN-DE-TRABAJO.md Seccion 18.3.D para la tabla
completa de los 7 enums existentes y la pregunta que responde cada uno.
Antes de crear un enum `Estado*` nuevo, buscar primero en esa tabla si ya
existe uno que responda la misma pregunta.

## 7. Modelos duplicados anonimo/tenant-scoped

`Hallazgo*`/`Consentimiento*` (Incremento 2) estan pensados como pares
separados — una version para `EvaluacionExpres` (tenant nulo) y otra para
cuentas registradas. Ver PLAN-DE-TRABAJO.md Seccion 18.3.E para el diseno
de los tipos de dominio compartidos (`src/domain/hallazgo/`,
`src/domain/consentimiento/`) que evitan duplicar la forma logica dos
veces — el codigo todavia no existe (el Incremento 2 no esta construido),
esto queda como la referencia a seguir cuando se implemente.
