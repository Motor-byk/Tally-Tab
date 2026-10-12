import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./configuration/connection.js";
import authRouter from "./routes/auth.js";
import weekRouter from "./routes/week.js";
import settingsRouter from "./routes/settings.js";
import requireAuth from "./middleware/requireAuth.js";

dotenv.config({path:"./config.env"});

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not set");
}

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "../client/dist");

// vercel and render sit in front of us, so take the client ip from their X-Forwarded-For
app.set("trust proxy", 1);

// keep in sync with the headers in vercel.json, which serves the static files there
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "img-src": ["'self'", "data:"],
            "connect-src": ["'self'"],
            "object-src": ["'none'"],
            "base-uri": ["'self'"],
            "form-action": ["'self'"],
            "frame-ancestors": ["'none'"],
            "upgrade-insecure-requests": isProduction ? [] : null,
        },
    },
    frameguard: { action: "deny" },
}));

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

// make sure mongo is connected before hitting the db (cold starts on vercel)
app.use("/api", async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error(err);
        res.status(503).json({ message: "Database unavailable" });
    }
});

//auth
app.use("/api/auth", authRouter);

//week
app.use("/api/week", requireAuth, weekRouter);

//settings
app.use("/api/settings", requireAuth, settingsRouter);

// unknown api routes shouldn't fall through to the react app
app.use("/api", (req, res) => {
    res.status(404).json({ message: "Not found" });
});

// serve the built react app
app.use(express.static(clientDist));
app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
});

// express's default handler sends html, and a stack trace outside production
app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ message: "Malformed JSON" });
    }
    if (err.type === "entity.too.large") {
        return res.status(413).json({ message: "Request is too large" });
    }
    const status = err.status ?? err.statusCode;
    if (status >= 400 && status < 500) {
        return res.status(status).json({ message: status === 404 ? "Not found" : "Bad request" });
    }
    console.error(err);
    res.status(500).json({ message: "Server error" });
});

export default app;
