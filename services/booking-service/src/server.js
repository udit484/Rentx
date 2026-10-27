
import express from "express";
import pg from "pg";
import dotenv from "dotenv";
import helmet from "helmet";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const { Pool } = pg;
const PORT = Number(process.env.PORT || 5004);

app.use(helmet());
app.use(express.json({ limit: "100kb" }));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 5,
  connectionTimeoutMillis: 5000,
});

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      message: "Bearer token required",
    });
  }

  try {
    req.user = jwt.verify(match[1], process.env.JWT_SECRET, {
      issuer: "rentx-auth",
      audience: "rentx-api",
    });
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}

function getUserId(user) {
  const value = user.userId ?? user.user_id ?? user.sub ?? user.id;

  if (value === undefined || value === null ||
      !/^\d+$/.test(String(value))) {
    return null;
  }

  return String(value);
}

function validId(value) {
  return /^\d+$/.test(String(value ?? ""));
}

async function getProduct(productId) {
  const response = await fetch(
    `${process.env.PRODUCT_SERVICE_URL}/api/products/${encodeURIComponent(productId)}`,
    { signal: AbortSignal.timeout(5000) }
  );

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`Product Service returned HTTP ${response.status}`);
  }

  const body = await response.json();
  return body.listing ?? body.item ?? body.product ?? body;
}

function calculateAmount(start, end, period, price) {
  const milliseconds = end.getTime() - start.getTime();
  const hours = milliseconds / 3600000;
  const days = milliseconds / 86400000;

  let units;

  switch (period) {
    case "hourly":
      units = Math.ceil(hours);
      break;
    case "daily":
      units = Math.ceil(days);
      break;
    case "weekly":
      units = Math.ceil(days / 7);
      break;
    case "monthly":
      units = Math.ceil(days / 30);
      break;
    default:
      throw new Error("Unsupported listing pricing period");
  }

  return {
    units,
    rentalAmount: Number((units * price).toFixed(2)),
  };
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      service: "booking-service",
      database: "connected",
    });
  } catch {
    res.status(503).json({
      status: "error",
      service: "booking-service",
      database: "disconnected",
    });
  }
});

