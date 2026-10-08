# Lecciones aprendidas — sesión, RLS y MFA

**Contexto:** retrospectiva de una serie de rondas de trabajo sobre tres frentes relacionados en un sistema multitenant: un mecanismo de revocación de sesiones, la reconstrucción reproducible de políticas RLS/funciones de autenticación/`GRANT`s manuales, y el endurecimiento del arnés de pruebas de integración que los valida. Todos los nombres de host, identificadores de proyecto/base, credenciales y nombres de personas se omiten deliberadamente — este documento conserva únicamente el patrón del error y la corrección, no los datos del entorno en que se encontró.

Cada punto sigue el mismo formato: qué se asumió, qué resultó ser falso, y qué práctica lo previene (con referencia a la sección correspondiente de `SECURITY_AND_INTEGRATION_TESTING_GUIDE.md`).

## 1. Un campo nuevo en un JWT no puede asumirse presente en tokens viejos

**Se asumió:** que una vez agregado un claim nuevo al token de sesión (un contador de versión, pensado para poder revocar sesiones), todo el código que lo lee podía tratarlo como siempre presente.

**Resultado real:** un JWT emitido *antes* de desplegar el cambio simplemente no lleva ese claim — no es `0` ni `null` explícito, está ausente por completo. Tratarlo como presente sin más hubiera roto la sesión de cualquiera que ya estuviera logueado al momento del despliegue.

**Prevención:** la ausencia del claim se trata como un caso explícito y documentado (un valor por defecto fijo, pensado para no desloguear a nadie al desplegar), nunca como "nunca va a pasar". Ver Guía, Sección 3.

## 2. Verificar sesión vigente en un solo lugar, no en cada ruta por separado

**Se asumió:** que bastaba agregar la verificación de sesión vigente a los dos helpers centrales ya existentes (`requireSession()`/`requireAdmin()`, pensados para rutas de API).

**Resultado real:** una auditoría encontró **13 páginas** (Server Components) que llamaban a la función de autenticación directamente, con su propio chequeo manual, sin pasar por esos helpers — quedaban completamente fuera del mecanismo de revocación. Una de esas 13 además era una ruta de API (no una página) que también se había pasado por alto en una primera revisión.

**Prevención:** cuando se introduce un control de seguridad centralizado, auditar explícitamente **todos** los puntos de entrada existentes que deberían usarlo, no solo los que ya seguían el patrón esperado — y crear la variante que falta (en este caso, equivalentes a los helpers existentes pero compatibles con `redirect()` en vez de una respuesta HTTP) en vez de duplicar el chequeo a mano en cada punto. Ver Guía, Sección 4.

## 3. Una migración "preparada, no aplicada" necesita quedar así explícitamente

**Se asumió:** que documentar en el propio código que una migración/mecanismo estaba "preparado para revisión" era suficiente.

**Resultado real:** sin un marcador consistente y repetido en cada archivo relacionado (migración, esquema, helpers, tipos), es fácil perder de vista, varias rondas después, qué piezas de un cambio multi-archivo ya se aplicaron contra un entorno real y cuáles siguen pendientes de autorización.

**Prevención:** cada archivo que forma parte de un cambio no aplicado todavía repite, en su propio comentario de cabecera, el mismo estado ("preparado para revisión, no aplicado") y una referencia al documento donde se autorizó originalmente — información redundante a propósito, para que no haga falta reconstruir el historial completo para saber si algo ya corrió contra una base real. Ver Guía, Sección 3.

## 4. Un listener de error faltante en una librería de colas puede convertirse en una excepción no capturada intermitente

**Se asumió:** que una librería de colas de trabajos en segundo plano, configurada con sus temporizadores de mantenimiento deshabilitados explícitamente (porque el proceso es de vida corta), no iba a generar actividad periódica de fondo.

**Resultado real:** una revisión del código fuente de la librería (no de su documentación) mostró que una comprobación periódica interna seguía corriendo de forma incondicional, sin depender de esa opción. Cuando esa comprobación fallaba (por ejemplo, por un timeout de conexión intermitente), la librería emitía un evento `"error"` — y sin ningún listener registrado para ese evento, el entorno de ejecución lo trataba como una excepción no capturada.

**Prevención:** cuando una dependencia expone un patrón de eventos (`EventEmitter` o equivalente), registrar explícitamente un manejador para el evento de error **antes** de iniciar la instancia, incluso si en teoría no debería dispararse con la configuración elegida — y verificar el comportamiento real contra el código fuente instalado de la dependencia, no solo contra su documentación, cuando algo no cuadra. Ver Guía, Sección 12 (mismo principio de "nunca dejar un error sin manejar explícitamente", aplicado aquí a nivel de proceso en vez de a nivel de respuesta HTTP).

## 5. Una prueba de integración puede dejar residuos aunque "solo lea"

**Se asumió:** que una prueba que únicamente encolaba un job de prueba para verificar el comportamiento de otro proceso no necesitaba limpieza propia, porque no modificaba ninguna tabla de negocio.

**Resultado real:** el job encolado quedaba como una fila huérfana en la tabla interna de la librería de colas, y la conexión usada para encolarlo nunca se cerraba — cada corrida de esa prueba specific dejaba más residuo que la anterior.

