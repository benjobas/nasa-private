const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IMERG_DATASET,
  computeImergIndices,
  buildImergFileName,
  buildImergFileUrl,
  buildImergQueryUrl,
  parseOpendapValue,
  fetchDailyPrecipitationFromImerg,
} = require('../services/gesdiscOpendap');

const FIXED_DATE = { year: '2020', month: '01', day: '15' };
const RUN_GESDISC_INTEGRATION = process.env.RUN_GESDISC_INTEGRATION === '1';

test('computeImergIndices clamps coordinates to grid limits', () => {
  const nearZero = computeImergIndices(0.04, -0.07);
  assert.equal(nearZero.latIndex, computeImergIndices(0, 0).latIndex);
  assert.equal(nearZero.lonIndex, computeImergIndices(0, 0).lonIndex);

  const pole = computeImergIndices(200, 400);
  assert.equal(pole.latIndex, IMERG_DATASET.latitude.count - 1);
  assert.equal(pole.lonIndex, IMERG_DATASET.longitude.count - 1);

  assert.throws(() => computeImergIndices(NaN, 0), /finite numbers/);
});

test('buildImergFileName and URLs preserve expected patterns', () => {
  const fileName = buildImergFileName(FIXED_DATE.year, FIXED_DATE.month, FIXED_DATE.day);
  assert.match(
    fileName,
    /^3B-DAY\.MS\.MRG\.3IMERG\.20200115-S000000-E235959\.V06B\.HDF5\.nc4$/,
  );

  const baseUrl = buildImergFileUrl(FIXED_DATE.year, FIXED_DATE.month, fileName);
  assert.equal(
    baseUrl,
    `${IMERG_DATASET.baseUrl}/${FIXED_DATE.year}/${fileName}`,
  );

  const { latIndex, lonIndex } = computeImergIndices(-10.2, 75.88);
  const queryUrl = buildImergQueryUrl(
    FIXED_DATE.year,
    FIXED_DATE.month,
    FIXED_DATE.day,
    latIndex,
    lonIndex,
  );

  assert.ok(queryUrl.includes('.ascii?precipitationCal[0:0]'));
  assert.ok(queryUrl.includes(`[${latIndex}:${latIndex}]`));
  assert.ok(queryUrl.includes(`[${lonIndex}:${lonIndex}]`));
});

test('parseOpendapValue extracts the last numeric value', () => {
  const payload = `Dataset {\n  Float32 precipitationCal[time = 1][lat = 2][lon = 2];\n} fake;\n---------------------------------------------\nData:\nprecipitationCal[0][1][1] = 1.2345\n`;
  const value = parseOpendapValue(payload);
  assert.equal(value, 1.2345);

  assert.throws(() => parseOpendapValue('no numbers here'), /numeric values/);
});

test(
  'fetchDailyPrecipitationFromImerg integrates with live endpoint',
  {
    skip: !RUN_GESDISC_INTEGRATION || !process.env.GESDISC_TOKEN,
    timeout: 30_000,
  },
  async (t) => {
    const result = await fetchDailyPrecipitationFromImerg({
      latitude: 0,
      longitude: 0,
      date: '2020-01-15',
    });

    assert.ok(result.precipitationMm === 0 || Number.isFinite(result.precipitationMm));
    assert.equal(result.datasetId, IMERG_DATASET.id);
    assert.equal(result.variable, IMERG_DATASET.variable);
    assert.match(result.sourceUrl, /\.nc4$/);
    assert.match(result.queryUrl, /precipitationCal/);

    t.diagnostic(`Sample precipitation: ${result.precipitationMm} mm`);
  },
);
