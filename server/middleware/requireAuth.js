import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import RevokedToken from "../model/RevokedToken.js";

export default async function requireAuth(req, res, next) {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).json({ message: "Not authenticated" });
    }
    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
        return res.status(401).json({ message: "Not authenticated" });
    }
    // sub goes straight into db queries, so make sure it's really an id and not an object
    if (typeof payload.sub !== "string" || !mongoose.isValidObjectId(payload.sub) || typeof payload.jti !== "string") {
        return res.status(401).json({ message: "Not authenticated" });
    }
    try {
        if (await RevokedToken.exists({ _id: payload.jti })) {
            return res.status(401).json({ message: "Not authenticated" });
        }
    } catch (err) {
        return next(err);
    }
    req.userId = payload.sub;
    req.tokenId = payload.jti;
    next();
}
