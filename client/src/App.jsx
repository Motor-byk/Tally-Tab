import Topbar from "./components/Topbar";
import PeriodExpenses from "./components/PeriodExpenses";
import Bottominput from "./components/Bottominput";
import AuthForm from "./components/AuthForm";
import Settings from "./components/Settings";
import Receipt from "./components/Receipt";
import { toStringCents } from "./util/expenseCalc";
import { useState, useEffect } from "react";

// throws the server's error message so callers can show it
async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message ?? "Something went wrong");
    }
    return data;
}

function StatusScreen({message, error}) {
    return (
        <div className="p-4">
            <Receipt className="text-center">
                <p className={error ? "text-ink-red" : "animate-pulse"}>{error || message}</p>
            </Receipt>
        </div>
    );
}

function App() {
    const [user, setUser] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [period, setPeriod] = useState(null);
    const [periodError, setPeriodError] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [deletingId, setDeletingId] = useState(null);

    useEffect(() => {
        fetch("/api/auth/me")
            .then(response => response.ok ? response.json() : null)
            .then((data) => setUser(data))
            .catch(error => {
                console.error('Error fetching user data:', error);
            })
            .finally(() => setAuthChecked(true));
    },[]);

    // keyed on the id so refreshing the user from the response doesn't refetch the period
    const userId = user?._id;
    useEffect(() => {
        if (!userId) {
            return;
        }
        request("/api/period/current")
            .then((data) => {
                setPeriod(data.period);
                setUser(data.user);
            })
            .catch((error) => setPeriodError(error.message));
    }, [userId]);

    async function handleLogout() {
        await fetch("/api/auth/logout", {method: "POST"});
        setUser(null);
        setPeriod(null);
        setPeriodError("");
        setSettingsOpen(false);
    }

    async function handleSaveSettings(settings) {
        const data = await request("/api/settings", {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(settings),
        });
        setUser(data.user);
        setPeriod(data.period);
        setSettingsOpen(false);
    }

    async function handleAddExpense(itemName, amount, category) {
        const data = await request("/api/period/current/expenses", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({itemName, amount, category}),
        });
        setPeriod(data);
    }

    async function handleDeleteExpense(expenseId) {
        setDeletingId(expenseId);
        try {
            const data = await request(`/api/period/${period._id}/expenses/${expenseId}`, {method: "DELETE"});
            setPeriod(data);
        } catch (error) {
            setPeriodError(error.message);
        } finally {
            setDeletingId(null);
        }
    }

    if (!authChecked) {
        return <StatusScreen message="Printing..." />;
    }

    if (!user) {
        return <AuthForm onAuth={setUser} />;
    }

    if (!period) {
        return <StatusScreen message="Printing..." error={periodError} />;
    }

    const { expenses, startingBalance, totalSpend } = period;
    const currentBalance = startingBalance - totalSpend

    return (
        <div className="min-h-screen px-4 py-8">
            <Receipt>
                <Topbar startDate={period.periodStart} kind={period.kind} onLogout={handleLogout} onOpenSettings={() => setSettingsOpen(true)} />
                <hr className="receipt-rule" />
                {periodError && <p className="text-ink-red text-base">{periodError}</p>}
                <PeriodExpenses expenses={expenses}
                    startingBalance={startingBalance}
                    currentBalance={currentBalance}
                    reserve={user.reserveCash}
                    projectedReserve={currentBalance < 0 ? user.reserveCash + currentBalance : undefined}
                    kind={period.kind}
                    deletingId={deletingId}
                    onDelete={handleDeleteExpense}/>
                <hr className="receipt-rule" />
                <Bottominput onAdd={handleAddExpense}/>
                <hr className="receipt-rule" />
                <div className="barcode" />
                {
                    currentBalance >= 0 ?
                    <p className="text-center">** You're {toStringCents(currentBalance)} under budget **</p> :
                    <p className="text-center text-ink-red">** Over budget by {toStringCents(-currentBalance)} **</p>
                }
            </Receipt>
            {settingsOpen && <Settings user={user} onSave={handleSaveSettings} onClose={() => setSettingsOpen(false)}/>}
        </div>
    );
}

export default App
