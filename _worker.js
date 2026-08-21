export default {
  async fetch(request, env) {

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    const url = new URL(request.url);

    // =========================
    // RS AI CHAT API
    // =========================
    if (url.pathname === "/api/chat") {

      if (request.method !== "POST") {
        return json(
          {
            error: "Method not allowed"
          },
          405,
          cors
        );
      }

      try {

        // Check API key
        if (!env.GEMINI_API_KEY) {
          return json(
            {
              error: "GEMINI_API_KEY is missing in Cloudflare Variables and Secrets."
            },
            500,
            cors
          );
        }

        // Read request
        const body = await request.json();

        const userMessage =
          typeof body?.message === "string"
            ? body.message.trim()
            : "";

        if (!userMessage) {
          return json(
            {
              error: "Message is required."
            },
            400,
            cors
          );
        }

        // =========================
        // GEMINI 3.6 FLASH
        // =========================

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
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

        // =========================
        // GEMINI ERROR
        // =========================

        if (!response.ok) {

          console.error(
            "Gemini API error:",
            JSON.stringify(data)
          );

          return json(
            {
              error: "Gemini API error",
              status: response.status,
              details:
                data?.error?.message ||
                JSON.stringify(data)
            },
            response.status,
            cors
          );
        }

        // =========================
        // GET ANSWER
        // =========================

        const answer =
          data?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || "")
            .join("")
            .trim();

        if (!answer) {

          return json(
            {
              error: "Gemini returned no answer.",
              details: JSON.stringify(data)
            },
            502,
            cors
          );
        }

        // =========================
        // SUCCESS
        // =========================

        return json(
          {
            answer: answer
          },
          200,
          cors
        );

      } catch (error) {

        console.error(
          "Worker error:",
          error
        );

        return json(
          {
            error: "Worker error",
            details:
              error?.message ||
              String(error)
          },
          500,
          cors
        );
      }
    }

    // =========================
    // WEBSITE FILES
    // =========================

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "RS AI is running 🤖",
      {
        status: 200,
        headers: cors
      }
    );
  }
};


// =========================
// JSON RESPONSE
// =========================

function json(data, status = 200, cors = {}) {

  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "Content-Type": "application/json",
        ...cors
      }
    }
  );
}
