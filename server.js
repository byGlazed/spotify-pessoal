require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const db = require("./db");

const app = express();
const PORT = 3000;

app.use(express.static("public")); // serve a interface (pasta public)
app.use(express.json()); // permite receber dados em JSON (usado no botão de tocar)

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
// Por padrão faz um GET. Pra outros tipos de chamada (como tocar música),
// passe { method: "PUT", body: "..." } em "opcoes".
async function spotify(caminho, opcoes = {}) {
  const token = await tokenValido();
  if (!token) return null;

  const resposta = await fetch(`https://api.spotify.com/v1${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  // Algumas respostas (como a de "tocar") vêm vazias, então lemos como texto
  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = { error: texto };
  }

  return { ok: resposta.ok, status: resposta.status, dados };
}

// Busca o histórico recente e guarda no banco.
// Devolve { novas, total } ou null se não tiver login.
async function sincronizar() {
  const r = await spotify("/me/player/recently-played?limit=50");
  if (!r) return null;

  if (!r.ok) {
    throw new Error(`Spotify respondeu ${r.status}: ${JSON.stringify(r.dados.error)}`);
  }

  const inserir = db.prepare(`
    INSERT OR IGNORE INTO plays
      (track_id, musica, artista, tocada_em, origem, origem_uri, capa)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  // Plays antigos ainda sem capa ganham a capa quando a música aparece de novo
  const guardarCapa = db.prepare(
    "UPDATE plays SET capa = ? WHERE track_id = ? AND capa IS NULL"
  );

  let novas = 0;
  for (const item of r.dados.items) {
    const imagens = item.track.album?.images;
    const capa = imagens?.[1]?.url || imagens?.[0]?.url || null;

    const resultado = inserir.run(
      item.track.id,
      item.track.name,
      item.track.artists.map((a) => a.name).join(", "),
      item.played_at,
      item.context ? item.context.type : null,
      item.context ? item.context.uri : null,
      capa
    );
    novas += resultado.changes;
    if (capa) guardarCapa.run(capa, item.track.id);
  }

  const total = db.prepare("SELECT COUNT(*) AS total FROM plays").get().total;
  return { novas, total };
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
    const resultado = await sincronizar();
    if (!resultado) return res.redirect("/login");
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao sincronizar.");
  }
});

app.get("/ranking-playlists", async (req, res) => {
  try {
    const r = await spotify("/me/playlists?limit=50");
    if (!r) return res.redirect("/login");

    if (!r.ok) {
      console.error("Erro do Spotify:", r.dados.error);
      return res.status(r.status).send("Erro ao buscar as playlists.");
    }

    // Monta um "dicionário": endereço da playlist -> nome e capa
    const infoPorUri = {};
    for (const p of r.dados.items.filter(Boolean)) {
      infoPorUri[p.uri] = { nome: p.name, capa: p.images?.[0]?.url };
    }

    // Quais playlists mais tiveram plays no banco
    const ranking = db
      .prepare(
        `
        SELECT origem_uri, COUNT(*) AS plays
        FROM plays
        WHERE origem = 'playlist'
        GROUP BY origem_uri
        ORDER BY plays DESC
        LIMIT 6
      `
      )
      .all();

    // Qual a música mais tocada dentro de cada playlist
    const maisTocada = db.prepare(`
      SELECT musica, artista, COUNT(*) AS vezes
      FROM plays
      WHERE origem_uri = ?
      GROUP BY track_id, musica, artista
      ORDER BY vezes DESC
      LIMIT 1
    `);

    const resultado = ranking.map((linha) => ({
      nome: infoPorUri[linha.origem_uri]?.nome || "Playlist desconhecida",
      capa: infoPorUri[linha.origem_uri]?.capa || null,
      uri: linha.origem_uri,
      plays: linha.plays,
      musicaMaisTocada: maisTocada.get(linha.origem_uri),
    }));

    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).send("Algo deu errado no servidor.");
  }
});

