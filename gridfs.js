// server/gridfs.js
const mongoose = require("mongoose");
const Grid = require("gridfs-stream");

let gfs;

const getGFS = () => {
  if (!gfs) {
    const conn = mongoose.connection;
    if (conn.readyState === 1) {
      gfs = Grid(conn.db, mongoose.mongo);
      gfs.collection("uploads");
    } else {
      throw new Error("MongoDB connection not ready");
    }
  }
  return gfs;
};

module.exports = getGFS;
