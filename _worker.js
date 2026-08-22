export default {
  async fetch(request, env) {

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    const url = new URL(request.url);

    // =====================================================
    // CHAT
    // =====================================================

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

        let sessionId =
          typeof body?.sessionId === "string"
            ? body.sessionId.trim()
            : "";

        if (!userMessage) {
          return json(
            { error: "Message is required." },
            400,
            cors
          );
        }

        if (!sessionId) {
          sessionId = crypto.randomUUID();
        }

        // -------------------------------------------------
        // SAVE USER MESSAGE
        // -------------------------------------------------

        if (env.DB) {
          try {

            await env.DB.prepare(
              `INSERT INTO conversations
              (session_id, role, message)
              VALUES (?, ?, ?)`
            )
              .bind(
                sessionId,
                "user",
                userMessage
              )
              .run();

          } catch (error) {
            console.error(
              "D1 user save error:",
              error
            );
          }
        }

        // -------------------------------------------------
        // LOAD PREVIOUS MESSAGES
        // -------------------------------------------------

        let history = [];

        if (env.DB) {
          try {

            const result =
              await env.DB.prepare(
                `SELECT role, message
                 FROM conversations
                 WHERE session_id = ?
                 ORDER BY id ASC
                 LIMIT 30`
              )
                .bind(sessionId)
                .all();

            history =
              result.results || [];

          } catch (error) {
            console.error(
              "D1 history error:",
              error
            );
          }
        }

        // -------------------------------------------------
        // AI INSTRUCTION
        // -------------------------------------------------

        const systemInstruction = `
You are RS AI.

You are a fast, helpful and intelligent AI assistant.

LANGUAGE:
Automatically detect the language of the user.
Always answer in the same language the user uses.

You can communicate in:
Kirundi, English, French, Kiswahili, Spanish,
Portuguese, Arabic, Chinese, Japanese, Korean,
German, Italian, Dutch, Russian, Turkish, Hindi
and many other languages.

If the user speaks Kirundi, answer naturally in Kirundi.
If the user speaks English, answer in English.
If the user speaks French, answer in French.

Do not unnecessarily translate the user's message.

Be helpful, clear, friendly and concise.

Your name is RS AI.
`;

        // -------------------------------------------------
        // BUILD GEMINI CONTENT
        // -------------------------------------------------

        const contents = [];

        for (const item of history) {

          if (
            item.role === "user" ||
            item.role === "assistant"
          ) {

            contents.push({
              role: item.role,
              parts: [
                {
                  text: item.message
                }
              ]
            });

          }
        }

        // -------------------------------------------------
        // GEMINI MODELS
        // -------------------------------------------------

        const models = [
          "gemini-3.6-flash",
          "gemini-2.5-flash"
        ];

        let data = null;

        for (const model of models) {

          try {

            const response =
              await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                {
                  method: "POST",

                  headers: {
                    "Content-Type":
                      "application/json",

                    "x-goog-api-key":
                      env.GEMINI_API_KEY
                  },

                  body: JSON.stringify({

                    systemInstruction: {
                      parts: [
                        {
                          text:
                            systemInstruction
                        }
                      ]
                    },

                    contents,

                    generationConfig: {
                      temperature: 0.7,
                      maxOutputTokens: 1024
                    }

                  })
                }
              );

            const result =
              await response.json();

            console.log(
              "Gemini:",
              model,
              response.status
            );

            if (response.ok) {
              data = result;
              break;
            }

          } catch (error) {

            console.error(
              "Gemini model error:",
              error
            );

          }

        }

        // -------------------------------------------------
        // NO MODEL AVAILABLE
        // -------------------------------------------------

        if (!data) {

          return json(
            {
              error:
                "RS AI is temporarily busy. Please try again in a few seconds."
            },
            503,
            cors
          );

        }

        // -------------------------------------------------
        // GET ANSWER
        // -------------------------------------------------

        const answer =
          data?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || "")
            .join("")
            .trim();

        if (!answer) {

          return json(
            {
              error:
                "RS AI returned no answer."
            },
            502,
            cors
          );

        }

        // -------------------------------------------------
        // SAVE AI ANSWER
        // -------------------------------------------------

        if (env.DB) {

          try {

            await env.DB.prepare(
              `INSERT INTO conversations
              (session_id, role, message)
              VALUES (?, ?, ?)`
            )
              .bind(
                sessionId,
                "assistant",
                answer
              )
              .run();

          } catch (error) {

            console.error(
              "D1 assistant save error:",
              error
            );

          }

        }

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
          "CHAT ERROR:",
          error
        );

        return json(
          {
            error:
              error?.message ||
              "Worker error"
          },
          500,
          cors
        );

      }

    }


    // =====================================================
    // HISTORY LIST
    // =====================================================

    if (url.pathname === "/api/history") {

      if (request.method !== "GET") {

        return json(
          { error: "Method not allowed" },
          405,
          cors
        );

      }

      if (!env.DB) {

        return json(
          {
            error:
              "D1 database binding DB is missing."
          },
          500,
          cors
        );

      }

      try {

        const result =
          await env.DB.prepare(
            `
            SELECT
              session_id,
              MIN(id) AS first_id,
              MAX(id) AS last_id,
              MAX(created_at) AS updated_at,
              (
                SELECT message
                FROM conversations c2
                WHERE c2.session_id = c.session_id
                AND c2.role = 'user'
                ORDER BY c2.id ASC
                LIMIT 1
              ) AS title
            FROM conversations c
            GROUP BY session_id
            ORDER BY last_id DESC
            LIMIT 50
            `
          )
            .all();

        const history =
          (result.results || []).map(item => ({

            sessionId:
              item.session_id,

            title:
              item.title ||
              "New conversation",

            updatedAt:
              item.updated_at

          }));

        return json(
          {
            history
          },
          200,
          cors
        );

      } catch (error) {

        console.error(
          "HISTORY ERROR:",
          error
        );

        return json(
          {
            error:
              error?.message ||
              "Could not load history."
          },
          500,
          cors
        );

      }

    }


    // =====================================================
    // LOAD ONE CONVERSATION
    // =====================================================

    if (url.pathname === "/api/history/chat") {

      if (request.method !== "GET") {

        return json(
          { error: "Method not allowed" },
          405,
          cors
        );

      }

      if (!env.DB) {

        return json(
          {
            error:
              "D1 database binding DB is missing."
          },
          500,
          cors
        );

      }

      const sessionId =
        url.searchParams.get(
          "sessionId"
        );

      if (!sessionId) {

        return json(
          {
            error:
              "sessionId is required."
          },
          400,
          cors
        );

      }

      try {

        const result =
          await env.DB.prepare(
            `
            SELECT
              role,
              message,
              created_at
            FROM conversations
            WHERE session_id = ?
            ORDER BY id ASC
            LIMIT 100
            `
          )
            .bind(sessionId)
            .all();

        return json(
          {
            sessionId,
            messages:
              result.results || []
          },
          200,
          cors
        );

      } catch (error) {

        console.error(
          "LOAD CHAT ERROR:",
          error
        );

        return json(
          {
            error:
              error?.message ||
              "Could not load conversation."
          },
          500,
          cors
        );

      }

    }


    // =====================================================
    // DELETE ONE CONVERSATION
    // =====================================================

    if (url.pathname === "/api/history/delete") {

      if (request.method !== "DELETE") {

        return json(
          { error: "Method not allowed" },
          405,
          cors
        );

      }

      if (!env.DB) {

        return json(
          {
            error:
              "D1 database binding DB is missing."
          },
          500,
          cors
        );

      }

      try {

        const body =
          await request.json();

        const sessionId =
          body?.sessionId;

        if (!sessionId) {

          return json(
            {
              error:
                "sessionId is required."
            },
            400,
            cors
          );

        }

        await env.DB.prepare(
          `
          DELETE FROM conversations
          WHERE session_id = ?
          `
        )
          .bind(sessionId)
          .run();

        return json(
          {
            success: true
          },
          200,
          cors
        );

      } catch (error) {

        return json(
          {
            error:
              error?.message ||
              "Could not delete conversation."
          },
          500,
          cors
        );

      }

    }


    // =====================================================
    // WEBSITE
    // =====================================================

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


// =====================================================
// JSON RESPONSE
// =====================================================

function json(
  data,
  status = 200,
  cors = {}
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json",

        ...cors
      }
    }
  );

}
