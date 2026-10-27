import express from "express";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import pg from "pg";
import { randomUUID } from "node:crypto";

dotenv.config();

const app = express();
const { Pool } = pg;

app.use(helmet());
app.use(express.json({ limit: "20kb" }));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = Number(
      decoded.userId ?? decoded.user_id ?? decoded.sub ?? decoded.id
    );

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid user token" });
    }

    req.user = { id: userId };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "payment-service",
      database: "connected",
      mode: "simulated",
    });
  } catch {
    res.status(503).json({
      status: "error",
      service: "payment-service",
      database: "disconnected",
    });
  }
});

async function getBooking(bookingId, token) {
  const response = await fetch(
    `${process.env.BOOKING_SERVICE_URL}/api/bookings/${bookingId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error("Could not verify booking");
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }

  return data.booking ?? data;
}

app.post("/api/payments", authenticate, async (req, res) => {
  const bookingId = Number(req.body.booking_id);
  const outcome = req.body.outcome;
  const idempotencyKey =
    req.headers["idempotency-key"] || req.body.idempotency_key;

  if (!Number.isSafeInteger(bookingId) || bookingId <= 0) {
    return res.status(400).json({ message: "Valid booking_id is required" });
  }

  if (!["success", "failure"].includes(outcome)) {
    return res.status(400).json({
      message: "outcome must be success or failure in simulation mode",
    });
  }

  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 128
  ) {
    return res.status(400).json({
      message: "Provide an idempotency key between 8 and 128 characters",
    });
  }

  const token = req.headers.authorization.slice(7);
  let client;

  try {
    const booking = await getBooking(bookingId, token);

    if (Number(booking.renter_user_id) !== req.user.id) {
      return res.status(403).json({
        message: "You can only pay for your own booking",
      });
    }

    if (booking.status !== "confirmed") {
      return res.status(409).json({
        message: "Booking must be confirmed by the owner before payment",
        booking_status: booking.status,
      });
    }

    const rentalAmount = Number(booking.rental_amount);
    const depositAmount = Number(booking.security_deposit ?? 0);
    const amount = rentalAmount + depositAmount;

    if (
      !Number.isFinite(amount) ||
      rentalAmount < 0 ||
      depositAmount < 0 ||
      amount <= 0
    ) {
      return res.status(400).json({
        message: "Booking contains an invalid payment amount",
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // Serialize attempts for the same booking.
    await client.query(
      "SELECT pg_advisory_xact_lock($1::bigint)",
      [bookingId]
    );

    const previous = await client.query(
      `SELECT * FROM payments
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (previous.rows.length) {
      const existing = previous.rows[0];

      if (
        existing.renter_user_id !== req.user.id ||
        existing.booking_id !== bookingId
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "Idempotency key was already used for another request",
        });
      }

      await client.query("COMMIT");
      return res.status(200).json({
        message: "Returning the existing payment attempt",
        payment: existing,
      });
    }

    const alreadyPaid = await client.query(
      `SELECT id FROM payments
       WHERE booking_id = $1 AND status = 'succeeded'
       LIMIT 1`,
      [bookingId]
    );

    if (alreadyPaid.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: "This booking already has a successful payment",
      });
    }

    const status = outcome === "success" ? "succeeded" : "failed";

    const result = await client.query(
      `INSERT INTO payments
         (booking_id, renter_user_id, amount, currency,
          status, provider, idempotency_key)
       VALUES ($1, $2, $3, 'INR', $4, 'simulation', $5)
       RETURNING id, booking_id, renter_user_id, amount,
                 currency, status, provider, created_at`,
      [bookingId, req.user.id, amount.toFixed(2), status, idempotencyKey]
    );

    await client.query("COMMIT");

    return res.status(status === "succeeded" ? 201 : 402).json({
      message:
        status === "succeeded"
          ? "Simulated payment successful"
          : "Simulated payment failed",
      payment: result.rows[0],
      notice: "Simulation only. No real money was charged.",
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Payment request failed:", error.message);

    return res.status(error.status || 500).json({
      message:
        error.status === 404
          ? "Booking not found"
          : error.status === 502
            ? "Booking service unavailable or returned an error"
            : "Could not process payment",
    });
  } finally {
    client?.release();
  }
});

app.get("/api/payments", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, booking_id, amount, currency, status,
              provider, created_at
       FROM payments
       WHERE renter_user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({ payments: result.rows });
  } catch (error) {
    console.error("Payment history failed:", error.message);
    res.status(500).json({ message: "Could not retrieve payment history" });
  }
});

app.get("/api/payments/:id", authenticate, async (req, res) => {
  const paymentId = Number(req.params.id);

  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
    return res.status(400).json({ message: "Invalid payment ID" });
  }

  try {
    const result = await pool.query(
      `SELECT id, booking_id, amount, currency, status,
              provider, created_at
       FROM payments
       WHERE id = $1 AND renter_user_id = $2`,
      [paymentId, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Payment not found" });
    }

    res.json({ payment: result.rows[0] });
  } catch (error) {
    console.error("Payment lookup failed:", error.message);
    res.status(500).json({ message: "Could not retrieve payment" });
  }
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      booking_id BIGINT NOT NULL,
      renter_user_id BIGINT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      status VARCHAR(20) NOT NULL
        CHECK (status IN ('succeeded', 'failed')),
      provider VARCHAR(30) NOT NULL DEFAULT 'simulation',
      idempotency_key VARCHAR(128) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  app.listen(Number(process.env.PORT || 5005), "0.0.0.0", () => {
    console.log(`Payment service listening on port ${process.env.PORT || 5005}`);
  });
}

start().catch((error) => {
  console.error("Payment service startup failed:", error.message);
  process.exit(1);
});
