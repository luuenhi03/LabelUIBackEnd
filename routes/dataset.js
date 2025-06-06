const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const Dataset = require("../models/Dataset");
const fs = require("fs");
const mongoose = require("mongoose");
const getGFS = require("../gridfs");
const { GridFsStorage } = require("multer-gridfs-storage");
const crypto = require("crypto");
const User = require("../models/User");
const Image = require("../models/Image");
const jwt = require("jsonwebtoken");

const storage = new GridFsStorage({
  url: process.env.MONGODB_URI || "mongodb://localhost:27017/label_db",
  options: { useNewUrlParser: true, useUnifiedTopology: true },
  file: (req, file) => {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(16, (err, buf) => {
        if (err) {
          return reject(err);
        }
        const filename = buf.toString("hex") + path.extname(file.originalname);
        const fileInfo = {
          filename: filename,
          bucketName: "uploads",
          metadata: {
            datasetId: req.params.id,
            originalName: file.originalname,
            uploadDate: new Date(),
          },
        };
        resolve(fileInfo);
      });
    });
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error("Only image files are accepted!"), false);
    }
    cb(null, true);
  },
});

const checkDatasetExists = async (req, res, next) => {
  try {
    console.log("=== Dataset Check Debug ===");
    console.log("Request params:", req.params);
    console.log("Request path:", req.path);
    console.log("Request method:", req.method);

    if (!req.params.id) {
      console.log("No dataset ID provided");
      return res.status(400).json({
        message: "Dataset ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log("Invalid dataset ID format:", req.params.id);
      return res.status(400).json({
        message: "Invalid dataset ID format",
      });
    }

    console.log("Checking dataset with ID:", req.params.id);
    const dataset = await Dataset.findById(req.params.id);

    if (!dataset) {
      console.log("Dataset not found with ID:", req.params.id);
      return res.status(404).json({
        message: "Dataset not found",
        details: `Dataset with ID ${req.params.id} does not exist`,
      });
    }

    console.log("Dataset found:", {
      id: dataset._id,
      name: dataset.name,
      imageCount: dataset.images?.length || 0,
    });

    req.dataset = dataset;
    next();
  } catch (error) {
    console.error("Error checking dataset:", error);
    res.status(500).json({
      message: "Error checking dataset",
      error: error.message,
    });
  }
};

const checkMongoConnection = async (req, res, next) => {
  try {
    const dbState = mongoose.connection.readyState;
    if (dbState !== 1) {
      return res.status(500).json({
        status: "error",
        message: "MongoDB is not connected",
        connectionState: dbState,
      });
    }
    next();
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Database connection error",
      error: error.message,
    });
  }
};

router.get("/test-db", checkMongoConnection, async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    console.log("MongoDB ping successful");

    const datasetCount = await Dataset.countDocuments();
    console.log("Total datasets:", datasetCount);

    res.json({
      status: "success",
      connection: {
        state: mongoose.connection.readyState,
        meaning: {
          0: "disconnected",
          1: "connected",
          2: "connecting",
          3: "disconnecting",
        }[mongoose.connection.readyState],
      },
      datasets: {
        count: datasetCount,
      },
    });
  } catch (error) {
    console.error("Database test failed:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
      connection: {
        state: mongoose.connection.readyState,
      },
    });
  }
});

router.get("/test-connection", checkMongoConnection, async (req, res) => {
  try {
    const datasetCount = await Dataset.countDocuments();
    console.log("Total datasets:", datasetCount);

    const testDataset = new Dataset({
      name: "test_dataset_" + Date.now(),
      images: [],
    });
    await testDataset.save();
    console.log("Test dataset created:", testDataset._id.toString());

    const updateResult = await Dataset.findByIdAndUpdate(
      testDataset._id,
      {
        $push: {
          images: {
            filename: "test.jpg",
            _id: new mongoose.Types.ObjectId(),
          },
        },
      },
      { new: true }
    );
    console.log("Test dataset updated:", updateResult._id.toString());

    const deleteResult = await Dataset.findByIdAndDelete(testDataset._id);
    console.log("Test dataset deleted:", deleteResult._id.toString());

    res.json({
      status: "success",
      message: "MongoDB connection test successful",
      details: {
        connectionState: mongoose.connection.readyState,
        totalDatasets: datasetCount,
        testOperations: "All passed",
        testDatasetId: testDataset._id.toString(),
      },
    });
  } catch (error) {
    console.error("MongoDB connection test failed:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
      details: {
        connectionState: mongoose.connection.readyState,
        errorType: error.name,
      },
    });
  }
});

