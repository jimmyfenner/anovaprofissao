// `node --test tests/` entrega esta pasta ao Node como se fosse um arquivo só
// (ele não procura testes dentro de um diretório passado assim). Este índice
// carrega todos os *.test.mjs daqui, então basta criar o arquivo novo.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

for (const f of fs.readdirSync(__dirname).filter((f) => /\.test\.mjs$/.test(f)).sort()) {
  import(pathToFileURL(path.join(__dirname, f)).href);
}
