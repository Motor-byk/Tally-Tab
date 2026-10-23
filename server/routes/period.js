import express from "express";
import mongoose from "mongoose";
import Period from "../model/Period.js";
import User from "../model/User.js";
import { getOrCreateCurrentPeriod } from "../util/period.js";
import { MAX_ITEM_NAME_LENGTH, MAX_CATEGORY_LENGTH, MAX_CENTS, MAX_EXPENSES_PER_WEEK, MAX_EXPENSES_PER_MONTH } from "../util/limits.js";

const router = express.Router();

router.get("/current", async (req, res) => {
    try {
        const period = await getOrCreateCurrentPeriod(req.userId);
        if (!period) {
            return res.status(401).json({ message: "Not authenticated" });
        }
        // re-fetch after the period lookup so the reserve includes any periods it just closed
        const user = await User.findById(req.userId).select("-passwordHash");
        res.status(200).json({ period, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/current/expenses", async (req, res) => {
    try {
        const { itemName, amount, category } = req.body ?? {};
        if (typeof itemName !== "string" || itemName.trim() === "") {
            return res.status(400).json({ message: "Item name is required" });
        }
        if (itemName.trim().length > MAX_ITEM_NAME_LENGTH) {
            return res.status(400).json({ message: `Item name must be ${MAX_ITEM_NAME_LENGTH} characters or less` });
        }
        if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_CENTS) {
            return res.status(400).json({ message: "Amount must be between $0.01 and $1,000,000" });
        }
        if (category !== undefined && typeof category !== "string") {
            return res.status(400).json({ message: "Category must be text" });
        }
        if (category !== undefined && category.trim().length > MAX_CATEGORY_LENGTH) {
            return res.status(400).json({ message: `Category must be ${MAX_CATEGORY_LENGTH} characters or less` });
        }

        const period = await getOrCreateCurrentPeriod(req.userId);
        if (!period) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        // the size check is part of the filter so concurrent adds can't push past the cap
        const cap = period.kind === "month" ? MAX_EXPENSES_PER_MONTH : MAX_EXPENSES_PER_WEEK;
        const updated = await Period.findOneAndUpdate(
            { _id: period._id, [`expenses.${cap - 1}`]: { $exists: false } },
            {
                $push: { expenses: { itemName: itemName.trim(), category: (category ?? "").trim(), amount } },
                $inc: { totalSpend: amount },
            },
            { returnDocument: "after", runValidators: true }
        );
        if (!updated) {
            return res.status(409).json({ message: `A ${period.kind} can have at most ${cap} expenses` });
        }
        res.status(201).json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

router.delete("/:periodId/expenses/:expenseId", async (req, res) => {
    try {
        const { periodId, expenseId } = req.params;
        if (!mongoose.isValidObjectId(periodId) || !mongoose.isValidObjectId(expenseId)) {
            return res.status(404).json({ message: "Expense not found" });
        }

        const period = await Period.findOne({ _id: periodId, userId: req.userId });
        const expense = period?.expenses.id(expenseId);
        if (!expense) {
            return res.status(404).json({ message: "Expense not found" });
        }

        // match on the expense id so a concurrent delete can't decrement totalSpend twice
        const updated = await Period.findOneAndUpdate(
            { _id: periodId, userId: req.userId, "expenses._id": expenseId },
            {
                $pull: { expenses: { _id: expenseId } },
                $inc: { totalSpend: -expense.amount },
            },
            { returnDocument: "after" }
        );
        if (!updated) {
            return res.status(404).json({ message: "Expense not found" });
        }
        if (updated.status === "closed") {
            // the period's leftover already went to the reserve, so give the refunded amount back too
            await User.updateOne({ _id: req.userId }, { $inc: { reserveCash: expense.amount } });
            const adjusted = await Period.findByIdAndUpdate(
                periodId,
                { $inc: { rollovertoReserve: expense.amount } },
                { returnDocument: "after" }
            );
            return res.status(200).json(adjusted);
        }
        res.status(200).json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
