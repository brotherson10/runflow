// Carregado com `node --import` pela API dos E2E (playwright.config.ts): HIBP
// simulado e rede externa bloqueada. Nunca é usado fora dos testes.
import { fakeHibp, installFakeNetwork } from "../apps/api/test/support/fake-network.ts";
import { E2E_COMPROMISED_PASSWORD, E2E_HIBP_FAILING_PASSWORD } from "./constants.ts";

installFakeNetwork();
fakeHibp.compromised.set(E2E_COMPROMISED_PASSWORD, 4242);
fakeHibp.failing.add(E2E_HIBP_FAILING_PASSWORD);
