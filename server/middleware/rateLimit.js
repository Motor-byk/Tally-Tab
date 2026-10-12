import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import RateLimit from "../model/RateLimit.js";

// express-rate-limit store backed by mongo. the default memory store resets on every
// serverless cold start and isn't shared between instances, so it can't stop brute force on vercel
class MongoStore {
    constructor(prefix) {
        this.prefix = prefix;
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    async increment(key) {
        const _id = this.prefix + key;
        const live = { $gt: ["$resetAt", "$$NOW"] };
        const update = [{
            $set: {
                // start a fresh window if the old one ran out
                hits: { $cond: [live, { $add: ["$hits", 1] }, 1] },
                resetAt: { $cond: [live, "$resetAt", { $add: ["$$NOW", this.windowMs] }] },
            },
        }];
        const options = { upsert: true, returnDocument: "after", updatePipeline: true };
        let doc;
        try {
            doc = await RateLimit.findOneAndUpdate({ _id }, update, options);
        } catch (err) {
            // two requests raced to create the counter; the retry updates the one that won
            if (err.code !== 11000) throw err;
            doc = await RateLimit.findOneAndUpdate({ _id }, update, options);
        }
        return { totalHits: doc.hits, resetTime: doc.resetAt };
    }

    async decrement(key) {
        await RateLimit.updateOne({ _id: this.prefix + key, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
    }

    async resetKey(key) {
        await RateLimit.deleteOne({ _id: this.prefix + key });
    }
}

const tooMany = (req, res) => {
    res.status(429).json({ message: "Too many attempts, please try again later" });
};

const ipKey = (req) => ipKeyGenerator(req.ip);

function emailKey(req) {
    const email = req.body?.email;
    return typeof email === "string" ? email.trim().toLowerCase() : ipKey(req);
}

// failed logins per ip, so one client can't guess passwords across many accounts
export const loginIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    keyGenerator: ipKey,
    store: new MongoStore("login-ip:"),
    handler: tooMany,
});

// failed logins per account, so a botnet can't spread guesses on one account across ips
export const loginAccountLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: emailKey,
    store: new MongoStore("login-email:"),
    handler: tooMany,
});

export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    keyGenerator: ipKey,
    store: new MongoStore("register-ip:"),
    handler: tooMany,
});