// Create a booking request.
app.post("/api/bookings", authenticate, async (req, res) => {
  const userId = getUserId(req.user);

  if (!userId) {
    return res.status(401).json({
      message: "Token has no valid user ID",
    });
  }

  if (req.user.role !== "renter") {
    return res.status(403).json({
      message: "Renter account required to book",
    });
  }

  const { product_id, start_date, end_date } = req.body;

  if (!validId(product_id) || !start_date || !end_date) {
    return res.status(400).json({
      message: "product_id, start_date and end_date are required",
    });
  }

  const start = new Date(start_date);
  const end = new Date(end_date);

  if (!Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start) {
    return res.status(400).json({
      message: "Provide valid dates; end_date must be after start_date",
    });
  }

  if (start <= new Date()) {
    return res.status(400).json({
      message: "Booking start must be in the future",
    });
  }

  let product;

  try {
    product = await getProduct(product_id);
  } catch (error) {
    console.error("Product lookup failed:", error.message);

    return res.status(503).json({
      message: "Product Service is unavailable; try again later",
    });
  }

  if (!product || product.status !== "active") {
    return res.status(404).json({
      message: "Active listing not found",
    });
  }

  if (String(product.owner_user_id) === userId) {
    return res.status(400).json({
      message: "You cannot book your own listing",
    });
  }

  if (product.available_from &&
      start < new Date(product.available_from)) {
    return res.status(400).json({
      message: "Booking starts before the listing availability",
    });
  }

  if (product.available_to &&
      end > new Date(product.available_to)) {
    return res.status(400).json({
      message: "Booking ends after the listing availability",
    });
  }

  const price = Number(product.price);
  const deposit = Number(product.security_deposit || 0);

  if (!Number.isFinite(price) || price < 0 ||
      !Number.isFinite(deposit) || deposit < 0) {
    return res.status(422).json({
      message: "Listing has invalid pricing",
    });
  }

  let calculation;

  try {
    calculation = calculateAmount(
      start,
      end,
      product.pricing_period,
      price
    );
  } catch (error) {
    return res.status(422).json({
      message: error.message,
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize reservation checks for this product.
    await client.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      [String(product_id)]
    );

    const conflict = await client.query(
      `SELECT id FROM bookings
       WHERE product_id = $1
         AND status IN ('pending', 'confirmed')
         AND start_date < $3
         AND end_date > $2
       LIMIT 1`,
      [String(product_id), start, end]
    );

    if (conflict.rowCount > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        message: "This listing is already booked for that period",
      });
    }

    const result = await client.query(
      `INSERT INTO bookings
       (renter_user_id, product_id, start_date, end_date,
        pricing_period, price_per_unit, rental_amount,
        security_deposit, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [
        userId,
        String(product_id),
        start,
        end,
        product.pricing_period,
        price,
        calculation.rentalAmount,
        deposit,
      ]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Booking request created. Payment is not integrated yet.",
      booking: result.rows[0],
      pricing: {
        units: calculation.units,
        pricing_period: product.pricing_period,
        rental_amount: calculation.rentalAmount,
        security_deposit: deposit,
        total_due_before_payment: Number(
          (calculation.rentalAmount + deposit).toFixed(2)
        ),
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Booking creation failed:", error.message);

    return res.status(500).json({
      message: "Could not create booking",
    });
  } finally {
    client.release();
  }
});

// List the authenticated renter's bookings.
app.get("/api/bookings", authenticate, async (req, res) => {
  const userId = getUserId(req.user);

  if (!userId) {
    return res.status(401).json({
      message: "Token has no valid user ID",
    });
  }

  if (req.user.role !== "renter") {
    return res.status(403).json({
      message: "Renter account required",
    });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM bookings
       WHERE renter_user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ items: result.rows });
  } catch (error) {
    console.error("Booking list failed:", error.message);

    res.status(500).json({
      message: "Could not retrieve bookings",
    });
  }
});

// Retrieve one booking belonging to the authenticated renter.
app.get("/api/bookings/:id", authenticate, async (req, res) => {
  const userId = getUserId(req.user);

  if (!userId) {
    return res.status(401).json({
      message: "Token has no valid user ID",
    });
  }

  if (!validId(req.params.id)) {
    return res.status(400).json({
      message: "Invalid booking ID",
    });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM bookings
       WHERE id = $1 AND renter_user_id = $2`,
      [req.params.id, userId]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    res.json({ booking: result.rows[0] });
  } catch (error) {
    console.error("Booking lookup failed:", error.message);

    res.status(500).json({
      message: "Could not retrieve booking",
    });
  }
});


