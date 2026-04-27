/**
 * Jazzy Resumes — Vercel Serverless Proxy
 *
 * Vercel hobby tier: no hard timeout on serverless functions (up to 60s default,
 * configurable to 300s on pro). Free tier is sufficient for all phases.
 *
 * No SSE, no streaming complexity. Collects full Anthropic response, returns JSON.
 * Phase 2 runs both sub-calls in parallel via Promise.all.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not set in Vercel environment variables" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  // Set CORS on all responses
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // Phase 2 — two prompts in parallel
  if (body.phase === "2") {
    try {
      const [text1, text2] = await Promise.all([
        callAnthropic(apiKey, body.prompt1, body.system1, body.max_tokens || 2048),
        callAnthropic(apiKey, body.prompt2, body.system2, body.max_tokens || 2048),
      ]);
      return res.status(200).json({ ok: true, text1, text2 });
    } catch (err) {
      console.error("Phase 2 error:", err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // All other phases — single call
  try {
    const text = await callAnthropic(
      apiKey,
      body.prompt,
      body.system,
      body.max_tokens || 2048
    );
    return res.status(200).json({ ok: true, text });
  } catch (err) {
    console.error("Phase error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function callAnthropic(apiKey, prompt, system, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system: system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const t = await response.text();
    throw new Error("Anthropic " + response.status + ": " + t.slice(0, 300));
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  return data.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("");
}
