import { createLimiter, type Limiter } from './rateLimit';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DesignContext } from '../src/engine/types';
import { buildSystemPrompt, type AssistantMode } from './prompt';
import {
  geminiAdapter,
  type ChatMessage,
  type LLMAdapter,
} from './llm/adapter';

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_CONTEXT_LENGTH = 2_000;
const DEFAULT_GLOBAL_LIMIT = 300;
const DEFAULT_RATE_LIMIT = 20;
const DEFAULT_RATE_WINDOW_MS = 60_000;

export interface ServerOptions {
  adapter?: LLMAdapter;
  apiKey?: string;
  model?: string;
  provider?: string;
  /** Allowed browser origin(s): a single origin or a comma-separated list. Same-origin requests are always allowed. */
  clientOrigin?: string;
  rateLimit?: number;
  rateWindowMs?: number;
  /** Ceiling for all callers combined per window, so one warm instance bounds spend. */
  globalLimit?: number;
  limiter?: Limiter;
}

interface ChatRequestBody {
  messages: ChatMessage[];
  context: DesignContext;
  mode: AssistantMode;
}

function loadServerEnv(): Record<string, string> {
  const envPath = resolve(process.cwd(), 'server', '.env');
  let contents: string;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw error;
  }
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) values[key] = value;
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateContext(value: unknown): DesignContext {
  if (!isRecord(value) || typeof value.page !== 'string') {
    throw new Error('Context must be an object with a page name.');
  }
  const context = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const keep = (record: Record<string, unknown>, keys: string[]) => {
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) delete record[key];
    }
  };
  context.page = value.page.slice(0, 120);
  keep(context, ['page', 'function', 'minimization', 'circuit', 'sequential', 'timing', 'cost', 'power', 'faults']);
  const functionData = isRecord(context.function) ? context.function : undefined;
  if (functionData) keep(functionData, ['vars', 'minterms', 'maxterms', 'dontCares', 'expr']);
  const minimization = isRecord(context.minimization) ? context.minimization : undefined;
  if (minimization) {
    keep(minimization, ['form', 'text', 'termCount', 'literalCount', 'steps']);
    delete minimization.steps;
    if (typeof minimization.text === 'string') minimization.text = minimization.text.slice(0, 200);
  }
  const circuit = isRecord(context.circuit) ? context.circuit : undefined;
  if (circuit) keep(circuit, ['name', 'gates', 'levels', 'netlistSummary']);
  const cost = isRecord(context.cost) ? context.cost : undefined;
  if (cost) keep(cost, ['ics', 'totalICs', 'totalPins', 'totalCost', 'notes']);
  const power = isRecord(context.power) ? context.power : undefined;
  if (power) keep(power, ['staticW', 'dynamicW', 'totalW', 'transistors', 'perNet', 'assumptions']);
  const faults = isRecord(context.faults) ? context.faults : undefined;
  if (faults) keep(faults, ['total', 'detected', 'undetected', 'coverage', 'minimalTestSet', 'table']);
  const sequential = isRecord(context.sequential) ? context.sequential : undefined;
  if (sequential) {
    keep(sequential, ['ffType', 'stateTable', 'equations', 'stateSequence']);
    if (isRecord(sequential.stateTable)) {
      keep(sequential.stateTable, ['model', 'inputs', 'outputs', 'states', 'reset', 'rows']);
      sequential.stateTable.rows = Array.isArray(sequential.stateTable.rows)
        ? sequential.stateTable.rows.slice(0, 8).map((row) => {
          if (!isRecord(row)) return {};
          keep(row, ['state', 'input', 'next', 'output']);
          for (const key of ['state', 'input', 'next', 'output']) {
            if (typeof row[key] === 'string') row[key] = row[key].slice(0, 32);
          }
          return row;
        })
        : [];
    }
    for (const key of ['inputs', 'outputs', 'states']) {
      if (isRecord(sequential.stateTable) && Array.isArray(sequential.stateTable[key])) {
        sequential.stateTable[key] = sequential.stateTable[key].slice(0, 8);
      }
    }
    for (const key of ['equations', 'stateSequence']) {
      if (Array.isArray(sequential[key])) {
        sequential[key] = sequential[key].slice(0, 8).map((entry) =>
          typeof entry === 'string' ? entry.slice(0, 200) : entry
        );
      }
    }
  }
  const timing = isRecord(context.timing) ? context.timing : undefined;
  if (timing) {
    keep(timing, ['events']);
    timing.events = Array.isArray(timing.events) ? timing.events.slice(-10).map((event) => {
      if (!isRecord(event)) return {};
      keep(event, ['t', 'label']);
      if (typeof event.label === 'string') event.label = event.label.slice(0, 100);
      return event;
    }) : [];
  }
  if (circuit && typeof circuit.netlistSummary === 'string') {
    circuit.netlistSummary = circuit.netlistSummary.slice(0, 300);
  }
  if (functionData) {
    for (const key of ['vars', 'minterms', 'maxterms', 'dontCares']) {
      if (Array.isArray(functionData[key])) {
        functionData[key] = functionData[key].slice(0, 32).map((entry) =>
          typeof entry === 'string' ? entry.slice(0, 32) : entry
        );
      }
    }
    if (typeof functionData.expr === 'string') functionData.expr = functionData.expr.slice(0, 200);
  }
  if (cost) {
    if (Array.isArray(cost.ics)) cost.ics = cost.ics.slice(0, 8).map((entry) => {
      if (!isRecord(entry)) return {};
      keep(entry, ['part', 'count', 'unusedGates', 'unitPrice', 'subtotal']);
      return entry;
    });
    if (Array.isArray(cost.notes)) cost.notes = cost.notes.slice(0, 5).map((note) =>
      typeof note === 'string' ? note.slice(0, 200) : note
    );
  }
  if (power) {
    if (Array.isArray(power.perNet)) power.perNet = power.perNet.slice(0, 8).map((entry) => {
      if (!isRecord(entry)) return {};
      keep(entry, ['net', 'alpha', 'capF', 'dynW']);
      return entry;
    });
    if (isRecord(power.assumptions)) keep(power.assumptions, ['vcc', 'freqHz', 'defaultCapF']);
  }
  if (faults) {
    if (Array.isArray(faults.undetected)) faults.undetected = faults.undetected.slice(0, 8);
    if (Array.isArray(faults.minimalTestSet)) faults.minimalTestSet = faults.minimalTestSet.slice(0, 8);
    if (Array.isArray(faults.table)) faults.table = faults.table.slice(0, 12).map((entry) => {
      if (!isRecord(entry)) return {};
      keep(entry, ['net', 'stuckAt', 'detectedBy']);
      if (Array.isArray(entry.detectedBy)) entry.detectedBy = entry.detectedBy.slice(0, 16);
      return entry;
    });
  }
  const shrinkSections = ['timing', 'faults', 'cost', 'power', 'sequential', 'minimization', 'circuit', 'function'];
  for (const section of shrinkSections) {
    if (JSON.stringify(context).length <= MAX_CONTEXT_LENGTH) break;
    delete context[section];
  }
  const json = JSON.stringify(context);
  if (json.length > MAX_CONTEXT_LENGTH) {
    throw new Error(`Context must be no larger than ${MAX_CONTEXT_LENGTH} characters after trimming.`);
  }
  return context as unknown as DesignContext;
}

