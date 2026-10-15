import { toStringCents, formatSigned } from "../util/expenseCalc";

export default function WeeklyExpenses({expenses = [], startingBalance = 0, currentBalance, reserve = 0, projectedReserve, kind = "week", deletingId, onDelete}){
    const totalSpent = expenses.reduce((total, cur) => total + cur.amount, 0);

    return (
        <section>
            <ul>
                <li className="flex justify-between">
                    <span>Starting Bal</span>
                    <span>{toStringCents(startingBalance)}</span>
                </li>
                {expenses.map((expense) => {
                    return <li key={expense._id}>
                                <div className="flex justify-between gap-2">
                                    <span className="break-all">{expense.itemName}</span>
                                    <span className="flex gap-2 shrink-0">
                                        -{toStringCents(expense.amount)}
                                        <button onClick={() => onDelete(expense._id)}
                                            disabled={deletingId === expense._id}
                                            aria-label={`Delete ${expense.itemName}`}
                                            className="text-sm text-ink-faint hover:text-ink-red">{deletingId === expense._id ? "..." : "Void"}</button>
                                    </span>
                                </div>
                                {expense.category && <div className="pl-4 text-base text-ink-faint break-all">{expense.category}</div>}
                            </li>
                })}
            </ul>
            <hr className="receipt-rule" />
            <div className="flex justify-between">
                <span>Total Spent</span>
                <span>{toStringCents(totalSpent)}</span>
            </div>
            <hr className="receipt-rule-double" />
            <div className={`flex justify-between text-2xl font-bold ${currentBalance < 0 ? "text-ink-red" : ""}`}>
                <span>Balance</span>
                <span className="underline decoration-2 underline-offset-4">{formatSigned(currentBalance)}</span>
            </div>
            <div className="flex justify-between">
                <span>Reserve</span>
                <span className={reserve < 0 ? "text-ink-red" : undefined}>{formatSigned(reserve)}</span>
            </div>
            {projectedReserve !== undefined &&
                <div className="flex justify-between pl-4 text-base text-ink-faint">
                    <span>After this {kind}</span>
                    <span className={projectedReserve < 0 ? "text-ink-red" : undefined}>{formatSigned(projectedReserve)}</span>
                </div>}
        </section>
    );
}
