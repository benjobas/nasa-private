const express = require('express');
const {
  fetchSeasonalDailyData,
  DEFAULT_PARAMETERS,
  DEFAULT_COMMUNITY,
} = require('../services/powerApi');
const { computeProbabilities, DEFAULT_THRESHOLDS } = require('../utils/statistics');

const router = express.Router();

function isValidMonthDay(value) {
  const padded = String(value).padStart(4, '0');
  if (!/^\d{4}$/.test(padded)) {
    return false;
  }

  const month = Number(padded.slice(0, 2));
  const day = Number(padded.slice(2));

  if (Number.isNaN(month) || Number.isNaN(day) || month < 1 || month > 12) {
    return false;
  }

  const daysInMonth = new Date(2000, month, 0).getDate();
  return day >= 1 && day <= daysInMonth;
}

function validateRequestBody(body) {
  const errors = [];
  const {
    latitude,
    longitude,
    startMonthDay,
    endMonthDay,
    startYear,
    endYear,
    thresholds,
    parameters,
    community,
  } = body;

  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
    errors.push('latitude must be a number between -90 and 90');
  }

  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
    errors.push('longitude must be a number between -180 and 180');
  }

  if (!isValidMonthDay(startMonthDay)) {
    errors.push('startMonthDay must be a string or number formatted as MMDD');
  }

  if (!isValidMonthDay(endMonthDay)) {
    errors.push('endMonthDay must be a string or number formatted as MMDD');
  }

  if (!Number.isInteger(startYear)) {
    errors.push('startYear must be an integer year (e.g., 2010)');
  }

  if (!Number.isInteger(endYear)) {
    errors.push('endYear must be an integer year (e.g., 2020)');
  }

  if (Number.isInteger(startYear) && Number.isInteger(endYear) && startYear > endYear) {
    errors.push('startYear cannot be greater than endYear');
  }

  if (thresholds && typeof thresholds !== 'object') {
    errors.push('thresholds must be an object if provided');
  }

  if (parameters && !Array.isArray(parameters) && typeof parameters !== 'string') {
    errors.push('parameters must be an array or a comma separated string');
  }

  if (community && typeof community !== 'string') {
    errors.push('community must be a string when provided');
  }

  return errors;
}

router.post('/', async (req, res, next) => {
  const errors = validateRequestBody(req.body || {});

  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const {
    latitude,
    longitude,
    startMonthDay,
    endMonthDay,
    startYear,
    endYear,
    thresholds,
    parameters,
    community,
  } = req.body;

  try {
    const { records, metadata } = await fetchSeasonalDailyData({
      latitude,
      longitude,
      startMonthDay,
      endMonthDay,
      startYear,
      endYear,
      parameters: parameters || DEFAULT_PARAMETERS,
      community: community || DEFAULT_COMMUNITY,
    });

    const stats = computeProbabilities(records, thresholds);

    return res.json({
      query: {
        latitude,
        longitude,
        startMonthDay: String(startMonthDay).padStart(4, '0'),
        endMonthDay: String(endMonthDay).padStart(4, '0'),
        startYear,
        endYear,
        parameters: parameters || DEFAULT_PARAMETERS,
        community: community || DEFAULT_COMMUNITY,
        thresholds: stats.thresholds,
      },
      results: stats,
      metadata,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/defaults', (_req, res) => {
  res.json({
    parameters: DEFAULT_PARAMETERS,
    community: DEFAULT_COMMUNITY,
    thresholds: DEFAULT_THRESHOLDS,
  });
});

module.exports = router;
