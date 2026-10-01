function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || ""));
}

function answerToText(answer) {
  if (answer === null || answer === undefined) return "";
  if (typeof answer === "string" || typeof answer === "number" || typeof answer === "boolean") {
    return String(answer);
  }
  if (Array.isArray(answer)) {
    return answer.map(answerToText).filter(Boolean).join(", ");
  }
  if (typeof answer === "object") {
    return Object.values(answer).map(answerToText).filter(Boolean).join(" ").trim();
  }
  return String(answer);
}

async function jotformGet(path, apiKey) {
  const url = `https://eu-api.jotform.com${path}${path.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await response.json();

  if (!response.ok || (data.responseCode && data.responseCode >= 400)) {
    const message = data.message || `Erro Jotform HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });

  const { formID, fieldID, submissionID } = req.query;
  const apiKey = process.env.JOTFORM_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "JOTFORM_API_KEY não configurada no servidor." });
  }
  if (!isNumericId(formID) || !isNumericId(fieldID)) {
    return res.status(400).json({ error: "formID e fieldID têm de ser IDs numéricos válidos." });
  }
  if (submissionID && !isNumericId(submissionID)) {
    return res.status(400).json({ error: "submissionID inválido." });
  }

  try {
    let submission;

    if (submissionID) {
      const data = await jotformGet(`/submission/${submissionID}`, apiKey);
      submission = data.content;

      if (!submission) {
        return res.status(404).json({ error: "Submissão não encontrada." });
      }
      if (String(submission.form_id || "") !== String(formID)) {
        return res.status(400).json({ error: "A submissão indicada não pertence ao formulário configurado." });
      }
    } else {
      const data = await jotformGet(`/form/${formID}/submissions?limit=100`, apiKey);
      const submissions = Array.isArray(data.content) ? data.content : [];

      if (!submissions.length) {
        return res.status(404).json({ error: "O formulário de origem não tem submissões." });
      }

      submission = submissions
        .filter(item => item && item.status !== "DELETED")
        .sort((a, b) => {
          const da = new Date(a.created_at || 0).getTime();
          const db = new Date(b.created_at || 0).getTime();
          return db - da;
        })[0];
    }

    if (!submission) {
      return res.status(404).json({ error: "Não foi encontrada uma submissão válida." });
    }

    const field = submission.answers?.[String(fieldID)];
    if (!field) {
      return res.status(404).json({ error: `O campo ${fieldID} não existe nesta submissão.` });
    }

    const value = answerToText(field.answer);

    return res.status(200).json({
      value,
      submissionID: String(submission.id || submissionID || ""),
      created_at: submission.created_at || null,
      fieldID: String(fieldID)
    });
  } catch (error) {
    console.error("Erro no proxy Jotform:", error);
    return res.status(500).json({ error: error.message || "Erro ao consultar a API Jotform." });
  }
}
