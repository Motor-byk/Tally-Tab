import express from "express";
import User from "../model/User.js";
import Week from "../model/Week.js";
import { getOrCreateCurrentWeek } from "../util/week.js";
import { MAX_CENTS } from "../util/limits.js";

const router = express.Router();

router.patch("/", async (req, res) => {
    try {
        const { weeklyAllowance } = req.body ?? {};
        if (!Number.isInteger(weeklyAllowance) || weeklyAllowance < 0 || weeklyAllowance > MAX_CENTS) {
            return res.status(400).json({ message: "Starting balance must be between $0 and $1,000,000" });
        }

        const user = await User.findByIdAndUpdate(
            req.userId,
            { weeklyAllowance },
            { returnDocument: "after", runValidators: true }
        ).select("-passwordHash");
        if (!user) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        // only the current week picks up the new balance, past weeks keep theirs
        const currentWeek = await getOrCreateCurrentWeek(req.userId);
        const week = await Week.findByIdAndUpdate(
            currentWeek._id,
            { startingBalance: weeklyAllowance },
            { returnDocument: "after" }
        );
        res.status(200).json({ user, week });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
