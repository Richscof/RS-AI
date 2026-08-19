export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, cors);
      }

      try {
        if (!env.GEMINI_API_KEY) {
          return json({
            error: "GEMINI_API_KEY is missing in Cloudflare."
          }, 500, cors);
        }

        const body = await request.json();
        const userMessage = body?.message?.trim();

        if (!userMessage) {
          return json({
            error: "Message is required."
          }, 400, cors);
        }

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": env.GEMINI_API_KEY
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      text: userMessage
                    }
                  ]
                }
              ]
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return json({
            error: "Gemini API error",
            status: response.status,
            details: data?.error?.message || data
          }, response.status, cors);
        }

        const answer =
          data?.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("") ||
          "No answer was generated.";

        return json({
          answer
        }, 200, cors);

      } catch (error) {
        return json({
          error: "Worker error",
          details: error?.message || String(error)
        }, 500, cors);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status, cors) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...cors
      }
    }
  );
}
