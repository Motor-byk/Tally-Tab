import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../model/User.js";
import RevokedToken from "../model/RevokedToken.js";
import requireAuth from "../middleware/requireAuth.js";
import { loginIpLimiter, loginAccountLimiter, registerLimiter } from "../middleware/rateLimit.js";
import { MAX_EMAIL_LENGTH, MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES } from "../util/limits.js";

const router = express.Router();

const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
};

// compared against when the email doesn't exist, so a miss takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setAuthCookie(res, userId) {
    const token = jwt.sign({ sub: userId.toString() }, process.env.JWT_SECRET, {
        expiresIn: "7d",
        algorithm: "HS256",
        jwtid: crypto.randomUUID(),
    });
    res.cookie("token", token, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function publicUser(user) {
    const { passwordHash, ...rest } = user.toObject();
    return rest;
}

function normalizeEmail(email) {
    return email.trim().toLowerCase();
}

function passwordTooLong(password) {
    return Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES;
}

router.post("/register", registerLimiter, async (req, res) => {
    try {
        const { email, password } = req.body ?? {};
        if (typeof email !== "string" || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email.trim())) {
            return res.status(400).json({ message: "A valid email is required" });
        }
        if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }
        if (passwordTooLong(password)) {
            return res.status(400).json({ message: "Password is too long" });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await User.create({ email: normalizeEmail(email), passwordHash });

        setAuthCookie(res, user._id);
        res.status(201).json(publicUser(user));
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: "An account with that email already exists" });
        }
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/login", loginIpLimiter, loginAccountLimiter, async (req, res) => {
    try {
        const { email, password } = req.body ?? {};
        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "Email and password are required" });
        }
        // anything past 72 bytes would be silently ignored by bcrypt
        if (email.length > MAX_EMAIL_LENGTH || passwordTooLong(password)) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const user = await User.findOne({ email: normalizeEmail(email) });
        const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !matches) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        setAuthCookie(res, user._id);
        res.status(200).json(publicUser(user));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/logout", async (req, res) => {
    // revoke the token so a copied cookie stops working too, not just this browser's
    try {
        const payload = jwt.verify(req.cookies?.token ?? "", process.env.JWT_SECRET, { algorithms: ["HS256"] });
        if (typeof payload.jti === "string") {
            await RevokedToken.updateOne(
                { _id: payload.jti },
                { expiresAt: new Date(payload.exp * 1000) },
                { upsert: true }
            );
        }
    } catch (err) {
        // a missing or invalid token has nothing to revoke
        if (!(err instanceof jwt.JsonWebTokenError)) {
            console.error(err);
            return res.status(500).json({ message: "Server error" });
        }
    }
    res.clearCookie("token", cookieOptions);
    res.status(204).end();
});

router.get("/me", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select("-passwordHash");
        if (!user) {
            return res.status(401).json({ message: "Not authenticated" });
        }
        res.status(200).json(user);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
