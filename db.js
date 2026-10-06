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

module.exports = db;