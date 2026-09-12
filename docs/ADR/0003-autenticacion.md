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
