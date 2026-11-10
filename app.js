const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { apiLimiter } = require("./utils/rateLimiters");
const { redisHealth } = require("./services/redis");
const swaggerUi = require("swagger-ui-express");
const morgan = require('morgan')
const sanitizeRequest = require("./utils/sanitizeRequest");
const errorHandler = require("./utils/errorHandler");
const routes = require("./routes/index");

const app = express();

// Behind a load balancer / reverse proxy, set TRUST_PROXY (e.g. 1) so req.ip,
// rate limits and secure cookies use the real client address and protocol.
if (process.env.TRUST_PROXY) {
    const value = process.env.TRUST_PROXY;
    app.set("trust proxy", /^\d+$/.test(value) ? Number(value) : value === "true" ? true : value);
}
app.disable("x-powered-by");

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim());
if (process.env.NODE_ENV !== "development" && !process.env.CORS_ORIGINS) {
    throw new Error("CORS_ORIGINS must be configured outside development");
}

app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "PATCH", "POST", "DELETE", "PUT"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Client-Type"],
    credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

app.use(helmet());

app.use(apiLimiter);

const specs = require("./docs/openapi");

if (process.env.NODE_ENV === "development") {
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));
    app.use(morgan("dev"));
}

// Strip MongoDB operators and XSS payloads (Express 5 compatible).
app.use(sanitizeRequest());

app.get("/health", async (req, res) => {
  const redis = await redisHealth();
  res.status(redis === "error" ? 503 : 200).json({ status: redis === "error" ? "degraded" : "ok", redis });
});

app.use(routes);

app.use((req, res) => res.status(404).json({ status: "fail", code: "NOT_FOUND", message: "Route not found." }));

app.use(errorHandler);

module.exports = app;