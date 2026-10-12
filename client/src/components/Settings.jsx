import { useState } from "react";
import Receipt from "./Receipt";

export default function Settings({user, onSave, onClose}) {

    const [balance, setBalance] = useState((user.weeklyAllowance / 100).toFixed(2));
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

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
            await onSave(amount);
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
                    <label className="flex flex-col">
                        <span>Weekly starting bal</span>
                        <input value={balance}
                            onChange={(e) => setBalance(e.target.value)}
                            type="number"
                            min="0"
                            step="0.01"
                            required
                            className="receipt-input"
                            placeholder="0.00"></input>
                    </label>
                    <p className="text-base text-ink-faint">Applies to this week and future weeks.</p>
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
