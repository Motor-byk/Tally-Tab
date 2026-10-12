import mongoose from "mongoose";

// reuse the connection across serverless invocations
let cached;

export default function connectDB(){
    if (!cached) {
        cached = mongoose.connect(process.env.ATLAS_URI, {
            dbName: "ExpenseTracker",
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 5000,
        }).catch((err) => {
            cached = undefined;
            throw err;
        });
    }
    return cached;
}
