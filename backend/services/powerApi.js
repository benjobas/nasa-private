const fetch = require('node-fetch');

const BASE_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const DEFAULT_PARAMETERS = ['T2M', 'T2M_MAX', 'T2M_MIN', 'WS2M', 'PRECTOTCORR', 'RH2M'];
const DEFAULT_COMMUNITY = 'RE';

function buildQuery(params) {
  const query = new URLSearchParams(params);
  return `${BASE_URL}?${query.toString()}`;
}

function transformParameterResponse(parameterResponse) {
  const parameterEntries = Object.entries(parameterResponse);
  if (parameterEntries.length === 0) {
    return [];
  }

  const dates = Object.keys(parameterEntries[0][1]);
  return dates.map((date) => {
    const record = { date };
    for (const [parameter, values] of parameterEntries) {
      if (Object.prototype.hasOwnProperty.call(values, date)) {
        record[parameter] = values[date];
      }
    }

    return record;
  });
}

async function fetchDailyData({
  latitude,
  longitude,
  start,
  end,
  parameters = DEFAULT_PARAMETERS,
  community = DEFAULT_COMMUNITY,
  retries = 2,
  retryDelayMs = 500,
} = {}) {
  if (latitude === undefined || longitude === undefined) {
    throw new Error('Latitude and longitude are required to query NASA POWER API.');
  }

  if (!start || !end) {
    throw new Error('Start and end dates (YYYYMMDD) are required to query NASA POWER API.');
  }

  const params = {
    latitude,
    longitude,
    start,
    end,
    community,
    parameters: Array.isArray(parameters) ? parameters.join(',') : parameters,
    format: 'JSON',
  };

  const url = buildQuery(params);

  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`NASA POWER API error: ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      const { properties } = payload;

      if (!properties || !properties.parameter) {
        return { records: [], metadata: payload }; // Unexpected but prevent crashes
      }

      const records = transformParameterResponse(properties.parameter);
      return { records, metadata: payload };
    } catch (error) {
      if (attempt >= retries) {
        if (error.type === 'system') {
          const enriched = new Error(
            `Failed to reach NASA POWER API: ${error.code || error.errno || error.message}`,
          );
          enriched.cause = error;
          throw enriched;
        }

        const enriched = new Error(`Failed to fetch NASA POWER data: ${error.message}`);
        enriched.cause = error;
        throw enriched;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
}

async function fetchSeasonalDailyData({
  latitude,
  longitude,
  startMonthDay,
  endMonthDay,
  startYear,
  endYear,
  parameters,
  community,
}) {
  if (!startMonthDay || !endMonthDay) {
    throw new Error('startMonthDay and endMonthDay are required (format: MMDD).');
  }

  if (!startYear || !endYear) {
    throw new Error('startYear and endYear are required.');
  }

  if (startYear > endYear) {
    throw new Error('startYear cannot be after endYear.');
  }

  const sanitizedStart = startMonthDay.toString().padStart(4, '0');
  const sanitizedEnd = endMonthDay.toString().padStart(4, '0');
  const crossesYearBoundary = sanitizedStart > sanitizedEnd;

  const allRecords = [];
  const metadataSamples = [];

  for (let seasonYear = startYear; seasonYear <= endYear; seasonYear += 1) {
    const ranges = [];

    if (!crossesYearBoundary) {
      ranges.push({
        start: `${seasonYear}${sanitizedStart}`,
        end: `${seasonYear}${sanitizedEnd}`,
        seasonYear,
      });
    } else {
      ranges.push({
        start: `${seasonYear}${sanitizedStart}`,
        end: `${seasonYear}1231`,
        seasonYear,
      });

      const nextYear = seasonYear + 1;
      ranges.push({
        start: `${nextYear}0101`,
        end: `${nextYear}${sanitizedEnd}`,
        seasonYear,
      });
    }

    for (const range of ranges) {
      const { records, metadata } = await fetchDailyData({
        latitude,
        longitude,
        start: range.start,
        end: range.end,
        parameters,
        community,
      });

      metadataSamples.push(metadata);

      for (const record of records) {
        allRecords.push({
          ...record,
          seasonYear,
        });
      }
    }
  }

  return {
    records: allRecords,
    metadata: metadataSamples,
  };
}

module.exports = {
  fetchDailyData,
  fetchSeasonalDailyData,
  DEFAULT_PARAMETERS,
  DEFAULT_COMMUNITY,
};
