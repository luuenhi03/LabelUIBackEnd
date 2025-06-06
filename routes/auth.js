const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const Otp = require("../models/Otp");
const multer = require("multer");
const authMiddleware = require("../middleware/auth");
const LabeledImage = require("../models/LabeledImage");

const checkDatabaseConnection = () => {
  return mongoose.connection.readyState === 1;
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
  debug: true,
  logger: true,
});

transporter.verify(function (error, success) {
  if (error) {
    console.error("Email configuration error:", {
      message: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      response: error.response,
      stack: error.stack,
    });
  } else {
    console.log("Email server is ready to send messages");
  }
});

async function sendOtpMail(to, otp) {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: to,
    subject: "Your OTP code",
    text: `Your OTP is: ${otp}`,
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
    return info;
  } catch (error) {
    console.error("Detailed email sending error:", {
      message: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
      response: error.response,
      stack: error.stack,
    });
    throw error;
  }
}

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

router.post("/send-otp-register", async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(500).json({ message: "Database connection error" });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email has been registed!" });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.findOneAndUpdate(
      { email },
      { code: otp, expiry: otpExpiry },
      { upsert: true, new: true }
    );

    try {
      await sendOtpMail(email, otp);
      console.log("OTP email sent successfully (register)");
    } catch (emailError) {
      return res.status(500).json({
        message: "Unable to send OTP email",
        error: emailError.message,
      });
    }

    res.status(200).json({ message: "OTP has been sent" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error sending OTP", error: error.message });
  }
});

router.post("/verify-otp-register", async (req, res) => {
  try {
    const { email, password, otp } = req.body;

    const otpRecord = await Otp.findOne({ email, code: otp });
    if (!otpRecord) {
      return res.status(400).json({ message: "OTP is incorrect" });
    }
    if (otpRecord.expiry < new Date()) {
      return res.status(400).json({ message: "OTP has expired" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email has been registered" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      email,
      password: hashedPassword,
      isVerified: true,
    });
    await user.save();

    await Otp.deleteOne({ _id: otpRecord._id });

    res.status(200).json({ message: "Registration successful" });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ message: "OTP verification error" });
  }
});

router.post("/send-otp", async (req, res) => {
  try {
    if (!checkDatabaseConnection()) {
      return res.status(500).json({ message: "Database connection error" });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    await Otp.findOneAndUpdate(
      { email },
      { code: otp, expiry: otpExpiry },
      { upsert: true, new: true }
    );

    try {
      await sendOtpMail(email, otp);
      console.log("OTP email sent successfully");
    } catch (emailError) {
      console.error("Detailed OTP email error:", {
        message: emailError.message,
        stack: emailError.stack,
        code: emailError.code,
        command: emailError.command,
        responseCode: emailError.responseCode,
        response: emailError.response,
      });
      return res.status(500).json({
        message: "Unable to send OTP email",
        error: emailError.message,
        details: {
          code: emailError.code,
          command: emailError.command,
          responseCode: emailError.responseCode,
        },
      });
    }

    res.status(200).json({ message: "OTP has been sent" });
  } catch (error) {
    console.error("Unexpected Error in send-otp:", {
      message: error.message,
      stack: error.stack,
      code: error.code,
    });
    res.status(500).json({
      message: "Error sending OTP",
      error: error.message,
      details: {
        code: error.code,
        stack: error.stack,
      },
    });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const otpRecord = await Otp.findOne({ email, code: otp });
    if (!otpRecord) {
      return res.status(400).json({ message: "OTP is incorrect" });
    }
    if (otpRecord.expiry < new Date()) {
      return res.status(400).json({ message: "OTP has expired" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    await Otp.deleteOne({ _id: otpRecord._id });

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ message: "OTP verification error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Email has not been registered" });
    }

    if (!user.isVerified) {
      return res.status(400).json({ message: "Email has not been verified" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Wrong password" });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res.status(200).json({
      message: "Login successfully",
      token,
      user: {
        id: user._id,
        email: user.email,
        isVerified: user.isVerified,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Login error" });
  }
});

router.post("/check-password", async (req, res) => {
  const { email, currentPassword } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: "User not found" });
  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch)
    return res.status(400).json({ message: "Wrong current password" });
  res.json({ success: true });
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "public/avatars/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const uploadAvatar = multer({ storage: storage });

router.post(
  "/upload-avatar",
  uploadAvatar.single("avatar"),
  async (req, res) => {
    try {
      const { email } = req.body;
      if (!req.file)
        return res.status(400).json({ message: "No file uploaded" });

      const avatarUrl = `/avatars/${req.file.filename}`;
      const user = await User.findOneAndUpdate(
        { email },
        { avatar: avatarUrl },
        { new: true }
      );
      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({ message: "Avatar updated", avatar: avatarUrl });
    } catch (error) {
      res.status(500).json({ message: "Upload error", error: error.message });
    }
  }
);

router.delete("/delete-account/:id", authMiddleware, async (req, res) => {
  const userIdToDelete = req.params.id;
  if (req.user._id !== userIdToDelete) {
    return res.status(403).json({ message: "Forbidden" });
  }
  try {
    await User.findByIdAndDelete(userIdToDelete);
    res.status(200).json({ message: "Account deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Delete account error", error: err.message });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({
      id: user._id,
      email: user.email,
      isVerified: user.isVerified,
      avatar: user.avatar,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching user" });
  }
});

router.get("/file/:fileId", async (req, res) => {
  const fileId = req.params.fileId;
  const file = await LabeledImage.findById(fileId);
  if (!file) return res.status(404).json({ message: "File not found" });
  res.json({ file });
});

module.exports = router;