// Dados e músicas de uma playlist (a tela de dentro da playlist usa isso)
app.get("/playlist/:id", async (req, res) => {
  const { id } = req.params;

  // O código de uma playlist só tem letras e números
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    return res.status(400).json({ erro: "Playlist inválida." });
  }

  try {
    const r = await spotify(`/playlists/${id}`);
    if (!r) return res.status(401).json({ erro: "Faça login primeiro." });

    if (!r.ok) {
      console.error("Erro do Spotify na playlist:", r.status, r.dados?.error);
      return res.status(r.status).json({ erro: "Não consegui abrir essa playlist." });
    }

    const p = r.dados;

    // Desde fev/2026 o Spotify chama de "items" (antes era "tracks") e, em cada
    // linha, de "item" (antes "track"). Só vem pra playlists suas ou colaborativas.
    const entradas = p.items?.items;

    const musicas = (entradas || [])
      .map((entrada) => entrada.item || entrada.track)
      .filter((faixa) => faixa && faixa.id && faixa.type === "track")
      .map((faixa) => {
        const imagens = faixa.album?.images || [];
        return {
          uri: faixa.uri,
          nome: faixa.name,
          artista: (faixa.artists || []).map((a) => a.name).join(", "),
          album: faixa.album?.name || "",
          capa: imagens[2]?.url || imagens[1]?.url || imagens[0]?.url || null,
          duracaoMs: faixa.duration_ms,
        };
      });

    res.json({
      uri: p.uri,
      nome: p.name,
      dono: p.owner?.display_name || null,
      capa: p.images?.[0]?.url || null,
      total: p.items?.total ?? null,
      conteudoDisponivel: Boolean(entradas),
      musicas,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Algo deu errado no servidor." });
  }
});

app.post("/tocar", async (req, res) => {
  const { uri, faixa } = req.body || {};

  // Validação: só aceita endereços no formato spotify:playlist:CODIGO
  if (typeof uri !== "string" || !/^spotify:playlist:[A-Za-z0-9]+$/.test(uri)) {
    return res.status(400).json({ erro: "Playlist inválida." });
  }

  // "faixa" é opcional (música específica dentro da playlist): spotify:track:CODIGO
  if (
    faixa !== undefined &&
    (typeof faixa !== "string" || !/^spotify:track:[A-Za-z0-9]+$/.test(faixa))
  ) {
    return res.status(400).json({ erro: "Música inválida." });
  }

  try {
    const corpo = { context_uri: uri };
    if (faixa) corpo.offset = { uri: faixa }; // começa a tocar a partir dessa música

    const r = await spotify("/me/player/play", {
      method: "PUT",
      body: JSON.stringify(corpo),
    });

    if (!r) return res.status(401).json({ erro: "Faça login primeiro (botão 👤)." });
    if (r.ok) return res.json({ ok: true });

    console.error("Erro do Spotify ao tocar:", r.status, r.dados?.error);

    if (r.status === 404) {
      return res.status(404).json({
        erro: "Nenhum dispositivo ativo. Abra o Spotify no PC ou no celular, toque qualquer música por um segundo e tente de novo.",
      });
    }
    if (r.status === 403) {
      return res.status(403).json({
        erro: "O Spotify recusou. Confira se a conta é Premium e se o login foi feito com as permissões novas.",
      });
    }
    res.status(r.status).json({ erro: "Não consegui tocar essa playlist." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Algo deu errado no servidor." });
  }
});

// Mostra o que está tocando agora (a página consulta isso de poucos em poucos segundos)
app.get("/player", async (req, res) => {
  try {
    const r = await spotify("/me/player");
    if (!r) return res.status(401).json({ erro: "Faça login primeiro." });

    if (!r.ok) {
      console.error("Erro do Spotify no player:", r.status, r.dados?.error);
      return res.status(r.status).json({ erro: "Não consegui ler o player." });
    }

    // Resposta vazia (204) = nenhum aparelho ativo no momento
    const d = r.dados;
    if (r.status === 204 || !d || !d.item) return res.json({ ativo: false });

    const imagens = d.item.album?.images || [];
    res.json({
      ativo: true,
      tocando: d.is_playing,
      musica: d.item.name,
      faixaUri: d.item.uri,
      artista: (d.item.artists || []).map((a) => a.name).join(", "),
      capa: imagens[1]?.url || imagens[0]?.url || null,
      progressoMs: d.progress_ms,
      duracaoMs: d.item.duration_ms,
      contextoUri: d.context?.uri || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Algo deu errado no servidor." });
  }
});

// Botões do player: pausar, continuar, próxima e anterior.
// Só aceita as 4 ações da lista abaixo, qualquer outra coisa é recusada.
const ACOES = {
  pausar: { caminho: "/me/player/pause", method: "PUT" },
  continuar: { caminho: "/me/player/play", method: "PUT" },
  proxima: { caminho: "/me/player/next", method: "POST" },
  anterior: { caminho: "/me/player/previous", method: "POST" },
};

app.post("/controle", async (req, res) => {
  const acao = req.body?.acao;

  if (typeof acao !== "string" || !Object.hasOwn(ACOES, acao)) {
    return res.status(400).json({ erro: "Ação inválida." });
  }

  try {
    const { caminho, method } = ACOES[acao];
    const r = await spotify(caminho, { method });

    if (!r) return res.status(401).json({ erro: "Faça login primeiro (botão 👤)." });
    if (r.ok) return res.json({ ok: true });

    console.error("Erro do Spotify no controle:", r.status, r.dados?.error);
    if (r.status === 404) {
      return res.status(404).json({
        erro: "Nenhum dispositivo ativo. Abra o Spotify e toque qualquer música por um segundo.",
      });
    }
    res.status(r.status).json({ erro: "O Spotify não conseguiu fazer isso agora." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Algo deu errado no servidor." });
  }
});

app.get("/top", async (req, res) => {
  try {
    const top = db
      .prepare(
        `
        SELECT track_id, musica, artista, COUNT(*) AS plays, MAX(capa) AS capa
        FROM plays
        GROUP BY track_id, musica, artista
        ORDER BY plays DESC
        LIMIT 10
      `
      )
      .all();

    // Músicas do top sem capa guardada: busca uma por uma e guarda no banco.
    // (O Spotify não deixa mais buscar várias músicas de uma vez.)
    const salvarCapa = db.prepare("UPDATE plays SET capa = ? WHERE track_id = ?");
    for (const m of top) {
      if (m.capa) continue;

      const r = await spotify(`/tracks/${m.track_id}`);
      if (!r) break; // sem login: segue sem capas
      if (!r.ok) continue;

      const imagens = r.dados.album?.images;
      m.capa = imagens?.[1]?.url || imagens?.[0]?.url || null;
      if (m.capa) salvarCapa.run(m.capa, m.track_id);
    }

    res.json(top);
  } catch (err) {
    console.error(err);
    res.status(500).send("Algo deu errado no servidor.");
  }
});

const INTERVALO_MINUTOS = 15;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://127.0.0.1:${PORT}`);

  const rodarSincronizacao = async () => {
    try {
      const resultado = await sincronizar();
      if (!resultado) {
        console.log("Sincronização automática: faça login em /login.");
        return;
      }
      console.log(
        `Sincronização automática: ${resultado.novas} novas (total ${resultado.total}).`
      );
    } catch (err) {
      console.error("Erro na sincronização automática:", err.message);
    }
  };

  rodarSincronizacao(); // roda uma vez ao ligar
  setInterval(rodarSincronizacao, INTERVALO_MINUTOS * 60 * 1000);
});