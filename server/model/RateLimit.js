import mongoose from "mongoose";

const Schema = mongoose.Schema;

// hit counters for the rate limiter, stored in mongo so they're shared across serverless instances
const rateLimitSchema = new Schema({
    _id: String, // limiter prefix + client key
    hits: { type: Number, required: true },
    resetAt: { type: Date, required: true },
});

rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

const RateLimit = mongoose.model("RateLimit", rateLimitSchema);
export default RateLimit;
