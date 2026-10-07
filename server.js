require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const db = require("./db");

const app = express();
const PORT = 3000;

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } =
  process.env;

// Permissões que o app vai pedir
const SCOPES = [
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-read-recently-played",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
].join(" ");

const ARQUIVO_TOKENS = "tokens.json";
const CREDENCIAIS = Buffer.from(
  `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
).toString("base64");

let estadoLogin = null; // código aleatório de segurança do login
let tokens = carregarTokens(); // tenta ler os tokens salvos da última vez

// ---------- Funções de token ----------

function carregarTokens() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_TOKENS, "utf8"));
  } catch {
    return null; // arquivo não existe ainda: precisa fazer login
  }
}

function salvarTokens(dados) {
  tokens = {
    access_token: dados.access_token,
    // na renovação o Spotify nem sempre manda um refresh_token novo,
    // então a gente mantém o antigo
    refresh_token: dados.refresh_token || tokens?.refresh_token,
    // guarda a hora em que o token expira (com 60s de folga)
    expira_em: Date.now() + (dados.expires_in - 60) * 1000,
  };
  fs.writeFileSync(ARQUIVO_TOKENS, JSON.stringify(tokens));
}

async function pedirTokens(corpo) {
  const resposta = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${CREDENCIAIS}`,
    },
    body: new URLSearchParams(corpo),
  });
  const dados = await resposta.json();
  return { ok: resposta.ok, dados };
}

// Devolve um token que funciona, renovando se já tiver expirado
async function tokenValido() {
  if (!tokens) return null;
  if (Date.now() < tokens.expira_em) return tokens.access_token;

  const { ok, dados } = await pedirTokens({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });

  if (!ok) {
    console.error("Erro ao renovar o token:", dados.error, dados.error_description);
    tokens = null;
    return null; // precisa fazer login de novo
  }

  salvarTokens(dados);
  return tokens.access_token;
}

// Faz uma chamada à API do Spotify já com o token certo.
// Devolve null se não tiver login.
async function spotify(caminho) {
  const token = await tokenValido();
  if (!token) return null;

  const resposta = await fetch(`https://api.spotify.com/v1${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const dados = await resposta.json();
  return { ok: resposta.ok, status: resposta.status, dados };
}

// ---------- Rotas ----------

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
    const { ok, dados } = await pedirTokens({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    });

    if (!ok) {
      console.error("Erro do Spotify:", dados.error, dados.error_description);
      return res
        .status(400)
        .send(`Erro ao pegar o token: ${dados.error_description || dados.error}`);
    }

    salvarTokens(dados);
    console.log("Login feito! Token recebido.");
    res.send("Login com Spotify feito! Pode fechar esta aba.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Algo deu errado no servidor.");
  }
});

app.get("/playlists", async (req, res) => {
  try {
    const r = await spotify("/me/playlists?limit=50");
    if (!r) return res.redirect("/login");

    if (!r.ok) {
      console.error("Erro do Spotify:", r.dados.error);
      return res.status(r.status).send("Erro ao buscar as playlists.");
    }

    const playlists = r.dados.items.filter(Boolean).map((p) => ({
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

app.get("/recentes", async (req, res) => {
  try {
    const r = await spotify("/me/player/recently-played?limit=50");
    if (!r) return res.redirect("/login");

    if (!r.ok) {
      console.error("Erro do Spotify:", r.dados.error);
      return res.status(r.status).send("Erro ao buscar o histórico.");
    }

    const recentes = r.dados.items.map((item) => ({
      musica: item.track.name,
      artista: item.track.artists.map((a) => a.name).join(", "),
      tocadaEm: item.played_at,
      origem: item.context ? item.context.type : null,
      origemUri: item.context ? item.context.uri : null,
    }));

    res.json(recentes);
  } catch (err) {
    console.error(err);
    res.status(500).send("Algo deu errado no servidor.");
  }
});

app.get("/sincronizar", async (req, res) => {
  try {
    const r = await spotify("/me/player/recently-played?limit=50");
    if (!r) return res.redirect("/login");

    if (!r.ok) {
      console.error("Erro do Spotify:", r.dados.error);
      return res.status(r.status).send("Erro ao buscar o histórico.");
    }

    const inserir = db.prepare(`
      INSERT OR IGNORE INTO plays
        (track_id, musica, artista, tocada_em, origem, origem_uri)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let novas = 0;
    for (const item of r.dados.items) {
      const resultado = inserir.run(
        item.track.id,
        item.track.name,
        item.track.artists.map((a) => a.name).join(", "),
        item.played_at,
        item.context ? item.context.type : null,
        item.context ? item.context.uri : null
      );
      novas += resultado.changes;
    }

    const total = db.prepare("SELECT COUNT(*) AS total FROM plays").get().total;
    res.json({ novas, total });
  } catch (err) {
    console.error(err);
    res.status(500).send("Algo deu errado no servidor.");
  }
});

app.get("/top", (req, res) => {
  const top = db
    .prepare(
      `
      SELECT musica, artista, COUNT(*) AS plays
      FROM plays
      GROUP BY track_id, musica, artista
      ORDER BY plays DESC
      LIMIT 10
    `
    )
    .all();

  res.json(top);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://127.0.0.1:${PORT}`);
});