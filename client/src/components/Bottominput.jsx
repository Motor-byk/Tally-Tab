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
        <div className="mb-2 w-full fixed bottom-0 left-0">
            {error && <p className="mx-2 text-red-700 text-sm">{error}</p>}
            <form className="flex items-center w-full" onSubmit={handleSubmit}>
                <button type="submit"
                    disabled={submitting}
                    className="p-4 mx-2 border-solid border-3 rounded-4xl disabled:opacity-50">Add</button>
                <input value={name}
                    onChange={(e) => setName(e.target.value)}
                    type="text"
                    className="flex-1 h-10 border-solid border-2 rounded-l-2xl"
                    placeholder="Name..."></input>
                <input value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    type="text"
                    className="flex-1 h-10 border-solid border-2"
                    placeholder="Category..."></input>
                <input value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="flex-1 h-10 mr-2 border-solid border-2 rounded-r-2xl"
                    placeholder="Cost..."></input>
            </form>
        </div>
    );
}
