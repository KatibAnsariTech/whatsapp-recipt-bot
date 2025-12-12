// utils/notifier.js
import axios from "axios";
import dotenv from 'dotenv';
dotenv.config();

export async function sendWhatsAppReply(to, message) {
  try {
    const url = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("Error sending WhatsApp message:", err?.response?.data || err);
  }
}












// // utils/notifier.js
// import Twilio from "twilio";
// import dotenv from "dotenv";
// dotenv.config();

// const client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
// const FROM = process.env.TWILIO_WHATSAPP_FROM; // 'whatsapp:+14155238886'

// /**
//  * sendWhatsAppReply(to, message)
//  * to should be 'whatsapp:+91xxxxxxxxxx'
//  */
// export async function sendWhatsAppReply(to, message) {
//   try {
//     await client.messages.create({
//       from: FROM,
//       to,
//       body: message
//     });
//   } catch (err) {
//     console.error("Twilio send error:", err?.message || err);
//   }
// }
