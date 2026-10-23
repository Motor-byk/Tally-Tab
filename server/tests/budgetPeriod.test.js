import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, newUser } from "./helpers.js";
import { currentWeekKey, localDateKey, monthBounds, addDays, monthKey } from "../util/period.js";
import Period from "../model/Period.js";

let app;
before(async () => { app = await startApp(); });
after(stopApp);

const TZ = "America/Los_Angeles";

// noon in LA on the given date, so the local date is unambiguous
function localNoon(key) {
    return new Date(`${key}T20:00:00Z`);
}

async function openPeriods(userId) {
    return await Period.find({ userId, status: "open" });
}

describe("monthly budget", () => {
    it("starts a full calendar month for a new monthly user and leaves the reserve alone mid-month", async () => {
        const { agent, user } = await newUser(app);
        await agent.patch("/api/settings").send({ budgetPeriod: "monthly", monthlyAllowance: 40000 }).expect(200);
        // drop the partial month left by the switch so the next lookup starts a fresh one
        await Period.deleteMany({ userId: user._id });

        const { period, user: me } = (await agent.get("/api/period/current")).body;
        const month = monthBounds(localDateKey(TZ));
        assert.equal(period.kind, "month");
        assert.equal(period.weekKey, monthKey(month.start));
        assert.equal(period.periodEnd, month.end);
        assert.equal(period.startingBalance, 40000);
        assert.equal(me.reserveCash, 0);

        await agent.post("/api/period/current/expenses").send({ itemName: "x", amount: 500 }).expect(201);
        assert.equal((await agent.get("/api/period/current")).body.user.reserveCash, 0);
    });

    it("closes a finished month into the reserve exactly once under concurrent requests", async () => {
        const { agent, user } = await newUser(app);
        await agent.patch("/api/settings").send({ budgetPeriod: "monthly", monthlyAllowance: 31000 }).expect(200);
        await Period.deleteMany({ userId: user._id });
        await Period.create({
            userId: user._id, kind: "month", weekKey: "M:2020-01-01", weekStart: new Date("2020-01-01"),
            periodStart: "2020-01-01", periodEnd: "2020-02-01", startingBalance: 31000, totalSpend: 1000,
        });
        await Promise.all(Array.from({ length: 15 }, () => agent.get("/api/period/current")));
        const { period, user: me } = (await agent.get("/api/period/current")).body;
        assert.equal(me.reserveCash, 30000);
        assert.equal(period.kind, "month");
        assert.equal(period.startingBalance, 31000);
        assert.equal((await openPeriods(user._id)).length, 1);
    });
});

describe("switching budget period", () => {
    it("weekly -> monthly keeps this week's expenses and uses the full monthly amount", async () => {
        const { agent, user } = await newUser(app);
        await agent.patch("/api/settings").send({ weeklyAllowance: 10000 }).expect(200);
        await agent.post("/api/period/current/expenses").send({ itemName: "coffee", amount: 500 }).expect(201);

        const res = await agent.patch("/api/settings").send({ budgetPeriod: "monthly", monthlyAllowance: 31000 }).expect(200);
        const wk = currentWeekKey(TZ, 1);
        const month = monthBounds(localDateKey(TZ));
        const start = wk > month.start ? wk : month.start;
        const { period } = res.body;
        assert.equal(period.kind, "month");
        assert.equal(period.periodStart, start);
        assert.equal(period.periodEnd, month.end);
        assert.equal(period.startingBalance, 31000);
        assert.equal(period.expenses.length, 1);
        assert.equal(period.totalSpend, 500);
        assert.equal(res.body.user.reserveCash, 0);
        assert.equal(res.body.user.budgetPeriod, "monthly");
        assert.equal((await openPeriods(user._id)).length, 1);
    });

    it("monthly -> weekly closes the month early and moves this week's expenses into the week", async () => {
        const { agent, user } = await newUser(app);
        await agent.patch("/api/settings").send({ budgetPeriod: "monthly", monthlyAllowance: 30000 }).expect(200);

        // pretend the month started 10 days before this week so there's always an earlier part to close
        const wk = currentWeekKey(TZ, 1);
        const today = localDateKey(TZ);
        const periodStart = addDays(wk, -10);
        await Period.deleteMany({ userId: user._id });
        await Period.create({
            userId: user._id, kind: "month", weekKey: monthKey(periodStart), weekStart: new Date(periodStart),
            periodStart, periodEnd: monthBounds(today).end, startingBalance: 30000, totalSpend: 1300,
            expenses: [
                { itemName: "early", amount: 1000, spentAt: localNoon(addDays(wk, -5)) },
                { itemName: "late", amount: 300, spentAt: localNoon(wk) },
            ],
        });

        const res = await agent.patch("/api/settings").send({ budgetPeriod: "weekly", weeklyAllowance: 7000 }).expect(200);
        const { period } = res.body;
        assert.equal(period.kind, "week");
        assert.equal(period.weekKey, wk);
        assert.equal(period.startingBalance, 7000);
        assert.deepEqual(period.expenses.map(e => e.itemName), ["late"]);
        assert.equal(period.totalSpend, 300);

        const closed = await Period.findOne({ userId: user._id, weekKey: monthKey(periodStart) });
        const expected = 30000 - 1000;
        assert.equal(closed.status, "closed");
        assert.equal(closed.periodEnd, wk);
        assert.deepEqual(closed.expenses.map(e => e.itemName), ["early"]);
        assert.equal(closed.rollovertoReserve, expected);
        assert.equal(res.body.user.reserveCash, expected);
        assert.equal((await openPeriods(user._id)).length, 1);
    });

    it("can switch back and forth within a month without losing expenses", async () => {
        const { agent, user } = await newUser(app);
        await agent.patch("/api/settings").send({ weeklyAllowance: 7000, monthlyAllowance: 30000 }).expect(200);
        await agent.post("/api/period/current/expenses").send({ itemName: "x", amount: 100 }).expect(201);
        for (const budgetPeriod of ["monthly", "weekly", "monthly", "weekly", "monthly"]) {
            const res = await agent.patch("/api/settings").send({ budgetPeriod });
            assert.equal(res.status, 200, budgetPeriod);
            assert.equal(res.body.period.kind, budgetPeriod === "monthly" ? "month" : "week");
            assert.equal(res.body.period.totalSpend, 100);
        }
        assert.equal((await openPeriods(user._id)).length, 1);
        assert.equal((await agent.get("/api/auth/me")).body.reserveCash, 0);
    });

    it("changing only the inactive mode's amount leaves the current period alone", async () => {
        const { agent } = await newUser(app);
        await agent.patch("/api/settings").send({ weeklyAllowance: 7000 }).expect(200);
        const res = await agent.patch("/api/settings").send({ monthlyAllowance: 99999 }).expect(200);
        assert.equal(res.body.period.kind, "week");
        assert.equal(res.body.period.startingBalance, 7000);
        assert.equal(res.body.user.monthlyAllowance, 99999);
    });
});
