import OpenAI from "openai";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function parseReceiptFields(imagePath) {
    console.log("Reading file:", imagePath);

    if (!fs.existsSync(imagePath)) {
        console.log("❌ File not found!");
        return { name: "", phone: "", email: "", amount: "", date: "" };
    }

    const imgBuffer = fs.readFileSync(imagePath);
    const base64Image = imgBuffer.toString("base64");

    const prompt = `
Extract ONLY these fields:
{
  "name": "",
  "phone": "",
  "email": "",
  "amount": "",
  "date": ""
}
Return valid JSON only.
`;

    console.log("Sending image to OpenAI Vision…");

    const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: prompt
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/jpeg;base64,${base64Image}`
                        }
                    }
                ]
            }
        ]
    });

    let raw = response.choices[0].message.content.trim();
    console.log("RAW AI RESPONSE:", raw);

    raw = raw.replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    try {
        return JSON.parse(raw);
    } catch (err) {
        console.log("❌ JSON parse error, raw content was:");
        console.log(raw);
        return { name: "", phone: "", email: "", amount: "", date: "" };
    }

}
