// server.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import webhookRouter from "./controllers/webhook.controller.js";

dotenv.config();
const app = express();

// Twilio sends form-encoded (application/x-www-form-urlencoded)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.post("/webhook/twilio", webhookRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
