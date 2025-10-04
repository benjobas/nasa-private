#!/usr/bin/env node

const { generateForecastSnapshot, completeForecastFromSnapshot } = require('../services/forecastModel');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

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

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);

  return parts.join(' ');
}

function hashSnapshotProbabilities(probabilities) {
  const snapshotString = Object.entries(probabilities || {})
    .map(([category, info]) => `${category}:${info && info.probability !== undefined ? info.probability : ''}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(snapshotString).digest('hex');
}

function hashComparisonProbabilities(categories) {
  const comparisonString = Object.entries(categories || {})
    .map(
      ([category, info]) =>
        `${category}:${
          info && info.predictedProbability !== undefined ? info.predictedProbability : ''
        }`,
    )
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(comparisonString).digest('hex');
}

function aggregateGlobalBrier(categoryRows) {
  // categoryRows: [{p, o}]
  if (!categoryRows.length) return null;
  const sum = categoryRows.reduce((a, r) => a + (r.p - r.o) * (r.p - r.o), 0);
  return sum / categoryRows.length;
}

function bootstrapBrier(categoryRows, iterations = 500, random = Math.random) {
  if (categoryRows.length === 0) return null;
  const n = categoryRows.length;
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    let s = 0;
    for (let k = 0; k < n; k += 1) {
      const r = categoryRows[Math.floor(random() * n)];
      s += (r.p - r.o) * (r.p - r.o);
    }
    samples.push(s / n);
  }
  samples.sort((a, b) => a - b);
  return {
    mean: samples.reduce((a, v) => a + v, 0) / samples.length,
    p05: samples[Math.floor(0.05 * samples.length)],
    p95: samples[Math.floor(0.95 * samples.length)],
  };
}

async function main() {
  const sampleSize = Number(process.env.SAMPLE_SIZE || 10);
  const seed = Number(process.env.RANDOM_SEED || 123456789);
  const progressInterval = Number(process.env.PROGRESS_INTERVAL || 1);
  const random = createPseudoRandom(seed);

  const results = [];
  const categoryLevelRows = []; // Para Brier global y bootstrap
  let successes = 0;
  let failures = 0;
  let networkFailures = 0;
  let externalSuccesses = 0;
  let externalFailures = 0;
  const startedAt = Date.now();

  // Cabecera CSV auditoría detallada
  const auditCsv = [];
  auditCsv.push([
    'sampleIndex',
    'targetDate',
    'lat',
    'lon',
    'category',
    'predictedProbability',
    'actualOutcome',
    'hashSnapshot',
    'hashVerified',
    'predictionGeneratedAt',
    'verificationCompletedAt',
  ].join(','));

  for (let index = 0; index < sampleSize; index += 1) {
    const location = randomFromArray(SAMPLE_LOCATIONS, random);
    const jitterLat = (random() - 0.5) * 1.2;
    const jitterLon = (random() - 0.5) * 1.2;
    const latitude = Math.max(-89.9, Math.min(89.9, location.latitude + jitterLat));
    const longitude = Math.max(-179.9, Math.min(179.9, location.longitude + jitterLon));
    const year = 2020 + Math.floor(random() * 3);
    const targetDate = randomDateInYear(random, year).toISOString().slice(0, 10);

    try {
      const snapshot = await generateForecastSnapshot({ latitude, longitude, targetDate });
      const snapshotHash = hashSnapshotProbabilities(snapshot.training.probabilities);

      const forecast = await completeForecastFromSnapshot(snapshot);
      const { meanBrierScore, categories } = forecast.comparison;
      const verifiedHash = hashComparisonProbabilities(categories);

      if (snapshotHash !== verifiedHash) {
        console.warn(
          `Advertencia: discrepancia entre hash de snapshot y verificación para la muestra ${index + 1}.`,
        );
      }

      // Auditoría categoría por categoría
      for (const [cat, info] of Object.entries(categories)) {
        const p = (info.predictedProbability ?? null);
        const o = (info.actualOutcome ?? null);
        if (p !== null && o !== null) {
          categoryLevelRows.push({ p, o });
        }
        auditCsv.push([
          index,
            targetDate,
            latitude.toFixed(4),
            longitude.toFixed(4),
            cat,
            p === null ? '' : p,
            o === null ? '' : o,
            snapshotHash,
            verifiedHash,
            snapshot.generatedAt,
            forecast.completedAt,
        ].join(','));
      }

      const validCategoryCount = Object.values(categories).filter(
        (c) => c.actualOutcome !== null && c.predictedProbability !== null,
      ).length;

      const imergObservation = (forecast.externalObservations || []).find(
        (observation) => observation.datasetId === 'GPM_3IMERGDF.06',
      );
      if (imergObservation) {
        if (imergObservation.error) externalFailures += 1;
        else externalSuccesses += 1;
      }

      successes += 1;
      results.push({
        latitude,
        longitude,
        targetDate,
        meanBrierScore,
        validCategoryCount,
        predictionGeneratedAt: snapshot.generatedAt,
        verificationCompletedAt: forecast.completedAt,
      });
    } catch (error) {
      failures += 1;
      const message = (error && error.message) ? error.message : String(error);
      if (message.includes('Failed to reach NASA POWER API')) networkFailures += 1;
      console.error(
        `Failed forecast sample ${index + 1}/${sampleSize} (${latitude.toFixed(2)}, ${longitude.toFixed(
          2,
        )}) ${targetDate}: ${message}`,
      );
    }

    const shouldReportProgress =
      progressInterval > 0 && ((index + 1) % progressInterval === 0 || index === sampleSize - 1);
    if (shouldReportProgress) {
      const completed = index + 1;
      const elapsedMs = Date.now() - startedAt;
      const avgPerSample = elapsedMs / completed;
      const remaining = sampleSize - completed;
      const etaMs = remaining * avgPerSample;
      const percent = ((completed / sampleSize) * 100).toFixed(1);
      console.log(`Progreso: ${completed}/${sampleSize} (${percent}%) · Tiempo: ${formatDuration(elapsedMs)} · ETA: ${formatDuration(etaMs)}`);
    }
  }

  // Brier medio (promedio simple de meanBrierScore existente)
  const brierScores = results
    .map(r => r.meanBrierScore)
    .filter(v => typeof v === 'number' && Number.isFinite(v));
  const averageBrier = brierScores.length
    ? brierScores.reduce((a, b) => a + b, 0) / brierScores.length
    : null;

  // Brier global (todas las categorías juntas)
  const globalBrier = aggregateGlobalBrier(categoryLevelRows);

  // Bootstrap (IC)
  const bootstrapStats = categoryLevelRows.length >= 20
    ? bootstrapBrier(categoryLevelRows, 400, createPseudoRandom(seed + 999))
    : null;

  if (successes === 0) {
    if (networkFailures === sampleSize) {
      console.warn('Todos fallaron por red. Abortando.');
      return;
    }
    console.error('Sin pronósticos exitosos.');
    process.exit(1);
  }
  if (successes < sampleSize * 0.5) {
    console.error('Menos del 50% de éxitos; revisar.');
    process.exit(1);
  }

  const totalDuration = Date.now() - startedAt;
  const validationStatus = successes >= sampleSize * 0.5 ? 'VALIDO' : 'NO VALIDO';

  // Guardar informes
  const reportDir = path.resolve(__dirname, '../reports');
  await fs.mkdir(reportDir, { recursive: true });

  // CSV auditoría
  const auditPath = path.join(reportDir, 'forecast-validation-audit.csv');
  await fs.writeFile(auditPath, auditCsv.join('\n'), 'utf8');

  // Reporte TXT
  const reportLines = [
    `Estado de validación: ${validationStatus}`,
    `Fecha: ${new Date().toISOString()}`,
    `Tamaño de la muestra: ${sampleSize}`,
    `Predicciones exitosas: ${successes}`,
    `Predicciones fallidas: ${failures}`,
    averageBrier !== null ? `Brier medio (promedio de meanBrier): ${averageBrier.toFixed(4)}` : 'Brier medio: no disponible',
    globalBrier !== null ? `Brier global (todas categorías): ${globalBrier.toFixed(4)}` : 'Brier global: no disponible',
    bootstrapStats ? `IC Bootstrap Brier global (p05–p95): ${bootstrapStats.p05.toFixed(4)} – ${bootstrapStats.p95.toFixed(4)}` : 'IC Bootstrap: muestra insuficiente (<20 filas categoría)',
    `Filas categoría (para Brier global): ${categoryLevelRows.length}`,
    `Observaciones externas exitosas: ${externalSuccesses}`,
    `Observaciones externas fallidas: ${externalFailures}`,
    `Duración total: ${formatDuration(totalDuration)}`,
    `Archivo auditoría: ${auditPath}`,
  ];
  const reportContent = `${reportLines.join('\n')}\n`;
  const reportPath = path.join(reportDir, 'forecast-validation-report.txt');
  await fs.writeFile(reportPath, reportContent, 'utf8');

  console.log('Resumen validación');
  console.log('==================');
  reportLines.forEach(l => console.log(l));
  console.log('Validación completada.');
}

main().catch(err => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
