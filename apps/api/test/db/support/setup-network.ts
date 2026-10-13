// Setup dos testes de base de dados: nenhum pedido sai da máquina (HIBP simulado,
// hosts externos bloqueados) e o HIBP simulado começa limpo em cada teste.
import { beforeEach } from "vitest";
import { installFakeNetwork, resetFakeHibp } from "../../support/fake-network.ts";

installFakeNetwork();
beforeEach(() => {
  resetFakeHibp();
});
