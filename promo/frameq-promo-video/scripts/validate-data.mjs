import fs from "node:fs";
import path from "node:path";

const dataPath = path.join(process.cwd(), "src", "promoData.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("Missing src/promoData.json");
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const expected = {
  fps: 30,
  width: 1080,
  height: 1350,
  durationInFrames: 1350,
};

for (const [key, value] of Object.entries(expected)) {
  if (data.composition?.[key] !== value) {
    throw new Error(`composition.${key} must be ${value}`);
  }
}

if (!Array.isArray(data.scenes) || data.scenes.length !== 5) {
  throw new Error("Expected exactly 5 scenes");
}

if (!Array.isArray(data.captions) || data.captions.length !== 5) {
  throw new Error("Expected exactly 5 caption groups");
}

for (const scene of data.scenes) {
  if (scene.startFrame < 0 || scene.endFrame > expected.durationInFrames) {
    throw new Error(`Scene ${scene.id} is outside composition bounds`);
  }
  if (scene.endFrame <= scene.startFrame) {
    throw new Error(`Scene ${scene.id} has invalid frame range`);
  }
}

for (let index = 1; index < data.scenes.length; index += 1) {
  const previous = data.scenes[index - 1];
  const current = data.scenes[index];
  if (previous.endFrame !== current.startFrame) {
    throw new Error(`Scene ${previous.id} must end where ${current.id} starts`);
  }
}

if (data.scenes[0].startFrame !== 0) {
  throw new Error("First scene must start at frame 0");
}

if (data.scenes[data.scenes.length - 1].endFrame !== expected.durationInFrames) {
  throw new Error("Last scene must end at frame 1350");
}

const requiredKeywords = ["本地优先", "文字稿", "启发话题点", "轻量分发"];
for (const keyword of requiredKeywords) {
  if (!data.keywords.includes(keyword)) {
    throw new Error(`Missing keyword: ${keyword}`);
  }
}

if (!Array.isArray(data.captionWords) || data.captionWords.length === 0) {
  throw new Error("captionWords must contain at least one item");
}

for (const [index, item] of data.captionWords.entries()) {
  if (typeof item.text !== "string" || item.text.trim().length === 0) {
    throw new Error(`captionWords[${index}].text must be a non-empty string`);
  }

  for (const key of ["startMs", "endMs", "timestampMs", "confidence"]) {
    if (typeof item[key] !== "number" || !Number.isFinite(item[key])) {
      throw new Error(`captionWords[${index}].${key} must be a finite number`);
    }
  }

  if (item.startMs < 0) {
    throw new Error(`captionWords[${index}].startMs must be >= 0`);
  }

  if (item.endMs <= item.startMs) {
    throw new Error(`captionWords[${index}].endMs must be greater than startMs`);
  }

  if (item.timestampMs !== item.startMs) {
    throw new Error(`captionWords[${index}].timestampMs must equal startMs`);
  }

  if (item.confidence < 0 || item.confidence > 1) {
    throw new Error(`captionWords[${index}].confidence must be between 0 and 1`);
  }

  if (index === 0 && item.startMs !== 0) {
    throw new Error("First captionWords item must start at 0ms");
  }

  if (index > 0) {
    const previous = data.captionWords[index - 1];
    if (previous.endMs !== item.startMs) {
      throw new Error(`captionWords[${index - 1}] must end where captionWords[${index}] starts`);
    }
  }
}

if (data.captionWords[data.captionWords.length - 1].endMs !== 45000) {
  throw new Error("Last captionWords item must end at 45000ms");
}

console.log("promo data ok");
