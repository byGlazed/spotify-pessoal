const Database = require("better-sqlite3");

const db = new Database("historico.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id TEXT NOT NULL,
    musica TEXT NOT NULL,
    artista TEXT NOT NULL,
    tocada_em TEXT NOT NULL,
    origem TEXT,
    origem_uri TEXT,
    UNIQUE (track_id, tocada_em)
  )
`);

// Atualização do banco: adiciona a coluna da capa se ainda não existir.
// (Quem já tem o banco criado ganha a coluna nova sem perder nenhum play.)
const colunas = db.prepare("PRAGMA table_info(plays)").all();
if (!colunas.some((coluna) => coluna.name === "capa")) {
  db.exec("ALTER TABLE plays ADD COLUMN capa TEXT");
}

module.exports = db;