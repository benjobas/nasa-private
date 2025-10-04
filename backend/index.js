const express = require('express');
const cors = require('cors');
const probabilitiesRouter = require('./routes/probabilities');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Will it rain on my parade? API',
  });
});

app.use('/api/probabilities', probabilitiesRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: 'Unexpected error while processing the request.',
    details: err.message,
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
