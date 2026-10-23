import mongoose from "mongoose";

const Schema = mongoose.Schema;

const expenseSchema = new Schema({
    amount: {type: Number, required: true, min: 1, validate: Number.isInteger}, // cents
    itemName: {type: String, required: true, trim: true},
    category: {type: String, trim: true, default: ""}, // brand or store, optional
    spentAt: {type: Date, default: Date.now},
})

// a budget period, stored in the "weeks" collection from before months existed
const periodSchema = new Schema({
    userId: {type:mongoose.Schema.Types.ObjectId, ref: "User", required: true},
    kind: {type: String, enum: ["week", "month"], default: "week"},
    periodKey: {type: String, required: true}, // "YYYY-MM-DD" of the week, or "M:" + periodStart for months
    periodStart: {type: String, required: true}, // "YYYY-MM-DD"
    periodEnd: {type: String, required: true},   // "YYYY-MM-DD", exclusive
    startingBalance: {type: Number, required: true},
    totalSpend: {type: Number, default: 0},
    expenses: [expenseSchema],
    status: {type: String, enum: ["open", "closed"], default: "open"},
    closedAt: Date,
    rollovertoReserve:{ type: Number, default: 0},
}, {timestamps: true});

periodSchema.index({ userId: 1, periodKey: 1 }, { unique: true });

const Period = mongoose.model("Period", periodSchema, "weeks")
export default Period;
