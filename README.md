

Readme · MD
# Spotify Pessoal 🎧
 
Projeto pessoal em **Node.js** que usa a API do Spotify para organizar minhas playlists, contar quantas vezes escuto cada música e tocar o que combina com o meu humor.
 
> 🚧 Projeto em desenvolvimento, feito aos poucos e como forma de aprender back-end e APIs.
 
## Ideias do projeto
 
- [ ] Login com a conta do Spotify (OAuth)
- [ ] Listar e organizar minhas playlists
- [ ] Contar quantas vezes escutei cada música (salvando o histórico em um banco de dados)
- [ ] Perguntar meu humor (mood) e tocar uma das minhas playlists ou músicas aleatórias com esse clima
- [ ] Sugerir músicas parecidas com as que já tenho nas playlists
## Status atual
 
- [x] Repositório criado
- [x] App criado no painel de desenvolvedor do Spotify
- [x] Servidor inicial com Express funcionando
- [x] Variáveis de ambiente configuradas com `.env`
## Tecnologias
 
- [Node.js](https://nodejs.org/) (JavaScript)
- [Express](https://expressjs.com/)
- [dotenv](https://www.npmjs.com/package/dotenv)
- [Spotify Web API](https://developer.spotify.com/documentation/web-api)
## Como rodar
 
1. Clone o repositório e entre na pasta:
```bash
   git clone https://github.com/seu-usuario/spotify-pessoal.git
   cd spotify-pessoal
```
 
2. Instale as dependências:
```bash
   npm install
```
 
3. Crie um arquivo `.env` na raiz do projeto com as suas chaves do Spotify:
```
   SPOTIFY_CLIENT_ID=seu_client_id
   SPOTIFY_CLIENT_SECRET=seu_client_secret
   SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
```
 
   > O arquivo `.env` está no `.gitignore` e **nunca** deve ser enviado ao GitHub.
 
4. Inicie o servidor:
```bash
   node server.js
```
 
5. Acesse `http://127.0.0.1:3000` no navegador.
## Observações sobre a API do Spotify
 
Desde novembro de 2024, apps novos não têm acesso aos endpoints de recomendações, audio features e artistas relacionados. Por isso, as sugestões de músicas parecidas e a busca por humor devem usar alternativas, como a API do Last.fm e as playlists que eu mesmo associar a cada humor.
 
## Autor
 
Gabriel.