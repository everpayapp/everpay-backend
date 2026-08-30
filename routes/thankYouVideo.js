import express from "express";
import multer from "multer";
import cloudinary from "../cloudinary.js";
import {
  getCreatorByUsername,
  updateCreatorThankYouVideo,
} from "../database.js";

const router = express.Router();

const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_VIDEO_SIZE,
  },
  fileFilter: (req, file, callback) => {
    if (!file.mimetype?.startsWith("video/")) {
      return callback(new Error("Only video files are allowed."));
    }

    callback(null, true);
  },
});

function cleanUsername(value) {
  return String(value || "").trim();
}

function safePublicIdUsername(username) {
  return cleanUsername(username)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
}

function uploadVideoBuffer(buffer, username) {
  return new Promise((resolve, reject) => {
    const safeUsername = safePublicIdUsername(username);

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "everpay/thank-you-videos",
        public_id: `everpay_${safeUsername}_thank_you`,
        resource_type: "video",
        overwrite: true,
        invalidate: true,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

router.post(
  "/thank-you-video",
  upload.single("file"),
  async (req, res) => {
    try {
      const username = cleanUsername(req.body?.username);

      if (!username) {
        return res.status(400).json({
          error: "Missing username.",
        });
      }

      if (!req.file?.buffer) {
        return res.status(400).json({
          error: "Missing video file.",
        });
      }

      const creator = await getCreatorByUsername(username);

      if (!creator) {
        return res.status(404).json({
          error: "Creator not found.",
        });
      }

      const uploaded = await uploadVideoBuffer(
        req.file.buffer,
        username
      );

      const videoUrl = uploaded?.secure_url;

      if (!videoUrl) {
        throw new Error("Cloudinary did not return a video URL.");
      }

      await updateCreatorThankYouVideo(
        username,
        videoUrl
      );

      return res.json({
        success: true,
        thank_you_video: videoUrl,
      });
    } catch (error) {
      console.error(
        "Thank-you video upload error:",
        error
      );

      if (error?.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "The video is too large. Maximum size is 50 MB.",
        });
      }

      if (error?.message === "Only video files are allowed.") {
        return res.status(400).json({
          error: error.message,
        });
      }

      return res.status(500).json({
        error: "Unable to upload the video.",
      });
    }
  }
);

router.delete("/thank-you-video", async (req, res) => {
  try {
    const username = cleanUsername(req.body?.username);

    if (!username) {
      return res.status(400).json({
        error: "Missing username.",
      });
    }

    const creator = await getCreatorByUsername(username);

    if (!creator) {
      return res.status(404).json({
        error: "Creator not found.",
      });
    }

    const safeUsername =
      safePublicIdUsername(username);

    const publicId =
      `everpay/thank-you-videos/` +
      `everpay_${safeUsername}_thank_you`;

    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: "video",
        invalidate: true,
      });
    } catch (cloudinaryError) {
      console.error(
        "Cloudinary video deletion warning:",
        cloudinaryError
      );
    }

    await updateCreatorThankYouVideo(username, "");

    return res.json({
      success: true,
      thank_you_video: "",
    });
  } catch (error) {
    console.error(
      "Thank-you video deletion error:",
      error
    );

    return res.status(500).json({
      error: "Unable to delete the video.",
    });
  }
});

export default router;
