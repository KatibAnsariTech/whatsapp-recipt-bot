// utils/ocr.js
import axios from "axios";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

// STEP 1 — Get actual media URL
export async function getMediaUrl(mediaId) {
  const url = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${mediaId}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });
  return res.data.url;
}

// STEP 2 — Download image to /tmp folder
export async function downloadImage(url, mediaId) {
  const folder = "./tmp";
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);

  const filePath = path.join(folder, `${mediaId}.jpg`);

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });

  fs.writeFileSync(filePath, response.data);
  console.log("📥 Downloaded:", filePath);

  return filePath;
}








// used twillio

// // utils/ocr.js
// import axios from "axios";
// import fs from "fs";
// import dotenv from 'dotenv';
// dotenv.config();

// export async function downloadImageFromUrl(url, destPath) {

//   console.log("📥 Trying to download from Twilio:");
//   console.log("URL:", url);
//   console.log("Saving to:", destPath);

//   try {
//     const authString = Buffer
//       .from(process.env.TWILIO_ACCOUNT_SID + ":" + process.env.TWILIO_AUTH_TOKEN)
//       .toString("base64");

//     const resp = await axios({
//       url,
//       method: "GET",
//       responseType: "arraybuffer",
//       headers: {
//         Authorization: "Basic " + authString
//       }
//     });

//     console.log("Status:", resp.status);
//     console.log("Data size:", resp.data.length, "bytes");

//     fs.writeFileSync(destPath, resp.data);
//     console.log("✅ File saved successfully!");

//     return destPath;

//   } catch (err) {
//     console.log("❌ DOWNLOAD FAILED!!");
//     console.log("ERROR:", err.message);
//     console.log("STATUS:", err.response?.status);
//     console.log("DETAILS:", err.response?.data?.toString());
//     return null;
//   }
// }
