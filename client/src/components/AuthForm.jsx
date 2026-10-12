import { useState } from "react";
import Receipt from "./Receipt";

export default function AuthForm({onAuth}) {

    const [mode, setMode] = useState("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    async function handleSubmit(e){
        e.preventDefault();
        setError("");
        try {
            const response = await fetch(`/api/auth/${mode}`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({email, password}),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data.message);
                return;
            }
            onAuth(data);
        } catch {
            setError("Could not reach the server");
        }
    }

    return(
        <div className="flex items-center justify-center min-h-screen p-4">
            <Receipt>
                <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
                    <h1 className="text-4xl text-center tracking-widest">** Tally Tab **</h1>
                    <hr className="receipt-rule" />
                    <h2 className="text-2xl text-center">{mode === "login" ? "Log in" : "Create account"}</h2>
                    <label className="flex flex-col">
                        <span>Email</span>
                        <input value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            type="email"
                            required
                            className="receipt-input normal-case"></input>
                    </label>
                    <label className="flex flex-col">
                        <span>Password</span>
                        <input value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            type="password"
                            required
                            minLength={mode === "register" ? 8 : undefined}
                            className="receipt-input"></input>
                    </label>
                    {error && <p className="text-ink-red text-base">{error}</p>}
                    <button type="submit" className="receipt-btn self-center mt-2">
                        {mode === "login" ? "Log in" : "Sign up"}
                    </button>
                    <button type="button"
                        onClick={() => setMode(mode === "login" ? "register" : "login")}
                        className="text-base text-ink-faint underline hover:text-ink">
                        {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
                    </button>
                </form>
                <hr className="receipt-rule" />
                <div className="barcode" />
                <p className="text-center">** Thank you **</p>
            </Receipt>
        </div>
    );
}
