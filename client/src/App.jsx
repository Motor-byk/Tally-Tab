import Topbar from "./components/Topbar";
import WeeklyExpenses from "./components/WeeklyExpenses";
import Bottominput from "./components/Bottominput";
import AuthForm from "./components/AuthForm";
import Settings from "./components/Settings";
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
    const [expanded, setExpanded] = useState(false);
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
        setExpanded(false);
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

    function handleExpand() {
        setExpanded(!expanded);
    }

    if (!authChecked) {
        return null;
    }

    if (!user) {
        return <AuthForm onAuth={setUser} />;
    }

    if (!week) {
        return <p className="m-4">{weekError || "Loading..."}</p>;
    }

    const { expenses, startingBalance } = week;
    const currentBalance = startingBalance - expenses.reduce((totalExpense, expense) => totalExpense + expense.amount, 0)

    return (
        <div className="flex flex-col min-h-screen">
            <Topbar reserve={user.reserveCash}
                projectedReserve={currentBalance < 0 ? user.reserveCash + currentBalance : undefined}
                weekStart={week.weekStart} onLogout={handleLogout} onOpenSettings={() => setSettingsOpen(true)} />
            <main className="grow m-4">
                <h2 className="text-2xl font-bold">Weekly Balance</h2>
                {
                    currentBalance >= 0 ?
                    <h3 className="text-xl font-bold text-green-800">{toStringCents(currentBalance)}</h3> :
                    <h3 className="text-xl font-bold text-red-800">-{toStringCents(currentBalance * -1)}</h3> // kinda goofy solution im sorry future me );
                }
                {weekError && <p className="text-red-700 text-sm">{weekError}</p>}
                <div>
                    <button onClick={handleExpand} className="text-sm text-blue-950 underline italic">Expand</button>
                    {expanded && <WeeklyExpenses expenses={expenses} startingBalance={startingBalance} onDelete={handleDeleteExpense}/>}
                </div>
            </main>
            <Bottominput onAdd={handleAddExpense}/>
            {settingsOpen && <Settings user={user} onSave={handleSaveSettings} onClose={() => setSettingsOpen(false)}/>}
        </div>
    );
}

export default App
