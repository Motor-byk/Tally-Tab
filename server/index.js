import app from "./app.js";
import connectDB from "./configuration/connection.js";

const PORT = process.env.PORT || 3000;

try {
    await connectDB();
    console.log("Connected to MongoDB");
} catch (err) {
    console.error(err);
    process.exit(1);
}

app.listen(PORT, () => {
    console.log(`Server listing on port ${PORT}`);
});
