import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import crypto from "crypto";
import { startApp, stopApp, newUser, uniqueEmail, anon, TEST_SECRET } from "./helpers.js";
import { MAX_CENTS, MAX_ITEM_NAME_LENGTH, MAX_CATEGORY_LENGTH, MAX_EXPENSES_PER_WEEK } from "../util/limits.js";
import RevokedToken from "../model/RevokedToken.js";
import Period from "../model/Period.js";
import User from "../model/User.js";

let app;
before(async () => { app = await startApp(); });
after(stopApp);

const PROTECTED = [
    ["get", "/api/auth/me"],
    ["get", "/api/period/current"],
    ["post", "/api/period/current/expenses"],
    ["delete", `/api/period/${new mongoose.Types.ObjectId()}/expenses/${new mongoose.Types.ObjectId()}`],
    ["patch", "/api/settings"],
];

// a token that passes every check except the one under test
function sign(payload, secret = TEST_SECRET) {
    return jwt.sign({ jti: crypto.randomUUID(), ...payload }, secret);
}

function withToken(method, path, token) {
    return request(app)[method](path).set("Cookie", `token=${token}`);
}

function assertNoSecrets(body) {
    const text = JSON.stringify(body);
    assert.ok(!text.includes("passwordHash"), "response leaked passwordHash");
    assert.ok(!/\$2[aby]\$/.test(text), "response leaked a bcrypt hash");
}

