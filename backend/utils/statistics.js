const DEFAULT_THRESHOLDS = {
  veryHot: {
    temperatureC: 32,
  },
  veryCold: {
    temperatureC: 0,
  },
  veryWindy: {
    windSpeedMs: 10,
  },
  veryWet: {
    precipitationMm: 10,
  },
  veryUncomfortable: {
    heatIndexC: 30,
    humidityPct: 70,
  },
};

function mergeThresholds(customThresholds = {}) {
  return {
    veryHot: { ...DEFAULT_THRESHOLDS.veryHot, ...(customThresholds.veryHot || {}) },
    veryCold: { ...DEFAULT_THRESHOLDS.veryCold, ...(customThresholds.veryCold || {}) },
    veryWindy: { ...DEFAULT_THRESHOLDS.veryWindy, ...(customThresholds.veryWindy || {}) },
    veryWet: { ...DEFAULT_THRESHOLDS.veryWet, ...(customThresholds.veryWet || {}) },
    veryUncomfortable: {
      ...DEFAULT_THRESHOLDS.veryUncomfortable,
      ...(customThresholds.veryUncomfortable || {}),
    },
  };
}

function celsiusToFahrenheit(value) {
  return value * (9 / 5) + 32;
}

function fahrenheitToCelsius(value) {
  return (value - 32) * (5 / 9);
}

function calculateHeatIndexCelsius(temperatureC, humidityPct) {
  if (!Number.isFinite(temperatureC) || !Number.isFinite(humidityPct)) {
    return null;
  }

  const temperatureF = celsiusToFahrenheit(temperatureC);

  if (temperatureF < 80 || humidityPct < 40) {
    return temperatureC;
  }

  const T = temperatureF;
  const R = humidityPct;

  const heatIndexF =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    0.00683783 * T * T -
    0.05481717 * R * R +
    0.00122874 * T * T * R +
    0.00085282 * T * R * R -
    0.00000199 * T * T * R * R;

  return fahrenheitToCelsius(heatIndexF);
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) {
    return null;
  }
  const sum = filtered.reduce((acc, value) => acc + value, 0);
  return sum / filtered.length;
}

function sum(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) {
    return null;
  }
  return filtered.reduce((acc, value) => acc + value, 0);
}

function evaluateConditions(records, thresholds) {
  const categoryCounters = {
    veryHot: { count: 0, available: 0 },
    veryCold: { count: 0, available: 0 },
    veryWindy: { count: 0, available: 0 },
    veryWet: { count: 0, available: 0 },
    veryUncomfortable: { count: 0, available: 0 },
  };

  const measurements = {
    temperatureMean: [],
    temperatureMax: [],
    temperatureMin: [],
    windSpeed: [],
    precipitation: [],
    humidity: [],
    heatIndex: [],
  };

  for (const record of records) {
    const tAvg = safeNumber(record.T2M);
    const tMax = safeNumber(record.T2M_MAX ?? record.T2M);
    const tMin = safeNumber(record.T2M_MIN ?? record.T2M);
    const windSpeed = safeNumber(record.WS2M);
    const precipitation = safeNumber(record.PRECTOTCORR ?? record.PRECTOT);
    const humidity = safeNumber(record.RH2M);

    if (Number.isFinite(tAvg)) {
      measurements.temperatureMean.push(tAvg);
    }

    if (Number.isFinite(tMax)) {
      measurements.temperatureMax.push(tMax);
      categoryCounters.veryHot.available += 1;
      if (tMax >= thresholds.veryHot.temperatureC) {
        categoryCounters.veryHot.count += 1;
      }
    }

    if (Number.isFinite(tMin)) {
      measurements.temperatureMin.push(tMin);
      categoryCounters.veryCold.available += 1;
      if (tMin <= thresholds.veryCold.temperatureC) {
        categoryCounters.veryCold.count += 1;
      }
    }

    if (Number.isFinite(windSpeed)) {
      measurements.windSpeed.push(windSpeed);
      categoryCounters.veryWindy.available += 1;
      if (windSpeed >= thresholds.veryWindy.windSpeedMs) {
        categoryCounters.veryWindy.count += 1;
      }
    }

    if (Number.isFinite(precipitation)) {
      measurements.precipitation.push(precipitation);
      categoryCounters.veryWet.available += 1;
      if (precipitation >= thresholds.veryWet.precipitationMm) {
        categoryCounters.veryWet.count += 1;
      }
    }

    if (Number.isFinite(humidity) && Number.isFinite(tAvg)) {
      measurements.humidity.push(humidity);
      const heatIndex = calculateHeatIndexCelsius(tAvg, humidity);
      if (Number.isFinite(heatIndex)) {
        measurements.heatIndex.push(heatIndex);
        categoryCounters.veryUncomfortable.available += 1;
        if (
          heatIndex >= thresholds.veryUncomfortable.heatIndexC &&
          humidity >= thresholds.veryUncomfortable.humidityPct
        ) {
          categoryCounters.veryUncomfortable.count += 1;
        }
      }
    }
  }

  const probabilities = {};
  for (const [category, stats] of Object.entries(categoryCounters)) {
    probabilities[category] = {
      daysMatching: stats.count,
      daysEvaluated: stats.available,
      probability: stats.available ? stats.count / stats.available : null,
      threshold: thresholds[category],
    };
  }

  return {
    probabilities,
    measurements,
  };
}

function computeAggregates(measurements) {
  return {
    temperature: {
      meanC: average(measurements.temperatureMean),
      maxC: average(measurements.temperatureMax),
      minC: average(measurements.temperatureMin),
    },
    wind: {
      meanSpeedMs: average(measurements.windSpeed),
    },
    precipitation: {
      meanDailyMm: average(measurements.precipitation),
      totalMm: sum(measurements.precipitation),
    },
    humidity: {
      meanPct: average(measurements.humidity),
    },
    heatIndex: {
      meanC: average(measurements.heatIndex),
    },
  };
}

function computeProbabilities(records, customThresholds) {
  const thresholds = mergeThresholds(customThresholds);
  const totalRecords = records.length;
  const { probabilities, measurements } = evaluateConditions(records, thresholds);

  const aggregates = computeAggregates(measurements);

  return {
    thresholds,
    totalDays: totalRecords,
    probabilities,
    aggregates,
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  mergeThresholds,
  calculateHeatIndexCelsius,
  computeProbabilities,
};
