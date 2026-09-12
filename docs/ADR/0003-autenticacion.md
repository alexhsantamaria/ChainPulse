# ADR-0003 — Autenticación de usuarios (RF1/RF4)

Fecha: 2026-09-12
Estado: Aceptado — confirmado por Alex el 2026-09-12.

## Contexto

ADR-0001 dejó deliberadamente pendiente el mecanismo de autenticación ("el modelo `Usuario` es deliberadamente mínimo, sin inventar esa decisión aquí"), a resolver en un ADR de Seguridad propio antes de implementar RF1 (registro/login de cuenta completa) y RF4 (un Responsable limitado a las conexiones de su propio eslabón).

Los apuntes del módulo de Seguridad (`Apuntes/12_Seguridad`) fijan normas concretas, no opcionales, para cualquier mecanismo de login que se construya:

- **"Autenticación, autorización y gestión de credenciales"** (Prácticas de codificación segura): no reinventar la rueda — usar frameworks auditados y protocolos estándar (OAuth 2.0, OpenID); prohibición de contraseñas en texto plano, hash con Argon2/BCrypt/SCrypt y salt aleatoria; principio de mínimo privilegio; ningún secreto en el repositorio.
- **"Identification and Authentication Failures"** (OWASP Top 10 2021, A07): MFA obligatorio para perfiles administrativos y con acceso a datos sensibles; passphrases largas en vez de reglas de complejidad arbitrarias; rate limiting y bloqueo temporal contra fuerza bruta; el formulario de recuperación de contraseña no debe revelar si un email existe (evita enumeración de cuentas); sesiones/JWT con expiración real e invalidación efectiva.

En el mismo hilo de trabajo se decidió la base de datos del Incremento 1: **Neon** (Postgres gestionado genérico, ver conversación de este mismo día) y no Supabase — por lo tanto no hay un proveedor de Auth ya integrado con la base de datos elegida, y esta decisión queda abierta sobre sus propios méritos.

El schema ya define `RolUsuario` (`ADMINISTRADOR`, `RESPONSABLE`) y el aislamiento multi-tenant vía `empresaId` + RLS (ADR-0001, RNF1) — este ADR cubre exclusivamente la autenticación (verificar identidad), no la autorización por rol o tenant, que ya está resuelta en el modelo de datos y las políticas RLS.

## Opciones consideradas

**Opción A — Auth.js (NextAuth), framework open source integrado nativamente en Next.js.** Cubre gestión de sesión/JWT, expiración e invalidación de forma auditada out-of-the-box. No ata el proyecto a ningún proveedor de base de datos ni de infraestructura — compatible con Neon o cualquier Postgres. El hashing de contraseñas y el rate limiting quedan a cargo del proyecto (implementación propia sobre la librería `argon2`).

**Opción B — Supabase Auth.** Resuelve MFA, hashing, rate limiting y reset seguro sin código propio. Descartada por ahora: exigiría migrar la base de datos de Neon a Supabase, cambiando una decisión ya tomada en este mismo hilo sin una razón nueva que la justifique.

**Opción C — Auth0 / Clerk (proveedores de identidad gestionados de pago).** Cubren el mismo checklist de los apuntes de fábrica, con planes gratuitos limitados por usuarios activos. Se descartan para el MVP por sumar un proveedor externo de pago no evaluado en esta fase, quedando como alternativa si Auth.js resultara insuficiente más adelante.

**Opción D — Sistema de login propio (hash manual, sesiones manuales).** Contradice directamente la norma explícita de los apuntes ("no reinventar la rueda... se recomienda el uso de frameworks auditados"). Descartada.

| Opción | Cumple checklist de los apuntes | Ata a un proveedor de datos | Costo | Esfuerzo propio |
|---|---|---|---|---|
| A — Auth.js | Sí (con hashing/rate limiting propios) | No | Ninguno | Medio |
| B — Supabase Auth | Sí, de fábrica | Sí (Supabase) | Ninguno (capa gratuita) | Bajo |
| C — Auth0/Clerk | Sí, de fábrica | No | Sí, más allá de un umbral de usuarios | Bajo |
| D — Propio | No | No | Ninguno | Alto, alto riesgo |

## Decisión

Se adopta la **Opción A — Auth.js (NextAuth)**, con:

- **Provider de Credentials** (email + contraseña) para el MVP — RF1 no exige SSO ni login social todavía.
- **Hash de contraseñas con Argon2id** (librería `argon2`), nunca texto plano, salt aleatoria por credencial. Ningún algoritmo obsoleto (MD5/SHA-1).
- **Sesiones vía JWT firmados por Auth.js**, expiración corta + refresco, invalidación real al cerrar sesión.
- **MFA obligatorio para el rol `ADMINISTRADOR`** desde el Incremento 1 (acceso a toda la cuenta de la empresa — el caso que los apuntes marcan como obligatorio). Para `RESPONSABLE` (superficie menor: solo su propio eslabón, por RF4) queda diferido, a revisar en un incremento posterior con datos reales de uso.
- **Rate limiting y bloqueo temporal** en el endpoint de login tras N intentos fallidos.
- **Recuperación de contraseña** sin revelar si el email existe (mismo mensaje siempre, exista o no la cuenta).
- **Ningún secreto en el repositorio** — `NEXTAUTH_SECRET`, credenciales de base de datos y de MFA viven en `.env` (ya cubierto por `.gitignore`), nunca hardcodeados.

