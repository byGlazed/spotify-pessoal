// ---------- Funções de apoio ----------

// Pede dados ao nosso servidor e devolve o JSON
async function buscarJSON(caminho) {
  const resposta = await fetch(caminho);
  if (!resposta.ok) throw new Error(`Erro ${resposta.status} em ${caminho}`);
  return resposta.json();
}

// Cria um elemento HTML, com classe e texto opcionais.
// Usa textContent (e não innerHTML) de propósito: assim, o texto de uma
// playlist ou música nunca é tratado como código HTML (evita XSS).
function criar(tag, classe, texto) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

// Cria a capa: uma <img> se tiver endereço, ou um quadrado cinza se não tiver
function criarCapa(url) {
  if (!url) return criar("div", "capa");
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  img.className = "capa";
  return img;
}

// Transforma milissegundos em "m:ss"
function formatarTempo(ms) {
  const totalSegundos = Math.floor((ms || 0) / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = String(totalSegundos % 60).padStart(2, "0");
  return `${minutos}:${segundos}`;
}

function mostrarMensagem(texto) {
  document.getElementById("mensagem").textContent = texto;
}

// ---------- Estado do player ----------

let estadoAtual = null; // última resposta de /player
let momentoEstado = 0; // hora em que recebemos essa resposta
const playlistsNaTela = []; // { uri, botao, disco } de cada playlist do ranking

// ---------- Top 10 (lateral) ----------

async function carregarTop() {
  const lista = document.getElementById("lista-top");

  try {
    const musicas = await buscarJSON("/top");
    lista.replaceChildren();

    if (musicas.length === 0) {
      lista.append(criar("li", "aviso", "Ainda sem plays registrados."));
      return;
    }

    for (const m of musicas) {
      const item = criar("li", "item-musica");

      const info = criar("div", "info");
      info.append(criar("strong", null, m.musica), criar("span", null, m.artista));

      item.append(criarCapa(m.capa), info, criar("span", "contagem", m.plays));
      lista.append(item);
    }
  } catch (erro) {
    console.error(erro);
    lista.replaceChildren(criar("li", "aviso", "Não consegui carregar o top 10."));
  }
}

// ---------- Ranking de playlists (centro) ----------

async function carregarRanking() {
  const lista = document.getElementById("lista-playlists");

  try {
    const playlists = await buscarJSON("/ranking-playlists");
    lista.replaceChildren();

    if (playlists.length === 0) {
      lista.append(
        criar("li", "aviso", "Ainda sem plays vindos de playlists. Ouça algumas!")
      );
      return;
    }

    for (const p of playlists) {
      const item = criar("li", "item-playlist");

      const engrenagem = criar("button", "botao-redondo", "⚙️");
      engrenagem.title = "Organizar playlist";

      const tocar = criar("button", "botao-redondo", "▶");
      tocar.title = "Tocar / Pausar";
      tocar.addEventListener("click", () => cliqueNaPlaylist(p.uri));

      // O "disco" é a capa dentro de uma moldura que vira vinil e gira
      const disco = criar("div", "disco grande");
      disco.append(criarCapa(p.capa));

      const m = p.musicaMaisTocada;
      const detalhe = m
        ? `Música mais tocada: ${m.musica} (${m.vezes} vezes)`
        : "Sem dados ainda";

      const info = criar("div", "info");
      info.append(criar("strong", null, p.nome), criar("span", null, detalhe));

      // Clicar na capa ou no nome abre a tela de dentro da playlist
      const abrir = () => abrirPlaylist(p.uri);
      disco.classList.add("clicavel");
      info.classList.add("clicavel");
      disco.addEventListener("click", abrir);
      info.addEventListener("click", abrir);

      item.append(engrenagem, tocar, disco, info);
      lista.append(item);

      playlistsNaTela.push({ uri: p.uri, botao: tocar, disco });
    }

    desenharPlayer(); // já marca qual playlist está tocando
  } catch (erro) {
    // Se você não estiver logado, o servidor redireciona pro Spotify e o
    // navegador bloqueia: cai aqui.
    console.error(erro);
    lista.replaceChildren(
      criar("li", "aviso", "Não consegui carregar. Clique em 👤 pra fazer login e recarregue.")
    );
  }
}

// ---------- Controles ----------

// Clique no ▶/⏸ de uma playlist
function cliqueNaPlaylist(uri) {
  const ativo = estadoAtual && estadoAtual.ativo;

  if (ativo && estadoAtual.contextoUri === uri) {
    // Essa playlist já é a atual: alterna entre pausar e continuar
    controlar(estadoAtual.tocando ? "pausar" : "continuar");
  } else {
    tocarPlaylist(uri);
  }
}

// "faixa" é opcional: se vier, começa a tocar a partir dessa música
async function tocarPlaylist(uri, faixa) {
  mostrarMensagem("Pedindo ao Spotify pra tocar...");

  try {
    const resposta = await fetch("/tocar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri, faixa }),
    });
    const dados = await resposta.json();
    mostrarMensagem(resposta.ok ? "" : dados.erro);
  } catch (erro) {
    console.error(erro);
    mostrarMensagem("Não consegui falar com o servidor.");
  }

  setTimeout(atualizarPlayer, 1000);
}

