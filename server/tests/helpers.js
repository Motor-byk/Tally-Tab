import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";

export const TEST_SECRET = "test-secret-".padEnd(64, "x");

let mongo;

// boots the real app against a throwaway in-memory mongo
export async function startApp() {
    mongo = await MongoMemoryServer.create();
    // dotenv won't override these, so the real config.env is never used
    process.env.ATLAS_URI = mongo.getUri();
    process.env.JWT_SECRET = TEST_SECRET;
    const { default: app } = await import("../app.js");
    return app;
}

export async function stopApp() {
    await mongoose.disconnect();
    await mongo?.stop();
}

let counter = 0;

// each simulated visitor gets its own ip so the rate limits don't bleed between tests
export function randomIp() {
    return `10.${counter % 256}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
}

// an anonymous request from a fresh ip
export function anon(app, method, path) {
    return request(app)[method](path).set("X-Forwarded-For", randomIp());
}

export function uniqueEmail() {
    return `user${Date.now()}_${counter++}@test.com`;
}

// registers a new user and returns an agent that carries their auth cookie
export async function newUser(app, password = "correct-horse-battery") {
    const agent = request.agent(app).set("X-Forwarded-For", randomIp());
    const email = uniqueEmail();
    const res = await agent.post("/api/auth/register").send({ email, password });
    if (res.status !== 201) {
        throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const token = res.headers["set-cookie"][0].match(/token=([^;]+)/)[1];
    return { agent, email, password, token, user: res.body };
}
