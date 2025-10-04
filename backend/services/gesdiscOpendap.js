const fetch = require('node-fetch');

const IMERG_DATASET = {
  id: 'GPM_3IMERGDF.06',
  description: 'GPM IMERG Daily Precipitation (Final Run)',
  variable: 'precipitationCal',
  baseUrl: 'https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGDF.06',
  latitude: {
    min: -89.95,
    max: 89.95,
    step: 0.1,
    count: 1800,
  },
  longitude: {
    min: -179.95,
    max: 179.95,
    step: 0.1,
    count: 3600,
  },
  timeIndex: 0,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeDate(input) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error('A valid ISO date is required to query GESDISC OPeNDAP.');
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return { date, year, month, day };
}

function computeImergIndex(value, axis) {
  const clamped = clamp(value, axis.min, axis.max);
  const index = Math.round((clamped - axis.min) / axis.step);
  const safeIndex = clamp(index, 0, axis.count - 1);
  return safeIndex;
}

function computeImergIndices(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Latitude and longitude must be finite numbers.');
  }

  return {
    latIndex: computeImergIndex(latitude, IMERG_DATASET.latitude),
    lonIndex: computeImergIndex(longitude, IMERG_DATASET.longitude),
  };
}

function valueFromIndex(index, axis) {
  const safeIndex = clamp(index, 0, axis.count - 1);
  return axis.min + axis.step * safeIndex;
}

function buildImergFileName(year, month, day) {
  return `3B-DAY.MS.MRG.3IMERG.${year}${month}${day}-S000000-E235959.V06B.HDF5.nc4`;
}

function buildImergFileUrl(year, month, fileName) {
  return `${IMERG_DATASET.baseUrl}/${year}/${month}/${fileName}`;
}

function buildImergQueryUrl(year, month, day, latIndex, lonIndex) {
  const fileName = buildImergFileName(year, month, day);
  const base = buildImergFileUrl(year, month, fileName);
  return `${base}.ascii?${IMERG_DATASET.variable}[${IMERG_DATASET.timeIndex}:${IMERG_DATASET.timeIndex}][${latIndex}:${latIndex}][${lonIndex}:${lonIndex}]`;
}

function parseOpendapValue(payload) {
  if (!payload || typeof payload !== 'string') {
    throw new Error('Empty OPeNDAP response.');
  }

  const dataSectionIndex = payload.indexOf('Data:');
  const relevant = dataSectionIndex >= 0 ? payload.slice(dataSectionIndex) : payload;
  const matches = relevant.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);

  if (!matches || matches.length === 0) {
    throw new Error('No numeric values found in OPeNDAP response.');
  }

  const value = Number(matches[matches.length - 1]);

  if (!Number.isFinite(value)) {
    throw new Error('Failed to parse numeric value from OPeNDAP response.');
  }

  return value;
}

async function fetchWithToken(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/plain',
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('GESDISC token rejected by server.');
  }

  if (!response.ok) {
    throw new Error(`GESDISC request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchDailyPrecipitationFromImerg({ latitude, longitude, date, token = process.env.GESDISC_TOKEN }) {
  if (!token) {
    throw new Error('GESDISC token not configured. Set GESDISC_TOKEN in the environment.');
  }

  const { year, month, day } = normalizeDate(date);
  const { latIndex, lonIndex } = computeImergIndices(latitude, longitude);
  const queryUrl = buildImergQueryUrl(year, month, day, latIndex, lonIndex);
  const payload = await fetchWithToken(queryUrl, token);
  const precipitationMm = parseOpendapValue(payload);

  return {
    dataset: IMERG_DATASET.description,
    datasetId: IMERG_DATASET.id,
    variable: IMERG_DATASET.variable,
    precipitationMm,
    gridPoint: {
      latitude: valueFromIndex(latIndex, IMERG_DATASET.latitude),
      longitude: valueFromIndex(lonIndex, IMERG_DATASET.longitude),
    },
    indices: {
      latitude: latIndex,
      longitude: lonIndex,
    },
    sourceUrl: buildImergFileUrl(year, month, buildImergFileName(year, month, day)),
    queryUrl,
  };
}

module.exports = {
  IMERG_DATASET,
  computeImergIndices,
  buildImergFileName,
  buildImergFileUrl,
  buildImergQueryUrl,
  parseOpendapValue,
  fetchDailyPrecipitationFromImerg,
};
