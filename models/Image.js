const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true,
  },
  originalName: {
    type: String,
    required: true,
  },
  path: {
    type: String,
    required: true,
  },
  dataset: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Dataset",
    required: true,
  },
  label: {
    type: String,
    default: "",
  },
  labeledBy: {
    type: String,
    default: "",
  },
  labeledAt: {
    type: Date,
    default: null,
  },
  coordinates: {
    type: Object,
    default: null,
  },
  boundingBox: {
    topLeft: {
      x: Number,
      y: Number,
    },
    bottomRight: {
      x: Number,
      y: Number,
    },
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  labels: [
    {
      label: { type: String, required: true },
      labeledBy: { type: String, required: true },
      labeledAt: { type: Date, default: Date.now },
    },
  ],
});

imageSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Image", imageSchema);
