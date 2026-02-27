import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { apiMiddleware, errorHandler } from './middleware/api';
import authRouter from './routes/auth';
import agentsRouter from './routes/agents';
import simulationRouter from './routes/simulation';

const app = express();

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow same-origin and Vite dev server
app.use(
  cors({
    origin: [
      `http://localhost:${config.port}`,
      'http://localhost:5173', // Vite dev server
    ],
    credentials: true,
  }),
);

// Serve built frontend static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API request logging / tracing middleware on all /api routes
app.use('/api', apiMiddleware);

// Routes
app.use('/', authRouter);
app.use('/api', agentsRouter);
app.use('/api', simulationRouter);

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/auth') && req.path !== '/redirect') {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Global error handler (must be last)
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`\n🚀 GHL Voice AI Copilot running on http://localhost:${config.port}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(
    `   HL OAuth: ${config.hl.clientId ? '✓ configured' : '⚠ HL_CLIENT_ID not set'}`,
  );
  console.log(
    `   Anthropic: ${config.anthropic.apiKey ? '✓ configured' : '⚠ ANTHROPIC_API_KEY not set'}`,
  );
});

export default app;
