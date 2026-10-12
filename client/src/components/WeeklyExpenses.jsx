import { toStringCents } from "../util/expenseCalc";

export default function WeeklyExpenses({expenses = [], startingBalance = 0, onDelete}){
        return (
        <div className="overflow-y-auto overflow-x-auto max-h-80 max-w-md">
            <ul className="w-50">
                <li className="flex justify-between">
                    <span className="italic text-green-700">{toStringCents(startingBalance)}</span>
                    <span className="italic">Starting Balance</span>
                </li>
                {expenses.map((expense) => {
                    return <li className="flex justify-between" key={expense._id}>
                                <span className="text-red-700">-{toStringCents(expense.amount)}</span>
                                <span className="flex gap-2">
                                    {expense.itemName}
                                    {expense.category && <span className="text-gray-500 text-sm">{expense.category}</span>}
                                    <button onClick={() => onDelete(expense._id)}
                                        aria-label={`Delete ${expense.itemName}`}
                                        className="text-gray-500 hover:text-red-700">×</button>
                                </span>
                            </li>
                })}
                <hr className="border-t border-gray-300 my-2" />
                <li className="flex justify-between">
                    <span className="underline font-semibold text-red-800">{toStringCents(expenses.reduce((total, cur) => total + cur.amount, 0))}</span>
                    <span>Total Spent</span>
                </li>
            </ul>
        </div>
    );
}
