import { toStringCents } from "../util/expenseCalc";

// reserve can go negative, toStringCents only formats the magnitude
function formatSigned(cents) {
    return cents < 0 ? `-${toStringCents(-cents)}` : toStringCents(cents);
}

export default function Topbar({reserve = 0, projectedReserve, weekStart, onLogout, onOpenSettings}){

    // weekStart is stored as UTC midnight, so format in UTC to avoid showing the previous day
    const weekStartLabel = weekStart && new Date(weekStart).toLocaleDateString(undefined, {
        timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
    });

    return(
        <nav className="flex justify-between p-4 bg-amber-200">
            <button onClick={onOpenSettings} className="underline">Settings</button>
            <div className="flex gap-4 text-md">
                <span>
                    Current Reserve: <span className={reserve < 0 ? "text-red-800" : undefined}>{formatSigned(reserve)}</span>
                    {projectedReserve !== undefined &&
                        <span className="ml-1 text-sm text-gray-600 italic">({formatSigned(projectedReserve)} after this week)</span>}
                </span>
                <span>{weekStartLabel}</span>
                <button onClick={onLogout} className="underline">Logout</button>
            </div>
        </nav>
    );
}
