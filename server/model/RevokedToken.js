import mongoose from "mongoose";

const Schema = mongoose.Schema;

// jwt ids that were logged out before they expired
const revokedTokenSchema = new Schema({
    _id: String, // the token's jti
    expiresAt: { type: Date, required: true },
});

// mongo deletes the entry once the token would have expired anyway
revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RevokedToken = mongoose.model("RevokedToken", revokedTokenSchema);
export default RevokedToken;
