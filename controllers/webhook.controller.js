// controllers/webhookController.js
import { sendWhatsAppReply } from "../utils/notifier.js";
import { getMediaUrl, downloadImage } from "../utils/ocr.js";
import { parseReceiptFields } from "../utils/extractors.js";
import dotenv from 'dotenv';
import fs from "fs";
dotenv.config();

export default {
    verify: (req, res) => {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
            return res.status(200).send(challenge);
        }
        return res.sendStatus(403);
    },

    receive: async (req, res) => {
        console.log("🔥 WEBHOOK HIT!");
        console.log(JSON.stringify(req.body, null, 2));

        try {
            const entry = req.body.entry?.[0];
            const changes = entry?.changes?.[0];
            const msgObj = changes?.value?.messages?.[0];

            // Ignore status updates
            if (!msgObj) {
                console.log("ℹ️ Ignoring status event.");
                return res.sendStatus(200);   // ⬅️ FIX ADDED HERE!!
            }

            const from = msgObj.from;
            const type = msgObj.type;

            // ------------ TEXT ------------
            if (type === "text") {
                await sendWhatsAppReply(from, `You sent: ${msgObj.text.body}`);
                return res.sendStatus(200);
            }

            // ------------ IMAGE ------------
            if (type === "image") {
                console.log("📸 Image received");

                const mediaId = msgObj.image.id;

                // STEP 1
                const mediaUrl = await getMediaUrl(mediaId);

                // STEP 2
                const localPath = await downloadImage(mediaUrl, mediaId);

                // STEP 3
                const receipt = await parseReceiptFields(localPath);

                // STEP 4 (Delete temp file)
                if (fs.existsSync(localPath)) {
                    fs.unlink(localPath, err => {
                        if (err) console.log("❌ Delete error:", err);
                        else console.log("🗑️ Deleted:", localPath);
                    });
                }

                // ------------------ VALIDATION ------------------
                const hasName = receipt.name?.trim();
                const hasPhone = receipt.phone?.trim();
                const hasEmail = receipt.email?.trim();

                const isAccepted = hasName || hasPhone || hasEmail;

                if (!isAccepted) {
                    await sendWhatsAppReply(
                        from,
                        `❌ *Receipt Rejected*\nMissing required fields (name, phone, email).\n\nPlease send a clearer photo.`
                    );
                    return res.sendStatus(200);
                }

                // ------------------ ACCEPTED ------------------
                const reply = `
✅ *Receipt Accepted*

👤 *Name:* ${receipt.name || "Not found"}
📞 *Phone:* ${receipt.phone || "Not found"}
📧 *Email:* ${receipt.email || "Not found"}
💰 *Amount:* ${receipt.amount || "Not found"}
📅 *Date:* ${receipt.date || "Not found"}
                `;

                await sendWhatsAppReply(from, reply.trim());
            }

            return res.sendStatus(200);

        } catch (err) {
            console.error("❌ Webhook error:", err);
            return res.sendStatus(500);
        }
    }
};




//  using twillio

// // controllers/webhookController.js
// import { downloadImageFromUrl } from "../utils/ocr.js";
// import { sendWhatsAppReply } from "../utils/notifier.js";
// import { parseReceiptFields } from '../utils/extractors.js';
// import fs from "fs";
// import path from "path";

// export default async function webhookController(req, res) {
//     let tmpPath = null;  // Track file for cleanup

//     try {
//         const from = req.body.From;
//         const numMedia = parseInt(req.body.NumMedia || "0", 10);

//         if (!numMedia) {
//             await sendWhatsAppReply(from, "Please send the receipt image (photo).");
//             return res.status(200).send("<Response></Response>");
//         }

//         const mediaUrl = req.body.MediaUrl0;
//         if (!mediaUrl) {
//             await sendWhatsAppReply(from, "Could not fetch the image. Please resend the receipt.");
//             return res.status(200).send("<Response></Response>");
//         }

//         const tmpDir = path.join(process.cwd(), "tmp");
//         if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

//         const mediaType = req.body.MediaContentType0 || "image/jpeg";

//         let ext = mediaType.includes("png") ? "png"
//                 : mediaType.includes("webp") ? "webp"
//                 : mediaType.includes("heic") ? "heic"
//                 : "jpg";

//         tmpPath = path.join(tmpDir, `receipt_${Date.now()}.${ext}`);

//         // DOWNLOAD IMAGE
//         const savedFile = await downloadImageFromUrl(mediaUrl, tmpPath);

//         if (!savedFile || !fs.existsSync(tmpPath)) {
//             await sendWhatsAppReply(from, "⚠️ Could not download the receipt image. Please resend.");
//             return res.status(200).send("<Response></Response>");
//         }

//         // PARSE RECEIPT USING AI
//         const extracted = await parseReceiptFields(tmpPath);

//         const reasons = [];
//         if (!extracted.name) reasons.push("Name missing");
//         if (!extracted.phone) reasons.push("Phone missing");
//         if (!extracted.email) reasons.push("Email missing");

//         const accepted = extracted.name && (extracted.phone || extracted.email);

//         const reply = accepted
//             ? `✅ *Receipt ACCEPTED*\n\nName: ${extracted.name}\nPhone: ${extracted.phone}\nEmail: ${extracted.email}\nAmount: ${extracted.amount}`
//             : `❌ *Receipt REJECTED*\nMissing: ${reasons.join(", ")}\n\nPlease resend a clearer image.`;

//         await sendWhatsAppReply(from, reply);

//         // CLEANUP FILE
//         try {
//             fs.unlinkSync(tmpPath);
//             console.log("🗑️ Deleted temp file:", tmpPath);
//         } catch {}

//         return res.status(200).send("<Response></Response>");

//     } catch (err) {
//         console.error("Webhook error:", err);

//         // Send error message to user
//         if (req.body?.From) {
//             await sendWhatsAppReply(req.body.From, "⚠️ Error reading your receipt. Please try again.");
//         }

//         // CLEANUP FILE IN ERROR CASE
//         try {
//             if (tmpPath && fs.existsSync(tmpPath)) {
//                 fs.unlinkSync(tmpPath);
//                 console.log("🗑️ Deleted temp file after error:", tmpPath);
//             }
//         } catch {}

//         return res.status(500).send("<Response></Response>");
//     }
// }
