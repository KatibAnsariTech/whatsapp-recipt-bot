// controllers/webhookController.js
import { sendWhatsAppReply } from "../utils/notifier.js";
import { getMediaUrl, downloadImage } from "../utils/ocr.js";
import { parseReceiptFields } from "../utils/extractors.js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const sessions = {}; // <-- USER SESSIONS STORAGE

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

            // Initialize session if missing
            if (!sessions[from]) {
                sessions[from] = {
                    state: "AWAITING_IMAGE",
                    receipt: {},
                    editField: null,
                    fieldsQueue: [],      // NEW: multiple field editing
                };
            }

            const session = sessions[from];

            // ------------------------------------
            // 1️⃣ USER SENDS TEXT
            // ------------------------------------
            if (type === "text") {
                const text = msgObj.text.body.trim();

                // CONFIRMATION SCREEN
                if (session.state === "AWAITING_CONFIRMATION") {
                    if (text === "1") {
                        await sendWhatsAppReply(from, "Successfully submitted your invoice.");
                        sessions[from] = { state: "AWAITING_IMAGE", receipt: {}, editField: null, fieldsQueue: [] };
                        return res.sendStatus(200);
                    }

                    if (text === "2") {
                        session.state = "AWAITING_EDIT_FIELD";

                        await sendWhatsAppReply(
                            from,
                            `Which field do you want to edit?
1️⃣ Name
2️⃣ Phone
3️⃣ Email
4️⃣ Amount
5️⃣ Date
6️⃣ Finish Editing
7️⃣ Edit multiple fields`
                        );
                        return res.sendStatus(200);
                    }

                    await sendWhatsAppReply(from, "Please press 1 to submit or 2 to edit.");
                    return res.sendStatus(200);
                }

                // MULTI-FIELD SELECTION ENTRY
                if (session.state === "AWAITING_MULTI_FIELD_SELECTION") {
                    const numbers = text.split(",").map(n => n.trim());

                    const map = {
                        "1": "name",
                        "2": "phone",
                        "3": "email",
                        "4": "amount",
                        "5": "date",
                    };

                    const fields = [];

                    for (let n of numbers) {
                        if (map[n]) fields.push(map[n]);
                    }

                    if (fields.length === 0) {
                        await sendWhatsAppReply(from, "Invalid selection. Please enter numbers like 1,3,5");
                        return res.sendStatus(200);
                    }

                    session.fieldsQueue = fields;
                    session.state = "AWAITING_MULTI_FIELD_VALUES";

                    await sendWhatsAppReply(
                        from,
                        `You selected: ${fields.join(", ")}

Please enter the new values in the same order, separated by commas.

Example:
newName,newPhone,newEmail`
                    );

                    return res.sendStatus(200);
                }

                // MULTI-FIELD VALUE HANDLING
                if (session.state === "AWAITING_MULTI_FIELD_VALUES") {
                    const values = text.split(",").map(v => v.trim());

                    if (values.length !== session.fieldsQueue.length) {
                        await sendWhatsAppReply(
                            from,
                            `❌ You must enter exactly ${session.fieldsQueue.length} values.

Please enter them again, separated by commas.`
                        );
                        return res.sendStatus(200);
                    }

                    let errors = [];
                    let fields = session.fieldsQueue;

                    // Validate each field
                    for (let i = 0; i < fields.length; i++) {
                        const field = fields[i];
                        const value = values[i];

                        const error = validateField(field, value);

                        if (error) {
                            errors.push({ field, message: error });
                        }
                    }

                    // If any validation errors → show ALL in one message
                    if (errors.length > 0) {
                        let errorMessage = "❌ Some fields are invalid:\n\n";

                        errors.forEach(err => {
                            errorMessage += `• *${err.field}* → ${err.message}\n`;
                        });

                        errorMessage += `\nPlease re-enter ALL values again in the same order:\n${fields.join(", ")}`;

                        await sendWhatsAppReply(from, errorMessage);
                        return res.sendStatus(200);
                    }

                    // All good → save all values
                    for (let i = 0; i < fields.length; i++) {
                        session.receipt[fields[i]] = values[i];
                    }

                    session.state = "AWAITING_CONFIRMATION";
                    session.fieldsQueue = [];

                    const r = session.receipt;

                    await sendWhatsAppReply(
                        from,
                        `✔️ Updated Values:

👤 Name: ${r.name || "Not found"}
📞 Phone: ${r.phone || "Not found"}
✉️ Email: ${r.email || "Not found"}
💰 Amount: ${r.amount || "Not found"}
📅 Date: ${r.date || "Not found"}`
                    );

                    await sendWhatsAppReply(
                        from,
                        "Please confirm if the details are correct.\nPress 1 to submit or 2 to edit."
                    );

                    return res.sendStatus(200);
                }


                // EDIT FIELD SELECTION (SINGLE MODE)
                if (session.state === "AWAITING_EDIT_FIELD") {
                    const map = {
                        "1": "name",
                        "2": "phone",
                        "3": "email",
                        "4": "amount",
                        "5": "date",
                        "6": "finish",
                        "7": "multi", // NEW
                    };

                    if (!map[text]) {
                        await sendWhatsAppReply(from, "Invalid option. Choose 1–7.");
                        return res.sendStatus(200);
                    }

                    // MULTI-FIELD ACTIVATE
                    if (map[text] === "multi") {
                        session.state = "AWAITING_MULTI_FIELD_SELECTION";
                        await sendWhatsAppReply(
                            from,
                            `Enter the field numbers you want to edit (comma separated):
Example: 1,2,3`
                        );
                        return res.sendStatus(200);
                    }

                    // finish edit
                    if (map[text] === "finish") {
                        session.state = "AWAITING_CONFIRMATION";
                        const r = session.receipt;

                        await sendWhatsAppReply(
                            from,
                            `
👤 Name: ${r.name || "Not found"}
📞 Phone: ${r.phone || "Not found"}
✉️ Email: ${r.email || "Not found"}
💰 Amount: ${r.amount || "Not found"}
📅 Date: ${r.date || "Not found"}`
                        );

                        await sendWhatsAppReply(from, "Press 1 to submit or 2 to edit.");
                        return res.sendStatus(200);
                    }

                    // choose single field
                    session.editField = map[text];
                    session.state = "AWAITING_NEW_VALUE";

                    await sendWhatsAppReply(from, getPrompt(session.editField));
                    return res.sendStatus(200);
                }

                // SINGLE FIELD VALUE HANDLING
                if (session.state === "AWAITING_NEW_VALUE") {
                    let value = text;

                    const validationError = validateField(session.editField, value);
                    if (validationError) {
                        await sendWhatsAppReply(from, validationError);
                        return res.sendStatus(200);
                    }

                    session.receipt[session.editField] = value;

                    session.state = "AWAITING_EDIT_FIELD";
                    session.editField = null;

                    await sendWhatsAppReply(from, "✅ Value updated.");

                    await sendWhatsAppReply(
                        from,
                        `Which field do you want to edit next?
1️⃣ Name
2️⃣ Phone
3️⃣ Email
4️⃣ Amount
5️⃣ Date
6️⃣ Finish Editing
7️⃣ Edit multiple fields`
                    );

                    return res.sendStatus(200);
                }

                // DEFAULT
                await sendWhatsAppReply(from, "Hello, please upload your bill to get processed with STT.");
                return res.sendStatus(200);
            }

            // ------------------------------------
            // 2️⃣ USER SENDS IMAGE
            // ------------------------------------
            if (type === "image") {
                const mediaId = msgObj.image.id;

                const mediaUrl = await getMediaUrl(mediaId);
                const localPath = await downloadImage(mediaUrl, mediaId);

                let receipt = { name: "", phone: "", email: "", amount: "", date: "" };

                try {
                    receipt = await parseReceiptFields(localPath);
                } catch (e) {
                    console.error("OCR error:", e);
                }

                // Delete temp image
                try {
                    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
                } catch (e) {
                    console.error("Delete error:", e);
                }

                const name = (receipt.name || "").trim();
                const phone = (receipt.phone || "").trim();
                const email = (receipt.email || "").trim();
                const amount = (receipt.amount || "").trim();
                const date = (receipt.date || "").trim();

                const hasAny = !!(name || phone || email || amount || date);

                if (!hasAny) {
                    await sendWhatsAppReply(
                        from,
                        `❌ *Receipt Rejected*
No readable fields detected.
Please upload a clearer image.`
                    );
                    session.state = "AWAITING_IMAGE";
                    return res.sendStatus(200);
                }

                session.receipt = { name, phone, email, amount, date };
                session.state = "AWAITING_CONFIRMATION";

                await sendWhatsAppReply(
                    from,
                    `
👤 Name: ${name || "Not found"}
📞 Phone: ${phone || "Not found"}
✉️ Email: ${email || "Not found"}
💰 Amount: ${amount || "Not found"}
📅 Date: ${date || "Not found"}`
                );

                await sendWhatsAppReply(from, "Press 1 to submit or 2 to edit.");

                return res.sendStatus(200);
            }

            return res.sendStatus(200);
        } catch (err) {
            console.error("Webhook error:", err);
            return res.sendStatus(500);
        }
    },
};



// --------------------
// HELPER FUNCTIONS
// --------------------
function getPrompt(field) {
    const prompts = {
        name: "Please enter the new *name*:",
        phone: "Please enter the new *phone number* (10 digits):",
        email: "Please enter the new *email*:",
        amount: "Please enter the new *amount* (e.g., 165 or 165.50):",
        date: "Please enter the new *date* (e.g., 15/01/2022 or January 15, 2022):",
    };
    return prompts[field];
}

function validateField(field, value) {
    if (field === "phone") {
        const regex = /^\d{10}$/;
        if (!regex.test(value)) return "❌ Invalid phone number. Must be 10 digits.";
    }

    if (field === "email") {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!regex.test(value)) return "❌ Invalid email. Enter a valid email address.";
    }

    if (field === "amount") {
        const regex = /^\d+(\.\d{1,2})?$/;
        if (!regex.test(value)) return "❌ Invalid amount. Enter a number like 165 or 165.50.";
    }

    if (field === "date") {
        if (isNaN(Date.parse(value))) return "❌ Invalid date. Enter a valid date.";
    }

    return null;
}


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
