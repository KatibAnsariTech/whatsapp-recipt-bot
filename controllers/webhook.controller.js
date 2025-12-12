// controllers/webhookController.js
import { downloadImageFromUrl } from "../utils/ocr.js";
import { sendWhatsAppReply } from "../utils/notifier.js";
import { parseReceiptFields } from '../utils/extractors.js';
import fs from "fs";
import path from "path";

export default async function webhookController(req, res) {
    let tmpPath = null;  // Track file for cleanup

    try {
        const from = req.body.From;
        const numMedia = parseInt(req.body.NumMedia || "0", 10);

        if (!numMedia) {
            await sendWhatsAppReply(from, "Please send the receipt image (photo).");
            return res.status(200).send("<Response></Response>");
        }

        const mediaUrl = req.body.MediaUrl0;
        if (!mediaUrl) {
            await sendWhatsAppReply(from, "Could not fetch the image. Please resend the receipt.");
            return res.status(200).send("<Response></Response>");
        }

        const tmpDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const mediaType = req.body.MediaContentType0 || "image/jpeg";

        let ext = mediaType.includes("png") ? "png"
                : mediaType.includes("webp") ? "webp"
                : mediaType.includes("heic") ? "heic"
                : "jpg";

        tmpPath = path.join(tmpDir, `receipt_${Date.now()}.${ext}`);

        // DOWNLOAD IMAGE
        const savedFile = await downloadImageFromUrl(mediaUrl, tmpPath);

        if (!savedFile || !fs.existsSync(tmpPath)) {
            await sendWhatsAppReply(from, "⚠️ Could not download the receipt image. Please resend.");
            return res.status(200).send("<Response></Response>");
        }

        // PARSE RECEIPT USING AI
        const extracted = await parseReceiptFields(tmpPath);

        const reasons = [];
        if (!extracted.name) reasons.push("Name missing");
        if (!extracted.phone) reasons.push("Phone missing");
        if (!extracted.email) reasons.push("Email missing");

        const accepted = extracted.name && (extracted.phone || extracted.email);

        const reply = accepted
            ? `✅ *Receipt ACCEPTED*\n\nName: ${extracted.name}\nPhone: ${extracted.phone}\nEmail: ${extracted.email}\nAmount: ${extracted.amount}`
            : `❌ *Receipt REJECTED*\nMissing: ${reasons.join(", ")}\n\nPlease resend a clearer image.`;

        await sendWhatsAppReply(from, reply);

        // CLEANUP FILE
        try {
            fs.unlinkSync(tmpPath);
            console.log("🗑️ Deleted temp file:", tmpPath);
        } catch {}

        return res.status(200).send("<Response></Response>");

    } catch (err) {
        console.error("Webhook error:", err);

        // Send error message to user
        if (req.body?.From) {
            await sendWhatsAppReply(req.body.From, "⚠️ Error reading your receipt. Please try again.");
        }

        // CLEANUP FILE IN ERROR CASE
        try {
            if (tmpPath && fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
                console.log("🗑️ Deleted temp file after error:", tmpPath);
            }
        } catch {}

        return res.status(500).send("<Response></Response>");
    }
}
