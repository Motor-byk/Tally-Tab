import mongoose from "mongoose";

const Schema = mongoose.Schema;

const userSchema = new Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },

  // settings
  weeklyAllowance: { type: Number, default: 0 },   // cents
  weekStartsOn:    { type: Number, default: 1 },    // 0 = Sun, 1 = Mon
  timezone:        { type: String, default: 'America/Los_Angeles' },

  reserveCash: { type: Number, default: 0 },
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
export default User;