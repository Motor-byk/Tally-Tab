import { useState } from "react";
import Receipt from "./Receipt";

const PERIODS = [
    { value: "weekly", label: "Weekly", unit: "week" },
    { value: "monthly", label: "Monthly", unit: "month" },
];

// what happens to the current period when the mode changes
const SWITCH_NOTES = {
    monthly: "This week's expenses move into this month.",
    weekly: "This month closes early and its leftover goes to your reserve. This week's expenses move into the new week.",
};

export default function Settings({user, onSave, onClose}) {

    const [budgetPeriod, setBudgetPeriod] = useState(user.budgetPeriod ?? "weekly");
    // one draft per mode so flipping the toggle doesn't lose what was typed
    const [balances, setBalances] = useState({
        weekly: (user.weeklyAllowance / 100).toFixed(2),
        monthly: ((user.monthlyAllowance ?? 0) / 100).toFixed(2),
    });
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const balance = balances[budgetPeriod];
    const { label, unit } = PERIODS.find(p => p.value === budgetPeriod);

    async function handleSubmit(e){
        e.preventDefault();
        // round so e.g. 0.29 * 100 = 28.999... becomes 29 cents
        const amount = Math.round(Number(balance) * 100);
        if (balance === "" || !(amount >= 0)) {
            setError("Enter a starting balance of $0.00 or more");
            return;
        }
        setError("");
        setSubmitting(true);
        try {
            await onSave({
                budgetPeriod,
                [budgetPeriod === "monthly" ? "monthlyAllowance" : "weeklyAllowance"]: amount,
            });
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return(
        <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <Receipt onClick={(e) => e.stopPropagation()}>
                <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
                    <h2 className="text-3xl text-center tracking-widest">** Settings **</h2>
                    <hr className="receipt-rule" />
                    <div className="flex justify-between" role="radiogroup" aria-label="Budget period">
                        {PERIODS.map(p => (
                            <button key={p.value}
                                type="button"
                                role="radio"
                                aria-checked={budgetPeriod === p.value}
                                onClick={() => setBudgetPeriod(p.value)}
                                className={budgetPeriod === p.value ? "" : "text-ink-faint"}>
                                [{budgetPeriod === p.value ? "x" : " "}] {p.label}
                            </button>
                        ))}
                    </div>
                    <label className="flex flex-col">
                        <span>{label} starting bal</span>
                        <input value={balance}
                            onChange={(e) => setBalances({...balances, [budgetPeriod]: e.target.value})}
                            type="number"
                            min="0"
                            max="1000000"
                            step="0.01"
                            required
                            className="receipt-input"
                            placeholder="0.00"></input>
                    </label>
                    <p className="text-base text-ink-faint">Applies to this {unit} and future {unit}s.</p>
                    {budgetPeriod !== (user.budgetPeriod ?? "weekly") &&
                        <p className="text-base text-ink-faint">{SWITCH_NOTES[budgetPeriod]}</p>}
                    {error && <p className="text-ink-red text-base">{error}</p>}
                    <hr className="receipt-rule" />
                    <div className="flex justify-between">
                        <button type="submit"
                            disabled={submitting}
                            className="receipt-btn">{submitting ? "Saving..." : "Save"}</button>
                        <button type="button"
                            onClick={onClose}
                            className="receipt-btn">Cancel</button>
                    </div>
                </form>
            </Receipt>
        </div>
    );
}