// List incoming bookings for listings owned by the authenticated owner.
app.get("/api/owner/bookings", authenticate, async (req, res) => {
  const userId = getUserId(req.user);

  if (!userId) {
    return res.status(401).json({ message: "Invalid user identity" });
  }

  if (!["owner", "admin"].includes(req.user.role)) {
    return res.status(403).json({ message: "Owner access required" });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM bookings
       WHERE status IN ('pending', 'confirmed')
       ORDER BY created_at DESC
       LIMIT 100`
    );

    const ownedBookings = [];

    for (const booking of result.rows) {
      try {
        const listing = await getProduct(booking.product_id);

        if (String(listing.owner_user_id) === String(userId)) {
          ownedBookings.push({
            ...booking,
            listing: {
              id: listing.id,
              title: listing.title,
              city: listing.city
            }
          });
        }
      } catch (error) {
        console.error(
          "Could not retrieve listing for booking",
          booking.id,
          error.message
        );
      }
    }

    return res.json({ items: ownedBookings });
  } catch (error) {
    console.error("Owner bookings lookup failed:", error.message);
    return res.status(500).json({
      message: "Could not retrieve owner bookings"
    });
  }
});

// Approve or reject a booking request.
app.patch("/api/bookings/:id/decision", authenticate, async (req, res) => {
  const userId = getUserId(req.user);
  const { decision } = req.body;

  if (!userId) {
    return res.status(401).json({ message: "Invalid user identity" });
  }

  if (!["owner", "admin"].includes(req.user.role)) {
    return res.status(403).json({ message: "Owner access required" });
  }

  if (!validId(req.params.id)) {
    return res.status(400).json({ message: "Invalid booking ID" });
  }

  if (!["approve", "reject"].includes(decision)) {
    return res.status(400).json({
      message: "decision must be approve or reject"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const found = await client.query(
      "SELECT * FROM bookings WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );

    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Booking not found" });
    }

    const booking = found.rows[0];

    if (booking.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "Only pending bookings can be approved or rejected",
        status: booking.status
      });
    }

    const listing = await getProduct(booking.product_id);

    if (
      !listing ||
      (String(listing.owner_user_id) !== String(userId) &&
       req.user.role !== "admin")
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "You do not own this listing"
      });
    }

    await client.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      [String(booking.product_id)]
    );

    if (decision === "approve") {
      const conflict = await client.query(
        `SELECT id FROM bookings
         WHERE product_id = $1
           AND id <> $2
           AND status IN ('pending', 'confirmed')
           AND start_date < $4
           AND end_date > $3
         LIMIT 1`,
        [
          booking.product_id,
          booking.id,
          booking.start_date,
          booking.end_date
        ]
      );

      if (conflict.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "Another active booking overlaps these dates"
        });
      }
    }

    // The current schema uses cancelled for rejected requests.
    const newStatus = decision === "approve" ? "confirmed" : "cancelled";

    const updated = await client.query(
      `UPDATE bookings
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [booking.id, newStatus]
    );

    await client.query("COMMIT");

    return res.json({
      message: decision === "approve"
        ? "Booking approved"
        : "Booking request rejected",
      booking: updated.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Booking decision failed:", error.message);

    return res.status(500).json({
      message: "Could not process booking decision"
    });
  } finally {
    client.release();
  }
});

// Cancel a pending or confirmed booking.
app.patch("/api/bookings/:id/cancel", authenticate, async (req, res) => {
  const userId = getUserId(req.user);

  if (!userId) {
    return res.status(401).json({
      message: "Token has no valid user ID",
    });
  }

  if (req.user.role !== "renter") {
    return res.status(403).json({
      message: "Renter account required",
    });
  }

  if (!validId(req.params.id)) {
    return res.status(400).json({
      message: "Invalid booking ID",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const found = await client.query(
      `SELECT * FROM bookings
       WHERE id = $1 AND renter_user_id = $2
       FOR UPDATE`,
      [req.params.id, userId]
    );

    if (!found.rowCount) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Booking not found",
      });
    }

    const booking = found.rows[0];

    if (!["pending", "confirmed"].includes(booking.status)) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        message: "This booking cannot be cancelled",
        status: booking.status,
      });
    }

    await client.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      [String(booking.product_id)]
    );

    const updated = await client.query(
      `UPDATE bookings
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    await client.query("COMMIT");

    res.json({
      message: "Booking cancelled",
      booking: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Booking cancellation failed:", error.message);

    res.status(500).json({
      message: "Could not cancel booking",
    });
  } finally {
    client.release();
  }
});

async function start() {
  if (!process.env.JWT_SECRET || !process.env.DB_PASSWORD ||
      !process.env.PRODUCT_SERVICE_URL) {
    throw new Error("Required environment configuration is missing");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGSERIAL PRIMARY KEY,
      renter_user_id BIGINT NOT NULL,
      product_id BIGINT NOT NULL,
      start_date TIMESTAMPTZ NOT NULL,
      end_date TIMESTAMPTZ NOT NULL,
      pricing_period VARCHAR(20) NOT NULL
        CHECK (pricing_period IN ('hourly', 'daily', 'weekly', 'monthly')),
      price_per_unit NUMERIC(12,2) NOT NULL
        CHECK (price_per_unit >= 0),
      rental_amount NUMERIC(12,2) NOT NULL
        CHECK (rental_amount >= 0),
      security_deposit NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (security_deposit >= 0),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (end_date > start_date)
    );

    CREATE INDEX IF NOT EXISTS bookings_renter_idx
      ON bookings (renter_user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS bookings_product_dates_idx
      ON bookings (product_id, start_date, end_date);
  `);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Booking Service listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Booking Service startup failed:", error.message);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});
