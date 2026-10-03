import { logger, schedules } from "@trigger.dev/sdk";

const TZ = "Asia/Kolkata";

type ClaudeResponse = { content?: Array<{ type: string; text?: string }> };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required Trigger.dev secret: ${name}`);
  return value;
}

async function claude(prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": required("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      max_tokens: 900,
      temperature: 0.7,
      system:
        "Write in Rishi Jain's voice: direct, practical, convicted, short paragraphs, one strong hook, no em dash, no generic AI filler. Return only the LinkedIn post text.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Claude failed (${response.status}): ${await response.text()}`);
  const data = (await response.json()) as ClaudeResponse;
  const text = data.content?.find((item) => item.type === "text")?.text?.trim();
  if (!text) throw new Error("Claude returned no text");
  return text;
}

async function createImage(prompt: string): Promise<string> {
  const endpoint = required("KIE_API_URL");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${required("KIE_API_KEY")}` },
    body: JSON.stringify({ prompt, aspect_ratio: "1:1", webhook_url: process.env.KIE_WEBHOOK_URL }),
  });
  if (!response.ok) throw new Error(`kie.ai failed (${response.status}): ${await response.text()}`);
  const data = (await response.json()) as { image_url?: string; url?: string; data?: { image_url?: string; url?: string } };
  const url = data.image_url ?? data.url ?? data.data?.image_url ?? data.data?.url;
  if (!url) throw new Error("kie.ai response did not include an image URL");
  return url;
}

async function publishToLinkedIn(text: string, imageUrl?: string): Promise<string> {
  const token = required("LINKEDIN_ACCESS_TOKEN");
  const author = required("LINKEDIN_AUTHOR_URN");
  const version = process.env.LINKEDIN_API_VERSION ?? "202601";
  const headers = { Authorization: `Bearer ${token}`, "LinkedIn-Version": version, "X-Restli-Protocol-Version": "2.0.0", "content-type": "application/json" };

  // Text publishing is always supported. Image attachment can be enabled once
  // the LinkedIn app has the Images API product and an asset upload flow.
  const body: Record<string, unknown> = {
    author,
    commentary: text,
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (imageUrl) logger.info("Image generated for LinkedIn post", { imageUrl });
  const response = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`LinkedIn publish failed (${response.status}): ${await response.text()}`);
  return response.headers.get("x-restli-id") ?? response.headers.get("location") ?? "published";
}

export const dailyLinkedInPost = schedules.task({
  id: "daily-linkedin-post",
  cron: { pattern: "0 9 * * *", timezone: TZ, environments: ["PRODUCTION"] },
  run: async (payload) => {
    const topic = process.env.LINKEDIN_DAILY_TOPIC ?? "one practical AI idea that helps marketers and business owners work better";
    const post = await claude(`Create today's LinkedIn post about: ${topic}. Use one concrete example and end with one action the reader can take today. Keep it under 1,300 characters.`);
    const image = await createImage(`Premium editorial LinkedIn visual for this idea: ${post.slice(0, 500)}. Square 1:1 composition, sophisticated technology publication style, no logos, no readable text, no watermark.`);
    const postId = await publishToLinkedIn(post, image);
    logger.info("Daily LinkedIn post published", { postId, scheduledFor: payload.timestamp, timezone: payload.timezone });
    return { postId, post, imageUrl: image };
  },
});