// acao: "pausar", "continuar", "proxima" ou "anterior"
async function controlar(acao) {
  try {
    const resposta = await fetch("/controle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao }),
    });

    if (resposta.ok) {
      mostrarMensagem("");
    } else {
      const dados = await resposta.json();
      mostrarMensagem(dados.erro);
    }
  } catch (erro) {
    console.error(erro);
    mostrarMensagem("Não consegui falar com o servidor.");
  }

  setTimeout(atualizarPlayer, 600);
}

document.getElementById("btn-play").addEventListener("click", () => {
  if (estadoAtual && estadoAtual.ativo) {
    controlar(estadoAtual.tocando ? "pausar" : "continuar");
  } else {
    mostrarMensagem("Nada tocando. Abra o Spotify e toque algo, ou clique em ▶ numa playlist.");
  }
});
document.getElementById("btn-proxima").addEventListener("click", () => controlar("proxima"));
document.getElementById("btn-anterior").addEventListener("click", () => controlar("anterior"));

// ---------- Player (rodapé) ----------

// Pergunta ao servidor o que está tocando
async function atualizarPlayer() {
  if (document.hidden) return; // aba escondida: não gasta chamadas à toa

  try {
    const resposta = await fetch("/player");
    estadoAtual = resposta.ok ? await resposta.json() : null;
    momentoEstado = Date.now();
  } catch (erro) {
    console.error(erro);
    estadoAtual = null;
  }

  desenharPlayer();
}

// Atualiza a tela com o estado atual
function desenharPlayer() {
  const ativo = Boolean(estadoAtual && estadoAtual.ativo);
  const tocando = ativo && estadoAtual.tocando;

  document.getElementById("player-musica").textContent = ativo
    ? estadoAtual.musica
    : "Nada tocando";
  document.getElementById("player-artista").textContent = ativo
    ? estadoAtual.artista
    : "Abra o Spotify em um aparelho e toque algo";
  document.getElementById("btn-play").textContent = tocando ? "⏸" : "▶";

  // Capa do player (vira vinil e gira enquanto toca)
  const capa = document.getElementById("player-capa");
  if (ativo && estadoAtual.capa) {
    capa.src = estadoAtual.capa;
    capa.style.visibility = "visible";
  } else {
    capa.style.visibility = "hidden";
  }
  const discoPlayer = document.getElementById("player-disco");
  discoPlayer.classList.toggle("ativo", ativo);
  discoPlayer.classList.toggle("girando", tocando);

  // Playlists do ranking: a que está tocando vira vinil e o botão vira ⏸
  for (const p of playlistsNaTela) {
    const eEssa = ativo && estadoAtual.contextoUri === p.uri;
    p.botao.textContent = eEssa && tocando ? "⏸" : "▶";
    p.disco.classList.toggle("ativo", eEssa);
    p.disco.classList.toggle("girando", eEssa && tocando);
  }

  desenharTelaPlaylist();
  desenharProgresso();
}

// Atualiza só a barra de progresso (roda várias vezes por segundo)
function desenharProgresso() {
  const ativo = Boolean(estadoAtual && estadoAtual.ativo);
  const atual = document.getElementById("tempo-atual");
  const total = document.getElementById("tempo-total");
  const barra = document.getElementById("barra-preenchida");

  if (!ativo) {
    atual.textContent = "0:00";
    total.textContent = "0:00";
    barra.style.width = "0%";
    return;
  }

  let ms = estadoAtual.progressoMs;
  if (estadoAtual.tocando) ms += Date.now() - momentoEstado; // anda sozinho entre as consultas
  ms = Math.min(ms, estadoAtual.duracaoMs);

  atual.textContent = formatarTempo(ms);
  total.textContent = formatarTempo(estadoAtual.duracaoMs);
  barra.style.width = `${(ms / estadoAtual.duracaoMs) * 100}%`;
}

