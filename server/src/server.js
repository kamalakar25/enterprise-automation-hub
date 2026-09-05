import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';

import logger from './config/logger.js';
import { bus } from './queue/socketBus.js';

import authRoutes from './routes/auth.js';
import moduleRoutes from './routes/modules.js';
import jobRoutes from './routes/jobs.js';
import fileRoutes from './routes/files.js';
import userRoutes from './routes/users.js';
import scheduleRoutes from './routes/schedules.js';
import auditRoutes from './routes/audit.js';

// ── Ensure storage dirs exist ──
['storage/uploads', 'storage/reports', 'storage/logs'].forEach((d) =>
  fs.mkdirSync(path.resolve(d), { recursive: true })
);

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : ['http://localhost:5173'];

const corsOriginHandler = (origin, callback) => {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    return callback(null, true);
  }
  if (/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|172\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin)) {
    return callback(null, true);
  }
  return callback(null, true);
};

// ── Socket.io for realtime logs/progress ──
const io = new SocketIOServer(server, {
  cors: {
    origin: corsOriginHandler,
    credentials: true,
  },
});

// Auth middleware for Socket.io
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
    socket.user = payload;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  logger.debug(`Socket connected: ${socket.id} (${socket.user.email})`);

  socket.on('subscribe:job', (jobId) => {
    socket.join(`job:${jobId}`);
  });
  socket.on('unsubscribe:job', (jobId) => {
    socket.leave(`job:${jobId}`);
  });
  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
  });
});

// Forward bus events → socket.io
bus.on('job:*:log', () => {}); // event wildcard via separate listener:
['log', 'status', 'progress'].forEach((ev) => {
  bus.on(ev, (payload) => {
    if (payload?.jobId) io.to(`job:${payload.jobId}`).emit(ev, payload);
  });
});

// ── Middleware ──
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: corsOriginHandler,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
  })
);

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'automation-hub-api', time: new Date().toISOString() });
});

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/users', userRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/audit', auditRoutes);

// 404
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error(err.stack || err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Automation Hub API running on http://0.0.0.0:${PORT}`);
  logger.info(`   Socket.io ready for realtime logs`);
});

export { io };
