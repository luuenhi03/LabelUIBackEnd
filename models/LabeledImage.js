const mongoose = require("mongoose");

const labeledImageSchema = new mongoose.Schema({
  image: { type: mongoose.Schema.Types.ObjectId, ref: "Image", required: true },
  label: { type: String, required: true },
  labeledBy: { type: String, required: true },
  labeledAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("LabeledImage", labeledImageSchema);