describe("authentication", () => {
    it("rejects every protected route without a cookie", async () => {
        for (const [method, path] of PROTECTED) {
            const res = await request(app)[method](path);
            assert.equal(res.status, 401, `${method.toUpperCase()} ${path}`);
        }
    });

    it("rejects tokens signed with the wrong secret", async () => {
        const { user } = await newUser(app);
        const forged = sign({ sub: user._id }, "wrong-secret");
        for (const [method, path] of PROTECTED) {
            assert.equal((await withToken(method, path, forged)).status, 401, `${method.toUpperCase()} ${path}`);
        }
    });

    it("rejects unsigned alg:none tokens", async () => {
        const { user } = await newUser(app);
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
        const none = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: user._id, jti: crypto.randomUUID() })}.`;
        assert.equal((await withToken("get", "/api/auth/me", none)).status, 401);
    });

    it("rejects a valid token whose payload was swapped to another user", async () => {
        const victim = await newUser(app);
        const attacker = await newUser(app);
        const [h, , s] = attacker.token.split(".");
        const payload = Buffer.from(JSON.stringify({ sub: victim.user._id, jti: jwt.decode(attacker.token).jti, iat: Math.floor(Date.now() / 1000) })).toString("base64url");
        assert.equal((await withToken("get", "/api/auth/me", `${h}.${payload}.${s}`)).status, 401);
    });

    it("rejects expired tokens", async () => {
        const { user } = await newUser(app);
        const expired = sign({ sub: user._id, exp: Math.floor(Date.now() / 1000) - 10 });
        assert.equal((await withToken("get", "/api/auth/me", expired)).status, 401);
    });

    it("rejects tokens for users that no longer exist", async () => {
        const ghost = sign({ sub: new mongoose.Types.ObjectId().toString() });
        for (const [method, path] of PROTECTED.filter(([m]) => m !== "delete")) {
            const req = withToken(method, path, ghost);
            const res = method === "post" ? await req.send({ itemName: "x", amount: 1 })
                : method === "patch" ? await req.send({ weeklyAllowance: 1 })
                : await req;
            assert.equal(res.status, 401, `${method.toUpperCase()} ${path}`);
        }
        assert.equal(await Period.countDocuments({ userId: jwt.decode(ghost).sub }), 0, "a period was created for a nonexistent user");
    });

    it("rejects tokens with a non-ObjectId subject without a 500", async () => {
        const weird = sign({ sub: { $ne: null } });
        const res = await withToken("get", "/api/period/current", weird);
        assert.equal(res.status, 401);
    });

    it("issues tokens that expire within 7 days", async () => {
        const { token } = await newUser(app);
        const { iat, exp } = jwt.decode(token);
        assert.ok(exp, "token has no expiry");
        assert.ok(exp - iat <= 7 * 24 * 3600);
    });

    it("sets the auth cookie HttpOnly and SameSite", async () => {
        const res = await anon(app, "post", "/api/auth/register").send({ email: uniqueEmail(), password: "password123" });
        const cookie = res.headers["set-cookie"][0];
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=(Lax|Strict)/i);
    });

    it("invalidates the session token on logout", async () => {
        const { agent, token } = await newUser(app);
        await agent.post("/api/auth/logout").expect(204);
        // an attacker who stole the cookie earlier should not keep access after the user logs out
        const res = await withToken("get", "/api/auth/me", token);
        assert.equal(res.status, 401, "token still works after logout");
    });

    it("only revokes the session that logged out", async () => {
        const { email, password, agent: laptop } = await newUser(app);
        const phone = (await anon(app, "post", "/api/auth/login").send({ email, password })).headers["set-cookie"][0].match(/token=([^;]+)/)[1];
        await laptop.post("/api/auth/logout").expect(204);
        assert.equal((await withToken("get", "/api/auth/me", phone)).status, 200);
    });

    it("cleans up revoked tokens once they would have expired", async () => {
        const { agent, token } = await newUser(app);
        await agent.post("/api/auth/logout").expect(204);
        const revoked = await RevokedToken.findById(jwt.decode(token).jti);
        assert.equal(revoked.expiresAt.getTime(), jwt.decode(token).exp * 1000);
        const ttl = (await RevokedToken.collection.indexes()).find(i => i.key.expiresAt);
        assert.equal(ttl?.expireAfterSeconds, 0, "no TTL index, revoked tokens pile up forever");
    });

    it("rejects tokens without a jti, since they could never be revoked", async () => {
        const { user } = await newUser(app);
        const noJti = jwt.sign({ sub: user._id }, TEST_SECRET);
        assert.equal((await withToken("get", "/api/auth/me", noJti)).status, 401);
    });

    it("rejects tokens signed with a different HMAC algorithm", async () => {
        const { user } = await newUser(app);
        const hs512 = jwt.sign({ sub: user._id, jti: crypto.randomUUID() }, TEST_SECRET, { algorithm: "HS512" });
        assert.equal((await withToken("get", "/api/auth/me", hs512)).status, 401);
    });
});

describe("credentials and accounts", () => {
    it("never returns the password hash from any endpoint", async () => {
        const { agent, email, password } = await newUser(app);
        assertNoSecrets((await agent.get("/api/auth/me")).body);
        assertNoSecrets((await anon(app, "post", "/api/auth/login").send({ email, password })).body);
        assertNoSecrets((await agent.get("/api/period/current")).body);
        assertNoSecrets((await agent.patch("/api/settings").send({ weeklyAllowance: 500 })).body);
        assertNoSecrets((await agent.post("/api/period/current/expenses").send({ itemName: "x", amount: 1 })).body);
    });

    it("hashes passwords with bcrypt at cost >= 10", async () => {
        const { email, password } = await newUser(app);
        const stored = await User.findOne({ email });
        assert.notEqual(stored.passwordHash, password);
        const cost = Number(stored.passwordHash.split("$")[2]);
        assert.ok(cost >= 10, `bcrypt cost is ${cost}`);
    });

    it("ignores privileged fields on register (mass assignment)", async () => {
        const forcedId = new mongoose.Types.ObjectId().toString();
        const res = await anon(app, "post", "/api/auth/register").send({
            email: uniqueEmail(), password: "password123",
            _id: forcedId, reserveCash: 1_000_000, weeklyAllowance: 999_999, passwordHash: "x", timezone: "Bad/Zone",
        });
        assert.equal(res.status, 201);
        assert.notEqual(res.body._id, forcedId);
        assert.equal(res.body.reserveCash, 0);
        assert.equal(res.body.weeklyAllowance, 0);
        assert.equal(res.body.timezone, "America/Los_Angeles");
    });

    it("ignores privileged fields on settings update", async () => {
        const { agent, user } = await newUser(app);
        await agent.patch("/api/settings").send({ weeklyAllowance: 100, reserveCash: 1_000_000, email: "admin@x.com", timezone: "Bad/Zone" });
        const me = (await agent.get("/api/auth/me")).body;
        assert.equal(me.reserveCash, 0);
        assert.equal(me.email, user.email);
        assert.equal(me.timezone, "America/Los_Angeles");
        // a bad timezone would 500 every period lookup
        assert.equal((await agent.get("/api/period/current")).status, 200);
    });

    it("treats emails case- and whitespace-insensitively so accounts can't be duplicated", async () => {
        const email = uniqueEmail();
        await anon(app, "post", "/api/auth/register").send({ email, password: "password123" }).expect(201);
        for (const variant of [email.toUpperCase(), ` ${email}`, `${email} `]) {
            const res = await anon(app, "post", "/api/auth/register").send({ email: variant, password: "password123" });
            assert.equal(res.status, 409, `"${variant}" created a second account`);
        }
    });

    it("refuses to register passwords longer than bcrypt can hash (72 bytes)", async () => {
        for (const password of ["a".repeat(73), "é".repeat(37)]) { // 73 and 74 bytes
            const res = await anon(app, "post", "/api/auth/register").send({ email: uniqueEmail(), password });
            assert.equal(res.status, 400, `${Buffer.byteLength(password)}-byte password accepted`);
        }
        await anon(app, "post", "/api/auth/register").send({ email: uniqueEmail(), password: "a".repeat(72) }).expect(201);
    });

    it("rejects a login that only matches the first 72 bytes (bcrypt truncation)", async () => {
        const base = "a".repeat(72);
        const { email } = await newUser(app, base);
        const res = await anon(app, "post", "/api/auth/login").send({ email, password: base + "totally-different" });
        assert.notEqual(res.status, 200, "login succeeded with the wrong password");
    });

    it("lets users log in with a differently cased or padded email", async () => {
        const { email, password } = await newUser(app);
        await anon(app, "post", "/api/auth/login").send({ email: ` ${email.toUpperCase()} `, password }).expect(200);
    });

    it("does not reveal whether an account exists through login response timing", async () => {
        const { email } = await newUser(app);
        const time = async (e) => {
            const start = performance.now();
            await anon(app, "post", "/api/auth/login").send({ email: e, password: "wrong-password" });
            return performance.now() - start;
        };
        let existing = 0, missing = 0;
        for (let i = 0; i < 5; i++) {
            existing += await time(email);
            missing += await time(uniqueEmail());
        }
        const ratio = existing / missing;
        assert.ok(ratio < 3, `existing accounts take ${ratio.toFixed(1)}x longer to reject (${(existing / 5).toFixed(0)}ms vs ${(missing / 5).toFixed(0)}ms)`);
    });

    it("rate-limits failed logins on one account even when every guess comes from a new ip", async () => {
        const { email, password } = await newUser(app);
        let limited = false;
        for (let i = 0; i < 30 && !limited; i++) {
            const res = await anon(app, "post", "/api/auth/login").send({ email, password: `guess-${i}` });
            limited = res.status === 429;
        }
        assert.ok(limited, "30 wrong passwords in a row were never throttled");
        // and the right password is refused too while locked, or the limit is useless
        assert.equal((await anon(app, "post", "/api/auth/login").send({ email, password })).status, 429);
    });

    it("rate-limits failed logins from one ip spread across many accounts", async () => {
        const ip = "203.0.113.7";
        let limited = false;
        for (let i = 0; i < 40 && !limited; i++) {
            const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: uniqueEmail(), password: "guess" });
            limited = res.status === 429;
        }
        assert.ok(limited, "40 failed logins from one ip were never throttled");
    });

    it("doesn't count successful logins toward the limit", async () => {
        const { email, password } = await newUser(app);
        for (let i = 0; i < 25; i++) {
            await anon(app, "post", "/api/auth/login").send({ email, password }).expect(200);
        }
    });

    it("can't be bypassed by changing the case of the email", async () => {
        const { email, password } = await newUser(app);
        for (let i = 0; i < 10; i++) {
            const variant = i % 2 ? email.toUpperCase() : ` ${email}`;
            await anon(app, "post", "/api/auth/login").send({ email: variant, password: `guess-${i}` });
        }
        assert.equal((await anon(app, "post", "/api/auth/login").send({ email, password: "guess" })).status, 429);
    });

    it("rate-limits mass account registration from one ip", async () => {
        const ip = "203.0.113.8";
        let limited = false;
        for (let i = 0; i < 30 && !limited; i++) {
            const res = await request(app).post("/api/auth/register").set("X-Forwarded-For", ip).send({ email: uniqueEmail(), password: "password123" });
            limited = res.status === 429;
        }
        assert.ok(limited, "30 accounts were created back to back without throttling");
    });

    it("returns JSON from the rate limiter", async () => {
        const ip = "203.0.113.9";
        let res;
        for (let i = 0; i < 10; i++) {
            res = await request(app).post("/api/auth/register").set("X-Forwarded-For", ip).send({ email: uniqueEmail(), password: "password123" });
        }
        assert.equal(res.status, 429);
        assert.match(res.body.message, /too many/i);
    });
});

describe("NoSQL injection", () => {
    it("rejects operator objects in login fields", async () => {
        await newUser(app);
        for (const body of [
            { email: { $ne: null }, password: { $ne: null } },
            { email: { $gt: "" }, password: "x" },
            { email: { $regex: ".*" }, password: "x" },
            { email: ["a@b.com"], password: "x" },
        ]) {
            const res = await anon(app, "post", "/api/auth/login").send(body);
            assert.equal(res.status, 400, JSON.stringify(body));
            assert.ok(!res.headers["set-cookie"], "a cookie was issued");
        }
    });

    it("treats regex characters in the login email literally", async () => {
        const { password } = await newUser(app);
        const res = await anon(app, "post", "/api/auth/login").send({ email: ".*", password });
        assert.equal(res.status, 401);
    });

    it("rejects operator objects in register", async () => {
        const res = await anon(app, "post", "/api/auth/register").send({ email: { $gt: "" }, password: "password123" });
        assert.equal(res.status, 400);
    });

    it("rejects operator objects in expense fields", async () => {
        const { agent } = await newUser(app);
        for (const body of [
            { itemName: { $ne: "" }, amount: 1 },
            { itemName: "x", amount: { $gt: 0 } },
            { itemName: "x", amount: 1, category: { $ne: "" } },
            { itemName: ["x"], amount: 1 },
        ]) {
            assert.equal((await agent.post("/api/period/current/expenses").send(body)).status, 400, JSON.stringify(body));
        }
    });

    it("rejects operator-shaped route params", async () => {
        const { agent } = await newUser(app);
        for (const p of ["%7B%22%24ne%22%3Anull%7D", "[$ne]=x", "000000000000000000000000' || '1'=='1"]) {
            const res = await agent.delete(`/api/period/${p}/expenses/${p}`);
            assert.equal(res.status, 404, p);
        }
    });

    it("rejects operator objects in settings", async () => {
        const { agent } = await newUser(app);
        assert.equal((await agent.patch("/api/settings").send({ weeklyAllowance: { $gt: 0 } })).status, 400);
        assert.equal((await agent.patch("/api/settings").send({ monthlyAllowance: { $gt: 0 } })).status, 400);
        assert.equal((await agent.patch("/api/settings").send({ budgetPeriod: { $ne: "weekly" } })).status, 400);
    });

    it("does not pollute Object.prototype from request bodies", async () => {
        const { agent } = await newUser(app);
        await agent.post("/api/period/current/expenses")
            .set("Content-Type", "application/json")
            .send('{"itemName":"x","amount":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}');
        assert.equal({}.polluted, undefined);
        assert.equal({}.polluted2, undefined);
    });
});

describe("authorization (IDOR)", () => {
    it("prevents one user from deleting another user's expense", async () => {
        const alice = await newUser(app);
        const mallory = await newUser(app);
        const period = (await alice.agent.post("/api/period/current/expenses").send({ itemName: "rent", amount: 5000 })).body;
        const expenseId = period.expenses[0]._id;

        const res = await mallory.agent.delete(`/api/period/${period._id}/expenses/${expenseId}`);
        assert.equal(res.status, 404);

        const after = (await alice.agent.get("/api/period/current")).body.period;
        assert.equal(after.expenses.length, 1);
        assert.equal(after.totalSpend, 5000);
    });

    it("prevents mixing your period id with someone else's expense id", async () => {
        const alice = await newUser(app);
        const mallory = await newUser(app);
        const aPeriod = (await alice.agent.post("/api/period/current/expenses").send({ itemName: "a", amount: 100 })).body;
        const mPeriod = (await mallory.agent.post("/api/period/current/expenses").send({ itemName: "m", amount: 100 })).body;

        const res = await mallory.agent.delete(`/api/period/${mPeriod._id}/expenses/${aPeriod.expenses[0]._id}`);
        assert.equal(res.status, 404);
        assert.equal((await mallory.agent.get("/api/period/current")).body.period.totalSpend, 100);
        assert.equal((await alice.agent.get("/api/period/current")).body.period.expenses.length, 1);
    });

    it("never returns another user's data from /period/current or /auth/me", async () => {
        const alice = await newUser(app);
        const bob = await newUser(app);
        await alice.agent.post("/api/period/current/expenses").send({ itemName: "alice-secret", amount: 100 });
        const body = JSON.stringify((await bob.agent.get("/api/period/current")).body) + JSON.stringify((await bob.agent.get("/api/auth/me")).body);
        assert.ok(!body.includes("alice-secret"));
        assert.ok(!body.includes(alice.email));
    });

    it("settings changes only affect the caller", async () => {
        const alice = await newUser(app);
        const bob = await newUser(app);
        await bob.agent.patch("/api/settings").send({ weeklyAllowance: 99999 }).expect(200);
        assert.equal((await alice.agent.get("/api/auth/me")).body.weeklyAllowance, 0);
    });
});

describe("input validation and data integrity", () => {
    it("rejects non-integer, negative, zero and string amounts", async () => {
        const { agent } = await newUser(app);
        for (const amount of [0, -1, -500, 1.5, "100", null, true, NaN]) {
            assert.equal((await agent.post("/api/period/current/expenses").send({ itemName: "x", amount })).status, 400, String(amount));
        }
    });

    it("rejects absurdly large amounts that break the balance math", async () => {
        const { agent } = await newUser(app);
        for (const amount of [1e308, Number.MAX_SAFE_INTEGER + 2, 1e20]) {
            const res = await agent.post("/api/period/current/expenses").send({ itemName: "x", amount });
            assert.equal(res.status, 400, `amount ${amount} was accepted`);
        }
        const period = (await agent.get("/api/period/current")).body.period;
        assert.ok(Number.isFinite(period.totalSpend), `totalSpend became ${period.totalSpend}`);
    });

    it("rejects absurdly large weekly allowances", async () => {
        const { agent } = await newUser(app);
        for (const weeklyAllowance of [1e308, Number.MAX_SAFE_INTEGER + 2]) {
            const res = await agent.patch("/api/settings").send({ weeklyAllowance });
            assert.equal(res.status, 400, `allowance ${weeklyAllowance} was accepted`);
        }
    });

    it("rejects negative, fractional and string allowances", async () => {
        const { agent } = await newUser(app);
        for (const weeklyAllowance of [-1, 1.5, "100", null]) {
            assert.equal((await agent.patch("/api/settings").send({ weeklyAllowance })).status, 400, String(weeklyAllowance));
        }
        for (const monthlyAllowance of [-1, 1.5, "100", null, MAX_CENTS + 1]) {
            assert.equal((await agent.patch("/api/settings").send({ monthlyAllowance })).status, 400, String(monthlyAllowance));
        }
    });

    it("rejects unknown budget periods and empty settings updates", async () => {
        const { agent } = await newUser(app);
        for (const budgetPeriod of ["yearly", "Weekly", null, 1]) {
            assert.equal((await agent.patch("/api/settings").send({ budgetPeriod })).status, 400, String(budgetPeriod));
        }
        assert.equal((await agent.patch("/api/settings").send({})).status, 400);
        assert.equal((await agent.get("/api/auth/me")).body.budgetPeriod, "weekly");
    });

    it("accepts values right at the limits", async () => {
        const { agent } = await newUser(app);
        await agent.post("/api/period/current/expenses")
            .send({ itemName: "N".repeat(MAX_ITEM_NAME_LENGTH), category: "C".repeat(MAX_CATEGORY_LENGTH), amount: MAX_CENTS })
            .expect(201);
        await agent.patch("/api/settings").send({ weeklyAllowance: MAX_CENTS }).expect(200);
    });

    it("rejects values one past the limits", async () => {
        const { agent } = await newUser(app);
        const add = (body) => agent.post("/api/period/current/expenses").send({ itemName: "x", amount: 1, ...body });
        assert.equal((await add({ itemName: "N".repeat(MAX_ITEM_NAME_LENGTH + 1) })).status, 400);
        assert.equal((await add({ category: "C".repeat(MAX_CATEGORY_LENGTH + 1) })).status, 400);
        assert.equal((await add({ amount: MAX_CENTS + 1 })).status, 400);
        assert.equal((await agent.patch("/api/settings").send({ weeklyAllowance: MAX_CENTS + 1 })).status, 400);
    });

    it("caps the number of expenses in a week", async () => {
        const { agent } = await newUser(app);
        const period = (await agent.get("/api/period/current")).body.period;
        const expenses = Array.from({ length: MAX_EXPENSES_PER_WEEK }, () => ({ itemName: "x", amount: 1 }));
        await Period.updateOne({ _id: period._id }, { expenses, totalSpend: MAX_EXPENSES_PER_WEEK });
        const res = await agent.post("/api/period/current/expenses").send({ itemName: "one too many", amount: 1 });
        assert.equal(res.status, 409);
        const after = await Period.findById(period._id);
        assert.equal(after.expenses.length, MAX_EXPENSES_PER_WEEK);
        assert.equal(after.totalSpend, MAX_EXPENSES_PER_WEEK);
    });

    it("caps item name and category length", async () => {
        const { agent } = await newUser(app);
        const huge = "A".repeat(50_000);
        assert.equal((await agent.post("/api/period/current/expenses").send({ itemName: huge, amount: 1 })).status, 400, "50k char item name accepted");
        assert.equal((await agent.post("/api/period/current/expenses").send({ itemName: "x", category: huge, amount: 1 })).status, 400, "50k char category accepted");
    });

    it("caps email length", async () => {
        const res = await anon(app, "post", "/api/auth/register").send({ email: "a".repeat(50_000) + "@x.com", password: "password123" });
        assert.equal(res.status, 400);
    });

    it("rejects request bodies over the size limit", async () => {
        const { agent } = await newUser(app);
        const res = await agent.post("/api/period/current/expenses").send({ itemName: "A".repeat(200_000), amount: 1 });
        assert.equal(res.status, 413);
    });

    it("handles malformed JSON with a 4xx and no stack trace", async () => {
        const res = await anon(app, "post", "/api/auth/login").set("Content-Type", "application/json").send('{"email":');
        assert.equal(res.status, 400);
        assert.match(res.headers["content-type"], /json/);
        assert.ok(!/at .+\.js:\d+/.test(res.text), "stack trace leaked to the client");
        assert.ok(!res.text.includes("node_modules"), "server file paths leaked to the client");
    });

    it("stores HTML in item names as plain text, not interpreted", async () => {
        const { agent } = await newUser(app);
        const payload = `<img src=x onerror=alert(1)>`;
        const res = await agent.post("/api/period/current/expenses").send({ itemName: payload, amount: 1 });
        assert.equal(res.headers["content-type"].split(";")[0], "application/json");
        assert.equal(res.body.expenses.at(-1).itemName, payload);
    });
});

describe("race conditions", () => {
    it("credits a closed week to the reserve exactly once under concurrent requests", async () => {
        const { agent, user } = await newUser(app);
        await Period.create({
            userId: user._id, weekKey: "2020-01-06", weekStart: new Date("2020-01-06"),
            startingBalance: 10000, totalSpend: 2500,
        });
        await Promise.all(Array.from({ length: 15 }, () => agent.get("/api/period/current")));
        const me = (await agent.get("/api/auth/me")).body;
        assert.equal(me.reserveCash, 7500);
    });

    it("refunds a deleted expense from a closed week exactly once under concurrent deletes", async () => {
        const { agent, user } = await newUser(app);
        const period = await Period.create({
            userId: user._id, weekKey: "2020-01-13", weekStart: new Date("2020-01-13"),
            startingBalance: 10000, totalSpend: 3000, expenses: [{ itemName: "x", amount: 3000 }],
            status: "closed", rollovertoReserve: 7000,
        });
        await User.updateOne({ _id: user._id }, { reserveCash: 7000 });
        const path = `/api/period/${period._id}/expenses/${period.expenses[0]._id}`;
        const results = await Promise.all(Array.from({ length: 15 }, () => agent.delete(path)));
        assert.equal(results.filter(r => r.status === 200).length, 1);
        assert.equal((await agent.get("/api/auth/me")).body.reserveCash, 10000);
        const saved = await Period.findById(period._id);
        assert.equal(saved.totalSpend, 0);
        assert.equal(saved.rollovertoReserve, 10000);
    });

    it("never lets concurrent adds lose an expense", async () => {
        const { agent } = await newUser(app);
        await Promise.all(Array.from({ length: 20 }, (_, i) => agent.post("/api/period/current/expenses").send({ itemName: `i${i}`, amount: 10 })));
        const period = (await agent.get("/api/period/current")).body.period;
        assert.equal(period.expenses.length, 20);
        assert.equal(period.totalSpend, 200);
    });
});

describe("CSRF and cross-origin", () => {
    it("ignores cross-site 'simple' requests that smuggle JSON as text/plain or form data", async () => {
        const { agent } = await newUser(app);
        await agent.post("/api/period/current/expenses").set("Content-Type", "text/plain").send('{"itemName":"csrf","amount":100}');
        await agent.post("/api/period/current/expenses").type("form").send({ itemName: "csrf", amount: 100 });
        await agent.patch("/api/settings").set("Content-Type", "text/plain").send('{"weeklyAllowance":1}');
        const { period, user } = (await agent.get("/api/period/current")).body;
        assert.equal(period.expenses.length, 0);
        assert.equal(user.weeklyAllowance, 0);
    });

    it("does not grant CORS access to other origins", async () => {
        const { agent } = await newUser(app);
        const res = await agent.get("/api/auth/me").set("Origin", "https://evil.example");
        assert.equal(res.headers["access-control-allow-origin"], undefined);
        assert.equal(res.headers["access-control-allow-credentials"], undefined);
    });
});

describe("HTTP hardening", () => {
    it("does not advertise the server framework", async () => {
        const res = await request(app).get("/api/health");
        assert.equal(res.headers["x-powered-by"], undefined, `X-Powered-By: ${res.headers["x-powered-by"]}`);
    });

    it("sends X-Content-Type-Options: nosniff", async () => {
        const res = await request(app).get("/api/health");
        assert.equal(res.headers["x-content-type-options"], "nosniff");
    });

    it("forbids framing (clickjacking)", async () => {
        const res = await request(app).get("/");
        const xfo = res.headers["x-frame-options"];
        const csp = res.headers["content-security-policy"] ?? "";
        assert.ok(/deny|sameorigin/i.test(xfo ?? "") || /frame-ancestors/.test(csp), "page can be framed by any site");
    });

    it("sends a Content-Security-Policy that blocks inline scripts", async () => {
        const csp = (await request(app).get("/")).headers["content-security-policy"] ?? "";
        const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? csp.match(/default-src ([^;]+)/)?.[1] ?? "";
        assert.ok(scriptSrc, "no CSP script policy");
        assert.ok(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("*"), `script-src is ${scriptSrc}`);
        assert.match(csp, /object-src 'none'/);
    });

    it("ignores a spoofed X-Forwarded-For chain when picking the client ip", async () => {
        // an attacker prepends fake ips; only the one the proxy appended should count
        const ip = "203.0.113.10";
        let limited = false;
        for (let i = 0; i < 30 && !limited; i++) {
            const res = await request(app).post("/api/auth/register")
                .set("X-Forwarded-For", `1.2.3.${i}, ${ip}`)
                .send({ email: uniqueEmail(), password: "password123" });
            limited = res.status === 429;
        }
        assert.ok(limited, "rotating the spoofed part of X-Forwarded-For bypassed the limit");
    });

    it("returns JSON 404s for unknown API routes instead of the app shell", async () => {
        const res = await request(app).get("/api/admin");
        assert.equal(res.status, 404);
        assert.match(res.headers["content-type"], /json/);
    });

    it("does not serve server files or secrets via path traversal", async () => {
        for (const p of [
            "/../server/config.env", "/%2e%2e/server/config.env", "/..%2fserver%2fconfig.env",
            "/%2e%2e%2f%2e%2e%2fserver/config.env", "/config.env", "/.env", "/../config.env",
            "/..%5cserver%5cconfig.env", "/../server/app.js", "/%2e%2e/package.json",
        ]) {
            const res = await request(app).get(p);
            assert.ok(!/JWT_SECRET|ATLAS_URI|mongodb(\+srv)?:\/\/|import express/.test(res.text), `${p} leaked server content`);
        }
    });
});
