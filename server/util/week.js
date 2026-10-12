import Week from "../model/Week.js";
import User from "../model/User.js";

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// returns the "YYYY-MM-DD" key of the week containing `now`, in the user's timezone
export function currentWeekKey(timezone, weekStartsOn, now = new Date()) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            year: "numeric",
            month: "numeric",
            day: "numeric",
            weekday: "short",
        }).formatToParts(now).map(p => [p.type, p.value])
    );

    const daysSinceStart = (WEEKDAYS[parts.weekday] - weekStartsOn + 7) % 7;
    const start = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - daysSinceStart));
    return start.toISOString().slice(0, 10);
}

export function weekStartFromKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

// closes every open week before the current one and adds its leftover (or overspend) to the reserve
export async function closeFinishedWeeks(userId, currentKey) {
    const finished = await Week.find({ userId, status: "open", weekKey: { $lt: currentKey } }).select("_id");
    for (const { _id } of finished) {
        // match on status so a concurrent request can't credit the same week twice
        const closed = await Week.findOneAndUpdate(
            { _id, status: "open" },
            [{
                $set: {
                    status: "closed",
                    closedAt: "$$NOW",
                    rollovertoReserve: { $subtract: [{ $add: ["$startingBalance", "$carriedIn"] }, "$totalSpend"] },
                },
            }],
            { returnDocument: "after", updatePipeline: true }
        );
        if (closed) {
            await User.updateOne({ _id: userId }, { $inc: { reserveCash: closed.rollovertoReserve } });
        }
    }
}

export async function getOrCreateCurrentWeek(userId) {
    const user = await User.findById(userId);
    if (!user) {
        return null;
    }

    const weekKey = currentWeekKey(user.timezone, user.weekStartsOn);
    await closeFinishedWeeks(userId, weekKey);
    const filter = { userId, weekKey };
    try {
        return await Week.findOneAndUpdate(
            filter,
            { $setOnInsert: { weekStart: weekStartFromKey(weekKey), startingBalance: user.weeklyAllowance } },
            { upsert: true, returnDocument: "after" }
        );
    } catch (err) {
        // two requests raced to create the same week; the other one won
        if (err.code === 11000) {
            return await Week.findOne(filter);
        }
        throw err;
    }
}
