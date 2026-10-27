
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 5002);

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000,
});

app.use(helmet());
app.use(express.json({ limit: '20kb' }));

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id BIGINT PRIMARY KEY,
      phone VARCHAR(30),
      bio VARCHAR(500),
      city VARCHAR(100),
      avatar_url TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Bearer token required' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'rentx-auth',
      audience: 'rentx-api',
    });

    if (!payload.sub || !['renter', 'owner', 'admin'].includes(payload.role)) {
      return res.status(401).json({ message: 'Invalid token claims' });
    }

    req.auth = {
      userId: payload.sub,
      role: payload.role,
    };

    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'user-service', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', service: 'user-service', database: 'disconnected' });
  }
});

app.get('/api/users/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, phone, bio, city, avatar_url, updated_at
       FROM user_profiles WHERE user_id = $1`,
      [req.auth.userId]
    );

    res.json({
      userId: req.auth.userId,
      role: req.auth.role,
      profile: result.rows[0] || {
        phone: null,
        bio: null,
        city: null,
        avatar_url: null,
      },
    });
  } catch (error) {
    console.error('Profile read failed:', error.message);
    res.status(500).json({ message: 'Unable to retrieve profile' });
  }
});

app.patch('/api/users/me', authenticate, async (req, res) => {
  const allowed = ['phone', 'bio', 'city', 'avatar_url'];
  const keys = Object.keys(req.body || {});

  if (keys.length === 0 || keys.some((key) => !allowed.includes(key))) {
    return res.status(400).json({
      message: 'Provide at least one allowed field: phone, bio, city, avatar_url',
    });
  }

  for (const key of keys) {
    const value = req.body[key];

    if (value !== null && typeof value !== 'string') {
      return res.status(400).json({ message: `${key} must be a string or null` });
    }

    if (typeof value === 'string' && value.length > ({
      phone: 30,
      bio: 500,
      city: 100,
      avatar_url: 2048,
    })[key]) {
      return res.status(400).json({ message: `${key} is too long` });
    }

    if (key === 'avatar_url' && typeof value === 'string' && value !== '') {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:') throw new Error('HTTPS required');
      } catch {
        return res.status(400).json({ message: 'avatar_url must be a valid HTTPS URL' });
      }
    }
  }

  const columns = {
    phone: 'phone',
    bio: 'bio',
    city: 'city',
    avatar_url: 'avatar_url',
  };

  try {
    await pool.query(
      `INSERT INTO user_profiles (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [req.auth.userId]
    );

    const assignments = keys.map(
      (key, index) => `${columns[key]} = $${index + 2}`
    );

    const values = [req.auth.userId, ...keys.map((key) => req.body[key])];

    const result = await pool.query(
      `UPDATE user_profiles
       SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, phone, bio, city, avatar_url, updated_at`,
      values
    );

    res.json({ message: 'Profile updated', profile: result.rows[0] });
  } catch (error) {
    console.error('Profile update failed:', error.message);
    res.status(500).json({ message: 'Unable to update profile' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('Request failed:', err.message);
  res.status(400).json({ message: 'Invalid request' });
});

async function start() {
  await initializeDatabase();

  app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`User Service listening on 127.0.0.1:${PORT}`);
  });
}

start().catch((error) => {
  console.error('User Service startup failed:', error.message);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
