export default {
  async fetch(request, env, ctx) {
    // 1. Setup CORS so the browser accepts the response
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, reply: "Only POST requests allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    try {
      // 2. Safety Check: Is the AI binding attached?
      if (!env.AI) {
        throw new Error("AI Binding is missing! Please check Cloudflare Settings > Variables > Bindings.");
      }

      const body = await request.json();
      const message = body.message || "";
      const catalog = body.catalog || [];

      const catalogSnippet = catalog.length ? `Known Products: ${catalog.join(", ")}` : "";

      const systemPrompt = `You are "Sunny AI", a strict POS command parser for a Kiryana Store. 
Read the user's Roman Urdu input and return ONLY a valid JSON object starting with { and ending with }.

${catalogSnippet}

Valid Actions: "sale", "return", "list_products", "low_stock", "stock", "customer_balance", "customer_payment", "customer_cash_out", "add_new_product", "update_price", "update_cost", "add_stock", "report", "chat"

Rules:
1. Sales/Items: {"action": "sale", "items": [{"product": "name", "qty": 1}], "payment": "cash"}
2. Reports: {"action": "report", "period": "daily"}
3. Chat: {"action": "chat", "reply": "Roman Urdu response"}
4. Stock check: {"action": "stock", "product": "name"}
5. Cash in/out: {"action": "customer_payment", "customer": "name", "amount": 500}

Output ONLY JSON. No markdown text formatting around it.`;

      // 3. Run the latest Cloudflare AI model
      const aiResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Input: "${message}"` }
        ],
        max_tokens: 500
      });

      let rawContent = aiResponse.response || "";
      
      // 4. Clean the output to ensure it is perfect JSON
      rawContent = rawContent.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      const firstBrace = rawContent.indexOf("{");
      const lastBrace = rawContent.lastIndexOf("}");
      
      if (firstBrace !== -1 && lastBrace !== -1) {
        rawContent = rawContent.substring(firstBrace, lastBrace + 1);
      } else {
        throw new Error("AI returned invalid data: " + rawContent);
      }

      const jsonParsed = JSON.parse(rawContent);

      return new Response(JSON.stringify({ ok: true, command: jsonParsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      // 5. Send the exact error back to the frontend
      return new Response(JSON.stringify({ ok: false, reply: "Worker Error: " + err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
