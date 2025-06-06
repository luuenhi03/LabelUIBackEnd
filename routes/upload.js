const mongoURI = "mongodb://localhost:27017/label_db";

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Dataset = require("../models/Dataset");
const Image = require("../models/Image");
const mongoose = require("mongoose");
const Grid = require("gridfs-stream");
const { MongoClient } = require("mongodb");
const { GridFsStorage } = require("multer-gridfs-storage");

const storage = new GridFsStorage({
  url: mongoURI,
  file: (req, file) => {
    if (req.body.isAvatar === "true") {
      return {
        filename: Date.now() + "-avatar-" + file.originalname,
        bucketName: "uploads",
        metadata: {
          isAvatar: true,
          userId: req.body.userId,
        },
      };
    }
    return {
      filename: Date.now() + "-" + file.originalname,
      bucketName: "uploads",
      metadata: {
        datasetName: req.body.datasetName,
      },
    };
  },
});

const upload = multer({ storage });

router.get("/datasets", async (req, res) => {
  try {
    const datasets = await Dataset.find().sort({ createdAt: -1 });
    res.json(datasets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/datasets", async (req, res) => {
  try {
    const { name } = req.body;

    const existingDataset = await Dataset.findOne({ name });
    if (existingDataset) {
      return res.status(400).json({ message: "Dataset already exists" });
    }

    // const uploadPath = path.join(__dirname, "../uploads", name);
    // if (!fs.existsSync(uploadPath)) {
    //   fs.mkdirSync(uploadPath, { recursive: true });
    // }

    const dataset = new Dataset({ name });
    await dataset.save();

    res.status(201).json(dataset);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/images/:datasetId", async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.datasetId);
    if (!dataset) {
      return res.status(404).json({ message: "Dataset not found" });
    }

    const images = await Image.find({ dataset: dataset._id, label: "" }).sort({
      createdAt: -1,
    });
    res.json(images);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/labeled/:datasetId", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = 6;
    const skip = page * limit;

    const dataset = await Dataset.findById(req.params.datasetId);
    if (!dataset) {
      return res.status(404).json({ message: "Dataset not found" });
    }

    const [images, total] = await Promise.all([
      Image.find({ dataset: dataset._id, label: { $ne: "" } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Image.countDocuments({ dataset: dataset._id, label: { $ne: "" } }),
    ]);

    res.json({ images, total });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/images/:imageId", async (req, res) => {
  try {
    const { label, labeledBy } = req.body;
    const image = await Image.findByIdAndUpdate(
      req.params.imageId,
      { label, labeledBy },
      { new: true }
    );
    if (!image) {
      return res.status(404).json({ message: "Image not found" });
    }
    res.json(image);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/images/:imageId", async (req, res) => {
  try {
    const image = await Image.findById(req.params.imageId);
    if (!image) {
      return res.status(404).json({ message: "Image not found" });
    }

    const filePath = path.join(__dirname, "..", image.path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await Image.findByIdAndDelete(req.params.imageId);
    res.json({ message: "Image deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const { datasetName } = req.body;

    let dataset = await Dataset.findOne({ name: datasetName });
    if (!dataset) {
      dataset = new Dataset({ name: datasetName });
      await dataset.save();
    }

    const image = new Image({
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path.replace(/\\/g, "/").replace(/^.*[\\\/]/, "uploads/"),
      dataset: dataset._id,
      label: req.body.label,
      labeledBy: req.body.labeledBy,
      labeledAt: req.body.labeledAt,
      coordinates: req.body.coordinates
        ? JSON.parse(req.body.coordinates)
        : null,
      boundingBox: req.body.boundingBox
        ? JSON.parse(req.body.boundingBox)
        : null,
      isCropped: req.body.isCropped === "true",
    });

    await image.save();
    res.status(201).json(image);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/image/:imageId/label-stats", async (req, res) => {
  try {
    const image = await Image.findById(req.params.imageId);
    if (!image) {
      return res.status(404).json({ message: "Image not found" });
    }

    const latestLabels = {};
    if (image.labels && Array.isArray(image.labels)) {
      image.labels.forEach((label) => {
        const userId = label.labeledBy;
        if (
          !latestLabels[userId] ||
          new Date(label.labeledAt) > new Date(latestLabels[userId].labeledAt)
        ) {
          latestLabels[userId] = label;
        }
      });
    }

    const labelCounts = {};
    Object.values(latestLabels).forEach((label) => {
      if (label.label) {
        labelCounts[label.label] = (labelCounts[label.label] || 0) + 1;
      }
    });

    const stats = Object.entries(labelCounts).map(([label, count]) => ({
      label,
      count,
    }));

    res.json(stats);
  } catch (error) {
    console.error("Error getting label stats:", error);
    res.status(500).json({ message: error.message });
  }
});

router.get("/images/:datasetName", async (req, res) => {
  gfs.files
    .find({ "metadata.datasetName": req.params.datasetName })
    .toArray((err, files) => {
      if (!files || files.length === 0) {
        return res.status(404).json({ message: "No files found" });
      }
      res.json(files);
    });
});

router.get("/image/:id", (req, res) => {
  gfs.files.findOne(
    { _id: mongoose.Types.ObjectId(req.params.id) },
    (err, file) => {
      if (!file || file.length === 0) {
        return res.status(404).json({ message: "No file found" });
      }
      const readstream = gfs.createReadStream(file.filename);
      res.set("Content-Type", file.contentType);
      readstream.pipe(res);
    }
  );
});

router.post("/upload/avatar", upload.single("avatar"), async (req, res) => {
  try {
    const userId = req.body.userId;
    const avatarFileId = req.file.id;

    const User = require("../models/User");
    await User.findByIdAndUpdate(userId, { avatar: avatarFileId });

    res
      .status(201)
      .json({ message: "Avatar uploaded", avatarId: avatarFileId });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/avatar/:id", (req, res) => {
  gfs.files.findOne(
    { _id: mongoose.Types.ObjectId(req.params.id) },
    (err, file) => {
      if (!file || file.length === 0) {
        return res.status(404).json({ message: "No avatar found" });
      }
      const readstream = gfs.createReadStream(file.filename);
      res.set("Content-Type", file.contentType);
      readstream.pipe(res);
    }
  );
});

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });
const conn = mongoose.connection;

let gfs;
conn.once("open", () => {
  gfs = Grid(conn.db, mongoose.mongo);
  gfs.collection("uploads");
  console.log("Successfully connected to MongoDB and initialized GridFS");
});

module.exports = router;
