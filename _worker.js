export default {
  async fetch(request, env) {

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    const url = new URL(request.url);

    // =========================
    // RS AI CHAT
    // =========================
    if (url.pathname === "/api/chat") {

      if (request.method !== "POST") {
        return json(
          { error: "Method not allowed" },
          405,
          cors
        );
      }

      try {

        if (!env.GEMINI_API_KEY) {
          return json(
            {
              error:
                "GEMINI_API_KEY is missing in Cloudflare."
            },
            500,
            cors
          );
        }

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
        // FAST GEMINI STREAMING
        // =========================

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse",
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key":
                env.GEMINI_API_KEY
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
              ],

              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024
              }
            })
          }
        );

        // Gemini error
        if (!response.ok) {

          const errorText =
            await response.text();

          console.error(
            "Gemini error:",
            errorText
          );

          return new Response(
            JSON.stringify({
              error: "Gemini API error",
              details: errorText
            }),
            {
              status: response.status,
              headers: {
                "Content-Type":
                  "application/json",
                ...cors
              }
            }
          );
        }

        // =========================
        // STREAM RESPONSE
        // =========================

        return new Response(
          response.body,
          {
            status: 200,

            headers: {
              "Content-Type":
                "text/event-stream",

              "Cache-Control":
                "no-cache, no-transform",

              "Connection":
                "keep-alive",

              ...cors
            }
          }
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
    // WEBSITE
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

function json(
  data,
  status = 200,
  cors = {}
) {
  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "Content-Type":
          "application/json",

        ...cors
      }
    }
  );
}
