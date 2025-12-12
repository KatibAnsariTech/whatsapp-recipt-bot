// controllers/webhookController.js
import { sendWhatsAppReply } from "../utils/notifier.js";
import { getMediaUrl, downloadImage } from "../utils/ocr.js";
import { parseReceiptFields } from "../utils/extractors.js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const sessions = {}; // <-- STORE USER STATES HERE

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
        try {
            const entry = req.body.entry?.[0];
            const msgObj = entry?.changes?.[0]?.value?.messages?.[0];

            if (!msgObj) return res.sendStatus(200);

            const from = msgObj.from;
            const type = msgObj.type;

            // initialize session
            if (!sessions[from]) {
                sessions[from] = {
                    state: "AWAITING_IMAGE",
                    receipt: {},
                    editField: null,
                };
            }

            const session = sessions[from];

            // ------------------------------------
            // 1️⃣ USER SENDS TEXT
            // ------------------------------------
            if (type === "text") {
                const text = msgObj.text.body.trim();

                // If expecting confirmation after receipt
                if (session.state === "AWAITING_CONFIRMATION") {
                    if (text === "1") {
                        await sendWhatsAppReply(from, "Successfully submitted your invoice.");
                        session.state = "AWAITING_IMAGE";
                        session.receipt = {};
                        return res.sendStatus(200);
                    }

                    if (text === "2") {
                        session.state = "AWAITING_EDIT_FIELD";

                        await sendWhatsAppReply(
                            from,
                            `Press 1 to edit Name
Press 2 to edit Phone
Press 3 to edit Email
Press 4 to edit Amount
Press 5 to edit Date`
                        );

                        return res.sendStatus(200);
                    }

                    await sendWhatsAppReply(from, "Please press 1 or 2.");
                    return res.sendStatus(200);
                }

                // EDIT FIELD SELECTION
                if (session.state === "AWAITING_EDIT_FIELD") {
                    const map = {
                        "1": "name",
                        "2": "phone",
                        "3": "email",
                        "4": "amount",
                        "5": "date",
                    };

                    if (!map[text]) {
                        await sendWhatsAppReply(from, "Invalid option. Choose 1–5.");
                        return res.sendStatus(200);
                    }

                    session.editField = map[text];
                    session.state = "AWAITING_NEW_VALUE";

                    // dynamic prompts
                    const fieldPrompts = {
                        name: "Please enter the new *name*:",
                        phone: "Please enter the new *phone number*:",
                        email: "Please enter the new *email*:",
                        amount: "Please enter the new *amount*:",
                        date: "Please enter the new *date*:",
                    };

                    await sendWhatsAppReply(from, fieldPrompts[session.editField]);
                    return res.sendStatus(200);
                }

                // USER ENTERS NEW VALUE FOR THE FIELD
                if (session.state === "AWAITING_NEW_VALUE") {
                    if (!session.editField) {
                        // fallback - shouldn't happen but be safe
                        session.state = "AWAITING_CONFIRMATION";
                        await sendWhatsAppReply(from, "No field selected. Please press 2 to edit again.");
                        return res.sendStatus(200);
                    }

                    session.receipt[session.editField] = text;
                    session.state = "AWAITING_CONFIRMATION";
                    session.editField = null;

                    await sendWhatsAppReply(from, "Value updated successfully.");

                    const updated = session.receipt;

                    await sendWhatsAppReply(
                        from,
                        `
👤 Name: ${updated.name || "Not found"}
📞 Phone: ${updated.phone || "Not found"}
✉️ Email: ${updated.email || "Not found"}
💰 Amount: ${updated.amount || "Not found"}
📅 Date: ${updated.date || "Not found"}`
                    );

                    await sendWhatsAppReply(
                        from,
                        "Please confirm if the details are correct.\nPress 1 to submit or 2 to edit."
                    );

                    return res.sendStatus(200);
                }

                // DEFAULT → Ask user to upload bill
                await sendWhatsAppReply(
                    from,
                    "Hello, please upload your bill to get processed with STT."
                );
                return res.sendStatus(200);
            }

            // ------------------------------------
            // 2️⃣ USER SENDS IMAGE
            // ------------------------------------
            if (type === "image") {
                const mediaId = msgObj.image.id;

                const mediaUrl = await getMediaUrl(mediaId);
                const localPath = await downloadImage(mediaUrl, mediaId);

                // ensure localPath exists before parsing
                let receipt = { name: "", phone: "", email: "", amount: "", date: "" };
                try {
                    receipt = await parseReceiptFields(localPath);
                } catch (e) {
                    console.error("Error parsing receipt fields:", e);
                }

                // delete temp file (best-effort; ensure we always remove file)
                try {
                    if (localPath && fs.existsSync(localPath)) {
                        fs.unlinkSync(localPath);
                    }
                } catch (e) {
                    console.error("Error deleting temp file:", e);
                }

                // NORMALIZE fields to strings (avoid crashes)
                const name = (receipt.name || "").toString().trim();
                const phone = (receipt.phone || "").toString().trim();
                const email = (receipt.email || "").toString().trim();
                const amount = (receipt.amount || "").toString().trim();
                const date = (receipt.date || "").toString().trim();

                // ACCEPT ONLY IF AT LEAST ONE FIELD IS FOUND
                const hasAnyField = !!(name || phone || email || amount || date);

                if (!hasAnyField) {
                    // If nothing is extracted, reject and ask for clearer photo
                    await sendWhatsAppReply(
                        from,
                        `❌ *Receipt Rejected*\nNo readable fields were found (name, phone, email, amount, date).\n\nPlease send a clearer photo of the bill or try a different angle.`
                    );

                    // keep the session state as AWAITING_IMAGE (so user can send again)
                    session.state = "AWAITING_IMAGE";
                    session.receipt = {};
                    session.editField = null;

                    return res.sendStatus(200);
                }

                // If we have at least one field, store and show the parsed receipt
                session.receipt = { name, phone, email, amount, date };
                session.state = "AWAITING_CONFIRMATION";
                session.editField = null;

                await sendWhatsAppReply(
                    from,
                    `
👤 Name: ${name || "Not found"}
📞 Phone: ${phone || "Not found"}
✉️ Email: ${email || "Not found"}
💰 Amount: ${amount || "Not found"}
📅 Date: ${date || "Not found"}`
                );

                await sendWhatsAppReply(
                    from,
                    "Please confirm if the details are correct.\nPress 1 to submit or 2 to edit."
                );

                return res.sendStatus(200);
            }

            return res.sendStatus(200);
        } catch (err) {
            console.error(err);
            return res.sendStatus(500);
        }
    },
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
