import express from "express";
import multer from "multer";
import cloudinary from "../cloudinary.js";
import { updateCreatorAvatarUrl, getCreatorByUsername } from "../database.js";


const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function uploadBufferToCloudinary(buffer, opts = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "everpay/avatars",
        resource_type: "image",
        transformation: [
          { width: 512, height: 512, crop: "fill", gravity: "face" },
          { quality: "auto" },
          { fetch_format: "auto" },
        ],
        ...opts,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

// POST /api/creator/avatar  (multipart/form-data: username + file)
router.post("/avatar", upload.single("file"), async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    if (!username) return res.status(400).json({ error: "Missing username." });

    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Missing file." });
    }

    const creator = await getCreatorByUsername(username);
    if (!creator) return res.status(404).json({ error: "Creator not found." });

    const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
      public_id: `everpay_${username}_avatar`,
      overwrite: true,
    });

    const avatarUrl = uploaded.secure_url;

    await updateCreatorAvatarUrl(username, avatarUrl);

    return res.json({ success: true, avatar_url: avatarUrl });
  } catch (err) {
    console.error("Avatar upload error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
