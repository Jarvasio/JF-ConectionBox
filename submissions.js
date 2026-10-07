/**
 * /api/submissions  —  proxy seguro para a API da Jotform (região EU)
 *
 * GET /api/submissions?formID=<id numérico>&questionID=<id numérico>[&limit=100]
 *
 * - A API key vive APENAS na variável de ambiente JOTFORM_API_KEY (nunca vai para o frontend).
 * - Devolve só o que o widget precisa (id, data e resposta do campo pedido), já ordenado da
 *   submissão mais recente para a mais antiga. Não expõe as restantes respostas do formulário.
 *
 * Variáveis de ambiente:
 *   JOTFORM_API_KEY    (obrigatória)  chave da API da Jotform
 *   ALLOWED_FORM_IDS   (opcional)     lista separada por vírgulas de formIDs permitidos, ex.: "2412345,2467890"
 *                                     Recomendado: sem ela, qualquer formID acessível à tua key pode ser consultado.
 *   ALLOWED_ORIGIN     (opcional)     origem CORS permitida (por defeito "*")
 *
 * Resposta de sucesso:
 *   { ok: true, formID, questionID, count,
 *     submissions: [ { id, created_at, answer, pretty } ]  // mais recente primeiro
 *   }
 * Resposta de erro:
 *   { ok: false, error: "mensagem legível" }   (com o código HTTP adequado)
 */

const JOTFORM_API_BASE = "https://eu-api.jotform.com"; // para conta não-EU: https://api.jotform.com
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;      // máximo aceite pela Jotform por pedido
const MAX_PAGES = 10;        // tecto de segurança na paginação de recurso (ver abaixo)
const TIMEOUT_MS = 10000;

/* ----------------------------- helpers ----------------------------- */

function setHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store"); // queremos sempre a última resposta
}

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

// Query params podem vir repetidos (array) — usa sempre o primeiro valor
const first = (v) => String(Array.isArray(v) ? v[0] : v ?? "").trim();

// Ids da Jotform são numéricos até ~19 dígitos: compara por comprimento e depois lexicograficamente
const compareIds = (a, b) =>
  String(a).length - String(b).length || (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

// "YYYY-MM-DD HH:mm:ss" ordena correctamente como texto. Mais recente primeiro; desempata por id.
const newestFirst = (a, b) => {
  const ca = a.created_at || "";
  const cb = b.created_at || "";
  if (ca !== cb) return ca < cb ? 1 : -1;
  return compareIds(b.id, a.id);
};

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.upstreamStatus = status;
  }
}

/** Obtém uma página de submissões. A key vai no header APIKEY (não no URL, para não aparecer em logs). */
async function fetchPage(formID, apiKey, limit, offset) {
  const url =
    `${JOTFORM_API_BASE}/form/${formID}/submissions` +
    `?orderby=created_at&direction=DESC&limit=${limit}&offset=${offset}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { APIKEY: apiKey }, signal: controller.signal });
    let body = null;
    try {
      body = await response.json();
    } catch {
      /* corpo não-JSON: tratado abaixo */
    }
    if (!response.ok || !body || !Array.isArray(body.content)) {
      throw new UpstreamError(body?.message || `Resposta inesperada da Jotform (HTTP ${response.status})`, response.status);
    }
    return body.content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devolve as submissões do formulário, garantidamente da mais recente para a mais antiga.
 *
 * A Jotform não documenta oficialmente o sentido do `orderby`. Por isso: pedimos created_at DESC,
 * e se a página vier cheia e AO CONTRÁRIO (mais antigas primeiro) paginamos até ao fim,
 * para nunca perder as mais recentes por causa do `limit`.
 */
async function loadSubmissions(formID, apiKey, limit) {
  let all = await fetchPage(formID, apiKey, limit, 0);

  const pageIsFull = all.length === limit;
  const looksAscending = all.length > 1 && (all[0].created_at || "") < (all[all.length - 1].created_at || "");

  if (pageIsFull && looksAscending) {
    for (let page = 1; page < MAX_PAGES; page++) {
      const next = await fetchPage(formID, apiKey, limit, page * limit);
      all = all.concat(next);
      if (next.length < limit) break;
    }
  }

  return all.sort(newestFirst);
}

/* ----------------------------- handler ----------------------------- */

export default async function handler(req, res) {
  setHeaders(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return fail(res, 405, "Método não permitido. Usa GET.");

  // --- Validação de configuração do servidor ---
  const apiKey = process.env.JOTFORM_API_KEY;
  if (!apiKey) return fail(res, 500, "JOTFORM_API_KEY não está configurada no servidor.");

  // --- Validação dos parâmetros ---
  const formID = first(req.query?.formID);
  const questionID = first(req.query?.questionID);

  if (!/^\d+$/.test(formID)) return fail(res, 400, "Parâmetro 'formID' em falta ou inválido (tem de ser numérico).");
  if (!/^\d+$/.test(questionID)) return fail(res, 400, "Parâmetro 'questionID' em falta ou inválido (tem de ser numérico).");

  let limit = parseInt(first(req.query?.limit), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const allowed = (process.env.ALLOWED_FORM_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(formID)) {
    return fail(res, 403, "Este formulário não está autorizado neste proxy.");
  }

  // --- Consulta à Jotform ---
  try {
    const submissions = (await loadSubmissions(formID, apiKey, limit))
      .filter((s) => s && s.status !== "DELETED")
      .map((s) => {
        const field = s.answers?.[questionID];
        return {
          id: s.id,
          created_at: s.created_at || "",
          answer: field?.answer ?? null,        // valor bruto (string, array ou objecto, conforme o tipo de campo)
          pretty: field?.prettyFormat ?? null,  // versão legível para campos compostos (nome, morada, ...)
        };
      });

    return res.status(200).json({ ok: true, formID, questionID, count: submissions.length, submissions });
  } catch (err) {
    console.error("Erro no proxy Jotform:", err?.name, err?.message, err?.upstreamStatus ?? "");

    if (err.name === "AbortError") return fail(res, 504, "A Jotform demorou demasiado a responder.");
    switch (err.upstreamStatus) {
      case 401:
      case 403:
        return fail(res, 502, "A Jotform recusou a API key (inválida ou sem permissão para este formulário).");
      case 404:
        return fail(res, 404, "Formulário não encontrado na Jotform (confirma o ID e a região EU).");
      case 429:
        return fail(res, 429, "Limite diário de pedidos da API Jotform atingido.");
      default:
        return fail(res, 502, "Erro ao consultar a API da Jotform.");
    }
  }
}
