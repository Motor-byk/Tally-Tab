import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { startApp, stopApp, newUser } from "./helpers.js";
import connectDB from "../configuration/connection.js";
import { backfill, cleanup } from "../scripts/migratePeriodFields.js";
import Period from "../model/Period.js";

let app;
before(async () => {
    app = await startApp();
    await connectDB();
});
after(stopApp);

const userId = new mongoose.Types.ObjectId();

// the shapes in production before the migration, each test gets its own copy of the collection
let weeks;
let counter = 0;
beforeEach(async () => {
    weeks = mongoose.connection.db.collection(`weeks_migration_${counter++}`);
    await weeks.insertMany([
        // from before months existed
        { userId, weekKey: "2020-01-06", weekStart: new Date("2020-01-06"), startingBalance: 10000, totalSpend: 0, status: "closed" },
        { userId, weekKey: "2025-12-29", weekStart: new Date("2025-12-29"), startingBalance: 10000, totalSpend: 0, status: "closed" },
        // from after
        {
            userId, kind: "week", weekKey: "2026-09-28", weekStart: new Date("2026-09-28"),
            periodStart: "2026-09-28", periodEnd: "2026-10-05", startingBalance: 10000, totalSpend: 0, status: "closed",
        },
        {
            userId, kind: "month", weekKey: "M:2026-10-01", weekStart: new Date("2026-10-01"),
            periodStart: "2026-10-01", periodEnd: "2026-11-01", startingBalance: 40000, totalSpend: 0, status: "open",
        },
    ]);
    await weeks.createIndex({ userId: 1, weekKey: 1 }, { unique: true, name: "userId_1_weekKey_1" });
});

async function byWeekKey(key) {
    return await weeks.findOne({ weekKey: key });
}

async function indexesByName() {
    return Object.fromEntries((await weeks.indexes()).map(i => [i.name, i]));
}

describe("migration backfill", () => {
    it("only reports on a dry run", async () => {
        const docs = await weeks.find().toArray();
        const report = await backfill(weeks);
        assert.deepEqual(report, { legacyWeeks: 2, missingPeriodKey: 4, hasNewIndex: false, hasOldIndex: true });
        assert.deepEqual(await weeks.find().toArray(), docs);
        assert.deepEqual(Object.keys(await indexesByName()).sort(), ["_id_", "userId_1_weekKey_1"]);
    });

    it("fills in legacy weeks and copies weekKey to periodKey", async () => {
        const report = await backfill(weeks, { apply: true });
        assert.deepEqual(report, { legacyWeeks: 2, missingPeriodKey: 4, stillMissingFields: 0 });

        const legacy = await byWeekKey("2020-01-06");
        assert.equal(legacy.kind, "week");
        assert.equal(legacy.periodKey, "2020-01-06");
        assert.equal(legacy.periodStart, "2020-01-06");
        assert.equal(legacy.periodEnd, "2020-01-13");
        // crosses a year
        assert.equal((await byWeekKey("2025-12-29")).periodEnd, "2026-01-05");

        const month = await byWeekKey("M:2026-10-01");
        assert.equal(month.periodKey, "M:2026-10-01");
        assert.equal(month.periodStart, "2026-10-01");
        assert.equal(month.periodEnd, "2026-11-01");
        // the old fields stay until cleanup so the old code keeps working
        assert.ok(legacy.weekStart instanceof Date);
    });

    it("swaps the old index for a partial one and is safe to rerun", async () => {
        await backfill(weeks, { apply: true });
        const docs = await weeks.find().toArray();
        const report = await backfill(weeks, { apply: true });
        assert.deepEqual(report, { legacyWeeks: 0, missingPeriodKey: 0, stillMissingFields: 0 });
        assert.deepEqual(await weeks.find().toArray(), docs);

        const indexes = await indexesByName();
        assert.equal(indexes.userId_1_periodKey_1.unique, true);
        assert.equal(indexes.userId_1_weekKey_1.unique, true);
        assert.deepEqual(indexes.userId_1_weekKey_1.partialFilterExpression, { weekKey: { $exists: true } });
    });

    it("lets new periods without a weekKey coexist but still blocks duplicates", async () => {
        await backfill(weeks, { apply: true });
        await weeks.insertMany([
            { userId, periodKey: "2026-10-19", periodStart: "2026-10-19", periodEnd: "2026-10-26" },
            { userId, periodKey: "2026-10-26", periodStart: "2026-10-26", periodEnd: "2026-11-02" },
        ]);
        await assert.rejects(weeks.insertOne({ userId, periodKey: "2026-10-26" }), { code: 11000 });
        await assert.rejects(weeks.insertOne({ userId, weekKey: "2020-01-06" }), { code: 11000 });
    });

    it("stops an old instance from recreating the full weekKey index", async () => {
        await backfill(weeks, { apply: true });
        // what mongoose's autoIndex does when the old code starts up
        await assert.rejects(
            weeks.createIndex({ userId: 1, weekKey: 1 }, { unique: true, name: "userId_1_weekKey_1" }),
            { codeName: "IndexKeySpecsConflict" }
        );
        assert.ok((await indexesByName()).userId_1_weekKey_1.partialFilterExpression);
    });
});

