const {
  mergeThresholds,
  computeProbabilitiesWithThresholds,
} = require('./statistics');

function computeCategoryComparison(trainingStats, evaluationStats) {
  const categories = {};
  let brierSum = 0;
  let considered = 0;

  const categoryNames = Object.keys(trainingStats.probabilities || {});
  for (const category of categoryNames) {
    const trainingProbability = trainingStats.probabilities[category]?.probability ?? null;
    const evaluationInfo = evaluationStats.probabilities[category] || {};
    const actualOutcome =
      evaluationInfo.daysEvaluated && evaluationInfo.daysEvaluated > 0
        ? evaluationInfo.daysMatching / evaluationInfo.daysEvaluated
        : null;

    let brierScore = null;
    let absoluteError = null;

    if (trainingProbability !== null && actualOutcome !== null) {
      const diff = trainingProbability - actualOutcome;
      brierScore = diff * diff;
      absoluteError = Math.abs(diff);
      brierSum += brierScore;
      considered += 1;
    }

    categories[category] = {
      predictedProbability: trainingProbability,
      actualOutcome,
      absoluteError,
      brierScore,
      daysEvaluated: evaluationInfo.daysEvaluated ?? 0,
    };
  }

  return {
    categories,
    meanBrierScore: considered ? brierSum / considered : null,
  };
}

function buildForecast(trainingRecords, evaluationRecords, customThresholds) {
  const thresholds = mergeThresholds(customThresholds);
  const trainingStats = computeProbabilitiesWithThresholds(trainingRecords, thresholds);
  const evaluationStats = computeProbabilitiesWithThresholds(evaluationRecords, thresholds);
  const comparison = computeCategoryComparison(trainingStats, evaluationStats);

  return {
    thresholds,
    training: trainingStats,
    evaluation: evaluationStats,
    comparison,
  };
}

module.exports = {
  buildForecast,
  computeCategoryComparison,
};
