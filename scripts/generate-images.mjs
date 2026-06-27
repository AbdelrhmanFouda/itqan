/**
 * Generate real product photos + client logos with Google Gemini ("Nano Banana")
 * and save them straight into public/ at the paths the site already references.
 *
 * Run LOCALLY (this needs network access to googleapis.com):
 *
 *   # macOS / Linux
 *   GOOGLE_AI_API_KEY=AIza...yourkey  npm run images
 *
 *   # Windows PowerShell
 *   $env:GOOGLE_AI_API_KEY="AIza...yourkey";  npm run images
 *
 * Get a free key at https://aistudio.google.com/apikey
 * Optional: set MODEL=gemini-3.1-flash-image-preview to override the default model.
 *
 * The key is read from the environment only — it is never written to a file.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("\n  Missing API key. Set GOOGLE_AI_API_KEY (free at https://aistudio.google.com/apikey).\n");
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const MODELS = process.env.MODEL
  ? [process.env.MODEL]
  : ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"];

const PHOTO = (s) =>
  `${s} Clean commercial product photography, soft diffused softbox lighting, subtle cyan rim light, gentle reflections, shallow depth of field, dark moody industrial background. Captured with a Canon EOS R5, 50mm lens at f/5.6. Wide landscape composition.`;

const LOGO = (name, mark, color) =>
  `A modern, minimalist, flat vector company logo on a clean solid white background for an Egyptian industrial company named "${name}". ${mark} The mark uses a ${color} palette, paired with a clean bold sans-serif wordmark "${name}" in dark slate grey. Balanced corporate branding, generous whitespace, crisp edges, no photographic texture.`;

const assets = [
  { out: "products/fan-housing.jpg", ratio: "4:3", prompt: PHOTO("Several glossy injection-molded ABS plastic fan housing shells for household electric fans, prominently displayed, neatly arranged on a dark brushed-steel workbench.") },
  { out: "products/counterweights.jpg", ratio: "4:3", prompt: PHOTO("A row of precision black plastic fan counterweight pieces, prominently displayed on a dark matte surface with a small digital scale faintly behind them.") },
  { out: "products/cable-clips.jpg", ratio: "4:3", prompt: PHOTO("Dozens of small black PA66 nylon automotive wire-harness cable clips, prominently displayed, arranged on a dark brushed-metal surface, macro detail.") },
  { out: "products/junction-boxes.jpg", ratio: "4:3", prompt: PHOTO("Custom grey polypropylene electrical junction boxes with removable lids, prominently displayed on a dark workbench.") },
  { out: "products/control-bezels.jpg", ratio: "4:3", prompt: PHOTO("Glossy black ABS appliance control-panel bezels with button cutouts, prominently displayed at a slight angle on a dark reflective surface.") },
  { out: "products/mounting-brackets.jpg", ratio: "4:3", prompt: PHOTO("Glass-filled black nylon industrial L-shaped mounting brackets with bolt holes, prominently displayed stacked on a dark steel surface.") },

  { out: "clients/nile-appliances.png", ratio: "1:1", prompt: LOGO("Nile Appliances", "A simple geometric emblem suggesting a stylized water wave merging into a fan blade.", "teal and deep blue") },
  { out: "clients/delta-electric.png", ratio: "1:1", prompt: LOGO("Delta Electric", "A triangular delta emblem with a subtle lightning bolt cut through it.", "amber and charcoal") },
  { out: "clients/cairo-auto.png", ratio: "1:1", prompt: LOGO("Cairo Auto Parts", "A circular emblem combining a stylized gear and a wrench.", "red and dark grey") },
  { out: "clients/pharaoh-plastics.png", ratio: "1:1", prompt: LOGO("Pharaoh Plastics", "An emblem of a stylized pharaoh headdress merging into a droplet shape.", "violet and indigo") },
  { out: "clients/giza-home.png", ratio: "1:1", prompt: LOGO("Giza Home Systems", "An emblem of three stylized pyramids forming a house roofline.", "blue and slate") },
  { out: "clients/suez-industrial.png", ratio: "1:1", prompt: LOGO("Suez Industrial Group", "A hexagon emblem with two interlocking gears inside.", "cyan and steel grey") },
];

async function callApi(prompt, ratio, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: ratio, imageSize: "1K" },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => p.inlineData)?.inlineData?.data;
  if (!inline) {
    throw new Error("No image returned: " + JSON.stringify(data).slice(0, 300));
  }
  return Buffer.from(inline, "base64");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(asset, model) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await callApi(asset.prompt, asset.ratio, model);
    } catch (e) {
      if (e.status === 429) {
        const wait = 15000 * (attempt + 1);
        console.log(`   rate limited — waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw new Error("rate limited: max retries exceeded");
}

async function run() {
  console.log(`Generating ${assets.length} images...\n`);
  let workingModel = null;
  let ok = 0;
  for (const asset of assets) {
    const outPath = join(PUBLIC, asset.out);
    mkdirSync(dirname(outPath), { recursive: true });
    const order = workingModel
      ? [workingModel, ...MODELS.filter((m) => m !== workingModel)]
      : MODELS;
    let saved = false;
    let lastErr;
    for (const model of order) {
      try {
        const buf = await generate(asset, model);
        writeFileSync(outPath, buf);
        workingModel = model;
        ok++;
        console.log(`✓ ${asset.out}  (${(buf.length / 1024).toFixed(0)} KB, ${model})`);
        saved = true;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!saved) console.error(`✗ ${asset.out}: ${lastErr?.message}`);
    await sleep(4000); // pace for free-tier rate limits
  }
  console.log(`\nDone: ${ok}/${assets.length} images saved. Run \`npm run dev\` to see them.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
