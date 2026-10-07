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

      item.append(criar("div", "capa"), info, criar("span", "contagem", m.plays));
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
      tocar.title = "Tocar";

      let capa;
      if (p.capa) {
        capa = document.createElement("img");
        capa.src = p.capa;
        capa.alt = "";
        capa.className = "capa grande";
      } else {
        capa = criar("div", "capa grande");
      }

      const m = p.musicaMaisTocada;
      const detalhe = m
        ? `Música mais tocada: ${m.musica} (${m.vezes} vezes)`
        : "Sem dados ainda";

      const info = criar("div", "info");
      info.append(criar("strong", null, p.nome), criar("span", null, detalhe));

      item.append(engrenagem, tocar, capa, info);
      lista.append(item);
    }
  } catch (erro) {
    // Se você não estiver logado, o servidor redireciona pro Spotify e o
    // navegador bloqueia: cai aqui.
    console.error(erro);
    lista.replaceChildren(
      criar("li", "aviso", "Não consegui carregar. Clique em 👤 pra fazer login e recarregue.")
    );
  }
}

// ---------- Começa tudo quando a página abre ----------

carregarTop();
carregarRanking();