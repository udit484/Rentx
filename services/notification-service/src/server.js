import express from "express";
import helmet from "helmet";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import pg from "pg";
import { timingSafeEqual } from "node:crypto";

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
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "rentx-auth",
      audience: "rentx-api",
    });

    const id = Number(decoded.sub);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(401).json({ message: "Invalid user token" });
    }

    req.user = { id };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function serviceOnly(req, res, next) {
  const supplied = req.headers["x-service-key"] || "";
  const expected = process.env.SERVICE_KEY || "";

  if (
    !expected ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    return res.status(401).json({ message: "Invalid service credentials" });
  }

  next();
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "notification-service",
      database: "connected",
    });
  } catch {
    res.status(503).json({
      status: "error",
      service: "notification-service",
      database: "disconnected",
    });
  }
});

// Internal service-to-service notification creation.
app.post("/api/notifications", serviceOnly, async (req, res) => {
  const userId = Number(req.body.user_id);
  const type = req.body.type;
  const title = req.body.title;
  const message = req.body.message;
  const metadata = req.body.metadata ?? {};

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Valid user_id is required" });
  }

  if (
    typeof type !== "string" || type.length < 1 || type.length > 50 ||
    typeof title !== "string" || title.trim().length < 1 || title.length > 150 ||
    typeof message !== "string" || message.trim().length < 1 || message.length > 2000 ||
    !metadata || typeof metadata !== "object" || Array.isArray(metadata)
  ) {
    return res.status(400).json({ message: "Invalid notification fields" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO notifications
        (user_id, type, title, message, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, user_id, type, title, message, metadata,
                 is_read, created_at`,
      [
        userId,
        type,
        title.trim(),
        message.trim(),
        JSON.stringify(metadata),
      ]
    );

    res.status(201).json({
      message: "Notification created",
      notification: result.rows[0],
    });
  } catch (error) {
    console.error("Notification creation failed:", error.message);
    res.status(500).json({ message: "Could not create notification" });
  }
});

app.get("/api/notifications", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, type, title, message, metadata, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );

    res.json({ notifications: result.rows });
  } catch (error) {
    console.error("Notification listing failed:", error.message);
    res.status(500).json({ message: "Could not retrieve notifications" });
  }
});

app.patch("/api/notifications/:id/read", authenticate, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid notification ID" });
  }

  try {
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING id, type, title, message, metadata, is_read, created_at`,
      [id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({
      message: "Notification marked as read",
      notification: result.rows[0],
    });
  } catch (error) {
    console.error("Notification update failed:", error.message);
    res.status(500).json({ message: "Could not update notification" });
  }
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      type VARCHAR(50) NOT NULL,
      title VARCHAR(150) NOT NULL,
      message VARCHAR(2000) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC)
  `);

  app.listen(Number(process.env.PORT || 5006), "0.0.0.0", () => {
    console.log(`Notification service listening on port ${process.env.PORT || 5006}`);
  });
}

start().catch((error) => {
  console.error("Notification service startup failed:", error.message);
  process.exit(1);
});
