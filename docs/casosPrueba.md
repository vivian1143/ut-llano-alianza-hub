# Casos de prueba

Los casos CP-01 a CP-12 están automatizados en `pruebas/ejecutarPruebas.js`. El script hace lo mismo que harían los usuarios en los portales, pero por la API REST: inicia el proceso, completa cada tarea con los datos del formulario, envía el concepto desde el portal de la ARL y al final revisa Camunda y el servicio de registros.

Los temporizadores (15 días, 1 hora y fecha de cierre) no se esperan de verdad: el script ejecuta el job del temporizador con `POST /job/{id}/execute`, que es lo mismo que pasaría al cumplirse el tiempo.

**Cómo correrlos:** con el motor, el servicio de registros, el portal de la ARL y los workers encendidos, desde la carpeta del hub:

```
node pruebas/ejecutarPruebas.js
```

El resultado obtenido de cada caso queda en `pruebas/resultados.md`, al lado de lo que se esperaba.

## Proceso 1: Investigar y Reportar Accidente de Trabajo

### CP-01 Accidente grave con concepto de la ARL (camino principal)
**Datos:** trabajador Luis Martínez, accidente grave, FURAT con 5 días de incapacidad.
**Pasos:** informar, atender, clasificar, FURAT, incapacidad, conformar equipo, 3 tareas del subproceso de investigación, la ARL entra a su portal y envía el concepto, SST revisa el concepto, definir, implementar y verificar acciones.
**Resultado esperado:**
- El caso aparece en el portal de la ARL y el envío del concepto responde 201
- El proceso termina en "Caso investigado y cerrado"
- En la base de datos el accidente queda CERRADO, con reportes a ARL_EPS y MINTRABAJO
- El radicado de la ARL tiene el formato ARL-AAAA-000000
- La variable calificacionArl en Camunda es "Accidente de trabajo" y el concepto queda guardado
- La matriz de riesgos queda con nivel ALTO y el proceso recibe nivelRiesgo = ALTO

### CP-02 Incidente sin lesión y acciones no eficaces a la primera (camino alternativo)
**Datos:** tipo incidente, gravedad no aplica. En la primera verificación las acciones no son eficaces.
**Resultado esperado:**
- La tabla DMN devuelve nivelReporte = ninguno
- No pasa por Diligenciar FURAT ni por Remitir a ARL
- Implementar acciones se hace 2 veces
- No hay reportes guardados, el accidente queda CERRADO con riesgo BAJO

### CP-03 Accidente leve sin incapacidad (camino alternativo)
**Datos:** accidente leve, FURAT sin incapacidad.
**Resultado esperado:**
- La tabla DMN devuelve nivelReporte = arl
- Solo hay reporte a ARL_EPS
- No pasa por Registrar incapacidad ni por Remitir a ARL
- La matriz de riesgos queda con nivel MEDIO

### CP-04 La ARL no responde en 15 días (excepción)
**Datos:** accidente mortal. Se dispara el temporizador "15 días sin respuesta".
**Resultado esperado:**
- El proceso pasa por "15 días sin respuesta" y no por "Revisar concepto de ARL"
- Si la ARL intenta responder después, el portal le contesta 409 (el caso ya no espera concepto)
- El accidente queda CERRADO sin concepto guardado

## Proceso 2: Programar y Controlar Asistencia del Personal

### CP-05 Mes con dos novedades (camino principal)
**Datos:** falta de Ana Rojas (8 h) y retardo de Jorge Díaz (1 h).
**Resultado esperado:**
- La DMN pide reemplazo para la falta (pasa una vez por Cubrir ausencia) y solo registra el retardo
- Quedan 2 novedades guardadas
- El proceso recibe totalNovedades = 2 y totalHorasNovedad = 9 desde el servicio de registros
- La prefactura guardada tiene 2 novedades y su resumen dice "Total novedades: 2"
- Nómina y facturación reciben la prefactura en paralelo y el proceso termina