describe("migration cleanup", () => {
    it("only reports on a dry run", async () => {
        await backfill(weeks, { apply: true });
        const docs = await weeks.find().toArray();
        const report = await cleanup(weeks);
        assert.equal(report.docsWithOldFields, 4);
        assert.deepEqual(await weeks.find().toArray(), docs);
    });

    it("backfills stragglers, then removes weekKey, weekStart and the old index", async () => {
        await backfill(weeks, { apply: true });
        // created by the old code between the backfill and the deploy
        await weeks.insertOne({ userId, weekKey: "2026-10-19", weekStart: new Date("2026-10-19"), startingBalance: 1, status: "open" });

        const report = await cleanup(weeks, { apply: true });
        assert.equal(report.backfill.legacyWeeks, 1);
        assert.equal(report.docsWithOldFields, 5);
        assert.equal(await weeks.countDocuments({ $or: [{ weekKey: { $exists: true } }, { weekStart: { $exists: true } }] }), 0);
        assert.equal((await weeks.findOne({ periodKey: "2026-10-19" })).periodEnd, "2026-10-26");
        assert.deepEqual(Object.keys(await indexesByName()).sort(), ["_id_", "userId_1_periodKey_1"]);
    });

    it("refuses to remove the old fields while a doc can't be backfilled", async () => {
        await weeks.insertOne({ userId: new mongoose.Types.ObjectId(), startingBalance: 1, status: "open" });
        await assert.rejects(cleanup(weeks, { apply: true }), /1 docs are still missing/);
        assert.equal(await weeks.countDocuments({ weekKey: { $exists: true } }), 4);
    });
});

describe("app after the migration", () => {
    it("closes a migrated legacy week into the reserve", async () => {
        const { agent, user } = await newUser(app);
        await Period.deleteMany({ userId: user._id });
        const real = mongoose.connection.db.collection("weeks");
        await real.insertOne({
            userId: new mongoose.Types.ObjectId(user._id), weekKey: "2020-01-06", weekStart: new Date("2020-01-06"),
            startingBalance: 10000, totalSpend: 2500, expenses: [{ itemName: "x", amount: 2500 }], status: "open",
        });
        await backfill(real, { apply: true });

        const { period, user: me } = (await agent.get("/api/period/current")).body;
        assert.equal(me.reserveCash, 7500);
        assert.notEqual(period.periodKey, "2020-01-06");
        const legacy = await Period.findOne({ userId: user._id, periodKey: "2020-01-06" });
        assert.equal(legacy.status, "closed");
        assert.equal(legacy.rollovertoReserve, 7500);
    });
});
