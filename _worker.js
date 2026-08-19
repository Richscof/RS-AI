export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);

    // API route
    if (url.pathname === "/api/chat") {

      if (request.method !== "POST") {
        return json({
          error: "Method not allowed"
        }, 405);
      }

      try {
        const body = await request.json();
        const userMessage = body.message?.trim();

        if (!userMessage) {
          return json({
            error: "Message is required."
          }, 400);
        }

        const aiResponse = await fetch(
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

        const data = await aiResponse.json();

        if (!aiResponse.ok) {
          return json({
            error:
              data?.error?.message ||
              "Gemini API error."
          }, aiResponse.status);
        }

        const answer =
          data?.candidates?.[0]?.content?.parts?.[0]?.text ||
          "I could not generate an answer.";

        return json({
          answer: answer
        });

      } catch (error) {

        return json({
          error: "Server error."
        }, 500);
      }
    }

    // Serve index.html and other website files
    return env.ASSETS.fetch(request);
  }
};


function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "Content-Type": "application/json",
        ...corsHeaders()
      }
    }
  );
}