function validateBody(value: unknown): ChatRequestBody | null {
  if (!isRecord(value) || !Array.isArray(value.messages) || !isRecord(value.context)) return null;
  if (value.mode !== 'explain' && value.mode !== 'hint') return null;
  if (typeof value.context.page !== 'string') return null;
  if (value.messages.length === 0 || value.messages.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  for (const message of value.messages) {
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' || message.content.length > MAX_MESSAGE_LENGTH) {
      return null;
    }
    messages.push({ role: message.role, content: message.content });
  }
  try {
    return {
      messages,
      context: truncateContext(value.context),
      mode: value.mode,
    };
  } catch {
    return null;
  }
}

export function createApp(options: ServerOptions = {}) {
  const app = express();
  const adapter = options.adapter ?? geminiAdapter;
  const fileEnv = loadServerEnv();
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY ?? fileEnv.LLM_API_KEY ?? '';
  const model = options.model ?? process.env.LLM_MODEL ?? fileEnv.LLM_MODEL ?? 'gemini-2.5-flash';
  const provider = options.provider ?? process.env.LLM_PROVIDER ?? fileEnv.LLM_PROVIDER ?? 'gemini';
  const allowedOrigins = new Set(
    (options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
  const configuredRateLimit = Number(process.env.CHAT_RATE_LIMIT);
  const rateLimit = options.rateLimit ?? (configuredRateLimit > 0 ? configuredRateLimit : DEFAULT_RATE_LIMIT);
  const rateWindowMs = options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS;
  const configuredGlobal = Number(process.env.CHAT_GLOBAL_LIMIT);
  const globalLimit = options.globalLimit ?? (configuredGlobal > 0 ? configuredGlobal : DEFAULT_GLOBAL_LIMIT);
  const limiter = options.limiter ?? createLimiter();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.get('origin');
    // Same-origin (the deployed site calling its own /api) always passes; otherwise the origin must be listed.
    const sameOrigin = origin !== undefined && (() => {
      try { return new URL(origin).host === req.get('host'); } catch { return false; }
    })();
    const allowed = origin !== undefined && (sameOrigin || allowedOrigins.has(origin));
    if (origin && allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (origin && !allowed) {
      res.status(403).json({ error: 'origin_not_allowed' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '128kb', strict: true }));

  app.post('/api/chat', async (req: Request, res: Response) => {
    // Behind Vercel/most proxies req.ip is the proxy, which would put every visitor in one bucket.
    const forwarded = req.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = forwarded || req.get('x-real-ip') || req.ip || req.socket.remoteAddress || 'unknown';
    if (!(await limiter.hit('global', globalLimit, rateWindowMs)) || !(await limiter.hit(`ip:${ip}`, rateLimit, rateWindowMs))) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    const body = validateBody(req.body);
    if (!body) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    if (!apiKey || provider !== 'gemini') {
      res.status(503).json({ error: 'assistant_unavailable' });
      return;
    }
    const systemPrompt = buildSystemPrompt(body.mode, body.context);
    try {
      const answer = await adapter.generate({
        apiKey,
        model,
        systemPrompt,
        messages: body.messages,
        context: body.context,
        mode: body.mode,
      });
      if (res.headersSent) return;
      const safeAnswer = apiKey ? answer.split(apiKey).join('[redacted]') : answer;
      res.json({ message: safeAnswer });
    } catch {
      if (!res.headersSent) {
        res.status(503).json({ error: 'assistant_unavailable' });
      }
    }
  });

  const safeErrors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    const status = isRecord(error) && error.status === 413 ? 413 : 400;
    res.status(status).json({ error: status === 413 ? 'request_too_large' : 'invalid_request' });
  };
  app.use(safeErrors);
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3001);
  const app = createApp();
  app.listen(port, '127.0.0.1', () => {
    console.log(`Aletheia assistant API listening on http://127.0.0.1:${port}`);
  });
}
