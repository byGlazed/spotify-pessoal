require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } =
  process.env;

// Permissões que o app vai pedir (a gente usa todas nos próximos passos)
const SCOPES = [
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-recently-played",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

let estadoLogin = null; // código aleatório de segurança
let tokens = null; // por enquanto os tokens ficam só na memória

app.get("/", (req, res) => {
  res.send('Servidor no ar! <a href="/login">Entrar com Spotify</a>');
});

app.get("/login", (req, res) => {
  estadoLogin = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state: estadoLogin,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.send(`Erro do Spotify: ${error}`);
  if (state !== estadoLogin) return res.status(400).send("State inválido.");

  try {
    const credenciais = Buffer.from(
      `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
    ).toString("base64");

    const resposta = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credenciais}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro do Spotify:", dados.error, dados.error_description);
      return res
        .status(400)
        .send(`Erro ao pegar o token: ${dados.error_description || dados.error}`);
    }

    tokens = dados;
    console.log("Login feito! Token recebido.");
    res.send("Login com Spotify feito! Pode fechar esta aba.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Algo deu errado no servidor.");
  }
});

app.get("/playlists", async (req, res) => {
  if (!tokens) return res.redirect("/login");

  try {
    const resposta = await fetch(
      "https://api.spotify.com/v1/me/playlists?limit=50",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro do Spotify:", dados.error);
      return res.status(resposta.status).send("Erro ao buscar as playlists.");
    }

    const playlists = dados.items.filter(Boolean).map((p) => ({
      nome: p.name,
      id: p.id,
      dono: p.owner?.display_name,
      capa: p.images?.[0]?.url,
    }));

    res.json(playlists);
  } catch (err) {
    console.error(err);
    res.status(500).send("Algo deu errado no servidor.");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://127.0.0.1:${PORT}`);
});
