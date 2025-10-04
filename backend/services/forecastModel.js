const {
  fetchSeasonalDailyData,
  DEFAULT_PARAMETERS,
  DEFAULT_COMMUNITY,
} = require('./powerApi');
const { buildForecast } = require('../utils/forecast');

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
      : targetYear - 1;

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

async function generateForecast({
  latitude,
  longitude,
  targetDate,
  trainingStartYear,
  trainingEndYear,
  parameters,
  community,
  thresholds,
}) {
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

  const { trainingStartYear: resolvedStartYear, trainingEndYear: resolvedEndYear } =
    sanitizeTrainingYears(targetYear, trainingStartYear, trainingEndYear);

  const parameterList = normalizeParameters(parameters);
  const resolvedCommunity = community || DEFAULT_COMMUNITY;
  const monthDay = formatMonthDayFromDate(target);

  const [trainingData, evaluationData] = await Promise.all([
    fetchDataForRange({
      latitude,
      longitude,
      startMonthDay: monthDay,
      endMonthDay: monthDay,
      startYear: resolvedStartYear,
      endYear: resolvedEndYear,
      parameters: parameterList,
      community: resolvedCommunity,
    }),
    fetchDataForRange({
      latitude,
      longitude,
      startMonthDay: monthDay,
      endMonthDay: monthDay,
      startYear: targetYear,
      endYear: targetYear,
      parameters: parameterList,
      community: resolvedCommunity,
    }),
  ]);

  const trainingRecords = trainingData.records.filter((record) => record.seasonYear <= resolvedEndYear);
  const evaluationRecords = evaluationData.records.filter((record) => record.seasonYear === targetYear);

  if (!trainingRecords.length) {
    throw new Error('No historical records available for the requested training period.');
  }

  if (!evaluationRecords.length) {
    throw new Error('No evaluation records available for the requested target date.');
  }

  const forecast = buildForecast(trainingRecords, evaluationRecords, thresholds);

  return {
    query: {
      latitude,
      longitude,
      targetDate: target.toISOString().slice(0, 10),
      trainingStartYear: resolvedStartYear,
      trainingEndYear: resolvedEndYear,
      evaluationYear: targetYear,
      parameters: parameterList,
      community: resolvedCommunity,
      thresholds: forecast.thresholds,
    },
    training: forecast.training,
    evaluation: {
      year: targetYear,
      ...forecast.evaluation,
    },
    comparison: forecast.comparison,
    metadata: {
      training: trainingData.metadata,
      evaluation: evaluationData.metadata,
    },
  };
}

module.exports = {
  generateForecast,
  DEFAULT_MIN_TRAINING_YEAR,
};