router.get("/", async (req, res) => {
  try {
    console.log("=== Get Datasets Debug ===");
    console.log("Query params:", req.query);
    const datasets = await Dataset.find({});
    console.log("Found datasets:", datasets.length);
    console.log(
      "Datasets:",
      datasets.map((d) => ({ id: d._id, name: d.name }))
    );

    res.json(datasets);
  } catch (error) {
    console.error("Error fetching datasets:", error);
    res.status(500).json({ message: "Error fetching datasets" });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ message: "Dataset name cannot be empty" });
    }

    if (!req.body.userId) {
      return res.status(400).json({ message: "UserId is required" });
    }

    const newDataset = new Dataset({
      name: req.body.name.trim(),
      userId: req.body.userId,
    });
    const savedDataset = await newDataset.save();
    res.json(savedDataset);
  } catch (error) {
    console.error("Error creating new dataset:", error);
    if (error.code === 11000) {
      res.status(400).json({ message: "Dataset name already exists" });
    } else {
      res.status(500).json({ message: "Error creating new dataset" });
    }
  }
});

router.put("/:id", checkDatasetExists, async (req, res) => {
  try {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ message: "Dataset name cannot be empty" });
    }

    const dataset = await Dataset.findByIdAndUpdate(
      req.params.id,
      { name: req.body.name.trim() },
      { new: true }
    );
    res.json(dataset);
  } catch (error) {
    console.error("Error updating dataset:", error);
    res.status(500).json({ message: "Error updating dataset" });
  }
});

router.post("/:id/share", checkDatasetExists, async (req, res) => {
  try {
    if (!req.body.email || !req.body.email.trim()) {
      return res.status(400).json({ message: "Email cannot be empty" });
    }

    res.json({ success: true, message: "Dataset shared successfully!" });
  } catch (error) {
    console.error("Error sharing dataset:", error);
    res.status(500).json({ message: "Error sharing dataset" });
  }
});

