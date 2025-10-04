const express = require('express');
const { generateForecast, DEFAULT_MIN_TRAINING_YEAR } = require('../services/forecastModel');
const { DEFAULT_PARAMETERS, DEFAULT_COMMUNITY } = require('../services/powerApi');
const { DEFAULT_THRESHOLDS } = require('../utils/statistics');

const router = express.Router();

function validateRequestBody(body) {
  const errors = [];
  const {
    latitude,
    longitude,
    targetDate,
    trainingStartYear,
    trainingEndYear,
    thresholds,
    parameters,
    community,
  } = body;

  if (typeof latitude !== 'number' || Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
    errors.push('latitude must be a number between -90 and 90');
  }

  if (
    typeof longitude !== 'number' ||
    Number.isNaN(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    errors.push('longitude must be a number between -180 and 180');
  }

  if (!targetDate) {
    errors.push('targetDate is required (format: YYYY-MM-DD)');
  }

  if (
    trainingStartYear !== undefined &&
    trainingStartYear !== null &&
    !Number.isInteger(trainingStartYear)
  ) {
    errors.push('trainingStartYear must be an integer year when provided');
  }

  if (
    trainingEndYear !== undefined &&
    trainingEndYear !== null &&
    !Number.isInteger(trainingEndYear)
  ) {
    errors.push('trainingEndYear must be an integer year when provided');
  }

  if (
    Number.isInteger(trainingStartYear) &&
    Number.isInteger(trainingEndYear) &&
    trainingStartYear > trainingEndYear
  ) {
    errors.push('trainingStartYear cannot be greater than trainingEndYear');
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

router.post('/forecast', async (req, res, next) => {
  const errors = validateRequestBody(req.body || {});

  if (errors.length) {
    return res.status(400).json({ errors });
  }

  try {
    const forecast = await generateForecast(req.body);
    return res.json(forecast);
  } catch (error) {
    if (error && typeof error.message === 'string') {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.get('/defaults', (_req, res) => {
  res.json({
    parameters: DEFAULT_PARAMETERS,
    community: DEFAULT_COMMUNITY,
    thresholds: DEFAULT_THRESHOLDS,
    minimumTrainingYear: DEFAULT_MIN_TRAINING_YEAR,
  });
});

module.exports = router;
