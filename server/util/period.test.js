import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentWeekKey, dateFromKey, localDateKey, monthBounds, addDays, periodRange } from "./period.js";

describe("currentWeekKey()", () => {
    it("returns the monday of the week when weeks start on monday", () => {
        // wed sept 16 2026, noon in LA
        const now = new Date("2026-09-16T19:00:00Z");
        assert.equal(currentWeekKey("America/Los_Angeles", 1, now), "2026-09-14");
    });

    it("returns the sunday of the week when weeks start on sunday", () => {
        const now = new Date("2026-09-16T19:00:00Z");
        assert.equal(currentWeekKey("America/Los_Angeles", 0, now), "2026-09-13");
    });

    it("treats the start day itself as the start of the week", () => {
        const now = new Date("2026-09-14T19:00:00Z");
        assert.equal(currentWeekKey("America/Los_Angeles", 1, now), "2026-09-14");
    });

    it("crosses month and year boundaries", () => {
        // fri jan 1 2027 -> monday dec 28 2026
        const now = new Date("2027-01-01T20:00:00Z");
        assert.equal(currentWeekKey("America/Los_Angeles", 1, now), "2026-12-28");
    });

    it("uses the user's local date, not the UTC date", () => {
        // 2026-09-14T03:00Z is still sunday sept 13 in LA, so the previous monday week
        const now = new Date("2026-09-14T03:00:00Z");
        assert.equal(currentWeekKey("America/Los_Angeles", 1, now), "2026-09-07");
        assert.equal(currentWeekKey("UTC", 1, now), "2026-09-14");
    });
});

describe("dateFromKey()", () => {
    it("returns UTC midnight of the key's date", () => {
        assert.equal(dateFromKey("2026-09-14").toISOString(), "2026-09-14T00:00:00.000Z");
    });
});

describe("localDateKey()", () => {
    it("uses the user's local date, not the UTC date", () => {
        const now = new Date("2026-10-01T03:00:00Z");
        assert.equal(localDateKey("America/Los_Angeles", now), "2026-09-30");
        assert.equal(localDateKey("UTC", now), "2026-10-01");
    });
});

describe("monthBounds()", () => {
    it("returns the first of the month and the first of the next month", () => {
        assert.deepEqual(monthBounds("2026-10-15"), { start: "2026-10-01", end: "2026-11-01" });
    });

    it("crosses the year boundary", () => {
        assert.deepEqual(monthBounds("2026-12-31"), { start: "2026-12-01", end: "2027-01-01" });
    });

    it("handles february in leap and non-leap years", () => {
        assert.equal(monthBounds("2028-02-10").end, "2028-03-01");
        assert.equal(monthBounds("2027-02-10").end, "2027-03-01");
    });
});

describe("addDays()", () => {
    it("crosses month boundaries", () => {
        assert.equal(addDays("2026-09-29", 7), "2026-10-06");
        assert.equal(addDays("2026-10-01", -1), "2026-09-30");
    });
});

describe("periodRange()", () => {
    it("treats weeks without period fields as a full week from weekKey", () => {
        assert.deepEqual(periodRange({ weekKey: "2020-01-06" }), { start: "2020-01-06", end: "2020-01-13" });
    });
});
