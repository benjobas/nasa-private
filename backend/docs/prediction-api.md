Características principales:

- Integración con la [API de NASA POWER](https://power.larc.nasa.gov/).
- Observaciones externas opcionales desde [GESDISC OPeNDAP (GPM IMERG)](https://disc.gsfc.nasa.gov/information/tools?title=OPeNDAP%20and%20GDS) para reforzar los resultados de precipitación.
- Probabilidades para días "muy calurosos", "muy fríos", "muy ventosos", "muy húmedos" y "muy incómodos".
- Umbrales configurables para cada categoría.
- Métricas agregadas (temperaturas medias, precipitación total, etc.) útiles para construir paneles de control.

## Ejecución del servicio

```bash
cd backend
npm install
node index.js
```

### Configuración de entorno

```bash
cp .env.example .env
# Edita .env y pega tu token Bearer de GESDISC en GESDISC_TOKEN=
```

## Endpoints

### `GET /`

Chequeo de salud simple que devuelve el estado y la descripción del servicio.

### `GET /api/probabilities/defaults`

Devuelve los parámetros predeterminados de NASA POWER, la comunidad y los valores de umbral utilizados cuando los clientes no proporcionan configuraciones personalizadas.

### `POST /api/probabilities/forecast`

Genera una predicción para una fecha puntual utilizando un histórico de entrenamiento y valida el resultado con los datos reales del año objetivo.

#### Cuerpo de la solicitud

```json
{
  "latitude": 40.7128,
  "longitude": -74.006,
  "targetDate": "2022-07-04",
  "trainingStartYear": 1990,
  "trainingEndYear": 2021,
  "thresholds": {
    "veryHot": { "temperatureC": 30 }
  }
}
```

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `latitude` | `number` | ✅ | Latitud en grados (-90 a 90). |
| `longitude` | `number` | ✅ | Longitud en grados (-180 a 180). |
| `targetDate` | `string` | ✅ | Fecha objetivo en formato ISO `YYYY-MM-DD`. |
| `trainingStartYear` | `integer` | ❌ | Primer año incluido en el entrenamiento (por defecto 1984). |
| `trainingEndYear` | `integer` | ❌ | Último año de entrenamiento (por defecto el año anterior a `targetDate`). |
| `thresholds` | `object` | ❌ | Umbrales personalizados por categoría. |
| `parameters` | `array`/`string` | ❌ | Parámetros personalizados de NASA POWER. |
| `community` | `string` | ❌ | Comunidad de NASA POWER (por defecto: `RE`). |

#### Respuesta

```json
{
  "query": {
    "latitude": 40.7128,
    "longitude": -74.006,
    "targetDate": "2022-07-04",
    "trainingStartYear": 1990,
    "trainingEndYear": 2021,
    "evaluationYear": 2022,
    "parameters": ["T2M", "T2M_MAX", "T2M_MIN", "WS2M", "PRECTOTCORR", "RH2M"],
    "community": "RE",
    "thresholds": {
      "veryHot": { "temperatureC": 32 },
      "veryCold": { "temperatureC": 0 },
      "veryWindy": { "windSpeedMs": 10 },
      "veryWet": { "precipitationMm": 10 },
      "veryUncomfortable": {
        "heatIndexC": 30,
        "humidityPct": 70
      }
    }
  },
  "training": {
    "totalDays": 32,
    "probabilities": { "veryHot": { "probability": 0.22, "daysEvaluated": 32, ... }, ... },
    "aggregates": { "temperature": { "meanC": 27.4, "maxC": 33.1, ... }, ... }
  },
  "evaluation": {
    "year": 2022,
    "totalDays": 1,
    "probabilities": { "veryHot": { "probability": 1, "daysMatching": 1, ... }, ... },
    "aggregates": { "temperature": { "meanC": 33.8, "maxC": 33.8, ... }, ... }
  },
  "comparison": {
    "meanBrierScore": 0.0484,
    "categories": {
      "veryHot": {
        "predictedProbability": 0.22,
        "actualOutcome": 1,
        "absoluteError": 0.78,
        "brierScore": 0.6084,
        "daysEvaluated": 1
      }
    }
  },
  "externalObservations": [
    {
      "type": "precipitation",
      "dataset": "GPM IMERG Daily Precipitation (Final Run)",
      "precipitationMm": 12.4,
      "gridPoint": { "latitude": 40.05, "longitude": -73.95 },
      "indices": { "latitude": 1301, "longitude": 1059 },
      "sourceUrl": "https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/.../3B-DAY.MS.MRG.3IMERG.20220704-S000000-E235959.V06B.HDF5.nc4",
      "queryUrl": "https://gpm1.gesdisc.eosdis.nasa.gov/opendap/...precipitationCal[0:0][1301:1301][1059:1059]"
    }
  ],
  "metadata": {
    "training": [ ... ],
    "evaluation": [ ... ]
  }
}
```

- Las probabilidades de entrenamiento se calculan sobre todos los años incluidos en la ventana histórica.
- `actualOutcome` representa si la condición ocurrió en la fecha evaluada (1 = sí, 0 = no).
- La métrica `meanBrierScore` resume el error cuadrático medio de las probabilidades predichas frente a los resultados observados.
- `metadata.training` y `metadata.evaluation` conservan las respuestas crudas de NASA POWER utilizadas para reproducibilidad.

## Definiciones de categorías

| Categoría | Condición |
| --- | --- |
| Muy caluroso | Temperatura máxima ≥ 32 °C (personalizable) |
| Muy frío | Temperatura mínima ≤ 0 °C |
| Muy ventoso | Velocidad media del viento ≥ 10 m/s |
| Muy húmedo | Precipitación diaria ≥ 10 mm |
| Muy incómodo | Índice de calor ≥ 30 °C **y** humedad relativa ≥ 70% |

Estos valores se proponen como valores predeterminados razonables para planificar actividades al aire libre y pueden ser adaptados por los clientes a través del cuerpo de la solicitud.

## Notas y limitaciones

- El servicio realiza una solicitud a NASA POWER por temporada por año; rangos de años grandes pueden resultar en tiempos de respuesta más largos.
- La cobertura de datos de NASA POWER es mejor entre 1984 y el presente. Las solicitudes fuera de esta ventana pueden devolver datos escasos.
- La implementación actual se centra en consultas puntuales (latitud/longitud). Las consultas promediadas por área podrían añadirse integrando otras APIs de NASA que soporten cajas delimitadoras.
- Se puede incorporar una capa de caché (por ejemplo, Redis o sistema de archivos) para reducir descargas repetidas para ubicaciones populares.
- Para habilitar la observación externa de precipitación, define `GESDISC_TOKEN` (Bearer) en un `.env` conforme a `.env.example`. Si no se configura, la API devolverá el motivo en `externalObservations[].error` pero el resto de la respuesta seguirá disponible.

## Pruebas y validación

- `npm test`: ejecuta pruebas unitarias, incluida la integración opcional con GESDISC (se omite automáticamente si no hay token).
- `npm run validate:forecast`: muestrea cientos de ubicaciones aleatorias contra NASA POWER y reporta precisión promedio. Requiere conectividad externa.

