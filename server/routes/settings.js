import express from "express";
import User from "../model/User.js";
import Period from "../model/Period.js";
import {
    getOrCreateCurrentPeriod, closeFinishedPeriods, currentWeekKey, localDateKey, dateFromKey,
    monthBounds, weekBounds, monthKey, periodRange,
} from "../util/period.js";
import { MAX_CENTS } from "../util/limits.js";

const router = express.Router();

const BUDGET_PERIODS = ["weekly", "monthly"];

function isValidAllowance(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_CENTS;
}

// weekly -> monthly: the current week becomes the rest of this month, keeping its expenses
async function switchToMonthly(user, week) {
    const { start: weekStart } = periodRange(week);
    const month = monthBounds(localDateKey(user.timezone));
    const periodStart = weekStart > month.start ? weekStart : month.start;
    return await Period.findOneAndUpdate(
        { _id: week._id, status: "open", kind: "week" },
        {
            kind: "month",
            weekKey: monthKey(periodStart),
            weekStart: dateFromKey(periodStart),
            periodStart,
            periodEnd: month.end,
            startingBalance: user.monthlyAllowance,
        },
        { returnDocument: "after" }
    );
}

// monthly -> weekly: the month closes early with the expenses from before this week,
// everything from this week on moves into a new week
async function switchToWeekly(user, month) {
    const wk = currentWeekKey(user.timezone, user.weekStartsOn);
    const week = weekBounds(wk);
    const { start: monthStart } = periodRange(month);

    if (monthStart >= wk) {
        // the month started inside this week, so none of it is before the week and it just becomes the week
        return await Period.findOneAndUpdate(
            { _id: month._id, status: "open", kind: "month" },
            {
                kind: "week",
                weekKey: wk,
                periodEnd: week.end,
                startingBalance: user.weeklyAllowance,
            },
            { returnDocument: "after" }
        );
    }

    const moved = month.expenses.filter(e => localDateKey(user.timezone, e.spentAt) >= wk);
    const movedTotal = moved.reduce((total, e) => total + e.amount, 0);

    // matching on status means a concurrent switch can only split the month once
    const cut = await Period.findOneAndUpdate(
        { _id: month._id, status: "open", kind: "month" },
        {
            $pull: { expenses: { _id: { $in: moved.map(e => e._id) } } },
            $inc: { totalSpend: -movedTotal },
            $set: { periodEnd: wk },
        },
        { returnDocument: "after" }
    );
    if (!cut) {
        return await getOrCreateCurrentPeriod(user._id);
    }
    // the month now ends at the start of this week, so the normal close credits its leftover to the reserve
    await closeFinishedPeriods(user._id, localDateKey(user.timezone));

    return await Period.findOneAndUpdate(
        { userId: user._id, weekKey: wk },
        {
            $setOnInsert: {
                kind: "week",
                weekStart: dateFromKey(wk),
                periodStart: week.start,
                periodEnd: week.end,
                startingBalance: user.weeklyAllowance,
            },
            $push: { expenses: { $each: moved.map(e => e.toObject()) } },
            $inc: { totalSpend: movedTotal },
        },
        { upsert: true, returnDocument: "after" }
    );
}

router.patch("/", async (req, res) => {
    try {
        const { budgetPeriod, weeklyAllowance, monthlyAllowance } = req.body ?? {};
        if (budgetPeriod === undefined && weeklyAllowance === undefined && monthlyAllowance === undefined) {
            return res.status(400).json({ message: "Nothing to update" });
        }
        if (budgetPeriod !== undefined && !BUDGET_PERIODS.includes(budgetPeriod)) {
            return res.status(400).json({ message: "Budget period must be weekly or monthly" });
        }
        if ((weeklyAllowance !== undefined && !isValidAllowance(weeklyAllowance))
            || (monthlyAllowance !== undefined && !isValidAllowance(monthlyAllowance))) {
            return res.status(400).json({ message: "Starting balance must be between $0 and $1,000,000" });
        }

        // closes anything that already finished under the old settings
        const current = await getOrCreateCurrentPeriod(req.userId);
        if (!current) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        const update = Object.fromEntries(
            Object.entries({ budgetPeriod, weeklyAllowance, monthlyAllowance }).filter(([, v]) => v !== undefined)
        );
        const user = await User.findByIdAndUpdate(req.userId, update, { returnDocument: "after", runValidators: true });
        if (!user) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        let period = current;
        const wantsMonth = user.budgetPeriod === "monthly";
        if (wantsMonth && current.kind === "week") {
            period = await switchToMonthly(user, current);
        } else if (!wantsMonth && current.kind === "month") {
            period = await switchToWeekly(user, current);
        } else {
            // only the current period picks up the new balance, past ones keep theirs
            period = await Period.findByIdAndUpdate(
                current._id,
                { startingBalance: wantsMonth ? user.monthlyAllowance : user.weeklyAllowance },
                { returnDocument: "after" }
            );
        }
        // a concurrent request changed the period under us, fall back to whatever is current now
        period ??= await getOrCreateCurrentPeriod(req.userId);

        // re-fetch so the reserve includes a month that was just closed early
        const fresh = await User.findById(req.userId).select("-passwordHash");
        res.status(200).json({ user: fresh, period });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