router.post(
  "/:id/upload",
  checkDatasetExists,
  upload.array("images"),
  async (req, res) => {
    console.log("=== Upload Debug ===");
    console.log("Request params:", req.params);
    console.log("Request files:", req.files?.length || 0, "files");
    console.log("Request body:", req.body);

    try {
      if (!req.files || req.files.length === 0) {
        console.log("No files uploaded");
        return res.status(400).json({ message: "No files were uploaded" });
      }

      const dataset = await Dataset.findById(req.params.id);
      if (!dataset) {
        console.log("Dataset not found:", req.params.id);
        return res.status(404).json({ message: "Dataset not found" });
      }

      console.log("Found dataset:", {
        id: dataset._id,
        name: dataset.name,
        currentImageCount: dataset.images?.length || 0,
        userId: dataset.userId,
      });

      if (!dataset.userId) {
        console.log("Dataset missing userId, attempting to get from request");
        const token = req.headers.authorization?.split(" ")[1];
        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            dataset.userId = decoded.userId;
            console.log("Added userId from token:", dataset.userId);
          } catch (err) {
            console.error("Error decoding token:", err);
            return res.status(401).json({ message: "Invalid token" });
          }
        } else {
          return res.status(401).json({ message: "Token not found" });
        }
      }

      dataset.images = dataset.images || [];
      const savedImages = [];

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        console.log(`Processing file ${i + 1}/${req.files.length}:`, {
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
        });

        const label = Array.isArray(req.body.label)
          ? req.body.label[i]
          : req.body.label || "";

        let coordinates;
        try {
          if (Array.isArray(req.body.coordinates)) {
            coordinates =
              req.body.coordinates[i] && req.body.coordinates[i] !== "undefined"
                ? JSON.parse(req.body.coordinates[i])
                : undefined;
          } else {
            coordinates =
              req.body.coordinates && req.body.coordinates !== "undefined"
                ? JSON.parse(req.body.coordinates)
                : undefined;
          }
        } catch (err) {
          console.error("Error parsing coordinates:", err);
          coordinates = undefined;
        }

        const labeledBy = Array.isArray(req.body.labeledBy)
          ? req.body.labeledBy[i]
          : req.body.labeledBy || "";

        let labeledAt;
        try {
          if (Array.isArray(req.body.labeledAt)) {
            labeledAt =
              req.body.labeledAt[i] && !isNaN(Date.parse(req.body.labeledAt[i]))
                ? new Date(req.body.labeledAt[i])
                : new Date();
          } else {
            labeledAt =
              req.body.labeledAt && !isNaN(Date.parse(req.body.labeledAt))
                ? new Date(req.body.labeledAt)
                : new Date();
          }
        } catch (err) {
          console.error("Error parsing labeledAt:", err);
          labeledAt = new Date();
        }

        const boundingBox = coordinates
          ? {
              x: coordinates.x,
              y: coordinates.y,
              width: coordinates.width,
              height: coordinates.height,
            }
          : undefined;

        const imageData = {
          fileId: file.id || file._id,
          url: `/api/dataset/file/${file.id || file._id}`,
          filename: file.filename,
          originalName: file.metadata?.originalName || file.originalname,
          uploadDate: file.metadata?.uploadDate || new Date(),
          label,
          labeledBy,
          labeledAt,
          coordinates,
          boundingBox,
          isCropped: req.body.isCropped === "true",
        };

        console.log("Adding image to dataset:", {
          fileId: imageData.fileId,
          filename: imageData.filename,
          label: imageData.label,
        });

        dataset.images.push(imageData);
        savedImages.push(imageData);
      }

      dataset.imageCount = dataset.images.length;
      console.log("Saving dataset with new images...");
      await dataset.save();
      console.log("Dataset saved successfully:", {
        datasetId: dataset._id,
        totalImages: dataset.images.length,
        newImages: savedImages.length,
        userId: dataset.userId,
      });

      res.status(200).json({
        message: "Images uploaded successfully",
        images: savedImages,
      });
    } catch (error) {
      console.error("Error uploading images:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        code: error.code,
      });
      res.status(500).json({
        message: "Error uploading images",
        error: error.message,
        details: error.stack,
      });
    }
  }
);

router.get("/:id/images", checkDatasetExists, async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      return res.status(404).json({ message: "Dataset not found" });
    }
    res.json(dataset.images || []);
  } catch (error) {
    console.error("Error fetching images:", error);
    res.status(500).json({ message: "Error fetching image list" });
  }
});

router.get("/:id/labeled", checkDatasetExists, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = 6;
    const skip = page * limit;

    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      return res.status(404).json({ message: "Dataset not found" });
    }

    const labeledImages = dataset.images.filter(
      (img) => img.label && img.label.trim() !== ""
    );

    labeledImages.sort((a, b) => {
      const dateA = a.labeledAt ? new Date(a.labeledAt) : new Date(0);
      const dateB = b.labeledAt ? new Date(b.labeledAt) : new Date(0);
      return dateB - dateA;
    });

    const paginatedImages = labeledImages.slice(skip, skip + limit);
    const total = labeledImages.length;

    console.log("Labeled images found:", {
      total,
      page,
      limit,
      skip,
      returnedCount: paginatedImages.length,
    });

    res.json({
      images: paginatedImages,
      total,
    });
  } catch (error) {
    console.error("Error fetching labeled images:", error);
    res.status(500).json({ message: "Error fetching labeled image list" });
  }
});