## Consecuencias

**Positivas:** cumple el checklist completo de los apuntes de Seguridad sin atar el proyecto a un proveedor de base de datos; mantiene la decisión de Neon intacta; Auth.js es el estándar de facto para Next.js, con comunidad y auditorías activas.

**Negativas / a implementar:** a diferencia de Supabase Auth, el hashing, el rate limiting y la lógica de MFA (TOTP) quedan a cargo del proyecto — no vienen resueltos de fábrica. Falta extender el modelo `Usuario` (o una tabla asociada) con: hash de contraseña, secreto TOTP y estado de MFA, contador de intentos fallidos/bloqueo temporal — diseño de schema pendiente, antes de implementar RF1/RF4.

**Reversibilidad:** alta. Auth.js es una capa delgada sobre la sesión; si más adelante conviene migrar a un proveedor gestionado (Supabase Auth, Auth0, Clerk), el modelo de dominio (`Usuario`, `RolUsuario`) no cambia, solo la capa de infraestructura de autenticación — mismo principio de desacoplamiento ya aplicado en ADR-0001.

## Referencias

- `Apuntes/12_Seguridad/Prácticas de codificación segura/Autenticacion-autorizacion-y-gestion-de-credenciales Apuntes.pdf`
- `Apuntes/12_Seguridad/OWASP Top 10 2021/Identification-and-Authentication-Failures Apuntes.pdf`
- ADR-0001 (pendiente que este documento cierra) y `requirements.md` (RF1, RF4).

## Addendum — implementacion (2026-09-12)

Al implementar la Opcion A surgio un detalle no resuelto en la version original de este ADR: el login recibe un email sin saber a que tenant (empresa) pertenece, pero las politicas RLS de `usuarios` (`prisma/rls.sql`) exigen que `app.tenant_id` ya este fijado para leer cualquier fila — un candado que el propio login, por definicion, todavia no puede abrir.

Dos decisiones para resolverlo, documentadas aca para trazabilidad:

1. **`email` pasa a ser unico global** (`@unique` simple), no compuesto con `empresaId` como en la primera version del schema. Se asume que una persona pertenece a una sola empresa en ChainPulse — coherente con el alcance de RF1/RF4 (no hay caso de uso de una misma persona en dos tenants distintos en el MVP). Si eso cambia mas adelante, hay que revisar esta decision.
2. **Funcion Postgres `login_lookup(email)` con `SECURITY DEFINER`** (`prisma/auth_functions.sql`) — la unica excepcion deliberada y acotada al aislamiento por RLS: expone solo los campos que la autenticacion necesita, para un usuario a la vez, y solo `chainpulse_app` puede ejecutarla (no `PUBLIC`). No es un bypass general — una vez que el login resuelve el tenant, el resto de cada request vuelve a pasar por `tenantClient()` (RLS normal, ADR-0001). Es el mismo criterio de "defensa en profundidad" ya aplicado en el resto del proyecto, acotado al unico punto donde el modelo de RLS choca con la realidad de un login por email.

Implementado: `src/auth.ts` (config de Auth.js v5), `src/infra/auth/` (`password.ts`, `mfa.ts`, `loginLookup.ts`, `rateLimit.ts`), `src/app/login/page.tsx`, `prisma/seed.ts` (usuario de prueba, no hay UI de registro de RF1 todavia). Pendiente: UI de alta de MFA (activar/escanear QR) — el motor de verificacion ya existe (`src/infra/auth/mfa.ts`), falta la pantalla; UI de registro/onboarding de RF1; middleware de proteccion de rutas para el dashboard (no existe dashboard todavia).

**Correccion (2026-09-12, mismo dia):** la libreria `argon2` (node-argon2) requiere compilar un binario nativo con node-gyp cuando no hay un prebuilt para la plataforma exacta — fallo real al instalar en Windows ARM64 (sin Visual Studio con el workload de C++). Se reemplazo por `@node-rs/argon2`, que publica un binario prebuilt para `win32-arm64-msvc` (y el resto de plataformas comunes: Windows x64/ARM64, macOS Intel/Apple Silicon, Linux glibc/musl x64/ARM64), sin node-gyp ni postinstall. Misma API (`hash`/`verify`), mismo algoritmo por defecto (Argon2id). No cambia ninguna decision de este ADR, solo la libreria concreta que la implementa.

