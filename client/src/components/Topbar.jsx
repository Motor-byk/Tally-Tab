export default function Topbar({startDate, kind = "week", onLogout, onOpenSettings}){

    // a "YYYY-MM-DD" startDate parses as UTC midnight, so format in UTC to avoid showing the previous day
    const isMonth = kind === "month";
    const startLabel = startDate && new Date(startDate).toLocaleDateString(undefined, {
        timeZone: "UTC", month: "long", year: "numeric", ...(isMonth ? {} : { day: "numeric" }),
    });

    return(
        <header className="text-center">
            <h1 className="text-4xl tracking-widest">** Tally Tab **</h1>
            <p>{isMonth ? "Month" : "Week"} of {startLabel}</p>
            <nav className="flex justify-between mt-2 text-base">
                <button onClick={onOpenSettings} className="receipt-btn">Settings</button>
                <button onClick={onLogout} className="receipt-btn">Logout</button>
            </nav>
        </header>
    );
}