router.put("/:id/images/:imageId", checkDatasetExists, async (req, res) => {
  try {
    console.log("=== Save Label Debug ===");
    console.log("Dataset ID:", req.params.id);
    console.log("Image ID:", req.params.imageId);
    console.log("Request body:", req.body);

    const { label, labeledBy, boundingBox } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ message: "Label cannot be empty" });
    }

    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      return res.status(404).json({ message: "Dataset not found" });
    }

    const image = dataset.images.find(
      (img) => img._id.toString() === req.params.imageId
    );
    if (!image) {
      return res.status(404).json({ message: "Image not found" });
    }

    image.label = label.trim();
    image.labeledBy = labeledBy || "";
    image.labeledAt = new Date();
    if (boundingBox) {
      image.boundingBox = boundingBox;
    }

    if (!image.labels) {
      image.labels = [];
    }

    image.labels.push({
      label: label.trim(),
      labeledBy: labeledBy || "",
      labeledAt: new Date(),
    });

    await dataset.save();
    console.log("Label saved successfully:", {
      imageId: image._id,
      label: image.label,
      labeledBy: image.labeledBy,
      labeledAt: image.labeledAt,
      labelsCount: image.labels.length,
    });

    res.json(image);
  } catch (error) {
    console.error("Error updating image label:", error);
    res.status(500).json({ message: "Error updating label" });
  }
});

router.get("/:id/check", async (req, res) => {
  try {
    console.log("=== Dataset Check Debug ===");
    console.log("Checking dataset ID:", req.params.id);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log("Invalid dataset ID format:", req.params.id);
      return res.status(400).json({
        message: "Invalid dataset ID format",
        id: req.params.id,
      });
    }

    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      console.log("Dataset not found with ID:", req.params.id);
      return res.status(404).json({
        message: "Dataset not found",
        id: req.params.id,
      });
    }

    console.log("Dataset found:", {
      id: dataset._id,
      name: dataset.name,
      imageCount: dataset.images?.length || 0,
    });

    res.json({
      exists: true,
      dataset: {
        id: dataset._id,
        name: dataset.name,
        imageCount: dataset.images?.length || 0,
      },
    });
  } catch (error) {
    console.error("Error checking dataset:", error);
    res.status(500).json({
      message: "Error checking dataset",
      error: error.message,
    });
  }
});

