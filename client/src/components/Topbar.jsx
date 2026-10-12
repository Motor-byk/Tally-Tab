export default function Topbar({weekStart, onLogout, onOpenSettings}){

    // weekStart is stored as UTC midnight, so format in UTC to avoid showing the previous day
    const weekStartLabel = weekStart && new Date(weekStart).toLocaleDateString(undefined, {
        timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
    });

    return(
        <header className="text-center">
            <h1 className="text-4xl tracking-widest">** Tally Tab **</h1>
            <p>Week of {weekStartLabel}</p>
            <nav className="flex justify-between mt-2 text-base">
                <button onClick={onOpenSettings} className="receipt-btn">Settings</button>
                <button onClick={onLogout} className="receipt-btn">Logout</button>
            </nav>
        </header>
    );
}
