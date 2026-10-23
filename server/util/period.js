import Period from "../model/Period.js";
import User from "../model/User.js";

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_MS = 24 * 60 * 60 * 1000;

function localParts(timezone, now) {
    return Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            year: "numeric",
            month: "numeric",
            day: "numeric",
            weekday: "short",
        }).formatToParts(now).map(p => [p.type, p.value])
    );
}

function keyFromUTC(date) {
    return date.toISOString().slice(0, 10);
}

// returns the "YYYY-MM-DD" date of `now` in the user's timezone
export function localDateKey(timezone, now = new Date()) {
    const parts = localParts(timezone, now);
    return keyFromUTC(new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))));
}

// returns the "YYYY-MM-DD" key of the week containing `now`, in the user's timezone
export function currentWeekKey(timezone, weekStartsOn, now = new Date()) {
    const parts = localParts(timezone, now);
    const daysSinceStart = (WEEKDAYS[parts.weekday] - weekStartsOn + 7) % 7;
    const start = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - daysSinceStart));
    return keyFromUTC(start);
}

export function dateFromKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(key, days) {
    return keyFromUTC(new Date(dateFromKey(key).getTime() + days * DAY_MS));
}

// the calendar month containing `key`, end exclusive
export function monthBounds(key) {
    const [y, m] = key.split("-").map(Number);
    return {
        start: keyFromUTC(new Date(Date.UTC(y, m - 1, 1))),
        end: keyFromUTC(new Date(Date.UTC(y, m, 1))),
    };
}

export function weekBounds(weekKey) {
    return { start: weekKey, end: addDays(weekKey, 7) };
}

export function monthKey(periodStart) {
    return `M:${periodStart}`;
}

// weeks created before months existed have no periodStart/periodEnd
export function periodRange(period) {
    const start = period.periodStart ?? period.weekKey;
    return { start, end: period.periodEnd ?? addDays(start, 7) };
}

// closes every open period that ended on or before `today` and adds its leftover (or overspend) to the reserve
export async function closeFinishedPeriods(userId, today) {
    const open = await Period.find({ userId, status: "open" }).select("_id weekKey periodStart periodEnd");
    const finished = open.filter(period => periodRange(period).end <= today);
    for (const { _id } of finished) {
        // match on status so a concurrent request can't credit the same period twice
        const closed = await Period.findOneAndUpdate(
            { _id, status: "open" },
            [{
                $set: {
                    status: "closed",
                    closedAt: "$$NOW",
                    rollovertoReserve: { $subtract: ["$startingBalance", "$totalSpend"] },
                },
            }],
            { returnDocument: "after", updatePipeline: true }
        );
        if (closed) {
            await User.updateOne({ _id: userId }, { $inc: { reserveCash: closed.rollovertoReserve } });
        }
    }
}

// the natural period for the user's mode when nothing is open, e.g. a new week or a new calendar month
function naturalPeriod(user, today) {
    if (user.budgetPeriod === "monthly") {
        const { start, end } = monthBounds(today);
        return { kind: "month", weekKey: monthKey(start), periodStart: start, periodEnd: end, startingBalance: user.monthlyAllowance };
    }
    const weekKey = currentWeekKey(user.timezone, user.weekStartsOn);
    const { start, end } = weekBounds(weekKey);
    return { kind: "week", weekKey, periodStart: start, periodEnd: end, startingBalance: user.weeklyAllowance };
}

export async function getOrCreateCurrentPeriod(userId) {
    const user = await User.findById(userId);
    if (!user) {
        return null;
    }

    const today = localDateKey(user.timezone);
    await closeFinishedPeriods(userId, today);

    // anything still open covers today, it may be a partial period left by a mode switch
    const open = await Period.findOne({ userId, status: "open" }).sort({ weekStart: -1 });
    if (open) {
        return open;
    }

    const { weekKey, ...fields } = naturalPeriod(user, today);
    const filter = { userId, weekKey };
    try {
        return await Period.findOneAndUpdate(
            filter,
            { $setOnInsert: { ...fields, weekStart: dateFromKey(fields.periodStart) } },
            { upsert: true, returnDocument: "after" }
        );
    } catch (err) {
        // two requests raced to create the same period; the other one won
        if (err.code === 11000) {
            return await Period.findOne(filter);
        }
        throw err;
    }
}
