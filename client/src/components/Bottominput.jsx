import { useState } from "react";

export default function Bottominput({onAdd}) {

    const [cost, setCost] = useState("");
    const [name, setName] = useState("")
    const [category, setCategory] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(e){
        e.preventDefault();
        // round so e.g. 0.29 * 100 = 28.999... becomes 29 cents
        const amount = Math.round(Number(cost) * 100);
        if (name.trim() === "" || cost === "" || !(amount > 0)) {
            return;
        }
        setError("");
        setSubmitting(true);
        try {
            await onAdd(name.trim(), amount, category.trim());
            setCost("");
            setName("");
            setCategory("");
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return(
        <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
            <p>New Item</p>
            <input value={name}
                onChange={(e) => setName(e.target.value)}
                type="text"
                aria-label="Name"
                className="receipt-input"
                placeholder="Name..."></input>
            <div className="flex gap-4">
                <input value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    type="text"
                    aria-label="Category"
                    className="receipt-input"
                    placeholder="Category..."></input>
                <input value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    aria-label="Cost"
                    className="receipt-input w-28! text-right"
                    placeholder="$0.00"></input>
            </div>
            {error && <p className="text-ink-red text-base">{error}</p>}
            <button type="submit"
                disabled={submitting}
                className="receipt-btn self-center mt-1">Add</button>
        </form>
    );
}
