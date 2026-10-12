import express from "express";
import mongoose from "mongoose";
import Week from "../model/Week.js";
import User from "../model/User.js";
import { getOrCreateCurrentWeek } from "../util/week.js";

const router = express.Router();

router.get("/current", async (req, res) => {
    try {
        const week = await getOrCreateCurrentWeek(req.userId);
        if (!week) {
            return res.status(401).json({ message: "Not authenticated" });
        }
        // re-fetch after the week lookup so the reserve includes any weeks it just closed
        const user = await User.findById(req.userId).select("-passwordHash");
        res.status(200).json({ week, user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/current/expenses", async (req, res) => {
    try {
        const { itemName, amount } = req.body ?? {};
        if (typeof itemName !== "string" || itemName.trim() === "") {
            return res.status(400).json({ message: "Item name is required" });
        }
        if (!Number.isInteger(amount) || amount <= 0) {
            return res.status(400).json({ message: "Amount must be a positive number of cents" });
        }

        const week = await getOrCreateCurrentWeek(req.userId);
        if (!week) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        const updated = await Week.findByIdAndUpdate(
            week._id,
            {
                $push: { expenses: { itemName: itemName.trim(), amount } },
                $inc: { totalSpend: amount },
            },
            { returnDocument: "after", runValidators: true }
        );
        res.status(201).json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

router.delete("/:weekId/expenses/:expenseId", async (req, res) => {
    try {
        const { weekId, expenseId } = req.params;
        if (!mongoose.isValidObjectId(weekId) || !mongoose.isValidObjectId(expenseId)) {
            return res.status(404).json({ message: "Expense not found" });
        }

        const week = await Week.findOne({ _id: weekId, userId: req.userId });
        const expense = week?.expenses.id(expenseId);
        if (!expense) {
            return res.status(404).json({ message: "Expense not found" });
        }

        // match on the expense id so a concurrent delete can't decrement totalSpend twice
        const updated = await Week.findOneAndUpdate(
            { _id: weekId, userId: req.userId, "expenses._id": expenseId },
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
            // the week's leftover already went to the reserve, so give the refunded amount back too
            await User.updateOne({ _id: req.userId }, { $inc: { reserveCash: expense.amount } });
            const adjusted = await Week.findByIdAndUpdate(
                weekId,
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
