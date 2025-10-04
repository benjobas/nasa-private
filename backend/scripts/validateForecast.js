#!/usr/bin/env node

const { generateForecast } = require('../services/forecastModel');

const SAMPLE_LOCATIONS = [
  { name: 'New York', latitude: 40.7128, longitude: -74.006 },
  { name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437 },
  { name: 'Chicago', latitude: 41.8781, longitude: -87.6298 },
  { name: 'Houston', latitude: 29.7604, longitude: -95.3698 },
  { name: 'Phoenix', latitude: 33.4484, longitude: -112.074 },
  { name: 'London', latitude: 51.5074, longitude: -0.1278 },
  { name: 'Paris', latitude: 48.8566, longitude: 2.3522 },
  { name: 'Berlin', latitude: 52.52, longitude: 13.405 },
  { name: 'Tokyo', latitude: 35.6895, longitude: 139.6917 },
  { name: 'San Francisco', latitude: 37.7749, longitude: -122.4194 },
  { name: 'Sydney', latitude: -33.8688, longitude: 151.2093 },
  { name: 'Melbourne', latitude: -37.8136, longitude: 144.9631 },
  { name: 'São Paulo', latitude: -23.5505, longitude: -46.6333 },
  { name: 'Buenos Aires', latitude: -34.6037, longitude: -58.3816 },
  { name: 'Mexico City', latitude: 19.4326, longitude: -99.1332 },
  { name: 'Moscow', latitude: 55.7558, longitude: 37.6173 },
  { name: 'Delhi', latitude: 28.6139, longitude: 77.209 },
  { name: 'Singapore', latitude: 1.3521, longitude: 103.8198 },
  { name: 'Shanghai', latitude: 31.2304, longitude: 121.4737 },
  { name: 'Dubai', latitude: 25.2048, longitude: 55.2708 },
];

function randomFromArray(array, random) {
  const index = Math.floor(random() * array.length);
  return array[index];
}

function createPseudoRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) {
    value += 2147483646;
  }
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function randomDateInYear(random, year) {
  const start = Date.UTC(year, 0, 1);
  const dayOffset = Math.floor(random() * 365);
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date;
}

async function main() {
  const sampleSize = Number(process.env.SAMPLE_SIZE || 200);
  const seed = Number(process.env.RANDOM_SEED || 123456789);
  const random = createPseudoRandom(seed);

  const results = [];
  let successes = 0;
  let failures = 0;
  let networkFailures = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const location = randomFromArray(SAMPLE_LOCATIONS, random);
    const jitterLat = (random() - 0.5) * 1.2; // ±0.6°
    const jitterLon = (random() - 0.5) * 1.2;
    const latitude = Math.max(-89.9, Math.min(89.9, location.latitude + jitterLat));
    const longitude = Math.max(-179.9, Math.min(179.9, location.longitude + jitterLon));
    const year = 2020 + Math.floor(random() * 3); // 2020-2022 inclusive
    const targetDate = randomDateInYear(random, year).toISOString().slice(0, 10);

    try {
      const forecast = await generateForecast({ latitude, longitude, targetDate });
      const { meanBrierScore } = forecast.comparison;
      const validCategoryCount = Object.values(forecast.comparison.categories).filter(
        (category) => category.actualOutcome !== null && category.predictedProbability !== null,
      ).length;

      successes += 1;
      results.push({
        latitude,
        longitude,
        targetDate,
        meanBrierScore,
        validCategoryCount,
      });
    } catch (error) {
      failures += 1;
      const message = error && error.message ? error.message : String(error);
      if (message.includes('Failed to reach NASA POWER API')) {
        networkFailures += 1;
      }

      console.error(
        `Failed forecast for sample ${index + 1}/${sampleSize} (${latitude.toFixed(2)}, ${longitude.toFixed(
          2,
        )}) on ${targetDate}: ${message}`,
      );
    }
  }

  const brierScores = results
    .map((result) => result.meanBrierScore)
    .filter((score) => typeof score === 'number' && Number.isFinite(score));
  const averageBrier =
    brierScores.length > 0 ? brierScores.reduce((acc, score) => acc + score, 0) / brierScores.length : null;

  console.log('Forecast validation summary');
  console.log('===========================');
  console.log(`Total samples: ${sampleSize}`);
  console.log(`Successful forecasts: ${successes}`);
  console.log(`Failed forecasts: ${failures}`);
  if (averageBrier !== null) {
    console.log(`Average mean Brier score: ${averageBrier.toFixed(4)}`);
  } else {
    console.log('Average mean Brier score: unavailable');
  }

  if (successes === 0) {
    if (networkFailures === sampleSize) {
      console.warn('All forecasts failed due to network connectivity issues. Skipping validation.');
      return;
    }

    console.error('No successful forecasts were generated.');
    process.exit(1);
  }

  if (successes < sampleSize * 0.5) {
    console.error('Less than half of the forecasts succeeded; investigation required.');
    process.exit(1);
  }

  console.log('Validation completed successfully.');
}

main().catch((error) => {
  console.error('Unexpected error while validating forecasts:', error);
  process.exit(1);
});
