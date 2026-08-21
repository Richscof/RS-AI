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

    // ==========================================
    // RS AI CHAT
    // ==========================================

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
              error:
                "GEMINI_API_KEY is missing in Cloudflare."
            },
            500,
            cors
          );
        }

        // Check D1
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

        const body =
          await request.json();

        const userMessage =
          typeof body?.message === "string"
            ? body.message.trim()
            : "";

        const sessionId =
          typeof body?.sessionId === "string"
            ? body.sessionId.trim()
            : "default";

        if (!userMessage) {
          return json(
            {
              error:
                "Message is required."
            },
            400,
            cors
          );
        }

        // ======================================
        // SAVE USER MESSAGE
        // ======================================

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


        // ======================================
        // LOAD PREVIOUS CONVERSATION
        // ======================================

        const historyResult =
          await env.DB.prepare(
            `SELECT role, message
             FROM conversations
             WHERE session_id = ?
             ORDER BY id DESC
             LIMIT 20`
          )
          .bind(sessionId)
          .all();


        const history =
          (historyResult.results || [])
            .reverse();


        // ======================================
        // CREATE GEMINI CONTENT
        // ======================================

        const contents =
          history.map(item => ({
            role:
              item.role === "assistant"
                ? "model"
                : "user",

            parts: [
              {
                text: item.message
              }
            ]
          }));


        // ======================================
        // RS AI PERSONALITY
        // ======================================

        contents.unshift({
          role: "user",
          parts: [
            {
              text:
                `You are RS AI, a fast and helpful
AI assistant.

You can communicate in:
- Kirundi
- French
- English
- Swahili
- and other languages.

Always answer in the same language
the user uses unless they ask for another
language.

Be clear, friendly and useful.

Keep answers reasonably concise so
responses can be fast.`
            }
          ]
        });


        // ======================================
        // GEMINI 3.6 FLASH
        // ======================================

        const response =
          await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                "x-goog-api-key":
                  env.GEMINI_API_KEY
              },

              body: JSON.stringify({
                contents: contents,

                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 1024
                }
              })
            }
          );


        // ======================================
        // GEMINI ERROR
        // ======================================

        if (!response.ok) {

          const errorText =
            await response.text();

          console.error(
            "Gemini error:",
            errorText
          );

          return json(
            {
              error:
                "Gemini API error",

              details:
                errorText
            },
            response.status,
            cors
          );
        }


        // ======================================
        // STREAM RESPONSE
        // ======================================

        const reader =
          response.body.getReader();

        const decoder =
          new TextDecoder();

        let buffer = "";

        let fullAnswer = "";


        const stream =
          new ReadableStream({

            async start(controller) {

              try {

                while (true) {

                  const {
                    value,
                    done
                  } =
                    await reader.read();


                  if (done) {
                    break;
                  }


                  buffer +=
                    decoder.decode(
                      value,
                      {
                        stream: true
                      }
                    );


                  const lines =
                    buffer.split("\n");


                  buffer =
                    lines.pop() || "";


                  for (
                    const line
                    of lines
                  ) {

                    const trimmed =
                      line.trim();


                    if (
                      !trimmed ||
                      !trimmed.startsWith("data:")
                    ) {
                      continue;
                    }


                    const dataText =
                      trimmed
                        .substring(5)
                        .trim();


                    if (
                      !dataText ||
                      dataText === "[DONE]"
                    ) {
                      continue;
                    }


                    try {

                      const data =
                        JSON.parse(
                          dataText
                        );


                      const parts =
                        data
                          ?.candidates?.[0]
                          ?.content?.parts;


                      if (
                        !Array.isArray(parts)
                      ) {
                        continue;
                      }


                      for (
                        const part
                        of parts
                      ) {

                        if (
                          typeof part?.text !==
                          "string"
                        ) {
                          continue;
                        }


                        const text =
                          part.text;


                        fullAnswer +=
                          text;


                        /*
                         * Send text immediately
                         * to index.html
                         */

                        controller.enqueue(
                          new TextEncoder().encode(
                            "data: " +
                            JSON.stringify({
                              text: text
                            }) +
                            "\n\n"
                          )
                        );

                      }

                    } catch (error) {

                      console.error(
                        "Chunk error:",
                        error
                      );

                    }

                  }

                }


                // =================================
                // SAVE AI ANSWER TO D1
                // =================================

                if (
                  fullAnswer.trim()
                ) {

                  await env.DB.prepare(
                    `INSERT INTO conversations
                     (session_id, role, message)
                     VALUES (?, ?, ?)`
                  )
                  .bind(
                    sessionId,
                    "assistant",
                    fullAnswer
                  )
                  .run();

                }


                controller.enqueue(
                  new TextEncoder().encode(
                    "data: [DONE]\n\n"
                  )
                );


                controller.close();

              } catch (error) {

                console.error(
                  "Streaming error:",
                  error
                );

                controller.error(
                  error
                );

              }

            }

          });


        return new Response(
          stream,
          {
            status: 200,

            headers: {
              ...cors,

              "Content-Type":
                "text/event-stream",

              "Cache-Control":
                "no-cache",

              "Connection":
                "keep-alive",

              "X-Accel-Buffering":
                "no"
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
            error:
              "Worker error",

            details:
              error?.message ||
              String(error)
          },
          500,
          cors
        );

      }

    }


    // ==========================================
    // WEBSITE
    // ==========================================

    if (env.ASSETS) {
      return env.ASSETS.fetch(
        request
      );
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


// ==========================================
// JSON FUNCTION
// ==========================================

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
