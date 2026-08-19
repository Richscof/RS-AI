export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);

    if (url.pathname !== "/api/chat") {
      return new Response("RS AI is running 🤖", {
        status: 200
      });
    }

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
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Authorization":
              `Bearer ${env.OPENAI_API_KEY}`
          },

          body: JSON.stringify({
            model: "gpt-5.6-luna",
            input: userMessage
          })
        }
      );

      const data = await aiResponse.json();

      if (!aiResponse.ok) {

        return json({
          error:
            data?.error?.message ||
            "AI API error."
        }, aiResponse.status);

      }

      const answer =
        data.output_text ||
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
};


function corsHeaders() {

  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type"
  };

}


function json(data, status = 200) {

  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "Content-Type":
          "application/json",

        ...corsHeaders()
      }
    }
  );

}
