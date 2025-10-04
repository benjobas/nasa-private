# Weather Probability Service

This document describes the backend service that powers the **Will it rain on my parade?** challenge. The API aggregates NASA POWER daily reanalysis data and returns probabilities for outdoor condition categories.

## Overview

The backend exposes an HTTP API built with Express. The service downloads historical records for a requested latitude/longitude and computes statistics for the selected time window across multiple years.

Key features:

- Integration with the [NASA POWER API](https://power.larc.nasa.gov/).
- Probabilities for "very hot", "very cold", "very windy", "very wet", and "very uncomfortable" days.
- Configurable thresholds for each category.
- Aggregate metrics (mean temperatures, total precipitation, etc.) useful for building dashboards.

## Running the service

```bash
cd backend
npm install
node index.js
```

By default the server listens on port `3000`. Set the `PORT` environment variable to change it.

## Endpoints

### `GET /`

Simple health check that returns service status and description.

### `GET /api/probabilities/defaults`

Returns the default NASA POWER parameters, community, and threshold values used when clients do not supply custom settings.

### `POST /api/probabilities`

Computes weather probabilities for the requested location and time range.

#### Request body

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

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `latitude` | `number` | ✅ | Latitude in degrees (-90 to 90). |
| `longitude` | `number` | ✅ | Longitude in degrees (-180 to 180). |
| `startMonthDay` | `string`/`number` | ✅ | Start day in `MMDD` format. |
| `endMonthDay` | `string`/`number` | ✅ | End day in `MMDD` format. Can be before `startMonthDay` to span two calendar years. |
| `startYear` | `integer` | ✅ | First year to include in the analysis. |
| `endYear` | `integer` | ✅ | Last year to include in the analysis. |
| `thresholds` | `object` | ❌ | Overrides for the category thresholds. |
| `parameters` | `array`/`string` | ❌ | Custom NASA POWER parameters. Defaults to `T2M,T2M_MAX,T2M_MIN,WS2M,PRECTOTCORR,RH2M`. |
| `community` | `string` | ❌ | NASA POWER community (defaults to `RE`). |

#### Response

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

- `probability` values are expressed in `[0, 1]`. Multiply by 100 to obtain percentages.
- `daysEvaluated` represents the number of days for which data was available for that category (e.g., precipitation data may be missing on some days).
- The `metadata` array contains the original NASA POWER responses for transparency and debugging purposes.

## Category definitions

| Category | Condition |
| --- | --- |
| Very hot | Maximum temperature ≥ 32 °C (customizable) |
| Very cold | Minimum temperature ≤ 0 °C |
| Very windy | Mean wind speed ≥ 10 m/s |
| Very wet | Daily precipitation ≥ 10 mm |
| Very uncomfortable | Heat index ≥ 30 °C **and** relative humidity ≥ 70% |

These values are intended as sensible defaults for planning outdoor activities and can be adapted by clients through the request payload.

## Notes and limitations

- The service performs one NASA POWER request per season per year; large year ranges may result in longer response times.
- NASA POWER data coverage is best between 1984 and present. Requests outside this window may return sparse data.
- The current implementation focuses on point queries (latitude/longitude). Area-averaged queries could be added by integrating other NASA APIs that support bounding boxes.
- A caching layer (e.g., Redis or filesystem) can be incorporated to reduce repeated downloads for popular locations.

