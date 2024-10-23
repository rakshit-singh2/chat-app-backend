const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require('swagger-jsdoc');
const morgan = require('morgan')
const mongosanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const routes = require("./routes/index");

const app = express();

app.use(
    cors({
        origin: "*",
        methods: ["GET", "PATCH", "POST", "DELETE", "PUT"],
        credentials: true,
    })
);

app.use(cookieParser());
app.use(express.json({ limit: "10kb" })); // Controls the maximum request body size. If this is a number, then the value specifies the number of bytes; if it is a string, the value is passed to the bytes library for parsing. Defaults to '100kb'.
app.use(bodyParser.json()); // Returns middleware that only parses json
app.use(bodyParser.urlencoded({ extended: true }));

app.use(helmet());

const limiter = rateLimit({
    max: 3000,
    windowMs: 60 * 60 * 1000, // In one hour
    message: "Too many Requests from this IP, please try again in an hour!",
});

app.use("/tawk", limiter);

// Swagger options
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'User API',
            version: '1.0.0',
            description: 'API documentation with Swagger',
        },
    },
    // Paths to files with API annotations
    apis: ['./controllers/*.js', './routes/*.js'],
};

const specs = swaggerJsdoc(options);

if (process.env.NODE_ENV === "development") {
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));
    app.use(morgan("dev"));
}

app.use(mongosanitize());

app.use(xss());

app.use(routes);

module.exports = app;