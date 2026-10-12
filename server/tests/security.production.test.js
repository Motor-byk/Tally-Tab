// runs in its own process (node --test isolates files) so the app loads with NODE_ENV=production
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { startApp, stopApp, uniqueEmail } from "./helpers.js";

process.env.NODE_ENV = "production";

let app;
before(async () => { app = await startApp(); });
after(stopApp);

describe("production config", () => {
    it("marks the auth cookie Secure", async () => {
        const res = await request(app).post("/api/auth/register").send({ email: uniqueEmail(), password: "password123" });
        assert.match(res.headers["set-cookie"][0], /;\s*Secure/i);
    });

    it("clears the cookie with matching attributes on logout", async () => {
        const res = await request(app).post("/api/auth/logout");
        const cookie = res.headers["set-cookie"][0];
        assert.match(cookie, /token=;/);
        assert.match(cookie, /Secure/i);
        assert.match(cookie, /HttpOnly/i);
    });

    it("sends Strict-Transport-Security", async () => {
        const res = await request(app).get("/api/health");
        assert.match(res.headers["strict-transport-security"] ?? "", /max-age=\d+/);
    });

    it("returns JSON errors without internals for malformed bodies", async () => {
        const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"email":');
        assert.equal(res.status, 400);
        assert.ok(!/at .+\.js:\d+|node_modules|SyntaxError/.test(res.text), "error internals leaked");
        assert.match(res.headers["content-type"], /json/, "error response is HTML, not JSON");
    });
});
