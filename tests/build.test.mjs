// O build cola o renderizador e o selo de mensagem agendada no painel
// (dist/admin/index.html), cada um no lugar do seu marcador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

test("build.js põe o renderizador e o selo no painel, sem export", () => {
  execFileSync(process.execPath, ["build.js"], { cwd: RAIZ, stdio: "pipe" });
  const html = readFileSync(path.join(RAIZ, "dist", "admin", "index.html"), "utf8");
  assert.match(html, /function renderizar\(modelo, dados, agora, sorteio\)/);
  assert.match(html, /function variaveisDesconhecidas\(/);
  assert.match(html, /var VARIAVEIS = \[/);
  assert.ok(!html.includes("export "), 'dist/admin/index.html não pode ter "export "');
  assert.ok(!html.includes("@@MENSAGEM@@"), "o marcador tem que sumir no build");
  // selo "mensagem agendada" (painel/selo.mjs), colado no mesmo script
  assert.match(html, /function selosMensagem\(envios, disparos, agora\)/);
  assert.match(html, /function seloDoNumero\(mapa, numero\)/);
  assert.ok(!html.includes("@@SELO@@"), "o marcador do selo tem que sumir no build");

  // o script do painel continua válido (sintaxe) depois da colagem
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const painel = scripts.find((s) => s.includes("function renderizar("));
  assert.ok(painel, "script do painel com o renderizador");
  assert.ok(painel.includes("function selosMensagem("), "o selo entra no mesmo script do painel");
  assert.doesNotThrow(() => new vm.Script(painel, { filename: "admin.js" }));
});
