
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 5003);

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
app.use(express.json({ limit: '50kb' }));

const periods = ['hourly', 'daily', 'weekly', 'monthly'];
const listingFields = [
  'title',
  'description',
  'category',
  'city',
  'address',
  'pricing_period',
  'price',
  'security_deposit',
  'image_urls',
  'available_from',
  'available_to',
];

function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

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

    req.auth = { userId: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function ownerOnly(req, res, next) {
  if (req.auth.role !== 'owner' && req.auth.role !== 'admin') {
    return res.status(403).json({ message: 'Owner account required to manage listings' });
  }
  next();
}

function validateListing(body, partial = false) {
  const keys = Object.keys(body || {});

  if (!keys.length || keys.some((key) => !listingFields.includes(key))) {
    return 'Provide valid listing fields only';
  }

  const required = [
    'title', 'description', 'category', 'city',
    'pricing_period', 'price',
  ];

  if (!partial) {
    for (const key of required) {
      if (body[key] === undefined || body[key] === null || body[key] === '') {
        return `${key} is required`;
      }
    }
  }

  for (const key of ['title', 'description', 'category', 'city', 'address']) {
    if (body[key] !== undefined &&
        (typeof body[key] !== 'string' || body[key].trim() === '')) {
      return `${key} must be a non-empty string`;
    }
  }

  const maxLengths = {
    title: 150,
    description: 5000,
    category: 80,
    city: 100,
    address: 250,
  };

  for (const [key, max] of Object.entries(maxLengths)) {
    if (typeof body[key] === 'string' && body[key].length > max) {
      return `${key} must be ${max} characters or fewer`;
    }
  }

  if (body.pricing_period !== undefined && !periods.includes(body.pricing_period)) {
    return `pricing_period must be one of: ${periods.join(', ')}`;
  }

  for (const key of ['price', 'security_deposit']) {
    if (body[key] !== undefined &&
        (!Number.isFinite(Number(body[key])) || Number(body[key]) < 0)) {
      return `${key} must be a non-negative number`;
    }
  }

  if (body.price !== undefined && Number(body.price) <= 0) {
    return 'price must be greater than zero';
  }

  if (body.security_deposit !== undefined && body.security_deposit === '') {
    return 'security_deposit cannot be empty';
  }

  if (body.image_urls !== undefined) {
    if (!Array.isArray(body.image_urls) || body.image_urls.length > 10) {
      return 'image_urls must be an array with at most 10 URLs';
    }

    for (const value of body.image_urls) {
      if (typeof value !== 'string') return 'Each image URL must be a string';
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:') throw new Error();
      } catch {
        return 'Image URLs must be valid HTTPS URLs';
      }
    }
  }

  for (const key of ['available_from', 'available_to']) {
    if (body[key] !== undefined && body[key] !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body[key]) ||
          Number.isNaN(Date.parse(`${body[key]}T00:00:00Z`))) {
        return `${key} must use YYYY-MM-DD format`;
      }
    }
  }

  const from = body.available_from;
  const to = body.available_to;
  if (from && to && from > to) {
    return 'available_to must be on or after available_from';
  }

  return null;
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id BIGSERIAL PRIMARY KEY,
      owner_user_id BIGINT NOT NULL,
      title VARCHAR(150) NOT NULL,
      description VARCHAR(5000) NOT NULL,
      category VARCHAR(80) NOT NULL,
      city VARCHAR(100) NOT NULL,
      address VARCHAR(250),
      pricing_period VARCHAR(10) NOT NULL
        CHECK (pricing_period IN ('hourly', 'daily', 'weekly', 'monthly')),
      price NUMERIC(12,2) NOT NULL CHECK (price > 0),
      security_deposit NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (security_deposit >= 0),
      image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      available_from DATE,
      available_to DATE,
      status VARCHAR(10) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (available_from IS NULL OR available_to IS NULL
        OR available_to >= available_from)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishlist_items (
      user_id BIGINT NOT NULL,
      product_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS wishlist_items_user_idx
    ON wishlist_items (user_id, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS listings_search_idx
    ON listings (status, city, category)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS listings_owner_idx
    ON listings (owner_user_id)
  `);
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'product-service', database: 'connected' });
  } catch {
    res.status(503).json({
      status: 'error',
      service: 'product-service',
      database: 'disconnected',
    });
  }
});

// Public listing search and filters.
app.get('/api/products', async (req, res) => {
  try {
    const conditions = ["status = 'active'"];
    const values = [];

    const addFilter = (sql, value) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };

    if (req.query.q) {
      addFilter(
        "(title ILIKE ? OR description ILIKE ?)",
        `%${String(req.query.q).slice(0, 100)}%`
      );
      // The previous condition has two placeholders, so use the same parameter twice.
      const n = values.length;
      conditions[conditions.length - 1] =
        `(title ILIKE $${n} OR description ILIKE $${n})`;
    }

    if (req.query.city) {
      addFilter('city ILIKE ?', String(req.query.city).slice(0, 100));
    }
    if (req.query.category) {
      addFilter('category ILIKE ?', String(req.query.category).slice(0, 80));
    }
    if (req.query.pricing_period) {
      if (!periods.includes(req.query.pricing_period)) {
        return res.status(400).json({ message: 'Invalid pricing_period' });
      }
      addFilter('pricing_period = ?', req.query.pricing_period);
    }
    if (req.query.min_price !== undefined) {
      const min = Number(req.query.min_price);
      if (!Number.isFinite(min) || min < 0) {
        return res.status(400).json({ message: 'Invalid min_price' });
      }
      addFilter('price >= ?', min);
    }
    if (req.query.max_price !== undefined) {
      const max = Number(req.query.max_price);
      if (!Number.isFinite(max) || max < 0) {
        return res.status(400).json({ message: 'Invalid max_price' });
      }
      addFilter('price <= ?', max);
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM listings WHERE ${conditions.join(' AND ')}`,
      values
    );

    const queryValues = [...values, limit, (page - 1) * limit];
    const result = await pool.query(
      `SELECT id, owner_user_id, title, description, category, city, address,
              pricing_period, price, security_deposit, image_urls,
              available_from, available_to, created_at, updated_at
       FROM listings
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      queryValues
    );

    res.json({
      items: result.rows,
      pagination: {
        page,
        limit,
        total: Number(countResult.rows[0].count),
        totalPages: Math.ceil(Number(countResult.rows[0].count) / limit),
      },
    });
  } catch (error) {
    console.error('Listing search failed:', error.message);
    res.status(500).json({ message: 'Unable to search listings' });
  }
});

// Public details for one active listing.
app.get('/api/products/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ message: 'Invalid listing ID' });
  }

  try {
    const result = await pool.query(
      `SELECT id, owner_user_id, title, description, category, city, address,
          pricing_period, price, security_deposit, image_urls, status,
          available_from, available_to, created_at, updated_at
     FROM listings WHERE id = $1 AND status = 'active'`,
     [req.params.id]
        );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.json({ listing: result.rows[0] });
  } catch (error) {
    console.error('Listing retrieval failed:', error.message);
    res.status(500).json({ message: 'Unable to retrieve listing' });
  }
});

// Owners and admins can create listings.

// Return all listings belonging to the authenticated owner, including inactive listings.
app.get('/api/owner/products', authenticate, ownerOnly, async (req, res) => {
  try {
    const isAdmin = req.auth.role === 'admin';
    const result = isAdmin
      ? await pool.query(
          `SELECT id, owner_user_id, title, description, category, city,
                  address, pricing_period, price, security_deposit,
                  image_urls, available_from, available_to, status,
                  created_at, updated_at
           FROM listings ORDER BY created_at DESC`
        )
      : await pool.query(
          `SELECT id, owner_user_id, title, description, category, city,
                  address, pricing_period, price, security_deposit,
                  image_urls, available_from, available_to, status,
                  created_at, updated_at
           FROM listings
           WHERE owner_user_id = $1
           ORDER BY created_at DESC`,
          [req.auth.userId]
        );

    return res.json({ items: result.rows });
  } catch (error) {
    console.error('Owner inventory retrieval failed:', error.message);
    return res.status(500).json({ message: 'Unable to retrieve owner inventory' });
  }
});

app.post('/api/products', authenticate, ownerOnly, async (req, res) => {
  const validationError = validateListing(req.body);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const b = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO listings
       (owner_user_id, title, description, category, city, address,
        pricing_period, price, security_deposit, image_urls,
        available_from, available_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        req.auth.userId, b.title.trim(), b.description.trim(),
        b.category.trim(), b.city.trim(), b.address?.trim() || null,
        b.pricing_period, b.price, b.security_deposit ?? 0,
        JSON.stringify(b.image_urls ?? []),
        b.available_from || null, b.available_to || null,
      ]
    );

    res.status(201).json({
      message: 'Listing created successfully',
      listing: result.rows[0],
    });
  } catch (error) {
    console.error('Listing creation failed:', error.message);
    res.status(500).json({ message: 'Unable to create listing' });
  }
});

// Only the listing owner or an admin can update or deactivate it.
app.patch('/api/products/:id', authenticate, ownerOnly, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ message: 'Invalid listing ID' });
  }

  const body = { ...req.body };
  const requestedStatus = body.status;
  delete body.status;

  if (requestedStatus !== undefined &&
      !['active', 'inactive'].includes(requestedStatus)) {
    return res.status(400).json({ message: 'status must be active or inactive' });
  }

  if (!Object.keys(body).length && requestedStatus === undefined) {
    return res.status(400).json({ message: 'Provide fields to update' });
  }

  if (Object.keys(body).length) {
    const validationError = validateListing(body, true);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }
  }

  const columns = {
    title: 'title',
    description: 'description',
    category: 'category',
    city: 'city',
    address: 'address',
    pricing_period: 'pricing_period',
    price: 'price',
    security_deposit: 'security_deposit',
    image_urls: 'image_urls',
    available_from: 'available_from',
    available_to: 'available_to',
  };

  try {
    const existing = await pool.query(
      'SELECT * FROM listings WHERE id = $1',
      [req.params.id]
    );

    if (!existing.rowCount) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (req.auth.role !== 'admin' &&
        existing.rows[0].owner_user_id.toString() !== req.auth.userId.toString()) {
      return res.status(403).json({ message: 'You cannot manage another owner’s listing' });
    }

    const merged = { ...existing.rows[0], ...body };
    const mergedError = validateListing({
      title: merged.title,
      description: merged.description,
      category: merged.category,
      city: merged.city,
      pricing_period: merged.pricing_period,
      price: merged.price,
      security_deposit: merged.security_deposit,
      address: merged.address,
      image_urls: merged.image_urls,
      available_from: merged.available_from?.toISOString?.().slice(0, 10) ?? merged.available_from,
      available_to: merged.available_to?.toISOString?.().slice(0, 10) ?? merged.available_to,
    });

    if (mergedError) {
      return res.status(400).json({ message: mergedError });
    }

    const assignments = [];
    const values = [req.params.id];

    for (const key of Object.keys(body)) {
      values.push(key === 'image_urls' ? JSON.stringify(body[key]) : body[key]);
      assignments.push(`${columns[key]} = $${values.length}${key === 'image_urls' ? '::jsonb' : ''}`);
    }

    if (requestedStatus !== undefined) {
      values.push(requestedStatus);
      assignments.push(`status = $${values.length}`);
    }

    assignments.push('updated_at = NOW()');

    const result = await pool.query(
      `UPDATE listings SET ${assignments.join(', ')}
       WHERE id = $1 RETURNING *`,
      values
    );

    res.json({ message: 'Listing updated', listing: result.rows[0] });
  } catch (error) {
    console.error('Listing update failed:', error.message);
    res.status(500).json({ message: 'Unable to update listing' });
  }
});


// Persistent wishlist: view saved listings
app.get('/api/wishlist', authenticate, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT l.*, w.created_at AS wishlisted_at
      FROM wishlist_items w
      JOIN listings l ON l.id = w.product_id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC
    `, [req.auth.userId]);

    res.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

// Add a listing to the wishlist
app.post('/api/wishlist/:productId', authenticate, async (req, res, next) => {
  try {
    const { productId } = req.params;

    if (!/^[1-9]\d*$/.test(productId)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    const listing = await pool.query(
      `SELECT id FROM listings WHERE id = $1 AND status = 'active'`,
      [productId]
    );

    if (listing.rowCount === 0) {
      return res.status(404).json({ message: 'Active listing not found' });
    }

    await pool.query(`
      INSERT INTO wishlist_items (user_id, product_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, product_id) DO NOTHING
    `, [req.auth.userId, productId]);

    res.status(200).json({ message: 'Added to wishlist', productId });
  } catch (error) {
    next(error);
  }
});

// Remove a listing from the wishlist
app.delete('/api/wishlist/:productId', authenticate, async (req, res, next) => {
  try {
    const { productId } = req.params;

    if (!/^[1-9]\d*$/.test(productId)) {
      return res.status(400).json({ message: 'Invalid product ID' });
    }

    await pool.query(
      `DELETE FROM wishlist_items WHERE user_id = $1 AND product_id = $2`,
      [req.auth.userId, productId]
    );

    res.json({ message: 'Removed from wishlist', productId });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  console.error('Request failed:', err.message);
  res.status(400).json({ message: 'Invalid request' });
});

async function start() {
  await initializeDatabase();
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`Product Service listening on 127.0.0.1:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Product Service startup failed:', error.message);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
