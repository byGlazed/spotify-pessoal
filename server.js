require("dotenv").config();
const express = require("express");

const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
  res.send("Servidor no ar!");
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://127.0.0.1:${PORT}`);
  console.log("Client ID carregado:", Boolean(process.env.SPOTIFY_CLIENT_ID));
});