// ---------- Tela de dentro da playlist ----------

let playlistAberta = null; // dados da playlist aberta (ou null se estiver no ranking)

async function abrirPlaylist(uri) {
  const id = uri.split(":")[2]; // "spotify:playlist:CODIGO" -> "CODIGO"
  mostrarMensagem("Carregando playlist...");

  try {
    playlistAberta = await buscarJSON(`/playlist/${id}`);
    mostrarMensagem("");
    montarTelaPlaylist();
  } catch (erro) {
    console.error(erro);
    mostrarMensagem("Não consegui abrir essa playlist.");
  }
}

function voltarParaRanking() {
  playlistAberta = null;
  document.getElementById("tela-playlist").hidden = true;
  document.getElementById("tela-ranking").hidden = false;
}

// Monta o cabeçalho e a lista de músicas
function montarTelaPlaylist() {
  const p = playlistAberta;
  document.getElementById("tela-ranking").hidden = true;
  document.getElementById("tela-playlist").hidden = false;

  document.getElementById("playlist-nome").textContent = p.nome;

  const capa = document.getElementById("playlist-capa");
  if (p.capa) {
    capa.src = p.capa;
    capa.style.visibility = "visible";
  } else {
    capa.style.visibility = "hidden";
  }

  const detalhes = [p.dono, p.total !== null ? `${p.total} músicas` : null];
  document.getElementById("playlist-detalhe").textContent = detalhes
    .filter(Boolean)
    .join(" • ");

  const lista = document.getElementById("playlist-faixas");
  lista.replaceChildren();

  if (!p.conteudoDisponivel) {
    lista.append(
      criar(
        "p",
        "aviso",
        "O Spotify só deixa ver as músicas de playlists que são suas ou colaborativas."
      )
    );
  } else {
    const cabecalho = criar("div", "faixa cabecalho");
    cabecalho.append(
      criar("span", null, "#"),
      criar("span", null, "Título"),
      criar("span", null, "Álbum"),
      criar("span", "direita", "Duração")
    );
    lista.append(cabecalho);

    p.musicas.forEach((m, i) => {
      const linha = criar("div", "faixa");
      linha.dataset.uri = m.uri;

      const info = criar("div", "info");
      info.append(criar("strong", null, m.nome), criar("span", null, m.artista));

      const titulo = criar("div", "faixa-titulo");
      titulo.append(criarCapa(m.capa), info);

      linha.append(
        criar("span", "numero", i + 1),
        titulo,
        criar("span", "album", m.album),
        criar("span", "direita", formatarTempo(m.duracaoMs))
      );

      // Clicar na linha toca a playlist a partir dessa música
      linha.addEventListener("click", () => tocarPlaylist(p.uri, m.uri));
      lista.append(linha);
    });

    if (p.total !== null && p.total > p.musicas.length) {
      lista.append(
        criar("p", "aviso", `Mostrando as primeiras ${p.musicas.length} músicas.`)
      );
    }
  }

  desenharTelaPlaylist();
}

// Atualiza o que muda enquanto a música toca: botão, vinil e linha atual
function desenharTelaPlaylist() {
  if (!playlistAberta) return;

  const ativo = Boolean(estadoAtual && estadoAtual.ativo);
  const eEssa = ativo && estadoAtual.contextoUri === playlistAberta.uri;
  const tocando = eEssa && estadoAtual.tocando;

  document.getElementById("playlist-play").textContent = tocando ? "⏸" : "▶";

  const disco = document.getElementById("playlist-disco");
  disco.classList.toggle("ativo", eEssa);
  disco.classList.toggle("girando", tocando);

  for (const linha of document.querySelectorAll("#playlist-faixas .faixa[data-uri]")) {
    linha.classList.toggle("atual", eEssa && linha.dataset.uri === estadoAtual.faixaUri);
  }
}

document.getElementById("btn-voltar").addEventListener("click", voltarParaRanking);
document.getElementById("playlist-play").addEventListener("click", () => {
  if (playlistAberta) cliqueNaPlaylist(playlistAberta.uri);
});

// ---------- Começa tudo quando a página abre ----------

carregarTop();
carregarRanking();
atualizarPlayer();
setInterval(atualizarPlayer, 3000); // pergunta ao Spotify a cada 3 segundos
setInterval(desenharProgresso, 500); // anda a barrinha suavemente