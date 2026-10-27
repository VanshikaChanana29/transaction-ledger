import './lib/zodConfig'; // must run before any schema is used
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { accountsRouter } from './modules/accounts/accounts.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false })); // CSP off: Swagger UI uses inline styles
  app.use(express.json({ limit: '100kb' }));

  // API docs
  const specPath = path.resolve(__dirname, '..', 'openapi.yaml'); // works from src/ (dev) and dist/ (prod)
  if (fs.existsSync(specPath)) {
    const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
    app.get('/api/openapi.json', (_req, res) => res.json(spec));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Transaction Ledger API' }));
  }

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ status: 'ok' }));
  api.use('/accounts', accountsRouter);
  api.use(notFoundHandler);
  app.use('/api', api);

  app.get('/', (_req, res) => res.redirect('/api/docs'));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
