// Service worker mínimo — só o necessário pra habilitar a instalação do PWA.
// Sem cache offline de propósito: o painel depende sempre de dados atualizados
// do servidor (agenda, pacientes), então não faz sentido servir versão antiga em cache.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // no-op: deixa o navegador buscar tudo normalmente da rede
});
