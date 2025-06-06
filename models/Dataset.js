const mongoose = require("mongoose");

const ImageSchema = new mongoose.Schema({
  fileId: String,
  url: String,
  filename: String,
  originalName: String,
  uploadDate: Date,
  label: String,
  labeledBy: String,
  labeledAt: Date,
  boundingBox: Object,
  labels: [
    {
      label: { type: String, required: true },
      labeledBy: { type: String, required: true },
      labeledAt: { type: Date, default: Date.now },
    },
  ],
});

const datasetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  description: {
    type: String,
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  imageCount: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  images: [ImageSchema],
});

datasetSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Dataset", datasetSchema);
