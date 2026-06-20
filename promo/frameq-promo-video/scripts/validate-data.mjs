import fs from "node:fs";
import path from "node:path";

const dataPath = path.join(process.cwd(), "src", "promoData.json");

if (!fs.existsSync(dataPath)) {
  throw new Error("Missing src/promoData.json");
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const expected = {
  id: "FrameQPromo",
  fps: 30,
  width: 1080,
  height: 1350,
  durationInFrames: 1350,
};

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

if (!isObject(data.composition)) {
  throw new Error("composition must be an object");
}

for (const [key, value] of Object.entries(expected)) {
  if (data.composition[key] !== value) {
    throw new Error(`composition.${key} must be ${value}`);
  }
}

if (!isObject(data.draft)) {
  throw new Error("draft must be an object");
}

for (const key of ["status", "title", "note"]) {
  if (!isNonEmptyString(data.draft[key])) {
    throw new Error(`draft.${key} must be a non-empty string`);
  }
}

for (const key of ["keywords", "voiceover", "scenes", "captions", "captionWords"]) {
  if (!Array.isArray(data[key])) {
    throw new Error(`${key} must be an array`);
  }
}

for (const [index, keyword] of data.keywords.entries()) {
  if (!isNonEmptyString(keyword)) {
    throw new Error(`keywords[${index}] must be a non-empty string`);
  }
}

for (const [index, line] of data.voiceover.entries()) {
  if (!isNonEmptyString(line)) {
    throw new Error(`voiceover[${index}] must be a non-empty string`);
  }
}

for (const [index, scene] of data.scenes.entries()) {
  if (!isObject(scene)) {
    throw new Error(`scenes[${index}] must be an object`);
  }
  for (const key of ["id", "label"]) {
    if (!isNonEmptyString(scene[key])) {
      throw new Error(`scenes[${index}].${key} must be a non-empty string`);
    }
  }
  for (const key of ["startFrame", "endFrame"]) {
    if (!Number.isInteger(scene[key])) {
      throw new Error(`scenes[${index}].${key} must be an integer`);
    }
  }
  if (scene.startFrame < 0 || scene.endFrame > expected.durationInFrames) {
    throw new Error(`scenes[${index}] is outside composition bounds`);
  }
  if (scene.endFrame <= scene.startFrame) {
    throw new Error(`scenes[${index}] has invalid frame range`);
  }
  if (index > 0 && data.scenes[index - 1].endFrame !== scene.startFrame) {
    throw new Error(`scenes[${index}] must start where the previous scene ends`);
  }
}

if (data.scenes.length > 0) {
  if (data.scenes[0].startFrame !== 0) {
    throw new Error("First scene must start at frame 0");
  }
  if (data.scenes[data.scenes.length - 1].endFrame !== expected.durationInFrames) {
    throw new Error("Last scene must end at frame 1350");
  }
}

for (const [index, caption] of data.captions.entries()) {
  if (!isObject(caption)) {
    throw new Error(`captions[${index}] must be an object`);
  }
  for (const key of ["text", "highlight"]) {
    if (!isNonEmptyString(caption[key])) {
      throw new Error(`captions[${index}].${key} must be a non-empty string`);
    }
  }
  for (const key of ["startFrame", "endFrame"]) {
    if (!Number.isInteger(caption[key])) {
      throw new Error(`captions[${index}].${key} must be an integer`);
    }
  }
  if (!caption.text.includes(caption.highlight)) {
    throw new Error(`captions[${index}].text must include its highlight`);
  }
}

for (const [index, item] of data.captionWords.entries()) {
  if (!isObject(item)) {
    throw new Error(`captionWords[${index}] must be an object`);
  }
  if (!isNonEmptyString(item.text)) {
    throw new Error(`captionWords[${index}].text must be a non-empty string`);
  }
  for (const key of ["startMs", "endMs", "timestampMs", "confidence"]) {
    if (typeof item[key] !== "number" || !Number.isFinite(item[key])) {
      throw new Error(`captionWords[${index}].${key} must be a finite number`);
    }
  }
  if (item.startMs < 0 || item.endMs <= item.startMs) {
    throw new Error(`captionWords[${index}] has invalid timing`);
  }
  if (item.timestampMs !== item.startMs) {
    throw new Error(`captionWords[${index}].timestampMs must equal startMs`);
  }
}

console.log("promo data ok");