### CP-06 Falta personal, el cliente pide cambios y hay inconsistencias (camino alternativo)
**Datos:** 15 de 20 operarios, sin candidatos en el banco de hojas de vida, el cliente pide un cambio, la auditoría encuentra una inconsistencia.
**Resultado esperado:**
- Se llama una vez el subproceso Gestionar personal adicional
- Asignar personal se hace 3 veces y Corregir novedades 1 vez
- No hay novedades guardadas y la prefactura dice "Sin novedades en el mes"

### CP-07 El supervisor no verifica la asistencia a tiempo (excepción)
**Datos:** se dispara el temporizador no interruptivo "1 hora sin verificar".
**Resultado esperado:**
- El worker recordarVerificacionAsistencia deja la variable ultimoRecordatorio
- El proceso pasa por "Recordatorio enviado"
- La tarea Verificar asistencia sigue abierta

## Proceso 3: Elaborar Propuesta

### CP-08 Propuesta aprobada a la primera (camino principal)
**Datos:** proceso LP-012-2026, 12 operarios, salario 1.750.905, factor 0.52, 10 meses, AIU 10 %, acredita servicios de origen nacional.
**Resultado esperado:**
- valorPropuesta = 12 × 1.750.905 × 1,52 × 10 × 1,10 = 351.301.579,2 (en Camunda y en la base de datos)
- La DMN devuelve "Servicios de origen nacional"
- La propuesta queda ENVIADA_RADICACION y el proceso termina en "Propuesta enviada a radicación"

### CP-09 Propuesta con adenda, errores y rechazo de gerencia (camino alternativo)
**Datos:** "Simular adenda" marcado, sin factores de desempate, una revisión con errores y un rechazo de gerencia.
**Resultado esperado:**
- Ajustar documentos según adenda se hace 1 vez
- Corregir con el área responsable se hace 2 veces y gerencia revisa 2 veces
- La DMN devuelve "Sin factor de desempate acreditado"
- El proceso termina en "Propuesta enviada a radicación"

### CP-10 Salario por debajo del mínimo (excepción)
**Datos:** salario por operario de 1.000.000.
**Resultado esperado:**
- Queda un incidente en Formular propuesta económica con un mensaje que habla del salario mínimo
- Al corregir la variable salarioBase y reintentar la tarea, el proceso sigue hasta Validar factores de desempate

### CP-11 Llega la fecha de cierre antes de la aprobación (excepción)
**Datos:** se dispara el temporizador "Fecha de cierre alcanzada" mientras gerencia no ha aprobado.
**Resultado esperado:**
- El proceso termina en "Propuesta no presentada"
- La propuesta queda FORMULADA (no se envía a radicación)

## Validación de datos

### CP-12 Validación en el portal de la ARL y en el servicio de registros (excepción)
**Resultado esperado:**
- Registro con NIT mal escrito: 400
- Registro con contraseñas distintas: 400
- Registro correcto: 201
- Registro repetido: 409
- Ingreso con contraseña equivocada: 401
- Ingreso con la cuenta nueva: 200
- Concepto demasiado corto: 400
- Ver casos sin iniciar sesión: 401
- Novedad de 30 horas en un día: 400
- Novedad con un tipo que no existe: 400

## Prueba manual: servicio de registros apagado
No está en el script porque hay que apagar un componente.
1. Apagar el servicio de registros.
2. Iniciar un accidente y completar "Informar evento" y "Atender al trabajador".
3. **Resultado esperado:** el worker notificarSst muestra el error de conexión, reintenta 3 veces cada 10 segundos y luego aparece un incidente en Cockpit en "Notificar evento al área SST".
4. Encender el servicio de registros, en Cockpit abrir el incidente y dar "Retry" (incrementar reintentos). **Resultado esperado:** el worker guarda el accidente y aparece la tarea "Registrar y clasificar evento".

## Recorrido manual por los portales
La sección "Demostración de principio a fin" del README del hub explica cómo hacer el CP-01 a mano entrando con cada usuario en el portal interno y en el portal de la ARL.
