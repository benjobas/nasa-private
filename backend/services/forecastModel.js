const {
  fetchSeasonalDailyData,
  DEFAULT_PARAMETERS,
  DEFAULT_COMMUNITY,
} = require('./powerApi');
const { fetchDailyPrecipitationFromImerg } = require('./gesdiscOpendap');
const { mergeThresholds, computeProbabilitiesWithThresholds } = require('../utils/statistics');
const { computeCategoryComparison } = require('../utils/forecast');

const DEFAULT_MIN_TRAINING_YEAR = 1984;

function normalizeParameters(parameters) {
  if (!parameters) {
    return DEFAULT_PARAMETERS;
  }

  if (Array.isArray(parameters)) {
    return parameters;
  }

  if (typeof parameters === 'string') {
    return parameters
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  throw new Error('parameters must be an array or comma separated string');
}

function sanitizeTrainingYears(targetYear, trainingStartYear, trainingEndYear) {
  const resolvedEndYear =
    trainingEndYear !== undefined && trainingEndYear !== null
      ? Number(trainingEndYear)
      : Math.min(targetYear - 1, new Date().getUTCFullYear());

  const resolvedStartYear =
    trainingStartYear !== undefined && trainingStartYear !== null
      ? Number(trainingStartYear)
      : DEFAULT_MIN_TRAINING_YEAR;

  if (!Number.isInteger(resolvedStartYear) || !Number.isInteger(resolvedEndYear)) {
    throw new Error('trainingStartYear and trainingEndYear must be integer values when provided');
  }

  if (resolvedEndYear >= targetYear) {
    throw new Error('trainingEndYear must be earlier than the target year');
  }

  const normalizedStart = Math.max(DEFAULT_MIN_TRAINING_YEAR, resolvedStartYear);

  if (normalizedStart > resolvedEndYear) {
    throw new Error('trainingStartYear must be earlier than trainingEndYear');
  }

  return {
    trainingStartYear: normalizedStart,
    trainingEndYear: resolvedEndYear,
  };
}

function formatMonthDayFromDate(date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}${day}`;
}

function ensureDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('targetDate must be a valid ISO-8601 date string (YYYY-MM-DD)');
  }
  return date;
}

function isFutureDate(date) {
  return date.getTime() > Date.now();
}

async function fetchDataForRange({
  latitude,
  longitude,
  startMonthDay,
  endMonthDay,
  startYear,
  endYear,
  parameters,
  community,
}) {
  const { records, metadata } = await fetchSeasonalDailyData({
    latitude,
    longitude,
    startMonthDay,
    endMonthDay,
    startYear,
    endYear,
    parameters,
    community,
  });

  return { records, metadata };
}

async function gatherExternalObservations({ latitude, longitude, targetDate }) {
  const observations = [];

  try {
    const imerg = await fetchDailyPrecipitationFromImerg({
      latitude,
      longitude,
      date: targetDate,
    });

    observations.push({
      type: 'precipitation',
      dataset: imerg.dataset,
      datasetId: imerg.datasetId,
      variable: imerg.variable,
      precipitationMm: imerg.precipitationMm,
      gridPoint: imerg.gridPoint,
      indices: imerg.indices,
      sourceUrl: imerg.sourceUrl,
      queryUrl: imerg.queryUrl,
    });
  } catch (error) {
    observations.push({
      type: 'precipitation',
      dataset: 'GPM IMERG Daily Precipitation (GPM_3IMERGDF.06)',
      error: error && error.message ? error.message : 'Unknown error while querying GESDISC',
    });
  }

  return observations;
}
function normalizeForecastOptions(options = {}) {
  const {
    latitude,
    longitude,
    targetDate,
    trainingStartYear,
    trainingEndYear,
    parameters,
    community,
    thresholds,
  } = options;

  if (typeof latitude !== 'number' || Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('latitude must be a number between -90 and 90');
  }

  if (
    typeof longitude !== 'number' ||
    Number.isNaN(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('longitude must be a number between -180 and 180');
  }

  if (!targetDate) {
    throw new Error('targetDate is required');
  }

  const target = ensureDate(targetDate);
  const targetYear = target.getUTCFullYear();

  if (targetYear <= DEFAULT_MIN_TRAINING_YEAR) {
    throw new Error('targetDate must be after the minimum training year');
  }

  // Permitir fechas futuras: si targetYear está en el futuro (más allá del año actual),
  // ajustamos endYear máximo al año actual para no pedir datos inexistentes a POWER.
  // Nota: effectiveTargetYear reservado si se requiere lógica adicional futura para limitar predicciones.

  const { trainingStartYear: resolvedStartYear, trainingEndYear: resolvedEndYear } =
    sanitizeTrainingYears(targetYear, trainingStartYear, trainingEndYear);

  const parameterList = normalizeParameters(parameters);
  const resolvedCommunity = community || DEFAULT_COMMUNITY;
  const resolvedThresholds = mergeThresholds(thresholds);
  const monthDay = formatMonthDayFromDate(target);

  return {
    latitude,
    longitude,
    targetDate: target.toISOString().slice(0, 10),
  targetYear: targetYear,
    resolvedStartYear,
    resolvedEndYear,
    parameterList,
    resolvedCommunity,
    resolvedThresholds,
    monthDay,
  };
}

async function generateForecastSnapshot(options = {}) {
  const {
    latitude,
    longitude,
    targetDate,
    targetYear,
    resolvedStartYear,
    resolvedEndYear,
    parameterList,
    resolvedCommunity,
    resolvedThresholds,
    monthDay,
  } = normalizeForecastOptions(options);

  const trainingData = await fetchDataForRange({
    latitude,
    longitude,
    startMonthDay: monthDay,
    endMonthDay: monthDay,
    startYear: resolvedStartYear,
    endYear: resolvedEndYear,
    parameters: parameterList,
    community: resolvedCommunity,
  });

  const trainingRecords = trainingData.records.filter(
    (record) => record.seasonYear <= resolvedEndYear,
  );

  if (!trainingRecords.length) {
    throw new Error('No historical records available for the requested training period.');
  }

  const trainingStats = computeProbabilitiesWithThresholds(trainingRecords, resolvedThresholds);

  return {
    type: 'ForecastSnapshot',
    generatedAt: new Date().toISOString(),
    query: {
      latitude,
      longitude,
      targetDate,
      evaluationYear: targetYear,
      trainingStartYear: resolvedStartYear,
      trainingEndYear: resolvedEndYear,
      parameters: parameterList,
      community: resolvedCommunity,
      thresholds: resolvedThresholds,
    },
    thresholds: resolvedThresholds,
    training: {
      totalDays: trainingStats.totalDays,
      probabilities: trainingStats.probabilities,
      aggregates: trainingStats.aggregates,
    },
    metadata: {
      training: trainingData.metadata,
    },
  };
}

function assertValidSnapshot(snapshot) {
  if (!snapshot || snapshot.type !== 'ForecastSnapshot') {
    throw new Error('A forecast snapshot produced by generateForecastSnapshot is required.');
  }

  if (!snapshot.query || !snapshot.thresholds || !snapshot.training) {
    throw new Error('Forecast snapshot is missing required fields.');
  }
}

async function completeForecastFromSnapshot(snapshot, { skipExternalObservations = false } = {}) {
  assertValidSnapshot(snapshot);

  const { query, thresholds, training } = snapshot;
  const { latitude, longitude, targetDate, evaluationYear, parameters, community } = query;

  const target = ensureDate(targetDate);
  const monthDay = formatMonthDayFromDate(target);
  const parameterList = normalizeParameters(parameters);
  const resolvedCommunity = community || DEFAULT_COMMUNITY;

  const targetIsFuture = isFutureDate(target);
  let evaluationRecords = [];
  let evaluationMetadata = [];

  if (!targetIsFuture) {
    const evaluationData = await fetchDataForRange({
      latitude,
      longitude,
      startMonthDay: monthDay,
      endMonthDay: monthDay,
      startYear: evaluationYear,
      endYear: evaluationYear,
      parameters: parameterList,
      community: resolvedCommunity,
    });

    evaluationRecords = evaluationData.records.filter(
      (record) => record.seasonYear === evaluationYear,
    );
    evaluationMetadata = evaluationData.metadata;

    if (!evaluationRecords.length) {
      throw new Error('No evaluation records available for the requested target date.');
    }
  }

  const evaluationStats = computeProbabilitiesWithThresholds(evaluationRecords, thresholds);
  const comparison = computeCategoryComparison(training, evaluationStats);

  const externalObservations = skipExternalObservations
    ? []
    : await gatherExternalObservations({ latitude, longitude, targetDate });

  const evaluation = {
    year: evaluationYear,
    ...evaluationStats,
  };

  if (targetIsFuture) {
    evaluation.pending = true;
    evaluation.reason = 'Evaluation data is not yet available for the requested future date.';
  }

  const metadata = {
    training: snapshot.metadata?.training ?? null,
    evaluation: targetIsFuture ? [] : evaluationMetadata,
  };

  if (targetIsFuture) {
    metadata.evaluationStatus = {
      state: 'pending',
      reason: 'Awaiting NASA POWER observations for the evaluation year.',
    };
  }

  return {
    snapshotGeneratedAt: snapshot.generatedAt,
    completedAt: new Date().toISOString(),
    query,
    thresholds,
    training,
    evaluation,
    comparison,
    externalObservations,
    metadata,
  };
}

async function generateForecast(options = {}) {
  const snapshot = await generateForecastSnapshot(options);
  return completeForecastFromSnapshot(snapshot, {
    skipExternalObservations: Boolean(options.skipExternalObservations),
  });
}

module.exports = {
  generateForecast,
  generateForecastSnapshot,
  completeForecastFromSnapshot,
  DEFAULT_MIN_TRAINING_YEAR,
};
