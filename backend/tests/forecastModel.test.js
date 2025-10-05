const test = require('node:test');
const assert = require('node:assert/strict');

const { completeForecastFromSnapshot } = require('../services/forecastModel');
const { mergeThresholds, computeProbabilitiesWithThresholds } = require('../utils/statistics');

function buildTrainingSnapshot() {
  const thresholds = mergeThresholds();
  const trainingRecords = [
    {
      date: '2023-07-03',
      T2M: 27,
      T2M_MAX: 34,
      T2M_MIN: 22,
      WS2M: 4,
      PRECTOTCORR: 1,
      RH2M: 65,
    },
    {
      date: '2023-07-04',
      T2M: 24,
      T2M_MAX: 29,
      T2M_MIN: 19,
      WS2M: 3,
      PRECTOTCORR: 0,
      RH2M: 55,
    },
  ];

  const trainingStats = computeProbabilitiesWithThresholds(trainingRecords, thresholds);

  return {
    thresholds,
    training: trainingStats,
  };
}

test('completeForecastFromSnapshot returns pending evaluation for future dates', async () => {
  const { thresholds, training } = buildTrainingSnapshot();
  const future = new Date();
  future.setUTCFullYear(future.getUTCFullYear() + 2);
  const futureDate = future.toISOString().slice(0, 10);

  const snapshot = {
    type: 'ForecastSnapshot',
    generatedAt: new Date().toISOString(),
    query: {
      latitude: 40.7128,
      longitude: -74.006,
      targetDate: futureDate,
      evaluationYear: future.getUTCFullYear(),
      trainingStartYear: 1984,
      trainingEndYear: future.getUTCFullYear() - 1,
      parameters: ['T2M', 'T2M_MAX', 'T2M_MIN', 'WS2M', 'PRECTOTCORR', 'RH2M'],
      community: 'RE',
      thresholds,
    },
    thresholds,
    training,
    metadata: {
      training: [],
    },
  };

  const result = await completeForecastFromSnapshot(snapshot, { skipExternalObservations: true });

  assert.equal(result.evaluation.pending, true);
  assert.equal(
    result.evaluation.reason,
    'Evaluation data is not yet available for the requested future date.',
  );
  assert.equal(result.evaluation.totalDays, 0);
  assert.equal(result.metadata.evaluationStatus.state, 'pending');
  assert.deepEqual(result.metadata.evaluation, []);

  const comparisonVeryHot = result.comparison.categories.veryHot;
  assert.equal(comparisonVeryHot.predictedProbability, 0.5);
  assert.equal(comparisonVeryHot.actualOutcome, null);
});
