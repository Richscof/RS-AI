export default {
  async fetch(request, env) {

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // =========================
    // CORS
    // =========================

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

        // =========================
        // CHECK API KEY
        // =========================

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

        // =========================
        // READ USER MESSAGE
        // =========================

        const body = await request.json();

        const userMessage =
          typeof body?.message === "string"
            ? body.message.trim()
            : "";

        const sessionId =
          typeof body?.sessionId === "string" &&
          body.sessionId.trim()
            ? body.sessionId.trim()
            : crypto.randomUUID();

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
        // SAVE USER MESSAGE
        // =========================

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
          } catch (dbError) {
            console.error(
              "D1 save error:",
              dbError
            );
          }
        }

        // =========================
        // GET PREVIOUS CHAT
        // =========================

        let history = [];

        if (env.DB) {
          try {

            const result =
              await env.DB.prepare(
                `SELECT role, message
                 FROM conversations
                 WHERE session_id = ?
                 ORDER BY id DESC
                 LIMIT 20`
              )
                .bind(sessionId)
                .all();

            history =
              (result.results || [])
                .reverse();

          } catch (dbError) {

            console.error(
              "D1 history error:",
              dbError
            );
          }
        }

        // =========================
        // MULTI-LANGUAGE AI
        // =========================

        const systemInstruction = `
You are RS AI, a fast, helpful and intelligent AI assistant.

LANGUAGE RULE:
Automatically detect the language used by the user.
Always answer in the same language as the user unless the user asks for another language.

You can communicate in many languages, including:
Kirundi, English, French, Kiswahili, Spanish, Portuguese,
Arabic, Chinese, Japanese, Korean, German, Italian,
Dutch, Russian, Turkish, Hindi and other languages.

If the user writes in Kirundi, answer naturally in Kirundi.
If the user writes in French, answer in French.
If the user writes in English, answer in English.

Do not unnecessarily translate the user's message.

Be clear, friendly, accurate and concise.
Help with questions, coding, technology, education and everyday topics.

Your name is RS AI.
`;

        // =========================
        // BUILD CONTENTS
        // =========================

        const contents = [];

        // Previous conversation
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

        // Current message
        contents.push({
          role: "user",
          parts: [
            {
              text: userMessage
            }
          ]
        });

        // =========================
        // MODELS
        // =========================

        const models = [
          "gemini-3.6-flash",
          "gemini-2.5-flash"
        ];

        let finalData = null;
        let finalResponse = null;

        // =========================
        // TRY MODELS
        // =========================

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

                    contents: contents,

                    generationConfig: {
                      temperature: 0.7,
                      maxOutputTokens: 1024
                    }
                  })
                }
              );

            const data =
              await response.json();

            console.log(
              "Gemini model:",
              model,
              "status:",
              response.status
            );

            // SUCCESS
            if (response.ok) {

              finalData = data;
              finalResponse = response;

              break;
            }

            // TRY NEXT MODEL
            console.error(
              `Model ${model} failed:`,
              JSON.stringify(data)
            );

          } catch (modelError) {

            console.error(
              `Model ${model} request error:`,
              modelError
            );

          }
        }

        // =========================
        // ALL MODELS FAILED
        // =========================

        if (!finalData) {

          return json(
            {
              error:
                "RS AI is temporarily busy. Please try again in a few seconds."
            },
            503,
            cors
          );
        }

        // =========================
        // GET ANSWER
        // =========================

        const answer =
          finalData
            ?.candidates?.[0]
            ?.content
            ?.parts
            ?.map(
              part =>
                part?.text || ""
            )
            .join("")
            .trim();

        if (!answer) {

          return json(
            {
              error:
                "Gemini returned no answer."
            },
            502,
            cors
          );
        }

        // =========================
        // SAVE AI ANSWER
        // =========================

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

          } catch (dbError) {

            console.error(
              "D1 assistant save error:",
              dbError
            );

          }
        }

        // =========================
        // SUCCESS
        // =========================

        return json(
          {
            answer: answer,
            sessionId: sessionId
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
            error:
              "RS AI Worker error",
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
// JSON FUNCTION
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
