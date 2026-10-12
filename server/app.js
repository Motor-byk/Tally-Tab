import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "../client/dist");

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

export default app;
