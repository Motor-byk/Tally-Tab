// One-time migration of the "weeks" collection to the Period shape:
// weeks created before months existed get periodStart/periodEnd/kind, weekKey becomes periodKey,
// and weekStart (a Date copy of periodStart) goes away.
//
//   node scripts/migratePeriodFields.js backfill [--apply]   before deploying the Period code
//   node scripts/migratePeriodFields.js cleanup  [--apply]   after it's deployed
//
// Without --apply it only reports what it would change. Every step is safe to rerun.
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../configuration/connection.js";

const OLD_INDEX = "userId_1_weekKey_1";
const NEW_INDEX = "userId_1_periodKey_1";
const REQUIRED = ["kind", "periodKey", "periodStart", "periodEnd"];

// only docs with a weekKey can be backfilled, anything else shows up in stillMissingFields
const LEGACY = { periodStart: { $exists: false }, weekKey: { $exists: true } };
const MISSING_KEY = { periodKey: { $exists: false }, weekKey: { $exists: true } };
const MISSING_REQUIRED = { $or: REQUIRED.map(field => ({ [field]: { $exists: false } })) };
const HAS_OLD_FIELDS = { $or: [{ weekKey: { $exists: true } }, { weekStart: { $exists: true } }] };

async function indexes(weeks) {
    try {
        return await weeks.indexes();
    } catch (err) {
        // the collection doesn't exist yet
        if (err.code === 26) {
            return [];
        }
        throw err;
    }
}

// additive, the old code keeps working afterwards
export async function backfill(weeks, { apply = false } = {}) {
    const report = {
        legacyWeeks: await weeks.countDocuments(LEGACY),
        missingPeriodKey: await weeks.countDocuments(MISSING_KEY),
    };
    if (!apply) {
        const names = (await indexes(weeks)).map(i => i.name);
        return { ...report, hasNewIndex: names.includes(NEW_INDEX), hasOldIndex: names.includes(OLD_INDEX) };
    }

    // weeks from before months existed: periodStart is the weekKey, and they always lasted 7 days
    await weeks.updateMany(LEGACY, [{
        $set: {
            kind: { $ifNull: ["$kind", "week"] },
            periodStart: "$weekKey",
            periodEnd: {
                $dateToString: {
                    format: "%Y-%m-%d",
                    date: { $dateAdd: { startDate: { $dateFromString: { dateString: "$weekKey" } }, unit: "day", amount: 7 } },
                },
            },
        },
    }]);
    await weeks.updateMany(MISSING_KEY, [{ $set: { periodKey: "$weekKey" } }]);

    await weeks.createIndex({ userId: 1, periodKey: 1 }, { unique: true, name: NEW_INDEX });
    // the old index would make every new period (which has no weekKey) collide on null, so it only covers
    // docs that have a weekKey now. Keeping the name means an old instance starting up can't recreate the
    // full index: mongoose's autoIndex hits a name conflict and leaves it alone
    const old = (await indexes(weeks)).find(i => i.name === OLD_INDEX);
    if (old && !old.partialFilterExpression) {
        await weeks.dropIndex(OLD_INDEX);
    }
    if (!old?.partialFilterExpression) {
        await weeks.createIndex(
            { userId: 1, weekKey: 1 },
            { unique: true, name: OLD_INDEX, partialFilterExpression: { weekKey: { $exists: true } } }
        );
    }

    return { ...report, stillMissingFields: await weeks.countDocuments(MISSING_REQUIRED) };
}

// destructive, only once nothing reads weekKey/weekStart anymore
export async function cleanup(weeks, { apply = false } = {}) {
    // catches periods the old code created between the backfill and the deploy
    const backfilled = await backfill(weeks, { apply });
    const report = { backfill: backfilled, docsWithOldFields: await weeks.countDocuments(HAS_OLD_FIELDS) };
    if (!apply) {
        return report;
    }

    const missing = await weeks.countDocuments(MISSING_REQUIRED);
    if (missing > 0) {
        throw new Error(`${missing} docs are still missing ${REQUIRED.join("/")}, not removing weekKey/weekStart`);
    }
    await weeks.updateMany(HAS_OLD_FIELDS, { $unset: { weekKey: "", weekStart: "" } });
    if ((await indexes(weeks)).some(i => i.name === OLD_INDEX)) {
        await weeks.dropIndex(OLD_INDEX);
    }
    return report;
}

async function main() {
    const [step, ...flags] = process.argv.slice(2);
    const steps = { backfill, cleanup };
    if (!steps[step] || flags.some(f => f !== "--apply")) {
        console.error("usage: node scripts/migratePeriodFields.js <backfill|cleanup> [--apply]");
        process.exit(1);
    }
    const apply = flags.includes("--apply");

    // same config as the app, an ATLAS_URI already in the environment wins
    dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../config.env"), quiet: true });
    await connectDB();
    try {
        const weeks = mongoose.connection.db.collection("weeks");
        console.log(`${step}${apply ? "" : " (dry run, pass --apply to write)"} on ${mongoose.connection.host}`);
        console.log(JSON.stringify(await steps[step](weeks, { apply }), null, 2));
    } finally {
        await mongoose.disconnect();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}