**Prevención:** cualquier prueba que cree un recurso con efecto observable más allá de la aserción (una fila en una cola, un archivo temporal, una conexión) necesita su propia limpieza acotada, sin importar que el objetivo principal de la prueba sea "solo verificar lectura" — la limpieza se decide por lo que la prueba *crea*, no por lo que la prueba *afirma*. Ver Guía, Secciones 6 y 7.

## 6. Un valor de prueba "obviamente falso" puede no serlo

**Se asumió,** en más de una ronda, que una aserción sobre un valor devuelto por un servicio externo simulado podía quedar laxa ("mayor o igual a cero") porque el servicio real no estaba disponible en el entorno de pruebas (modo sandbox, sin dominio verificado).

**Resultado real:** esa laxitud ocultaba que la prueba, en los hechos, no estaba confirmando el valor que decía confirmar — solo que el código no reventaba. Una vez mockeado el servicio externo correctamente (ver Guía, Sección 10), la misma prueba pudo afirmar el valor exacto esperado.

**Prevención:** una aserción débil ("no es negativo", "no lanzó") es una señal de que falta una pieza (típicamente, un mock) para poder afirmar el valor real — no una aceptación permanente de incertidumbre.

## 7. Verificar identidad completa de un objeto compartido, no solo su existencia

**Se asumió**, en una primera versión del verificador de drift para una función de autenticación `SECURITY DEFINER`, que confirmar "existe una función con este nombre y esta cantidad de argumentos" alcanzaba.

**Resultado real:** una ejecución real contra el motor de base de datos mostró dos defectos reales en esa expectativa: el conjunto esperado de modos de argumento no coincidía exactamente con lo que el catálogo real devuelve para argumentos de entrada *y* de salida combinados, y el conjunto esperado de privilegios `EXECUTE` no coincidía tras una segunda ejecución real. Ninguno de los dos defectos lo iba a encontrar nunca una prueba puramente estática (de texto) sin ejecutar contra una base real.

**Prevención:** las pruebas de forma (estáticas, sobre el texto de la migración) y las pruebas de contenido (contra un catálogo real) son complementarias, nunca sustitutas una de la otra — una suite madura necesita ambas, y las de contenido son las únicas que detectan discrepancias de identidad completa (Guía, Sección 9).

## 8. Un extractor de texto sobre SQL necesita buscar el marcador completo, no una subcadena

**Se asumió** que buscar la subcadena de un marcador de sección (el texto descriptivo de un comentario) alcanzaba para ubicar el inicio de un fragmento de migración a ejecutar por separado.

**Resultado real:** buscar la subcadena sin su prefijo de comentario SQL (`--`) encontraba una posición *dentro* del comentario, no al principio de la línea — el fragmento extraído terminaba empezando con texto suelto, no con un comentario válido, lo que lo volvía SQL ejecutable inválido (y potencialmente peligroso) en cuanto se envolvía en una transacción y se corría.

**Prevención:** cualquier extracción de texto que vaya a convertirse en SQL ejecutable debe buscar el marcador completo (incluido cualquier prefijo sintácticamente significativo), y validar explícitamente ausencia, duplicación y orden de los marcadores antes de extraer nada — nunca confiar en la primera coincidencia de una búsqueda de subcadena. Ver Guía, Sección 3.

## 9. Una suite reconstructiva necesita abortar ante un objeto preexistente, no pisarlo

**Se asumió**, en una primera versión de una suite que reconstruye un esquema descartable para probar RLS/`GRANT`s desde cero, que empezar siempre con un `DROP SCHEMA IF EXISTS ... CASCADE` incondicional era la forma correcta de garantizar un estado limpio.

**Resultado real:** ese patrón borra en silencio cualquier esquema con ese nombre que haya quedado de una corrida anterior interrumpida — sin que nadie pueda investigar por qué quedó ahí, y sin ninguna señal de que se perdió algo.

**Prevención:** separar "verificar que no existe" (y abortar con un error claro si existe) de "crear" — y separar "esta suite lo creó" (una bandera de propiedad) de "borrar" en la limpieza. Ningún `DROP ... CASCADE` corre sin que ambas condiciones se cumplan. Ver Guía, Secciones 6, 7 y 8 — este fue el motivo original de que esas tres prácticas se documentaran juntas.

## 10. Resumen de prevención por categoría

| Categoría del error | Dónde se repitió | Práctica que lo previene |
|---|---|---|
| Asumir presencia de un dato nuevo en estado viejo | claim de sesión en JWT viejo | Guía §3 |
| Punto de entrada nuevo que no pasa por el control central | páginas fuera de los helpers de sesión | Guía §4 |
| Estado "preparado, no aplicado" sin marcador consistente | migraciones y helpers de revocación | Guía §3 |
| Efecto secundario de una dependencia no documentado | listener de error de la librería de colas | Guía §12 |
| Residuo de un recurso no obvio | job huérfano en prueba "de solo lectura" | Guía §6, §7 |
| Aserción débil que oculta falta de determinismo | servicio externo no mockeado | Guía §10, §11 |
| Verificación de forma sin verificación de contenido | identidad de función `SECURITY DEFINER` | Guía §9 |
| Búsqueda de subcadena en vez de marcador completo | extractor de fragmento SQL | Guía §3 |
| Borrado incondicional de un recurso compartido | `DROP SCHEMA ... CASCADE` sin bandera de propiedad | Guía §6, §7, §8 |