router.get("/:id/export", checkDatasetExists, async (req, res) => {
  try {
    console.log("=== CSV Export Debug ===");
    console.log("Export request for dataset ID:", req.params.id);

    const dataset = req.dataset;
    console.log("Dataset found:", {
      id: dataset._id,
      name: dataset.name,
      imageCount: dataset.images?.length || 0,
    });

    const csvRows = ["imageUrl,label,labeledBy,labeledAt,boundingBox"];

    if (dataset.images && dataset.images.length > 0) {
      dataset.images
        .filter((img) => img.label)
        .forEach((img) => {
          const escapeCsv = (str) => {
            if (str === null || str === undefined) return "";
            str = String(str);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };

          let boundingBoxStr = "";
          if (img.boundingBox) {
            if (
              typeof img.boundingBox.x !== "undefined" &&
              typeof img.boundingBox.y !== "undefined" &&
              typeof img.boundingBox.width !== "undefined" &&
              typeof img.boundingBox.height !== "undefined"
            ) {
              boundingBoxStr = `${img.boundingBox.x},${img.boundingBox.y},${img.boundingBox.width},${img.boundingBox.height}`;
            } else if (img.boundingBox.topLeft && img.boundingBox.bottomRight) {
              boundingBoxStr = `${img.boundingBox.topLeft.x},${img.boundingBox.topLeft.y},${img.boundingBox.bottomRight.x},${img.boundingBox.bottomRight.y}`;
            }
          }

          let imageUrl = "";
          if (img.url) {
            imageUrl = `http://localhost:5000${img.url}`;
          } else if (img.fileId) {
            imageUrl = `http://localhost:5000/api/dataset/${img.fileId}`;
          }

          const row = [
            escapeCsv(imageUrl),
            escapeCsv(img.label || ""),
            escapeCsv(img.labeledBy || ""),
            escapeCsv(img.labeledAt || ""),
            escapeCsv(boundingBoxStr),
          ].join(",");

          csvRows.push(row);
        });
    }

    const csvContent = csvRows.join("\n");
    console.log("CSV content generated, length:", csvContent.length);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${dataset.name}_labeled_images.csv`
    );
    res.setHeader("Content-Length", Buffer.byteLength(csvContent, "utf-8"));

    console.log("Sending CSV response");
    res.send(csvContent);
  } catch (error) {
    console.error("Error exporting CSV:", error);
    res.status(500).json({ message: "Error exporting CSV" });
  }
});

router.delete("/:id/images/:imageId", checkDatasetExists, async (req, res) => {
  try {
    console.log("=== Delete Image Debug ===");
    console.log("Dataset ID:", req.params.id);
    console.log("Image ID:", req.params.imageId);

    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      console.log("Dataset not found");
      return res.status(404).json({ message: "Dataset not found" });
    }

    const imageIndex = dataset.images.findIndex(
      (img) => img._id.toString() === req.params.imageId
    );

    if (imageIndex === -1) {
      console.log("Image not found in dataset");
      return res.status(404).json({ message: "Image not found in dataset" });
    }

    dataset.images[imageIndex].label = "";
    dataset.images[imageIndex].labeledBy = "";
    dataset.images[imageIndex].labeledAt = null;
    dataset.images[imageIndex].labels = [];
    dataset.images[imageIndex].boundingBox = null;

    await dataset.save();

    console.log("Image label information deleted successfully");
    res.json({
      message: "Image label information deleted successfully",
      datasetId: req.params.id,
      imageId: req.params.imageId,
    });
  } catch (error) {
    console.error("Error deleting image label:", {
      error: error.message,
      stack: error.stack,
      params: req.params,
    });
    res.status(500).json({
      message: "Error deleting image label",
      error: error.message,
    });
  }
});

router.delete("/reset", async (req, res) => {
  try {
    await Dataset.deleteMany({});
    res.json({ message: "All datasets deleted" });
  } catch (error) {
    console.error("Error resetting datasets:", error);
    res.status(500).json({ message: "Error deleting datasets" });
  }
});

router.get("/file/:fileId", checkMongoConnection, async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const bucket = new mongoose.mongo.GridFSBucket(db, {
      bucketName: "uploads",
    });

    const fileId = new mongoose.Types.ObjectId(req.params.fileId);

    const files = await db
      .collection("uploads.files")
      .find({ _id: fileId })
      .toArray();
    if (!files || files.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    res.set("Content-Type", files[0].contentType || "application/octet-stream");
    const downloadStream = bucket.openDownloadStream(fileId);
    downloadStream.pipe(res);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching image", error: err.message });
  }
});

router.get(
  "/:id/images/:imageId/label-stats",
  checkDatasetExists,
  async (req, res) => {
    try {
      const dataset = await Dataset.findById(req.params.id);
      if (!dataset) {
        return res.status(404).json({ message: "Dataset not found" });
      }
      const image = dataset.images.find(
        (img) => img._id.toString() === req.params.imageId
      );
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
  }
);

router.post("/upload-avatar", upload.single("avatar"), async (req, res) => {
  try {
    const { email } = req.body;
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ message: "Only image files are accepted" });
    }

    const avatarUrl = `/avatars/${req.file.filename}`;
    const user = await User.findOneAndUpdate(
      { email },
      { avatar: avatarUrl },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Avatar updated successfully",
      avatar: avatarUrl,
    });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    res.status(500).json({
      message: "Error uploading avatar",
      error: error.message,
    });
  }
});

router.get("/:id/stats", async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      return res.status(404).json({ message: "Dataset not found" });
    }

    const total = dataset.images.length;
    const unlabeled = dataset.images.filter(
      (img) => !img.label || img.label.trim() === ""
    ).length;
    const labeled = total - unlabeled;

    res.json({
      total,
      labeled,
      unlabeled,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching dataset stats", error: error.message });
  }
});

router.get("/:id", checkMongoConnection, async (req, res) => {
  try {
    console.log("=== Get Dataset by ID Debug ===");
    console.log("Dataset ID:", req.params.id);

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      console.log("Invalid dataset ID format:", req.params.id);
      return res.status(400).json({
        message: "Invalid dataset ID format",
      });
    }

    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      console.log("Dataset not found with ID:", req.params.id);
      return res.status(404).json({
        message: "Dataset not found",
      });
    }

    console.log("Dataset found:", {
      id: dataset._id,
      name: dataset.name,
      imageCount: dataset.images?.length || 0,
    });

    res.json(dataset);
  } catch (error) {
    console.error("Error fetching dataset:", error);
    res.status(500).json({
      message: "Error fetching dataset",
      error: error.message,
    });
  }
});

module.exports = router;
