export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
        // Check API key
        if (!env.GEMINI_API_KEY) {
          return json(
            {
              error: "GEMINI_API_KEY is missing."
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

        // Session ID
        const sessionId =
          typeof body?.sessionId === "string" &&
          body.sessionId.trim()
            ? body.sessionId.trim()
            : crypto.randomUUID();

        if (!userMessage) {
          return json(
            {
              error: "Message is required.",
              sessionId
            },
            400,
            cors
          );
        }

        // =========================
        // LOAD OLD CONVERSATION
        // =========================

        let history = [];

        if (env.DB) {
          const result = await env.DB
            .prepare(
              `SELECT role, message
               FROM conversations
               WHERE session_id = ?
               ORDER BY id ASC
               LIMIT 30`
            )
            .bind(sessionId)
            .all();

          history = result.results || [];
        }

        // =========================
        // BUILD GEMINI CONTENT
        // =========================

        const contents = history.map(row => ({
          role:
            row.role === "assistant"
              ? "model"
              : "user",
          parts: [
            {
              text: row.message
            }
          ]
        }));

        contents.push({
          role: "user",
          parts: [
            {
              text: userMessage
            }
          ]
        });

        // =========================
        // GEMINI
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
              systemInstruction: {
                parts: [
                  {
                    text:
                      "You are RS AI, a fast, helpful and friendly AI assistant. " +
                      "You can communicate in Kirundi, English, French and other languages. " +
                      "Answer clearly and naturally. " +
                      "If the user speaks Kirundi, answer in Kirundi."
                  }
                ]
              },

              contents: contents,

              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024
              }
            })
          }
        );

        const data = await response.json();

        // =========================
        // GEMINI ERROR
        // =========================

        if (!response.ok) {
          console.error(
            "Gemini error:",
            JSON.stringify(data)
          );

          return json(
            {
              error: "Gemini API error",
              details:
                data?.error?.message ||
                "Unknown Gemini error.",
              sessionId
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
              sessionId
            },
            502,
            cors
          );
        }

        // =========================
        // SAVE CONVERSATION
        // =========================

        if (env.DB) {
          await env.DB.batch([
            env.DB
              .prepare(
                `INSERT INTO conversations
                 (session_id, role, message)
                 VALUES (?, ?, ?)`
              )
              .bind(
                sessionId,
                "user",
                userMessage
              ),

            env.DB
              .prepare(
                `INSERT INTO conversations
                 (session_id, role, message)
                 VALUES (?, ?, ?)`
              )
              .bind(
                sessionId,
                "assistant",
                answer
              )
          ]);
        }

        // =========================
        // SUCCESS
        // =========================

        return json(
          {
            answer,
            sessionId
          },
          200,
          cors
        );

      } catch (error) {
        console.error(
          "RS AI Worker error:",
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
// JSON HELPER
// =========================

function json(data, status = 200, cors = {}) {
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
