Características principales:

- Integración con la [API de NASA POWER](https://power.larc.nasa.gov/).
- Probabilidades para días "muy calurosos", "muy fríos", "muy ventosos", "muy húmedos" y "muy incómodos".
- Umbrales configurables para cada categoría.
- Métricas agregadas (temperaturas medias, precipitación total, etc.) útiles para construir paneles de control.

## Ejecución del servicio

```bash
cd backend
npm install
node index.js
```

## Endpoints

### `GET /`

Chequeo de salud simple que devuelve el estado y la descripción del servicio.

### `GET /api/probabilities/defaults`

Devuelve los parámetros predeterminados de NASA POWER, la comunidad y los valores de umbral utilizados cuando los clientes no proporcionan configuraciones personalizadas.

### `POST /api/probabilities`

Calcula las probabilidades meteorológicas para la ubicación y el rango de tiempo solicitados.

#### Cuerpo de la solicitud

```json
{
  "latitude": 40.7128,
  "longitude": -74.006,
  "startMonthDay": "0601",
  "endMonthDay": "0831",
  "startYear": 2013,
  "endYear": 2022,
  "thresholds": {
    "veryHot": { "temperatureC": 30 },
    "veryWindy": { "windSpeedMs": 8 }
  }
}
```

| Campo | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `latitude` | `number` | ✅ | Latitud en grados (-90 a 90). |
| `longitude` | `number` | ✅ | Longitud en grados (-180 a 180). |
| `startMonthDay` | `string`/`number` | ✅ | Día de inicio en formato `MMDD`. |
| `endMonthDay` | `string`/`number` | ✅ | Día de fin en formato `MMDD`. Puede ser anterior a `startMonthDay` para abarcar dos años calendario. |
| `startYear` | `integer` | ✅ | Primer año incluido en el análisis. |
| `endYear` | `integer` | ✅ | Último año incluido en el análisis. |
| `thresholds` | `object` | ❌ | Sobrescribe los umbrales de las categorías. |
| `parameters` | `array`/`string` | ❌ | Parámetros personalizados de NASA POWER. Por defecto: `T2M,T2M_MAX,T2M_MIN,WS2M,PRECTOTCORR,RH2M`. |
| `community` | `string` | ❌ | Comunidad de NASA POWER (por defecto: `RE`). |

#### Respuesta

```json
{
  "query": {
    "latitude": 40.7128,
    "longitude": -74.006,
    "startMonthDay": "0601",
    "endMonthDay": "0831",
    "startYear": 2013,
    "endYear": 2022,
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
  "results": {
    "thresholds": { ... },
    "totalDays": 920,
    "probabilities": {
      "veryHot": {
        "daysMatching": 120,
        "daysEvaluated": 920,
        "probability": 0.1304,
        "threshold": { "temperatureC": 32 }
      },
      "veryCold": { ... }
    },
    "aggregates": {
      "temperature": {
        "meanC": 24.1,
        "maxC": 29.2,
        "minC": 18.4
      },
      "wind": { "meanSpeedMs": 4.3 },
      "precipitation": {
        "meanDailyMm": 3.1,
        "totalMm": 285.2
      },
      "humidity": { "meanPct": 71.5 },
      "heatIndex": { "meanC": 25.9 }
    }
  },
  "metadata": [ ... ]
}
```

- Los valores de `probability` se expresan en `[0, 1]`. Multiplique por 100 para obtener porcentajes.
- `daysEvaluated` representa el número de días para los cuales había datos disponibles para esa categoría (por ejemplo, pueden faltar datos de precipitación en algunos días).
- El array `metadata` contiene las respuestas originales de NASA POWER para transparencia y propósitos de depuración.

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

