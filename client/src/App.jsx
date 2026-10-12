import Topbar from "./components/Topbar";
import WeeklyExpenses from "./components/WeeklyExpenses";
import Bottominput from "./components/Bottominput";
import AuthForm from "./components/AuthForm";
import Settings from "./components/Settings";
import Receipt from "./components/Receipt";
import { toStringCents } from "./util/expenseCalc";
import { useState, useEffect } from "react";

// throws the server's error message so callers can show it
async function requestWeek(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message ?? "Something went wrong");
    }
    return data;
}

function App() {
    const [user, setUser] = useState(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [week, setWeek] = useState(null);
    const [weekError, setWeekError] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);

    useEffect(() => {
        fetch("/api/auth/me")
            .then(response => response.ok ? response.json() : null)
            .then((data) => setUser(data))
            .catch(error => {
                console.error('Error fetching user data:', error);
            })
            .finally(() => setAuthChecked(true));
    },[]);

    // keyed on the id so refreshing the user from the response doesn't refetch the week
    const userId = user?._id;
    useEffect(() => {
        if (!userId) {
            return;
        }
        requestWeek("/api/week/current")
            .then((data) => {
                setWeek(data.week);
                setUser(data.user);
            })
            .catch((error) => setWeekError(error.message));
    }, [userId]);

    async function handleLogout() {
        await fetch("/api/auth/logout", {method: "POST"});
        setUser(null);
        setWeek(null);
        setWeekError("");
        setSettingsOpen(false);
    }

    async function handleSaveSettings(weeklyAllowance) {
        const data = await requestWeek("/api/settings", {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({weeklyAllowance}),
        });
        setUser(data.user);
        setWeek(data.week);
        setSettingsOpen(false);
    }

    async function handleAddExpense(itemName, amount, category) {
        const data = await requestWeek("/api/week/current/expenses", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({itemName, amount, category}),
        });
        setWeek(data);
    }

    async function handleDeleteExpense(expenseId) {
        try {
            const data = await requestWeek(`/api/week/${week._id}/expenses/${expenseId}`, {method: "DELETE"});
            setWeek(data);
        } catch (error) {
            setWeekError(error.message);
        }
    }

    if (!authChecked) {
        return null;
    }

    if (!user) {
        return <AuthForm onAuth={setUser} />;
    }

    if (!week) {
        return (
            <div className="p-4">
                <Receipt className="text-center">
                    <p className={weekError ? "text-ink-red" : undefined}>{weekError || "Printing..."}</p>
                </Receipt>
            </div>
        );
    }

    const { expenses, startingBalance, totalSpend } = week;
    const currentBalance = startingBalance - totalSpend

    return (
        <div className="min-h-screen px-4 py-8">
            <Receipt>
                <Topbar weekStart={week.weekStart} onLogout={handleLogout} onOpenSettings={() => setSettingsOpen(true)} />
                <hr className="receipt-rule" />
                {weekError && <p className="text-ink-red text-base">{weekError}</p>}
                <WeeklyExpenses expenses={expenses}
                    startingBalance={startingBalance}
                    currentBalance={currentBalance}
                    reserve={user.reserveCash}
                    projectedReserve={currentBalance < 0 ? user.reserveCash + currentBalance : undefined}
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
