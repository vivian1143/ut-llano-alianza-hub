# Modelo de datos del negocio

Lo guarda el servicio de registros en su propia base H2 (`registros-db/registros`), aparte de la base de Camunda.
El script que crea las tablas es `src/main/resources/schema.sql` y el de datos iniciales es `src/main/resources/data.sql`, los dos en el repositorio ut-llano-alianza-registros. Se ejecutan en cada arranque y no borran lo que ya está guardado.

## Diagrama

```mermaid
erDiagram
    ACCIDENTE ||--o{ REPORTE_ACCIDENTE : "se reporta a"
    ACCIDENTE ||--o| CONCEPTO_ARL : "recibe"
    ACCIDENTE ||--o| MATRIZ_RIESGO : "actualiza"
    USUARIO_ARL ||--o{ CONCEPTO_ARL : "envía"

    ACCIDENTE {
        bigint id PK
        varchar process_instance_id UK
        varchar nombre_trabajador
        varchar documento_trabajador
        varchar sede
        date fecha_evento
        varchar descripcion
        varchar tipo_evento
        varchar gravedad
        varchar estado
        varchar radicado_arl
        varchar causas
        varchar conclusiones
        timestamp fecha_remision
        timestamp fecha_registro
        timestamp fecha_cierre
    }
    REPORTE_ACCIDENTE {
        bigint id PK
        bigint accidente_id FK
        varchar entidad
        varchar radicado UK
        varchar numero_furat
        timestamp fecha
    }
    CONCEPTO_ARL {
        bigint id PK
        bigint accidente_id FK
        bigint usuario_arl_id FK
        varchar calificacion
        varchar concepto
        varchar recomendaciones
        timestamp fecha
    }
    MATRIZ_RIESGO {
        bigint id PK
        bigint accidente_id FK
        varchar sede
        varchar peligro
        varchar controles
        varchar nivel_riesgo
        date fecha_actualizacion
        date proxima_inspeccion
    }
    USUARIO_ARL {
        bigint id PK
        varchar nombre
        varchar nit UK
        varchar correo UK
        varchar clave_hash
        timestamp fecha_registro
    }
    NOVEDAD {
        bigint id PK
        varchar tarea_id UK
        varchar process_instance_id
        varchar proyecto
        varchar sede
        varchar mes
        date fecha
        varchar trabajador
        varchar tipo
        decimal horas
    }
    PREFACTURA {
        bigint id PK
        varchar process_instance_id UK
        varchar proyecto
        varchar sede
        varchar mes
        int total_novedades
        decimal total_horas
        varchar resumen
        timestamp fecha_cierre
    }
    PROPUESTA {
        bigint id PK
        varchar process_instance_id UK
        varchar numero_proceso
        varchar entidad_contratante
        varchar modalidad
        int numero_operarios
        decimal salario_base
        decimal factor_prestacional
        int meses_contrato
        decimal porcentaje_aiu
        decimal costo_personal
        decimal valor_propuesta
        varchar estado
    }
    PARAMETRO {
        varchar clave PK
        decimal valor
        varchar descripcion
        int vigencia
    }
```

NOVEDAD y PREFACTURA se relacionan por `process_instance_id`: la prefactura de un mes se arma con las novedades de la misma instancia.

## Tablas

**accidente** (proceso 1). Un registro por cada evento reportado. Lo crea el worker notificarSst.
Estados: REGISTRADO, REPORTADO, ESPERANDO_CONCEPTO_ARL, CONCEPTO_RECIBIDO y CERRADO.

**reporte_accidente** (proceso 1). Reportes a ARL y EPS (`ARL_EPS`) y al Ministerio del Trabajo (`MINTRABAJO`). El radicado lo asigna el servicio con el formato ARL-2026-000001 o MT-2026-000001. Solo puede haber un reporte por entidad para cada accidente.

**concepto_arl** (proceso 1). Lo que envía la ARL desde su portal. Uno por accidente.

**matriz_riesgo** (proceso 1). Se crea al cerrar el caso. El nivel de riesgo sale de la gravedad: grave o mortal es ALTO, leve es MEDIO, incidente es BAJO. La próxima inspección queda a los días del parámetro diasProximaInspeccion.

**usuario_arl** (usuario externo). Cuentas del portal de la ARL. La contraseña se guarda como sal + SHA-256, nunca en texto plano.

**novedad** (proceso 2). Faltas, retardos, horas extra e incapacidades. `tarea_id` es el id de la External Task, así un reintento del worker no la guarda dos veces.

**prefactura** (proceso 2). Una por instancia (un mes de una sede). Se calcula con las novedades guardadas.

**propuesta** (proceso 3). Datos de costos y valor calculado. Estados: FORMULADA y ENVIADA_RADICACION.

**parametro**. Valores de referencia. Datos iniciales:
- salarioMinimo: 1.750.905 (Decreto 1469 de 2025)
- auxilioTransporte: 249.095 (Decreto 1470 de 2025)
- diasProximaInspeccion: 30

## Vínculo con las instancias de Camunda

Las tablas accidente, novedad, prefactura y propuesta guardan el `process_instance_id` de la instancia principal. Las demás se ligan a través del accidente. Con eso:
- `GET http://localhost:8082/api/instancias/{processInstanceId}` devuelve todo lo de un caso (es lo que muestra el portal interno debajo de cada formulario).
- Desde Cockpit se puede copiar el id de una instancia y buscarlo en la base de datos.

## Consultar los datos
- API: http://localhost:8082/api/accidentes, /api/novedades, /api/prefacturas, /api/propuestas, /api/matriz-riesgos, /api/parametros
- Consola H2: http://localhost:8082/h2-console con JDBC URL `jdbc:h2:file:./registros-db/registros`, usuario `sa` y contraseña `sa`

## Empezar de cero
Detener el servicio de registros y borrar la carpeta `registros-db`. Al volver a arrancar se crean las tablas vacías con los datos iniciales.
