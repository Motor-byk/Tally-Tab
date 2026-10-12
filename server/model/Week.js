import mongoose from "mongoose";

const Schema = mongoose.Schema;

const expenseSchema = new Schema({
    amount: {type: Number, required: true, min: 1, validate: Number.isInteger}, // cents
    itemName: {type: String, required: true, trim: true},
    category: {type: String, trim: true, default: ""}, // brand or store, optional
    spentAt: {type: Date, default: Date.now},
})

const weekSchema = new Schema({
    userId: {type:mongoose.Schema.Types.ObjectId, ref: "User", required: true},
    weekStart: {type: Date, required: true},
    weekKey: {type: String, required: true}, // "YYYY-MM-DD" of weekStart
    startingBalance: {type: Number, required: true},
    totalSpend: {type: Number, default: 0},
    expenses: [expenseSchema],
    status: {type: String, enum: ["open", "closed"], default: "open"},
    closedAt: Date,
    rollovertoReserve:{ type: Number, default: 0},
}, {timestamps: true});

weekSchema.index({ userId: 1, weekKey: 1 }, { unique: true });

const Week = mongoose.model("Week", weekSchema)
export default Week;