**Correccion (2026-09-12, mismo dia) — motor de Prisma sin binario Rust:** al correr `npm run prisma:seed` en Windows aparecio un segundo problema de la misma familia (binario nativo incompatible con Windows ARM64), esta vez en Prisma Client mismo, no en `argon2`: `query_engine-windows.dll.node is not a valid Win32 application`. Prisma no publica un motor de consultas nativo para Windows ARM64 (issue de Prisma cerrado como "not planned") — a diferencia del motor de esquema (`schema-engine`, usado por `prisma generate`/`prisma migrate dev`), que corre como proceso separado y por eso si funciono via emulacion de Windows; el motor de consultas se carga *dentro* del proceso de Node como adenda nativa (`.node`), y ahi la emulacion no aplica — tiene que coincidir la arquitectura exacta.

Solucion: `engineType = "client"` en el bloque `generator client` de `prisma/schema.prisma` — el modo "sin motor Rust" de Prisma (GA desde la version 6.16, el proyecto ya estaba en 6.19.3), que compila las consultas en TypeScript puro y delega la conexion a un *driver adapter* en vez de al binario nativo. Se uso `@prisma/adapter-pg` (driver `pg`/node-postgres, TypeScript puro, funciona en cualquier arquitectura) en los dos lugares donde el proyecto crea un `PrismaClient`: `src/infra/prisma/client.ts` (cliente base, usado por `tenantClient()`) y `prisma/seed.ts` (script de siembra, conexion directa con `neondb_owner`). No cambia ninguna decision de este ADR ni de ADR-0001 (aislamiento multi-tenant): `tenantClient()` sigue envolviendo cada consulta en `$transaction` + `set_config('app.tenant_id', ...)` exactamente igual, el adapter solo cambia como Prisma habla con Postgres por debajo.

## Addendum — registro de cuenta y activacion de MFA (RF1, 2026-09-12)

Implementado el flujo de RF1 completo: `/registro` (crea la empresa y el administrador), inicio de sesion automatico con las mismas credenciales recien creadas, y `/activar-mfa` (obligatorio antes de considerar la cuenta operativa, segun la Decision de este ADR).

**Creacion del tenant bajo RLS — mas simple de lo previsto.** Al plantear esto se penso que insertar una empresa nueva chocaria con el mismo problema de `login_lookup()` (RLS exige `app.tenant_id` fijado de antemano). No es asi: a diferencia del login, en el registro *nosotros* elegimos el id de la empresa antes de tocar la base (`randomUUID()` en `src/infra/auth/registro.ts`, no el `@default(cuid())` de schema.prisma). Alcanza con fijar `app.tenant_id` a ese mismo id dentro de la misma transaccion antes de insertar — la politica `tenant_isolation_empresas` (`id = current_setting('app.tenant_id')`) queda satisfecha sin necesitar una funcion `SECURITY DEFINER` nueva. `registrarEmpresaYAdmin()` abre su propia transaccion sobre el cliente base (no via `tenantClient()`, que envuelve cada operacion en una transaccion separada) precisamente para que la creacion de la empresa y la del administrador sean atomicas: si el email ya existe, la transaccion completa revierte y no queda una empresa huerfana.

**MFA se genera en el registro, se activa despues.** `registrarEmpresaYAdmin()` genera el secreto TOTP (`generarSecretoMfa()`) y lo guarda de una vez (`mfaSecret`), pero `mfaHabilitado` queda en `false` hasta que `/activar-mfa` confirma un codigo real contra ese mismo secreto (`construirOtpauthUrl()`, nueva en `src/infra/auth/mfa.ts`, reconstruye la URL otpauth:// del secreto ya guardado sin generar uno nuevo — generarlo de nuevo invalidaria el que el usuario ya escaneo).

**Nota sobre los tipos generados con `engineType = "client"`:** con este modo (ver addendum anterior), el `default.d.ts` que genera `prisma generate` tipa `PrismaClient` y `Prisma.TransactionClient` directamente como `any`, y no reexporta `PrismaClientKnownRequestError`. `registro.ts` usa duck-typing (`"code" in err`) para detectar el error de restriccion unica (P2002, email duplicado) en vez de `instanceof`, y anota `tx: any` explicito en su transaccion (con el mismo comentario que ya tenia `tenantClient.ts` sobre este mismo motivo).
## Addendum — middleware de proteccion de rutas (2026-09-12)

`src/middleware.ts` protege `/activar-mfa` y `/dashboard/*` (este ultimo todavia no existe, pero queda en el `matcher` desde ya): sin sesion valida, redirige a `/login`. Usa `auth()` de Auth.js v5 directo como funcion de middleware -- funciona en el Edge runtime de Next.js sin tocar la base de datos porque la sesion es JWT (`session.strategy: "jwt"` en `src/auth.ts`), no de base de datos: decodificar el JWT no requiere el driver de Postgres, que de cualquier forma no corre en Edge (ADR-0001).

Es una capa adicional, no un reemplazo: `/activar-mfa` sigue validando su propia sesion del lado del servidor (`auth()` dentro de la pagina) ademas del middleware, mismo criterio de "cinturon y tirantes" que `tenantClient()` + RLS para el aislamiento multi-tenant.
