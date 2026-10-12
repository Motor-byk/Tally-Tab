export function toStringCents(price) {
    if (!Number.isInteger(price) || price === null || price === undefined) {
        throw new Error("Must be a positive int")
    }
    return `$${(price/100).toFixed(2)}`;
}



// toStringCents only formats the magnitude, this adds the sign back for values that can go negative
export function formatSigned(cents) {
    return cents < 0 ? `-${toStringCents(-cents)}` : toStringCents(cents);
}
